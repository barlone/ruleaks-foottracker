import type { Content } from 'pdfmake/interfaces';
import {
  CREDIBILITY_LABELS, attrDisplayValue, NODE_TYPE_LABELS, POST_KIND_LABELS,
  type Dossier, type DossierItem, type Investigation, type PdfRequest, type Source,
} from '@ft/shared';
import { can } from '../authz.ts';
import { exportFileName } from '../export/build.ts';
import type { Deps } from '../ports.ts';
import { graphSvg } from './graph.ts';
import { clean, markdownToPdf, type MdContext } from './markdown.ts';
import { renderPdf, type PdfJob } from './render.ts';
import { APP } from './theme.ts';

// PDF-отчёт по досье или расследованию. Здесь собирается содержимое (pdfmake Content[]), сама вёрстка —
// в отдельном потоке (pdf/worker.ts через pdf/render.ts): на больших отчётах она занимает процессор десятками секунд.
// В отчёт попадает только то, что пользователь может читать. Снимков поиска в отчёте нет: нужное из ответов шлюза
// уже перенесено в атрибуты. Изображения — только data URL (JPEG, PNG, SVG).
// Пароль — штатное шифрование PDF (AES-256); без пароля PDF не шифруется.

const PHOTO_ALBUM = 'Фото персоны';
const PLATFORM: Record<string, string> = {
  vk: 'VK', telegram: 'Telegram', ok: 'OK', instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', web: 'Веб', other: 'Другое',
};
const SOURCE_KIND: Record<Source['kind'], string> = { search: 'поиск', url: 'веб', manual: 'вручную', humint: 'HUMINT', document: 'документ' };
const HYPOTHESIS_STATUS = { open: 'открыта', supported: 'подкреплена', confirmed: 'подтверждена', refuted: 'опровергнута' } as const;

/** headlineLevel — заголовок не остаётся один внизу страницы (см. pageBreakBefore). */
const h2 = (text: string): Content => ({ text, style: 'h2', headlineLevel: 1 });
const empty = (text = 'нет'): Content => ({ text, style: 'muted' });
const table = (widths: (string | number)[], header: string[], rows: Content[][]): Content => ({
  table: { headerRows: 1, widths, body: [header.map((h) => ({ text: h, style: 'th' })), ...rows], dontBreakRows: true },
  layout: 'lightHorizontalLines',
  fontSize: 8.5,
  margin: [0, 0, 0, 4],
});

/** Раздел-таблица: короткая не отрывается от заголовка (длинная может начаться на следующей странице после него). */
const tableSection = (title: string, widths: (string | number)[], header: string[], rows: Content[][]): Content => ({
  stack: [h2(title), table(widths, header, rows)],
  unbreakable: rows.length <= 20,
});

/** Отчёт в работе: что можно читать, какие досье стали разделами, форматирование дат. */
export class Report {
  /** Досье, вошедшие в отчёт отдельными разделами (на них ведут ссылки). */
  sections = new Set<string>();
  /** Досье, которые пользователь может читать: название для ссылок и списков. */
  titles = new Map<string, string>();
  investigationId: string | null = null;
  private dateFmt: Intl.DateTimeFormat;
  private dateTimeFmt: Intl.DateTimeFormat;

