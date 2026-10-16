import { createHash } from 'node:crypto';
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js';
import {
  EXPORT_EXTENSION, EXPORT_FORMAT, EXPORT_LINK_PREFIX, EXPORT_VERSION,
  type Dossier, type DossierItem, type ExportDossier, type ExportDossierItem, type ExportImage, type ExportInvestigation,
  type ExportMeta, type ExportRelation, type ExportRequest, type ExportSearch, type Investigation, type Source,
} from '@ft/shared';
import { can } from '../authz.ts';
import type { Deps } from '../ports.ts';
import { archivePassword } from './password.ts';

// Сборка файла экспорта (формат описан в packages/shared/src/export.ts).
// В файл попадает только то, что экспортирующий может читать: досье — по can(), снимки поиска — только свои.
// Связанные досье берутся на один уровень: у досье — участники группы и связанные персоны, у расследования —
// досье узлов графа; их собственные связи дальше не разворачиваются (связи между вошедшими досье — сохраняются).

configure({ useWebWorkers: false });

const APP = 'RuLeaks.Следопыт';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'image/bmp': 'bmp', 'image/heic': 'heic', 'image/avif': 'avif',
};
/** Уже сжатое не пережимаем. */
const STORED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/avif']);

function decodeDataUrl(url: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),/.exec(url);
  if (!m) return null;
  const body = url.slice(m[0].length);
  const base64 = m[2]!.split(';').includes('base64');
  try {
    return { mime: (m[1] || 'application/octet-stream').toLowerCase(), bytes: base64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body)) };
  } catch {
    return null;
  }
}

interface MediaFile { file: string; mime: string; bytes: Buffer; sha256: string }

class Builder {
  private dossierKeys = new Map<string, string>();
  private dossiers: Dossier[] = [];
  private searchKeys = new Map<string, string>();
  private searches: ExportSearch[] = [];
  private media = new Map<string, MediaFile>();
  private root: { type: 'dossier' | 'investigation'; id: string; title: string } | null = null;

  constructor(private deps: Deps, private userId: string) {}

  addDossier(d: Dossier): void {
    if (this.dossierKeys.has(d.id)) return;
    this.dossierKeys.set(d.id, `d${this.dossierKeys.size + 1}`);
    this.dossiers.push(d);
  }

  async addDossierIds(ids: Iterable<string>): Promise<void> {
    const fresh = [...new Set(ids)].filter((id) => !this.dossierKeys.has(id));
    // Право чтения — по шапкам одной выборкой; целиком загружаются только те досье, что войдут в файл.
    const heads = await this.deps.dossiers.heads(fresh);
    const allowed = new Set(heads.filter((h) => can(this.userId, 'read', h)).map((h) => h.id));
    for (const id of fresh) {
      if (!allowed.has(id)) continue;
      const d = await this.deps.dossiers.get(id);
      if (d) this.addDossier(d);
    }
  }

  setRoot(type: 'dossier' | 'investigation', id: string, title: string) {
    this.root = { type, id, title };
  }

  /** Снимки поиска, на которые ссылаются элементы и источники: берутся только свои (как и в интерфейсе). */
  async addSearches(ids: Iterable<string>): Promise<void> {
    for (const id of new Set(ids)) {
      if (this.searchKeys.has(id)) continue;
      const s = await this.deps.searches.get(id, this.userId);
      if (!s) continue;
      const key = `s${this.searchKeys.size + 1}`;
      this.searchKeys.set(id, key);
      this.searches.push({
        key, section: s.section, kind: s.kind, query: s.query, deep: s.deep, params: s.params, state: s.state,
        error: s.error, candidates: s.candidates, result: s.result ?? null, startedAt: s.startedAt,
      });
    }
  }

  // ---------- Преобразование без идентификаторов базы ----------

  image(url: string): ExportImage {
    const data = decodeDataUrl(url);
    if (!data) return { url };
    const sha256 = createHash('sha256').update(data.bytes).digest('hex');
    let f = this.media.get(sha256);
    if (!f) {
      f = { file: `media/m${this.media.size + 1}.${EXT[data.mime] ?? 'bin'}`, mime: data.mime, bytes: data.bytes, sha256 };
      this.media.set(sha256, f);
    }
    return { file: f.file };
  }

  /** [@Имя](/dossiers/<id>) → [@Имя](ft:d1); ссылка на объект вне файла остаётся только текстом. */
  markdown(md: string): string {
    return md.replace(/\[([^\]]*)\]\(\/(dossiers|investigations)\/([^)\s/?#]+)\)/g, (all, text: string, kind: string, id: string) => {
      const key = kind === 'dossiers' ? this.dossierKeys.get(id) : this.root?.type === 'investigation' && this.root.id === id ? 'i1' : undefined;
      return key ? `[${text}](${EXPORT_LINK_PREFIX}${key})` : text;
    });
  }

