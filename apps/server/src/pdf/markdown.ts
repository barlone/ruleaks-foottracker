import { marked, type Token, type Tokens } from 'marked';
import type { Content } from 'pdfmake/interfaces';

// Markdown (формат всех длинных текстов сайта) → блоки pdfmake. Поддерживается то, что умеет редактор и GFM:
// заголовки, абзацы, списки, цитаты, код, таблицы, линии, жирный/курсив/зачёркнутый, ссылки, изображения.
// Ссылка [@Имя](/dossiers/<id>) ведёт к разделу этого досье в отчёте, если он есть, иначе остаётся текстом.

export interface MdContext {
  /** Внутренняя ссылка сайта → id раздела отчёта (linkToDestination) или null. */
  destination(href: string): string | null;
  /** Изображение из текста (data URL) → блок pdfmake или null, если не показывать. */
  image(src: string, alt: string): Content | null;
}

type Inline = { text: string | Inline[]; bold?: boolean; italics?: boolean; decoration?: 'lineThrough' | 'underline'; link?: string; linkToDestination?: string; color?: string; background?: string };

const LINK = '#1a6fb5';

/** В Roboto нет эмодзи — вместо них были бы пустые квадраты. */
export const clean = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '');

function inline(tokens: Token[] | undefined, ctx: MdContext, style: Omit<Inline, 'text'> = {}): Inline[] {
  const out: Inline[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...inline((t as Tokens.Strong).tokens, ctx, { ...style, bold: true }));
        break;
      case 'em':
        out.push(...inline((t as Tokens.Em).tokens, ctx, { ...style, italics: true }));
        break;
      case 'del':
        out.push(...inline((t as Tokens.Del).tokens, ctx, { ...style, decoration: 'lineThrough' }));
        break;
      case 'codespan':
        out.push({ ...style, text: clean((t as Tokens.Codespan).text), background: '#eef1f0', color: '#333' });
        break;
      case 'br':
        out.push({ ...style, text: '\n' });
        break;
      case 'link': {
        const l = t as Tokens.Link;
        const dest = ctx.destination(l.href);
        if (dest) out.push(...inline(l.tokens, ctx, { ...style, linkToDestination: dest, color: LINK }));
        else if (/^(https?:|mailto:)/i.test(l.href)) out.push(...inline(l.tokens, ctx, { ...style, link: l.href, color: LINK, decoration: 'underline' }));
        else out.push(...inline(l.tokens, ctx, style));
        break;
      }
      case 'image':
        out.push({ ...style, text: (t as Tokens.Image).text ? `[${(t as Tokens.Image).text}]` : '' });
        break;
      case 'text': {
        const x = t as Tokens.Text;
        if (x.tokens?.length) out.push(...inline(x.tokens, ctx, style));
        else out.push({ ...style, text: clean(x.text) });
        break;
      }
      default:
        // escape, html и прочее — как текст.
        out.push({ ...style, text: clean('text' in t && typeof t.text === 'string' ? t.text : t.raw) });
    }
  }
  return out;
}

/** Абзац, в котором только изображение, становится картинкой; иначе — текст. */
function paragraph(tokens: Token[], ctx: MdContext): Content {
  const images = tokens.filter((t) => t.type === 'image') as Tokens.Image[];
  if (images.length && tokens.every((t) => t.type === 'image' || (t.type === 'text' && !t.raw.trim()) || t.type === 'br')) {
    const blocks = images.flatMap((i) => ctx.image(i.href, i.text) ?? []);
    if (blocks.length) return { stack: blocks, margin: [0, 2, 0, 6] };
  }
  return { text: inline(tokens, ctx), margin: [0, 0, 0, 6] };
}

function blocks(tokens: Token[], ctx: MdContext): Content[] {
  const out: Content[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break;
      case 'heading': {
        const h = t as Tokens.Heading;
        out.push({ text: inline(h.tokens, ctx), bold: true, fontSize: Math.max(10, 15 - h.depth), margin: [0, 6, 0, 4] });
        break;
      }
      case 'paragraph':
        out.push(paragraph((t as Tokens.Paragraph).tokens, ctx));
        break;
      case 'text': {
        const x = t as Tokens.Text;
        out.push({ text: x.tokens ? inline(x.tokens, ctx) : clean(x.text), margin: [0, 0, 0, 2] });
        break;
      }
      case 'list': {
        const l = t as Tokens.List;
        const items = l.items.map((i) => {
          // Флажок задачи — отдельный токен checkbox; в Roboto нет ☐/☑, поэтому [ ] / [x].
          const body = blocks(i.tokens.filter((x) => x.type !== 'checkbox'), ctx);
          const content: Content = body.length === 1 ? body[0]! : { stack: body };
          return i.task ? { columns: [{ text: i.checked ? '[x]' : '[  ]', width: 18, color: '#555' }, content] } : content;
        });
        out.push(l.ordered ? { ol: items, start: typeof l.start === 'number' ? l.start : 1, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] });
        break;
      }
      case 'blockquote':
        out.push({
          table: { widths: ['*'], body: [[{ stack: blocks((t as Tokens.Blockquote).tokens, ctx), color: '#555' }]] },
          layout: {
            hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2 : 0), vLineColor: () => '#9fd9c6',
            paddingLeft: () => 8, paddingTop: () => 2, paddingBottom: () => 0,
          },
          margin: [0, 0, 0, 6],
        });
        break;
      case 'code':
        out.push({
          table: { widths: ['*'], body: [[{ text: clean((t as Tokens.Code).text), fontSize: 8, preserveLeadingSpaces: true, color: '#333' }]] },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => '#f2f4f3' },
          margin: [0, 0, 0, 6],
        });
        break;
      case 'table': {
        const tb = t as Tokens.Table;
        out.push({
          table: {
            headerRows: 1,
            widths: tb.header.map(() => '*'),
            body: [
              tb.header.map((c) => ({ text: inline(c.tokens, ctx), bold: true })),
              ...tb.rows.map((r) => r.map((c) => ({ text: inline(c.tokens, ctx) }))),
            ],
          },
          layout: 'lightHorizontalLines',
          fontSize: 9,
          margin: [0, 0, 0, 6],
        });
        break;
      }
      case 'hr':
        out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#ccc' }], margin: [0, 4, 0, 8] });
        break;
      default:
        if (t.raw.trim()) out.push({ text: clean(t.raw), margin: [0, 0, 0, 6] });
    }
  }
  return out;
}

export function markdownToPdf(md: string, ctx: MdContext): Content[] {
  if (!md.trim()) return [];
  return blocks(marked.lexer(md, { gfm: true, breaks: true }), ctx);
}
