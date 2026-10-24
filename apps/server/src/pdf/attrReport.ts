import type { Content, TableCell } from 'pdfmake/interfaces';
import {
  ATTR_PDF_SCANS_MAX, isUuid, scanDoctypeLabel, type AttrPdfRequest, type DeepRow, type LeakCard, type LeakTuple, type SearchJob,
} from '@ft/shared';
import { FIELD_ORDER, fieldLabel, headerRows, pickAttr, sectionTitle, shownValue } from '../export/attrPick.ts';
import type { Deps, ScanMeta } from '../ports.ts';
import { withEmoji } from './emoji.ts';
import { clean } from './markdown.ts';
import { Report } from './report.ts';
import { MINT } from './theme.ts';

// PDF-отчёт по результату поиска по атрибутам / геоданным — как страница результата: карточка на утечку,
// в ней записи, разделённые чертой, в записи «АТРИБУТ значение» (в альбомной ориентации — в две колонки, как на
// широком экране); у глубокого поиска — карточка на атрибут и «найдено через …». Сканы документов — картинками
// из хранилища (сервер забирает их сам, как прокси /scans). Карты геолокаций нет — координаты остаются значениями.

/** Иконка «проверенная база» (lucide shield-check), как на странице. */
const SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${MINT}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`;
/** Записи не делятся между страницами, если в каждой не больше стольких значений (выше страницы — потерялась бы). */
const UNBREAKABLE_VALUES = 40;
/** Картинка скана больше — пропускается (в хранилище бывают многомегабайтные сканы). */
const SCAN_MAX_BYTES = 8 * 1024 * 1024;
const SCAN_CONCURRENCY = 4;

const label = (f: string): Content => ({ text: fieldLabel(f).toUpperCase(), fontSize: 6.5, color: '#888', characterSpacing: 0.4, margin: [0, 1.3, 0, 0] });

/** Иконка «найдено через» (lucide corner-down-right): стрелок ↪ ↳ в Roboto нет. */
const VIA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#999999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 10 5 5-5 5"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>`;

// eslint-disable-next-line no-control-regex
const printable = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

function value(f: string, v: string): Content {
  const text = printable(shownValue(f, v));
  const link = f === 'weblinks' && /^https?:\/\/[^\s]+$/i.test(text.trim()) ? text.trim() : undefined;
  return { ...(withEmoji(text) as object), ...(link ? { link, color: '#1a6fb5' } : {}) } as Content;
}

/** Шапка карточки: название заглавными (моно на сайте), значок проверенной базы, счётчик справа. */
function cardHead(title: string, count: string, trusted = false): TableCell {
  return {
    columns: [
      { width: 'auto', text: clean(title).toUpperCase(), bold: true, color: MINT, fontSize: 9, characterSpacing: 0.8 },
      ...(trusted ? [{ width: 9, svg: SHIELD, margin: [4, 0.5, 0, 0] } as Content] : []),
      { width: '*', text: count, alignment: 'right', fontSize: 7.5, color: '#777' },
    ],
  };
}

/** Значения одной записи: «атрибут — значение» в одну или две колонки (по строкам, как сетка на странице). */
function tuplePairs(t: LeakTuple, twoCols: boolean): Content {
  const pairs = FIELD_ORDER.flatMap((f) => (t[f] ?? []).map((v) => [label(f), value(f, v)] as [Content, Content]));
  const body: Content[][] = [];
  if (!twoCols) for (const p of pairs) body.push(p);
  else for (let i = 0; i < pairs.length; i += 2) body.push([...pairs[i]!, ...(pairs[i + 1] ?? [{ text: '' }, { text: '' }])]);
  return { table: { widths: twoCols ? [92, '*', 92, '*'] : [110, '*'], body }, layout: 'ftPairs' };
}

