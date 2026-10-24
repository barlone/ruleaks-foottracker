import type { AttrXlsxRequest, DeepRow, LeakCard, SearchJob } from '@ft/shared';
import { FIELD_ORDER, fieldLabel, headerRows, pickAttr, sectionTitle, shownValue, type AttrPick } from '../export/attrPick.ts';
import { exportFileName } from '../export/build.ts';
import { APP } from '../pdf/theme.ts';
import { writeXlsx, type XCell, type XSheet, type XStyle } from './xlsx.ts';

// Excel по результату поиска по атрибутам / геоданным. Два вида листа «Результат»:
//   rows    — как на странице: строка-шапка утечки, под ней записи «атрибут — значение», записи разделены чертой;
//             у глубокого поиска — шапка атрибута, значения и «найдено через …»;
//   columns — таблица: атрибут = колонка, запись утечки = строка (несколько значений — в ячейке через перенос);
//             у глубокого поиска значения атрибута идут вниз по его колонке.
// Второй лист «Запрос» — что искали и что вошло в файл. Сканы документов в Excel не попадают (это картинки).

const MINT = '0F7A5C';
const S = {
  leak: { bold: true, color: MINT, fill: 'EAF6F1', valign: 'center' },
  count: { color: '777777', size: 9, fill: 'EAF6F1', valign: 'center' },
  label: { color: '808080', size: 9, valign: 'top' },
  value: { wrap: true, valign: 'top' },
  via: { color: '808080', size: 9, italic: true, wrap: true, valign: 'top' },
  head: { bold: true, color: 'FFFFFF', fill: MINT, wrap: true, valign: 'center' },
  key: { bold: true, color: '555555', valign: 'top' },
} satisfies Record<string, XStyle>;
const SEP = 'D9D9D9';

const cell = (v: string, s?: XStyle): XCell => ({ v, s });
/** Первая строка записи (кроме первой в утечке) — с чертой сверху, как на странице. */
const sep = (s: XStyle, on: boolean): XStyle => (on ? { ...s, borderTop: SEP } : s);

function viaText(r: DeepRow, byId: Map<number, DeepRow>): string {
  if (r.link4_id <= 0) return '';
  const parent = byId.get(r.link4_id);
  return `найдено через ${r.link4}${parent ? ` ${shownValue(parent.prm, parent.val)}` : ''}`;
}

function deepGroups(rows: DeepRow[]): [string, DeepRow[]][] {
  const m = new Map<string, DeepRow[]>();
  for (const r of rows) m.set(r.prm, [...(m.get(r.prm) ?? []), r]);
  return [...m];
}

// ---------- Построчно ----------

function leakRows(leaks: LeakCard[]): XSheet {
  const rows: (XCell | null)[][] = [];
  for (const card of leaks) {
    if (rows.length) rows.push([]);
    const tuples = card.tuples ?? [];
    rows.push([cell(card.leak.toUpperCase(), S.leak), cell(`${tuples.length} зап.${card.trusted ? ' · проверенная база' : ''}`, S.count)]);
    tuples.forEach((t, ti) => {
      let first = ti > 0;
      for (const f of FIELD_ORDER) for (const v of t[f] ?? []) {
        rows.push([cell(fieldLabel(f).toUpperCase(), sep(S.label, first)), cell(shownValue(f, v), sep(S.value, first))]);
        first = false;
      }
    });
  }
  return { name: 'Результат', cols: [24, 90], rows };
}

function deepRows(p: AttrPick): XSheet {
  const rows: (XCell | null)[][] = [];
  for (const [prm, list] of deepGroups(p.rows)) {
    if (rows.length) rows.push([]);
    rows.push([cell(fieldLabel(prm).toUpperCase(), S.leak), cell(String(list.length), S.count)]);
    for (const r of list) rows.push([cell(shownValue(prm, r.val), S.value), cell(viaText(r, p.byId), S.via)]);
  }
  return { name: 'Результат', cols: [60, 70], rows };
}

// ---------- Поколоночно ----------

/** Ширина колонки по самой длинной строке значений: от 10 до 60 символов. */
function widthOf(texts: string[]): number {
  let max = 0;
  for (const t of texts) for (const line of t.split('\n')) max = Math.max(max, line.length);
  return Math.min(60, Math.max(10, max + 2));
}

function leakColumns(leaks: LeakCard[]): XSheet {
  const used = FIELD_ORDER.filter((f) => leaks.some((c) => c.tuples?.some((t) => t[f]?.length)));
  const header = ['Утечка', 'Проверенная', ...used.map(fieldLabel)];
  const data = leaks.flatMap((c) =>
    (c.tuples ?? []).map((t) => [c.leak, c.trusted ? 'да' : '', ...used.map((f) => (t[f] ?? []).map((v) => shownValue(f, v)).join('\n'))]),
  );
  return {
    name: 'Результат',
    cols: header.map((h, i) => (i === 1 ? 13 : widthOf([h, ...data.map((r) => r[i]!)]))),
    rows: [header.map((h) => cell(h, S.head)), ...data.map((r) => r.map((v) => cell(v, S.value)))],
    freeze: { rows: 1, cols: 1 },
    autoFilter: true,
  };
}

function deepColumns(p: AttrPick): XSheet {
  const groups = deepGroups(p.rows);
  const height = Math.max(0, ...groups.map(([, l]) => l.length));
  const cols = groups.map(([prm, list]) => list.map((r) => shownValue(prm, r.val)));
  return {
    name: 'Результат',
    cols: groups.map(([prm], i) => widthOf([fieldLabel(prm), ...cols[i]!])),
    rows: [
      groups.map(([prm]) => cell(fieldLabel(prm), S.head)),
      ...Array.from({ length: height }, (_, r) => cols.map((c) => (c[r] !== undefined ? cell(c[r]!, S.value) : null))),
    ],
    freeze: { rows: 1, cols: 0 },
    autoFilter: true,
  };
}

// ---------- Книга ----------

export async function attrSearchXlsx(job: SearchJob, req: AttrXlsxRequest) {
  const p = pickAttr(job, req);
  let tz = 'UTC';
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: req.timeZone });
    tz = req.timeZone;
  } catch { /* неизвестный пояс — UTC */ }
  const fmt = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dateTime = (iso: string) => fmt.format(new Date(iso));

  const result = p.deep
    ? req.layout === 'rows' ? deepRows(p) : deepColumns(p)
    : req.layout === 'rows' ? leakRows(p.leaks) : leakColumns(p.leaks);
  if (!result.rows.length) result.rows.push([cell('Нет значений для выгрузки', S.label)]);

  const title = `${sectionTitle(job)}: ${job.query}`;
  const info: XSheet = {
    name: 'Запрос',
    cols: [18, 90],
    rows: [
      [cell('Отчёт', S.key), cell(`${sectionTitle(job).toLowerCase()} · ${APP}`, S.value)],
      ...headerRows(p, dateTime).map(([k, v]) => [cell(k, S.key), cell(v, S.value)]),
      [cell('Сформирован', S.key), cell(dateTime(new Date().toISOString()), S.value)],
    ],
  };
  const bytes = await writeXlsx([result, info], { title, creator: APP });
  return { fileName: exportFileName(title, 'search', 'xlsx'), data: Buffer.from(bytes).toString('base64') };
}
