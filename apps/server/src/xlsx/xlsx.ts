import { TextReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js';

// Минимальный писатель .xlsx (Office Open XML): листы со строковыми ячейками, стили (шрифт, заливка, верхняя
// черта, перенос), ширины колонок, закреплённая шапка, автофильтр, объединённые ячейки. Своя реализация вместо
// библиотеки: нужно немного, а exceljs и подобные тянут десятки устаревших зависимостей.
// Строки пишутся inlineStr: это всегда текст, формулой (=…, +…) значение из утечки стать не может.

configure({ useWebWorkers: false });

export interface XStyle {
  bold?: boolean;
  italic?: boolean;
  /** RRGGBB. */
  color?: string;
  size?: number;
  /** Заливка RRGGBB. */
  fill?: string;
  /** Тонкая черта сверху, RRGGBB. */
  borderTop?: string;
  /** Перенос по словам; без него длинные значения уходят за край. */
  wrap?: boolean;
  valign?: 'top' | 'center';
}

export interface XCell {
  v: string;
  s?: XStyle;
}

export interface XSheet {
  name: string;
  /** Ширины колонок в символах. */
  cols: number[];
  rows: (XCell | null)[][];
  /** Закрепить строк сверху / колонок слева. */
  freeze?: { rows: number; cols: number };
  /** Автофильтр на первой строке по всем колонкам. */
  autoFilter?: boolean;
  /** Объединения «A1:B1». */
  merges?: string[];
}

/** Ячейка больше не вмещает (ограничение Excel). */
const CELL_MAX = 32_767;

const esc = (s: string) =>
  s
    // Символы, недопустимые в XML 1.0, и непарные суррогаты — Excel отказался бы открывать файл.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 0 → A, 26 → AA. */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Имя листа: до 31 символа, без []:*?/\ и неповторяющееся. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\']/g, ' ').trim().slice(0, 31) || 'Лист';
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 28)} ${i}`;
  used.add(out.toLowerCase());
  return out;
}

/** Стили → шрифты, заливки, границы и xf-записи без повторов; индекс xf — атрибут s ячейки. */
class Styles {
  private fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  private fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  private borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private byKey = new Map<string, number>([['{}', 0]]);

  private index(list: string[], xml: string): number {
    const i = list.indexOf(xml);
    return i >= 0 ? i : list.push(xml) - 1;
  }

  id(s: XStyle | undefined): number {
    const key = JSON.stringify(s ?? {});
    const known = this.byKey.get(key);
    if (known !== undefined) return known;
    const st = s ?? {};
    const font = this.index(
      this.fonts,
      `<font>${st.bold ? '<b/>' : ''}${st.italic ? '<i/>' : ''}<sz val="${st.size ?? 11}"/>${st.color ? `<color rgb="FF${st.color}"/>` : ''}<name val="Calibri"/><family val="2"/></font>`,
    );
    const fill = st.fill
      ? this.index(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${st.fill}"/><bgColor indexed="64"/></patternFill></fill>`)
      : 0;
    const border = st.borderTop
      ? this.index(this.borders, `<border><left/><right/><top style="thin"><color rgb="FF${st.borderTop}"/></top><bottom/><diagonal/></border>`)
      : 0;
    const align = st.wrap || st.valign ? `<alignment${st.valign ? ` vertical="${st.valign}"` : ''}${st.wrap ? ' wrapText="1"' : ''}/>` : '';
    const xf =
      `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"` +
      `${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}` +
      (align ? ` applyAlignment="1">${align}</xf>` : '/>');
    const id = this.xfs.push(xf) - 1;
    this.byKey.set(key, id);
    return id;
  }

  xml(): string {
    const list = (tag: string, items: string[]) => `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      list('fonts', this.fonts) +
      list('fills', this.fills) +
      list('borders', this.borders) +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      list('cellXfs', this.xfs) +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    );
  }
}

function sheetXml(sh: XSheet, styles: Styles): string {
  const width = Math.max(sh.cols.length, ...sh.rows.map((r) => r.length), 1);
  const last = `${colName(width - 1)}${Math.max(sh.rows.length, 1)}`;
  const f = sh.freeze && (sh.freeze.rows || sh.freeze.cols) ? sh.freeze : null;
  const pane = f
    ? `<pane${f.cols ? ` xSplit="${f.cols}"` : ''}${f.rows ? ` ySplit="${f.rows}"` : ''} topLeftCell="${colName(f.cols)}${f.rows + 1}"` +
      ` activePane="${f.rows && f.cols ? 'bottomRight' : f.rows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
    : '';
  const cols = sh.cols.length
    ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rows = sh.rows
    .map((row, r) => {
      const cells = row
        .map((c, i) => {
          if (!c) return '';
          const ref = `${colName(i)}${r + 1}`;
          const s = styles.id(c.s);
          const sAttr = s ? ` s="${s}"` : '';
          if (!c.v) return s ? `<c r="${ref}"${sAttr}/>` : '';
          return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(c.v.slice(0, CELL_MAX))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    `<sheetData>${rows}</sheetData>` +
    (sh.autoFilter ? `<autoFilter ref="A1:${last}"/>` : '') +
    merges +
    '</worksheet>'
  );
}

/** Книга из листов → байты .xlsx. */
export async function writeXlsx(sheets: XSheet[], meta: { title: string; creator: string }): Promise<Uint8Array> {
  const styles = new Styles();
  const used = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, used) }));
  const sheetFiles = named.map((s) => sheetXml(s, styles));
  const width = (s: XSheet) => Math.max(s.cols.length, ...s.rows.map((r) => r.length), 1);
  const filters = named
    .map((s, i) => (s.autoFilter
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!$A$1:$${colName(width(s) - 1)}$${Math.max(s.rows.length, 1)}</definedName>`
      : ''))
    .join('');
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '</Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>',
    ],
    [
      'docProps/core.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.creator)}</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
        '</cp:coreProperties>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews>' +
        `<sheets>${named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        (filters ? `<definedNames>${filters}</definedNames>` : '') +
        '</workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ],
    ...sheetFiles.map((xml, i) => [`xl/worksheets/sheet${i + 1}.xml`, xml] as [string, string]),
    // Стили — после листов: их набор складывается, пока листы пишутся.
    ['xl/styles.xml', styles.xml()],
  ];

  const writer = new ZipWriter(new Uint8ArrayWriter(), { dataDescriptor: false });
  for (const [path, xml] of files) await writer.add(path, new TextReader(xml));
  return writer.close();
}
