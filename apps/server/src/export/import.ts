import {
  DEFAULT_TAG_COLOR, Dossier, DossierItem, EXPORT_LINK_PREFIX, Fact, GraphEdge, GraphNode, Hypothesis, Investigation,
  TagColor, TagText, newId, normalizeRelationText,
  type ExportDossier, type ExportDossierItem, type ExportImage, type ExportInvestigation, type Source,
} from '@ft/shared';
import type { z } from 'zod';
import { Conflict, type Deps, type DossierContent, type InvestigationContent } from '../ports.ts';
import { ImportError, type ExportPackage } from './read.ts';

// Импорт файла экспорта в базу от имени пользователя. Объекты сопоставляются по сквозному uid среди живых объектов
// импортирующего: нашёлся — содержимое перезаписывается целиком (видимость и доступы прежние), нет — создаётся
// новый приватный объект с тем же uid. Теги — из словаря пользователя (недостающие заводятся с цветом из файла),
// типы связей — так же; снимки поиска — скрытые закреплённые записи истории. Связи между персонами файла
// у перезаписываемых досье заменяются связями из файла; связи с досье вне файла не трогаются.
// Импорт не атомарен (каждый объект — своя транзакция), но повторный импорт того же файла его доделает: всё уже
// созданное найдётся по uid.

/** Что лежит в файле и что из этого уже есть у пользователя (будет перезаписано). */
export interface ImportPreview {
  root: { type: 'dossier' | 'investigation'; title: string };
  author: string;
  note: string;
  exportedAt: string;
  editable: boolean;
  passwordProtected: boolean;
  dossiers: { title: string; kind: 'person' | 'group'; existing: { id: string; title: string } | null }[];
  investigation: { title: string; nodes: number; facts: number; hypotheses: number; existing: { id: string; title: string } | null } | null;
  relations: number;
  searches: number;
  media: number;
}

async function matches(deps: Deps, userId: string, pkg: ExportPackage) {
  const dUids = pkg.dossiers.flatMap((d) => d.uid ?? []);
  const iUid = pkg.investigation?.uid;
  const [ds, is] = await Promise.all([
    dUids.length ? deps.dossiers.findByUid(userId, dUids) : [],
    iUid ? deps.investigations.findByUid(userId, [iUid]) : [],
  ]);
  return { dossiers: new Map(ds.map((m) => [m.uid, m])), investigation: is[0] ?? null };
}

export async function previewPackage(deps: Deps, userId: string, pkg: ExportPackage): Promise<ImportPreview> {
  // Пробное преобразование с временными id: ошибки содержимого видны до подтверждения, а не посреди записи.
  const conv = new Converter(pkg);
  for (const d of pkg.dossiers) conv.dossierIds.set(d.key, newId());
  for (const s of pkg.searches) conv.searchIds.set(s.key, newId());
  if (pkg.investigation) conv.investigationId = newId();
  for (const d of pkg.dossiers) conv.dossier(d);
  if (pkg.investigation) conv.investigation(pkg.investigation);

  const m = await matches(deps, userId, pkg);
  const existing = (uid: string | undefined, map: Map<string, { id: string; title: string }>) => {
    const x = uid ? map.get(uid) : undefined;
    return x ? { id: x.id, title: x.title } : null;
  };
  const inv = pkg.investigation;
  return {
    root: { type: pkg.meta.root.type, title: pkg.meta.root.title },
    author: pkg.meta.author,
    note: pkg.meta.note,
    exportedAt: pkg.meta.exportedAt,
    editable: pkg.meta.options.editable,
    passwordProtected: pkg.meta.passwordProtected,
    dossiers: pkg.dossiers.map((d) => ({ title: d.title, kind: d.kind, existing: existing(d.uid, m.dossiers) })),
    investigation: inv
      ? {
          title: inv.title, nodes: inv.nodes.length, facts: inv.facts.length, hypotheses: inv.hypotheses.length,
          existing: m.investigation ? { id: m.investigation.id, title: m.investigation.title } : null,
        }
      : null,
    relations: pkg.relations.length,
    searches: pkg.searches.length,
    media: pkg.media.size,
  };
}