function leakCard(card: LeakCard, twoCols: boolean): Content {
  const tuples = card.tuples ?? [];
  const small = tuples.every((t) => FIELD_ORDER.reduce((n, f) => n + (t[f]?.length ?? 0), 0) <= UNBREAKABLE_VALUES);
  return {
    table: {
      widths: ['*'],
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: small,
      body: [[cardHead(card.leak, `${tuples.length} зап.`, card.trusted)], ...tuples.map((t) => [tuplePairs(t, twoCols)])],
    },
    layout: 'ftCard',
    margin: [0, 0, 0, 10],
  };
}

/** Глубокий поиск: карточка на атрибут, под значением — через что найдено. */
function deepCards(rows: DeepRow[], byId: Map<number, DeepRow>): Content[] {
  const groups = new Map<string, DeepRow[]>();
  for (const r of rows) groups.set(r.prm, [...(groups.get(r.prm) ?? []), r]);
  return [...groups].map(([prm, list]) => ({
    table: {
      widths: ['*'],
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      body: [
        [cardHead(fieldLabel(prm), String(list.length))],
        ...list.map((r) => {
          const parent = r.link4_id > 0 ? byId.get(r.link4_id) : undefined;
          const via: Content[] = r.link4_id > 0
            ? [{
                columns: [
                  { width: 7, svg: VIA, margin: [0, 0.5, 0, 0] },
                  { width: '*', text: printable(`найдено через ${r.link4}${parent ? `  ${shownValue(parent.prm, parent.val)}` : ''}`), fontSize: 7, color: '#888' },
                ],
                columnGap: 3,
                margin: [8, 1, 0, 0],
              }]
            : [];
          return [{ stack: [value(prm, r.val), ...via] }];
        }),
      ],
    },
    layout: 'ftCardList',
    margin: [0, 0, 0, 10],
  }));
}

// ---------- Сканы документов ----------

interface ScanGroup { title: string; ids: string[] }

/** Как на странице: сканы по записям, uuid и одинаковые файлы (sha256) не повторяются. */
function scanGroups(leaks: LeakCard[], meta: Map<string, ScanMeta | null>): ScanGroup[] {
  const seenId = new Set<string>();
  const seenSha = new Set<string>();
  const out: ScanGroup[] = [];
  for (const card of leaks) for (const t of card.tuples ?? []) {
    const ids = (t.scans ?? []).map((s) => s.toLowerCase()).filter((id) => {
      if (!isUuid(id) || seenId.has(id)) return false;
      seenId.add(id);
      const sha = meta.get(id)?.sha256;
      if (sha && seenSha.has(sha)) return false;
      if (sha) seenSha.add(sha);
      return true;
    });
    if (ids.length) out.push({ title: [t.names?.[0], card.leak].filter(Boolean).join(' · '), ids });
  }
  return out;
}

/** Каждый id — по очереди из SCAN_CONCURRENCY потоков. */
async function eachLimited(ids: string[], fn: (id: string) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, ids.length) }, async () => {
    while (next < ids.length) await fn(ids[next++]!);
  }));
}