  source(s: Source): Source {
    if (s.kind !== 'search') return s;
    const { ref, ...rest } = s;
    const key = ref ? this.searchKeys.get(ref) : undefined;
    return key ? { ...rest, ref: key } : rest;
  }

  private item(i: DossierItem): ExportDossierItem {
    const base = { ...(i.source ? { source: this.source(i.source) } : {}), createdAt: i.createdAt };
    switch (i.type) {
      case 'attribute':
        return { ...base, type: i.type, key: i.key, label: i.label, value: i.value };
      case 'link':
        return { ...base, type: i.type, url: i.url, title: i.title, platform: i.platform };
      case 'media':
        return {
          ...base, type: i.type, image: this.image(i.url), thumb: i.thumbUrl ? this.image(i.thumbUrl) : undefined,
          caption: i.caption, album: i.album,
        };
      case 'note':
        return { ...base, type: i.type, markdown: this.markdown(i.markdown) };
      case 'snapshot':
        return {
          ...base, type: i.type, search: this.searchKeys.get(i.searchId) ?? null, section: i.section, kind: i.kind,
          query: i.query, deep: i.deep, summary: i.summary,
        };
      case 'post': {
        const { id: _id, position: _p, source: _s, createdAt: _c, ...rest } = i;
        return { ...base, ...rest };
      }
    }
  }

  dossier(d: Dossier): ExportDossier {
    return {
      key: this.dossierKeys.get(d.id)!,
      uid: d.uid,
      kind: d.kind,
      title: d.title,
      summaryMd: this.markdown(d.summaryMd),
      tags: d.tags.map((t) => ({ text: t.text, color: t.color })),
      cover: d.coverMediaUrl ? this.image(d.coverMediaUrl) : null,
      members: d.memberIds.flatMap((id) => this.dossierKeys.get(id) ?? []),
      items: [...d.items].sort((a, b) => a.position - b.position).map((i) => this.item(i)),
      updatedAt: d.updatedAt,
    };
  }

  investigation(inv: Investigation): ExportInvestigation {
    const keys = (prefix: string, ids: string[]) => new Map(ids.map((id, n) => [id, `${prefix}${n + 1}`]));
    const nodes = keys('n', inv.nodes.map((n) => n.id));
    const facts = keys('f', inv.facts.map((f) => f.id));
    const pick = (map: Map<string, string>, ids: string[]) => ids.flatMap((id) => map.get(id) ?? []);
    return {
      key: 'i1',
      uid: inv.uid,
      title: inv.title,
      descriptionMd: this.markdown(inv.descriptionMd),
      tags: inv.tags.map((t) => ({ text: t.text, color: t.color })),
      nodes: inv.nodes.map((n) => ({
        key: nodes.get(n.id)!, type: n.type, label: n.label, dossier: (n.dossierId && this.dossierKeys.get(n.dossierId)) || null,
        props: n.props, position: n.position,
      })),
      edges: inv.edges.flatMap((e, n) => {
        const source = nodes.get(e.source);
        const target = nodes.get(e.target);
        if (!source || !target) return [];
        return [{ key: `e${n + 1}`, source, target, relation: e.relation, label: e.label, credibility: e.credibility, facts: pick(facts, e.factIds) }];
      }),
      facts: inv.facts.map((f) => ({
        key: facts.get(f.id)!, textMd: this.markdown(f.textMd), occurredAt: f.occurredAt, sources: f.sources.map((s) => this.source(s)),
        nodes: pick(nodes, f.nodeIds), createdAt: f.createdAt,
      })),
      hypotheses: inv.hypotheses.map((h, n) => ({
        key: `h${n + 1}`, title: h.title, textMd: this.markdown(h.textMd), status: h.status,
        evidence: h.evidence.flatMap((e) => (facts.has(e.factId) ? [{ fact: facts.get(e.factId)!, stance: e.stance }] : [])),
        createdAt: h.createdAt,
      })),
      updatedAt: inv.updatedAt,
    };
  }

  /** Связи между персонами, обе стороны которых вошли в файл. */
  async relations(): Promise<ExportRelation[]> {
    const seen = new Set<string>();
    const out: ExportRelation[] = [];
    for (const d of this.dossiers) {
      for (const r of await this.deps.relations.list(d.id)) {
        const from = this.dossierKeys.get(r.fromId);
        const to = this.dossierKeys.get(r.toId);
        if (seen.has(r.id) || !from || !to) continue;
        seen.add(r.id);
        out.push({ from, to, type: r.typeText, fromNote: r.fromNote, toNote: r.toNote, createdAt: r.createdAt });
      }
    }
    return out;
  }