  constructor(private deps: Deps, private userId: string, readonly req: PdfRequest) {
    let tz = 'UTC';
    try {
      new Intl.DateTimeFormat('ru-RU', { timeZone: req.timeZone });
      tz = req.timeZone;
    } catch { /* неизвестный пояс — UTC */ }
    this.dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
    this.dateTimeFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Запоминает названия тех досье из списка, которые пользователь может читать (для ссылок и списков),
   * и возвращает их id. Полные досье здесь не загружаются — только шапки.
   */
  async readableIds(ids: Iterable<string>): Promise<string[]> {
    const fresh = [...new Set(ids)].filter((id) => !this.titles.has(id));
    for (const h of await this.deps.dossiers.heads(fresh)) if (can(this.userId, 'read', h)) this.titles.set(h.id, h.title);
    return [...new Set(ids)].filter((id) => this.titles.has(id));
  }

  /** Даты фактов вводятся днём (полночь UTC) — показываются так же. */
  date = (iso: string) => this.dateFmt.format(new Date(iso));
  dateTime = (iso: string) => this.dateTimeFmt.format(new Date(iso));
  /** Время постов хранится в UTC и в интерфейсе показывается в UTC. */
  utc = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(8, 10)}.${d.toISOString().slice(5, 7)}.${d.toISOString().slice(0, 4)} ${d.toISOString().slice(11, 16)} UTC`;
  };

  // ---------- Общие куски ----------

  image(url: string, fit: [number, number]): Content | null {
    if (!this.req.options.photos) return null;
    const m = /^data:(image\/[\w.+-]+)((?:;[^;,]*)*),/i.exec(url);
    if (!m) return null;
    const mime = m[1]!.toLowerCase();
    const base64 = m[2]!.toLowerCase().includes(';base64');
    const body = url.slice(m[0].length);
    try {
      if (mime === 'image/svg+xml') return { svg: base64 ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body), fit };
      if (!base64) return null;
      const head = Buffer.from(body.slice(0, 16), 'base64');
      // pdfkit понимает только JPEG и PNG; проверяем сигнатуру, чтобы битая картинка не сорвала весь отчёт.
      const jpeg = head[0] === 0xff && head[1] === 0xd8;
      const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      return jpeg || png ? { image: url, fit } : null;
    } catch {
      return null;
    }
  }

  md(text: string): Content[] {
    const ctx: MdContext = {
      destination: (href) => {
        const d = /^\/dossiers\/([^/?#]+)$/.exec(href)?.[1];
        if (d) return this.sections.has(d) ? `d-${d}` : null;
        const i = /^\/investigations\/([^/?#]+)$/.exec(href)?.[1];
        return i && i === this.investigationId ? 'investigation' : null;
      },
      image: (src) => this.image(src, [400, 300]),
    };
    return markdownToPdf(text, ctx);
  }

  sourceText(s: Source | undefined): string {
    if (!s) return '';
    const ref = s.kind === 'search' ? '' : s.ref ?? '';
    return clean([`${s.reliability}${s.credibility}`, SOURCE_KIND[s.kind], ref, s.note].filter(Boolean).join(' · '));
  }

  sourceLine(s: Source | undefined): Content[] {
    if (!this.req.options.sources || !s) return [];
    return [{
      text: [{ text: 'Источник: ', bold: true }, this.sourceText(s)],
      style: 'small',
      margin: [0, 1, 0, 0],
    }];
  }

  link(title: string, id: string): Content {
    return this.sections.has(id) ? { text: clean(title), linkToDestination: `d-${id}`, color: '#1a6fb5' } : { text: clean(title) };
  }

  tags(tags: { text: string; color: string }[]): Content[] {
    return tags.flatMap((t) => [{ text: ` ${clean(t.text)} `, background: t.color, color: '#111', fontSize: 7.5, bold: true }, { text: '  ' }]);
  }

  // ---------- Досье ----------

  async dossier(d: Dossier, first: boolean): Promise<Content[]> {
    const items = <T extends DossierItem['type']>(t: T) =>
      d.items.filter((i): i is Extract<DossierItem, { type: T }> => i.type === t).sort((a, b) => a.position - b.position);
    const out: Content[] = [];
    out.push({ text: clean(d.title), style: 'h1', id: `d-${d.id}`, ...(first ? {} : { pageBreak: 'before' as const }) });
    out.push({ text: [{ text: d.kind === 'group' ? 'Группа лиц' : 'Персона', style: 'muted' }, { text: '   ' }, ...this.tags(d.tags)], margin: [0, 0, 0, 8] });

    // Атрибуты — рядом с фото персоны.
    const attrs = items('attribute');
    const attrTable = attrs.length
      ? table(
          this.req.options.sources ? [90, '*', 90] : [100, '*'],
          this.req.options.sources ? ['Поле', 'Значение', 'Источник'] : ['Поле', 'Значение'],
          attrs.map((a) => {
            const row: Content[] = [{ text: clean(a.label), color: '#555' }, { text: clean(attrDisplayValue(a.key, a.value)) }];
            if (this.req.options.sources) row.push({ text: this.sourceText(a.source), style: 'small' });
            return row;
          }),
        )
      : empty('Атрибутов нет');
    const cover = d.coverMediaUrl ? this.image(d.coverMediaUrl, [110, 140]) : null;
    out.push(cover ? { columns: [{ width: 120, stack: [cover] }, { width: '*', stack: [attrTable] }], columnGap: 12 } : attrTable);

    if (d.summaryMd.trim()) out.push(h2('Сводка'), ...this.md(d.summaryMd));

    const rels = await this.deps.relations.list(d.id);
    const otherOf = (r: (typeof rels)[number]) => (r.fromId === d.id ? r.toId : r.fromId);
    const visible = new Set(await this.readableIds(rels.map(otherOf)));
    const relLines: Content[] = rels.flatMap((r) => {
      const otherId = otherOf(r);
      if (!visible.has(otherId)) return [];
      const note = r.fromId === d.id ? r.fromNote : r.toNote;
      return [{ text: [{ text: clean(r.typeText), bold: true }, note ? ` (${clean(note)})` : '', ' — ', this.link(this.titles.get(otherId)!, otherId)] } as Content];
    });
    if (relLines.length) out.push(h2('Связи с персонами'), { ul: relLines });

    if (d.kind === 'group') {
      const members = (await this.readableIds(d.memberIds)).map((m) => this.link(this.titles.get(m)!, m));
      out.push(h2('Участники'), members.length ? { ul: members } : empty());
    }

    const links = items('link');
    if (links.length) {
      out.push(tableSection('Соцсети и ссылки', [70, '*'], ['Платформа', 'Ссылка'], links.map((l) => [
        { text: PLATFORM[l.platform] ?? l.platform },
        { text: [l.title ? { text: `${clean(l.title)}\n` } : '', { text: l.url, link: l.url, color: '#1a6fb5', fontSize: 7.5 }] },
      ])));
    }

    const posts = items('post');
    if (posts.length) {
      out.push(h2('Посты и реакции'));
      for (const p of posts) {
        const head = [
          POST_KIND_LABELS[p.kind], PLATFORM[p.platform] ?? p.platform, p.place, p.at ? this.utc(p.at) : 'дата неизвестна',
          p.author ? `автор: ${p.author}` : '',
        ].filter(Boolean).join(' · ');
        out.push({
          stack: [
            { text: clean(head), bold: true, fontSize: 8.5, color: '#444' },
            ...(p.replyTo ? [{ text: [{ text: 'В ответ на: ', bold: true }, clean(p.replyTo)], style: 'quote' } as Content] : []),
            ...(p.text ? [{ text: clean(p.text), margin: [0, 1, 0, 0] } as Content] : []),
            ...(p.url ? [{ text: p.url, link: p.url, color: '#1a6fb5', fontSize: 7.5 } as Content] : []),
            ...this.sourceLine(p.source),
          ],
          margin: [0, 0, 0, 8],
          unbreakable: (p.text?.length ?? 0) < 1500,
        });
      }
    }

    const notes = items('note');
    if (notes.length) {
      out.push(h2('Заметки'));
      for (const n of notes) {
        out.push({ stack: [{ text: this.date(n.createdAt), style: 'small' }, ...this.md(n.markdown), ...this.sourceLine(n.source)], margin: [0, 0, 0, 8] });
      }
    }

    // Фото и медиа: сетка по три.
    if (this.req.options.photos) {
      const media = items('media');
      // Обложка уже стоит рядом с атрибутами — в сетке её не повторяем.
      const photos = media.filter((m) => m.album === PHOTO_ALBUM && !(cover && m.url === d.coverMediaUrl));
      const rest = media.filter((m) => m.album !== PHOTO_ALBUM);
      for (const [title, list] of [['Фото персоны', photos], ['Медиа', rest]] as const) {
        const cells = list.flatMap((m) => {
          const img = this.image(m.url, [160, 150]);
          if (!img) return [];
          const caption = [m.album && m.album !== PHOTO_ALBUM ? m.album : '', m.caption ?? ''].filter(Boolean).join(' · ');
          return [{ stack: [img, ...(caption ? [{ text: clean(caption), style: 'small' } as Content] : []), ...this.sourceLine(m.source)], margin: [0, 0, 0, 8] } as Content];
        });
        if (!cells.length) continue;
        const rows: Content[] = [];
        for (let i = 0; i < cells.length; i += 3) {
          const row = cells.slice(i, i + 3);
          while (row.length < 3) row.push({ text: '' });
          rows.push({ columns: row.map((c) => ({ width: '*', stack: [c] })), columnGap: 10 });
        }
        // Ряд картинок не делится, поэтому заголовок держится с первым рядом явно.
        out.push({ stack: [h2(title), rows[0]!], unbreakable: true }, ...rows.slice(1));
      }
    }

    return out;
  }

  // ---------- Расследование ----------

  async investigation(inv: Investigation): Promise<Content[]> {
    const out: Content[] = [];
    out.push({ text: clean(inv.title), style: 'h1', id: 'investigation' });
    out.push({ text: [{ text: 'Расследование', style: 'muted' }, { text: '   ' }, ...this.tags(inv.tags)], margin: [0, 0, 0, 8] });
    if (inv.descriptionMd.trim()) out.push(h2('Описание'), ...this.md(inv.descriptionMd));

    const graph = graphSvg(inv.nodes, inv.edges);
    out.push(h2('Граф связей'), graph ? { svg: graph.svg, fit: [515, 600], alignment: 'center' } : empty('Граф пуст'));
    if (graph) {
      out.push({ text: 'Линия: сплошная — подтверждено или вероятно, пунктир — возможно или сомнительно, точки — маловероятно или нельзя оценить.', style: 'small', margin: [0, 4, 0, 0] });
    }

    // Факты — хронологически, с номерами: на номера ссылаются связи и гипотезы.
    const facts = [...inv.facts].sort((a, b) => (a.occurredAt ?? '9999').localeCompare(b.occurredAt ?? '9999') || a.createdAt.localeCompare(b.createdAt));
    const factNo = new Map(facts.map((f, i) => [f.id, i + 1]));
    const nodeLabel = new Map(inv.nodes.map((n) => [n.id, n.label || NODE_TYPE_LABELS[n.type]]));

    if (inv.nodes.length) {
      out.push(tableSection('Объекты', [70, '*', 120, 140], ['Тип', 'Название', 'Досье', 'Свойства'], inv.nodes.map((n) => [
        { text: NODE_TYPE_LABELS[n.type], color: '#555' },
        { text: clean(n.label || '—') },
        n.dossierId && this.titles.has(n.dossierId) ? this.link(this.titles.get(n.dossierId)!, n.dossierId) : { text: '' },
        { text: clean(Object.entries(n.props).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')), style: 'small' },
      ])));
    }
    if (inv.edges.length) {
      out.push(tableSection('Связи', ['*', 100, '*', 80, 40], ['Откуда', 'Связь', 'Куда', 'Достоверность', 'Факты'], inv.edges.map((e) => [
        { text: clean(nodeLabel.get(e.source) ?? '—') },
        { text: clean([e.relation, e.label].filter(Boolean).join(' · ')) },
        { text: clean(nodeLabel.get(e.target) ?? '—') },
        { text: `${e.credibility} — ${CREDIBILITY_LABELS[e.credibility]}`, style: 'small' },
        { text: e.factIds.flatMap((f) => factNo.get(f) ?? []).join(', ') },
      ])));
    }

    out.push(h2('Факты'));
    if (!facts.length) out.push(empty('Фактов нет'));
    for (const f of facts) {
      const nodes = f.nodeIds.flatMap((n) => nodeLabel.get(n) ?? []);
      out.push({
        stack: [
          { text: [{ text: `Факт ${factNo.get(f.id)}`, bold: true }, { text: ` · ${f.occurredAt ? this.date(f.occurredAt) : 'дата неизвестна'}`, color: '#555' }], fontSize: 9 },
          ...this.md(f.textMd),
          ...(nodes.length ? [{ text: [{ text: 'Объекты: ', bold: true }, clean(nodes.join(', '))], style: 'small' } as Content] : []),
          ...(this.req.options.sources ? f.sources.flatMap((s) => this.sourceLine(s)) : []),
        ],
        margin: [0, 0, 0, 8],
      });
    }

    out.push(h2('Гипотезы'));
    if (!inv.hypotheses.length) out.push(empty('Гипотез нет'));
    for (const h of inv.hypotheses) {
      const ev = (stance: 'supports' | 'contradicts') =>
        h.evidence.filter((e) => e.stance === stance).flatMap((e) => factNo.get(e.factId) ?? []).sort((a, b) => a - b).join(', ');
      const sup = ev('supports');
      const con = ev('contradicts');
      out.push({
        stack: [
          { text: [{ text: clean(h.title || 'Без названия'), bold: true }, { text: ` · ${HYPOTHESIS_STATUS[h.status]}`, color: '#555' }], fontSize: 10 },
          ...this.md(h.textMd),
          ...(sup ? [{ text: [{ text: 'Подкрепляют факты: ', bold: true }, sup], style: 'small' } as Content] : []),
          ...(con ? [{ text: [{ text: 'Противоречат факты: ', bold: true }, con], style: 'small' } as Content] : []),
        ],
        margin: [0, 0, 0, 8],
      });
    }
    return out;
  }

  // ---------- Документ ----------

  /**
   * extra — дополнительные строки шапки (у отчёта поиска: запрос, пользователь, итог);
   * page — ограничения, ориентация и водяной знак (отчёт по результату поиска по атрибутам).
   */
  async render(
    title: string,
    kind: 'dossier' | 'investigation' | 'search' | 'attr' | 'geo',
    body: Content[],
    extra: [string, Content][] = [],
    page: Pick<PdfJob, 'permissions' | 'landscape' | 'watermark'> = {},
  ): Promise<{ fileName: string; data: string }> {
    const { author, note, password } = this.req;
    const label = { dossier: 'досье', investigation: 'расследование', search: 'поиск в Telegram', attr: 'поиск по атрибутам', geo: 'поиск по геоданным' }[kind];
    const meta: Content = {
      table: {
        widths: [80, '*'],
        body: [
          [{ text: 'Отчёт', style: 'th' }, { text: `${label} · ${APP}` }],
          ...extra.map(([k, v]) => [{ text: k, style: 'th' }, v]),
          ...(author ? [[{ text: 'Автор', style: 'th' }, { text: clean(author) }]] : []),
          [{ text: 'Сформирован', style: 'th' }, { text: this.dateTime(new Date().toISOString()) }],
          ...(note ? [[{ text: 'Примечание', style: 'th' }, { text: clean(note) }]] : []),
        ],
      },
      layout: 'noBorders',
      fontSize: 8.5,
      margin: [0, 0, 0, 14],
    };
    // Стили, колонтитул и правила переноса страниц — в воркере (pdf/worker.ts): туда уходит только содержимое.
    const buf = await renderPdf({ title, footerTitle: clean(title), author, note, password, content: [meta, ...body], ...page });
    return { fileName: exportFileName(title, kind === 'attr' || kind === 'geo' ? 'search' : kind, 'pdf'), data: buf.toString('base64') };
  }
}

/** Связанные досье, которые станут разделами отчёта: право чтения проверено по шапкам, целиком загружаются только они. */
async function relatedDossiers(r: Report, deps: Deps, ids: Iterable<string>, exclude: Set<string>): Promise<Dossier[]> {
  const out: Dossier[] = [];
  for (const id of await r.readableIds([...ids].filter((id) => !exclude.has(id)))) {
    const d = await deps.dossiers.get(id);
    if (d) {
      out.push(d);
      r.sections.add(d.id);
    }
  }
  return out;
}

export async function dossierPdf(deps: Deps, userId: string, d: Dossier, req: PdfRequest) {
  const r = new Report(deps, userId, req);
  r.titles.set(d.id, d.title);
  r.sections.add(d.id);
  let related: Dossier[] = [];
  if (req.options.related) {
    const rels = await deps.relations.list(d.id);
    related = await relatedDossiers(r, deps, [...d.memberIds, ...rels.map((x) => (x.fromId === d.id ? x.toId : x.fromId))], new Set([d.id]));
  }
  const body = await r.dossier(d, true);
  for (const x of related) body.push(...(await r.dossier(x, false)));
  return r.render(d.title, 'dossier', body);
}

export async function investigationPdf(deps: Deps, userId: string, inv: Investigation, req: PdfRequest) {
  const r = new Report(deps, userId, req);
  r.investigationId = inv.id;
  // Названия досье узлов нужны в таблице объектов всегда (шапки), разделами — по опции (тогда полные досье).
  const nodeDossiers = inv.nodes.flatMap((n) => (n.dossierId ? [n.dossierId] : []));
  const related = req.options.related ? await relatedDossiers(r, deps, nodeDossiers, new Set()) : [];
  if (!req.options.related) await r.readableIds(nodeDossiers);
  const body = await r.investigation(inv);
  for (const x of related) body.push(...(await r.dossier(x, false)));
  return r.render(inv.title, 'investigation', body);
}