async function scansSection(deps: Deps, leaks: LeakCard[]): Promise<Content[]> {
  const store = deps.scans;
  const all = [...new Set(leaks.flatMap((c) => (c.tuples ?? []).flatMap((t) => (t.scans ?? []).map((s) => s.toLowerCase()))))].filter(isUuid);
  if (!store || !all.length) return [];
  const meta = new Map<string, ScanMeta | null>();
  const images = new Map<string, string>();
  let failed = 0;
  try {
    await eachLimited(all, async (id) => void meta.set(id, await store.meta(id)));
  } catch {
    return [{ text: 'Сканы документов: хранилище сканов недоступно.', style: 'muted', margin: [0, 0, 0, 10] }];
  }
  const groups = scanGroups(leaks, meta);
  const ids = groups.flatMap((g) => g.ids).slice(0, ATTR_PDF_SCANS_MAX);
  const total = groups.reduce((n, g) => n + g.ids.length, 0);
  await eachLimited(ids, async (id) => {
    try {
      const img = await store.image(id, {});
      if (img.status !== 'ok') {
        failed++;
        return;
      }
      const buf = Buffer.from(await new Response(img.body).arrayBuffer());
      // pdfkit понимает только JPEG и PNG; битая картинка не должна сорвать весь отчёт.
      const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
      const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      if (buf.length > SCAN_MAX_BYTES || (!jpeg && !png)) {
        failed++;
        return;
      }
      images.set(id, `data:image/${jpeg ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`);
    } catch {
      failed++;
    }
  });

  const out: Content[] = [];
  const cells = (list: string[]): Content[] => list.flatMap((id) => {
    const src = images.get(id);
    if (!src) return [];
    const m = meta.get(id);
    const caption = [scanDoctypeLabel(m?.doctype), m?.docnum].filter(Boolean).join(' ');
    return [{ stack: [{ image: src, fit: [160, 200] }, { text: clean(caption), style: 'small', margin: [0, 2, 0, 0] }], margin: [0, 0, 0, 8] } as Content];
  });
  const head: Content = { text: `Сканы документов · ${total}`, style: 'h2', headlineLevel: 1 };
  const titled = groups.length > 1;
  for (const g of groups) {
    const list = cells(g.ids);
    if (!list.length) continue;
    const rows: Content[] = [];
    for (let i = 0; i < list.length; i += 3) {
      const row = list.slice(i, i + 3);
      while (row.length < 3) row.push({ text: '' });
      rows.push({ columns: row.map((c) => ({ width: '*', stack: [c] })), columnGap: 10 });
    }
    // Ряд картинок не делится, поэтому подпись (и заголовок раздела) держатся с первым рядом явно.
    const caption: Content[] = titled ? [{ text: clean(g.title), fontSize: 8, color: '#555', margin: [0, 0, 0, 3] }] : [];
    out.push({ stack: [...(out.length ? [] : [head]), ...caption, rows[0]!], unbreakable: true }, ...rows.slice(1));
  }
  if (!out.length) out.push(head);
  const skipped = total - ids.length;
  const notes = [
    skipped > 0 ? `в отчёт входят первые ${ids.length} из ${total} сканов` : '',
    failed ? `не загружено: ${failed}` : '',
  ].filter(Boolean);
  if (notes.length) out.push({ text: `Сканы документов: ${notes.join('; ')}.`, style: 'muted', margin: [0, 0, 0, 6] });
  out.push({ text: '', margin: [0, 0, 0, 6] });
  return out;
}

// ---------- Отчёт ----------

export async function attrSearchPdf(deps: Deps, userId: string, job: SearchJob, req: AttrPdfRequest) {
  const p = pickAttr(job, req);
  const r = new Report(deps, userId, { ...req, id: job.id, options: { photos: true, related: false, sources: false } });
  const o = req.options;
  const title = `${sectionTitle(job)}: ${job.query}`;

  const body: Content[] = [{ text: clean(title), style: 'h1', margin: [0, 0, 0, 8] }];
  if (o.scans) body.push(...(await scansSection(deps, p.scanLeaks)));
  if (p.deep) body.push(...deepCards(p.rows, p.byId));
  else body.push(...p.leaks.map((c) => leakCard(c, o.landscape)));
  if (p.deep ? !p.rows.length : !p.leaks.length) body.push({ text: job.result ? 'Нет значений для выгрузки' : 'Ничего не найдено', style: 'muted' });

  const extra = headerRows(p, r.dateTime).map(([k, v]) => [k, { text: clean(v) }] as [string, Content]);
  return r.render(title, job.section === 'geo' ? 'geo' : 'attr', body, extra, {
    permissions: { printing: o.printing, copying: o.copying },
    landscape: o.landscape,
    watermark: clean(o.watermark) || undefined,
  });
}