  /** Все ссылки досье и фактов на снимки поиска. */
  searchRefs(sources: (Source | undefined)[], items: DossierItem[]): string[] {
    return [
      ...items.flatMap((i) => (i.type === 'snapshot' ? [i.searchId] : [])),
      ...[...sources, ...items.map((i) => i.source)].flatMap((s) => (s?.kind === 'search' && s.ref ? [s.ref] : [])),
    ];
  }

  get includedDossiers() {
    return this.dossiers;
  }

  // ---------- Архив ----------

  async zip(req: ExportRequest, investigation: Investigation | null): Promise<{ fileName: string; data: string }> {
    const root = this.root!;
    // Порядок важен: досье и снимки уже собраны, ключи известны — теперь преобразуем (картинки копятся в media).
    const dossiers = this.dossiers.map((d) => this.dossier(d));
    const inv = investigation ? this.investigation(investigation) : null;
    const relations = await this.relations();

    const meta: ExportMeta = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      app: APP,
      exportedAt: new Date().toISOString(),
      author: req.author,
      note: req.note,
      passwordProtected: req.password.length > 0,
      options: req.options,
      root: { type: root.type, key: root.type === 'investigation' ? 'i1' : this.dossierKeys.get(root.id)!, title: root.title },
      contents: {
        dossiers: dossiers.map((d) => ({ key: d.key, file: `dossiers/${d.key}.json`, kind: d.kind, title: d.title })),
        investigations: inv ? [{ key: inv.key, file: `investigations/${inv.key}.json`, title: inv.title }] : [],
        relations: relations.length ? { file: 'relations.json', count: relations.length } : null,
        searches: this.searches.map((s) => ({ key: s.key, file: `searches/${s.key}.json`, query: s.query })),
        media: [...this.media.values()].map((m) => ({ file: m.file, mime: m.mime, size: m.bytes.length, sha256: m.sha256 })),
      },
    };

    const writer = new ZipWriter(new Uint8ArrayWriter());
    // Версия формата читается без пароля — по имени файла.
    await writer.add(`version.v${EXPORT_VERSION}`, new TextReader(`${APP}: файл экспорта, формат v${EXPORT_VERSION}\n`));
    const enc = { password: await archivePassword(req.password), encryptionStrength: 3 as const };
    const json = (path: string, value: unknown) => writer.add(path, new TextReader(JSON.stringify(value, null, 2)), enc);
    await json('meta.info', meta);
    for (const d of dossiers) await json(`dossiers/${d.key}.json`, d);
    if (inv) await json(`investigations/${inv.key}.json`, inv);
    if (relations.length) await json('relations.json', relations);
    for (const s of this.searches) await json(`searches/${s.key}.json`, s);
    for (const m of this.media.values()) {
      await writer.add(m.file, new Uint8ArrayReader(m.bytes), { ...enc, level: STORED.has(m.mime) ? 0 : 6 });
    }
    const bytes = await writer.close();
    return { fileName: exportFileName(root.title, root.type), data: Buffer.from(bytes).toString('base64') };
  }
}

/** Имя скачиваемого файла: «Название ГГГГ-ММ-ДД.ftx» (для PDF — .pdf). */
export function exportFileName(title: string, type: 'dossier' | 'investigation' | 'search', ext: string = EXPORT_EXTENSION): string {
  const fallback = { dossier: 'досье', investigation: 'расследование', search: 'поиск' }[type];
  // eslint-disable-next-line no-control-regex
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
  return `${safe} ${new Date().toISOString().slice(0, 10)}.${ext}`;
}

/** Досье + участники группы + связанные персоны (полностью, один уровень). */
export async function exportDossier(deps: Deps, userId: string, d: Dossier, req: ExportRequest) {
  const b = new Builder(deps, userId);
  b.setRoot('dossier', d.id, d.title);
  b.addDossier(d);
  const rels = await deps.relations.list(d.id);
  await b.addDossierIds([...d.memberIds, ...rels.map((r) => (r.fromId === d.id ? r.toId : r.fromId))]);
  await b.addSearches(b.includedDossiers.flatMap((x) => b.searchRefs([], x.items)));
  return b.zip(req, null);
}

/** Расследование + досье узлов графа (полностью). */
export async function exportInvestigation(deps: Deps, userId: string, inv: Investigation, req: ExportRequest) {
  const b = new Builder(deps, userId);
  b.setRoot('investigation', inv.id, inv.title);
  await b.addDossierIds(inv.nodes.flatMap((n) => (n.dossierId ? [n.dossierId] : [])));
  await b.addSearches([
    ...b.searchRefs(inv.facts.flatMap((f) => f.sources), []),
    ...b.includedDossiers.flatMap((x) => b.searchRefs([], x.items)),
  ]);
  return b.zip(req, inv);
}
