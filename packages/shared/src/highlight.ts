// Выделение текста цветом в Markdown. В стандарте цвета нет, поэтому в тексте это встроенный HTML:
// <mark data-color="yellow">текст</mark> — законный Markdown, чужой редактор покажет выделение или просто текст.
// Цвет — только имя из списка (не hex): так выделение одинаково читается в тёмной и светлой теме и в PDF.
// Один набор правил на редактор (components/Markdown.tsx), показ на страницах и PDF-отчёт (pdf/markdown.ts).

export const HIGHLIGHT_COLORS = [
  { key: 'yellow', label: 'Жёлтый', color: '#ffc85c' },
  { key: 'green', label: 'Зелёный', color: '#2ee0ac' },
  { key: 'blue', label: 'Синий', color: '#6cb8ff' },
  { key: 'violet', label: 'Фиолетовый', color: '#a78bfa' },
  { key: 'red', label: 'Красный', color: '#ff5c7a' },
  { key: 'orange', label: 'Оранжевый', color: '#ff8a4c' },
] as const;

export type HighlightKey = (typeof HIGHLIGHT_COLORS)[number]['key'];
export const HIGHLIGHT_DEFAULT: HighlightKey = 'yellow';

/** Имя цвета из текста → известное имя; незнакомое или пустое — цвет по умолчанию. */
export const highlightKey = (s: unknown): HighlightKey =>
  HIGHLIGHT_COLORS.find((c) => c.key === String(s ?? '').toLowerCase())?.key ?? HIGHLIGHT_DEFAULT;

/** Открывающий и закрывающий теги — ровно в том виде, в каком их пишет редактор; другой HTML выделением не считается. */
export const MARK_OPEN_RE = /^<mark(?:\s+data-color="([a-z]+)")?\s*>$/i;
export const MARK_CLOSE_RE = /^<\/mark\s*>$/i;
/** Выделенный фрагмент целиком в начале строки (для разбора в редакторе): [1] — цвет, [2] — содержимое. */
export const MARK_SPAN_RE = /^<mark(?:\s+data-color="([a-z]+)")?\s*>([\s\S]+?)<\/mark\s*>/i;

/** Текст без тегов выделения — для однострочных превью, где Markdown не разбирается. */
export const stripHighlight = (md: string) => md.replace(/<\/?mark(?:\s+data-color="[a-z]+")?\s*>/gi, '');

/** Фон выделения на белой бумаге: цвет, наполовину разбавленный белым. */
export function highlightPaperColor(key: unknown): string {
  const hex = HIGHLIGHT_COLORS.find((c) => c.key === highlightKey(key))!.color;
  const mix = (i: number) => Math.round((parseInt(hex.slice(i, i + 2), 16) + 255) / 2).toString(16).padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}