/** Пишет файл в базу; возвращает корневой объект (на него переходит интерфейс). */
export async function applyPackage(deps: Deps, userId: string, pkg: ExportPackage): Promise<{ type: 'dossier' | 'investigation'; id: string }> {
  const conv = new Converter(pkg);
  const m = await matches(deps, userId, pkg);

  // Теги — по тексту из словаря пользователя.
  const dict = new Map((await deps.tags.list(userId)).map((t) => [t.text, t.id]));
  const tagIds = async (tags: { text: string; color: string }[]): Promise<string[]> => {
    const ids: string[] = [];
    for (const t of tags) {
      const text = TagText.safeParse(t.text);
      if (!text.success) continue;
      let id = dict.get(text.data);
      if (!id) {
        const color = TagColor.safeParse(t.color);
        try {
          id = (await deps.tags.create(userId, text.data, color.success ? color.data : DEFAULT_TAG_COLOR)).id;
        } catch (e) {
          if (!(e instanceof Conflict)) throw e;
          id = (await deps.tags.list(userId)).find((x) => x.text === text.data)?.id;
        }
        if (id) dict.set(text.data, id);
      }
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };

  for (const s of pkg.searches) {
    const { key: _k, ...job } = s;
    // Незавершённую задачу опрашивать некому — в снимке она «не завершена».
    const done = job.state === 'running' ? { state: 'failed' as const, error: 'Поиск не был завершён на момент экспорта' } : {};
    conv.searchIds.set(s.key, await deps.searches.importSnapshot(userId, { ...job, result: job.result ?? null, ...done }));
  }

  // Досье: сначала id всех (на них ссылаются тексты, участники групп, узлы графа), потом содержимое.
  const overwritten = new Set<string>();
  for (const d of pkg.dossiers) {
    const found = d.uid ? m.dossiers.get(d.uid) : undefined;
    if (found) overwritten.add(found.id);
    const id = found?.id ?? (await deps.dossiers.create({ ownerId: userId, kind: d.kind, title: d.title, summaryMd: '', uid: d.uid })).id;
    conv.dossierIds.set(d.key, id);
  }
  const inv = pkg.investigation;
  if (inv) {
    conv.investigationId = m.investigation?.id
      ?? (await deps.investigations.create({ ownerId: userId, title: inv.title, descriptionMd: '', uid: inv.uid })).id;
  }
  for (const d of pkg.dossiers) {
    const { tags, ...content } = conv.dossier(d);
    await deps.dossiers.replaceContent(conv.dossierIds.get(d.key)!, { ...content, tagIds: await tagIds(tags) }, userId);
  }

  // Связи между персонами файла: у перезаписанных досье прежние заменяются файловыми.
  const inFile = new Set(conv.dossierIds.values());
  const removed = new Set<string>();
  for (const id of overwritten) {
    for (const r of await deps.relations.list(id)) {
      if (removed.has(r.id) || !inFile.has(r.fromId) || !inFile.has(r.toId)) continue;
      removed.add(r.id);
      await deps.relations.remove(r.id);
    }
  }
  const persons = new Set(pkg.dossiers.filter((d) => d.kind === 'person').map((d) => d.key));
  let types = await deps.relations.listTypes(userId);
  for (const r of pkg.relations) {
    const from = conv.dossierIds.get(r.from);
    const to = conv.dossierIds.get(r.to);
    const text = normalizeRelationText(r.type);
    if (!from || !to || from === to || !persons.has(r.from) || !persons.has(r.to) || !text || text.length > 64) continue;
    let type = types.find((t) => t.text === text);
    if (!type) {
      try {
        type = await deps.relations.createType(userId, text);
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        types = await deps.relations.listTypes(userId);
        type = types.find((t) => t.text === text);
      }
      if (!type) continue;
      types = [...types, type];
    }
    await deps.relations.add({ dossierId: from, otherId: to, typeId: type.id, note: r.fromNote?.slice(0, 500) || null, otherNote: r.toNote?.slice(0, 500) || null }, userId);
  }

  if (inv) {
    const id = conv.investigationId!;
    const { tags, ...content } = conv.investigation(inv);
    await deps.investigations.replaceContent(id, { ...content, tagIds: await tagIds(tags) }, userId);
    return { type: 'investigation', id };
  }
  return { type: 'dossier', id: conv.dossierIds.get(pkg.meta.root.key)! };
}

/** Перевод из формата файла в объекты базы: ключи файла → id, файлы изображений → data URL. */
class Converter {
  dossierIds = new Map<string, string>();
  searchIds = new Map<string, string>();
  /** id расследования из файла — для ссылок ft:i1 в текстах; задаётся до преобразования досье. */
  investigationId: string | null = null;

  constructor(private pkg: ExportPackage) {}

  private image(img: ExportImage): string {
    if ('url' in img) return img.url;
    const m = this.pkg.media.get(img.file);
    if (!m) throw new ImportError('BAD_FILE', `нет ${img.file}`);
    return `data:${m.mime};base64,${Buffer.from(m.bytes).toString('base64')}`;
  }

  /** [@Имя](ft:d1) → [@Имя](/dossiers/<id>); ссылка на то, чего нет в файле, — просто текст. */
  private markdown(md: string): string {
    const prefix = EXPORT_LINK_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return md.replace(new RegExp(`\\[([^\\]]*)\\]\\(${prefix}([a-z]+\\d+)\\)`, 'g'), (_all, text: string, key: string) => {
      const d = this.dossierIds.get(key);
      if (d) return `[${text}](/dossiers/${d})`;
      if (this.investigationId && key === this.pkg.investigation?.key) return `[${text}](/investigations/${this.investigationId})`;
      return text;
    });
  }

  private source(s: Source): Source {
    if (s.kind !== 'search') return s;
    const { ref, ...rest } = s;
    const id = ref ? this.searchIds.get(ref) : undefined;
    return id ? { ...rest, ref: id } : rest;
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
    const r = schema.safeParse(value);
    if (!r.success) {
      const i = r.error.issues[0];
      throw new ImportError('BAD_FILE', `${where}: ${i ? `${i.path.join('.')} ${i.message}` : 'неверные данные'}`);
    }
    return r.data;
  }

  private item(i: ExportDossierItem, position: number, where: string): DossierItem {
    const base = { id: newId(), position, createdAt: i.createdAt, ...(i.source ? { source: this.source(i.source) } : {}) };
    let value: unknown;
    switch (i.type) {
      case 'media': {
        const { image, thumb, source: _s, createdAt: _c, ...rest } = i;
        // mediaId выдаёт хранилище при записи (запись media по содержимому картинки).
        value = { ...rest, ...base, mediaId: 'import', url: this.image(image), ...(thumb ? { thumbUrl: this.image(thumb) } : {}) };
        break;
      }
      case 'snapshot': {
        const { search, source: _s, createdAt: _c, ...rest } = i;
        // Снимок не вошёл в файл (был чужим) — элемент остаётся описанием поиска без ответа шлюза.
        value = { ...rest, ...base, searchId: (search && this.searchIds.get(search)) || 'none' };
        break;
      }
      case 'note':
        value = { ...i, ...base, markdown: this.markdown(i.markdown) };
        break;
      default:
        value = { ...i, ...base };
    }
    return this.parse(DossierItem, value, where);
  }

  dossier(d: ExportDossier): Omit<DossierContent, 'tagIds'> & { tags: ExportDossier['tags'] } {
    const where = `досье «${d.title}»`;
    const head = this.parse(
      Dossier.pick({ kind: true, title: true, summaryMd: true }),
      { kind: d.kind, title: d.title, summaryMd: this.markdown(d.summaryMd) },
      where,
    );
    return {
      ...head,
      tags: d.tags,
      memberIds: d.kind === 'group' ? d.members.flatMap((k) => this.dossierIds.get(k) ?? []) : [],
      items: d.items.map((i, n) => this.item(i, n, where)),
      coverMediaUrl: d.cover ? this.image(d.cover) : null,
    };
  }

  investigation(inv: ExportInvestigation): Omit<InvestigationContent, 'tagIds'> & { tags: ExportInvestigation['tags'] } {
    const where = `расследование «${inv.title}»`;
    const ids = (list: { key: string }[]) => new Map(list.map((x) => [x.key, newId()]));
    const nodes = ids(inv.nodes);
    const facts = ids(inv.facts);
    const pick = (map: Map<string, string>, keys: string[]) => keys.flatMap((k) => map.get(k) ?? []);
    const head = this.parse(
      Investigation.pick({ title: true, descriptionMd: true }),
      { title: inv.title, descriptionMd: this.markdown(inv.descriptionMd) },
      where,
    );
    if (inv.nodes.length > 2000 || inv.edges.length > 5000) throw new ImportError('BAD_FILE', `${where}: слишком большой граф`);
    return {
      ...head,
      tags: inv.tags,
      nodes: inv.nodes.map((n) => this.parse(GraphNode, {
        id: nodes.get(n.key), type: n.type, label: n.label, dossierId: (n.dossier && this.dossierIds.get(n.dossier)) || null,
        props: n.props, position: n.position,
      }, where)),
      edges: inv.edges.flatMap((e) => {
        const source = nodes.get(e.source);
        const target = nodes.get(e.target);
        if (!source || !target) return [];
        return [this.parse(GraphEdge, {
          id: newId(), source, target, relation: e.relation, label: e.label, credibility: e.credibility, factIds: pick(facts, e.facts),
        }, where)];
      }),
      facts: inv.facts.map((f) => this.parse(Fact, {
        id: facts.get(f.key), textMd: this.markdown(f.textMd), occurredAt: f.occurredAt, sources: f.sources.map((s) => this.source(s)),
        nodeIds: pick(nodes, f.nodes), createdAt: f.createdAt,
      }, where)),
      hypotheses: inv.hypotheses.map((h) => this.parse(Hypothesis, {
        id: newId(), title: h.title, textMd: this.markdown(h.textMd), status: h.status,
        evidence: h.evidence.flatMap((e) => (facts.has(e.fact) ? [{ factId: facts.get(e.fact)!, stance: e.stance }] : [])),
        createdAt: h.createdAt,
      }, where)),
    };
  }
}
