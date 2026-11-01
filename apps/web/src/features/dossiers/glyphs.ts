// Абстрактные значки персоны: заглушка вместо фото, пока настоящего фото нет. Значок — обычный медиа-элемент альбома
// PHOTO_ALBUM с SVG в data URL, поэтому без отдельной поддержки работает всюду, где есть обложка: карточки, связи, PDF, экспорт.
// Цвета постоянные: картинка живёт и вне страницы (PDF, файл экспорта), где переменных темы нет.

export type GlyphId = 'man' | 'woman' | 'child';

const SVG_BASE64 = 'data:image/svg+xml;base64,';
/** Метка в самом SVG: значок опознаётся и после смены рисунка, и после экспорта и импорта. */
const MARK = 'data-ft-glyph';

const BACKGROUND = '#0f2a22';
const FIGURE = '#2ee0ac';
const HAIR = '#1fb98c';

const dataUrl = (id: GlyphId, body: string) =>
  SVG_BASE64 + btoa(`<svg xmlns="http://www.w3.org/2000/svg" ${MARK}="${id}" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="${BACKGROUND}"/>${body}</svg>`);

export const GLYPHS: { id: GlyphId; label: string; url: string }[] = [
  {
    id: 'man',
    label: 'Мужчина',
    url: dataUrl('man', `<circle cx="60" cy="44" r="21" fill="${FIGURE}"/><path d="M18 120 C18 88 36 74 60 74 C84 74 102 88 102 120 Z" fill="${FIGURE}"/>`),
  },
  {
    id: 'woman',
    label: 'Женщина',
    url: dataUrl('woman', `<path d="M36 46 C36 24 46 16 60 16 C74 16 84 24 84 46 C84 64 90 76 96 84 L24 84 C30 76 36 64 36 46 Z" fill="${HAIR}"/><circle cx="60" cy="46" r="17" fill="${FIGURE}"/><path d="M28 120 C28 94 42 78 60 78 C78 78 92 94 92 120 Z" fill="${FIGURE}"/>`),
  },
  {
    id: 'child',
    label: 'Ребёнок',
    url: dataUrl('child', `<circle cx="60" cy="62" r="18" fill="${FIGURE}"/><path d="M38 120 C38 100 46 86 60 86 C74 86 82 100 82 120 Z" fill="${FIGURE}"/>`),
  },
];

/** Какой значок в этом адресе; null — обычное изображение. */
export function glyphOf(url: string | null | undefined): GlyphId | null {
  if (!url?.startsWith(SVG_BASE64)) return null;
  try {
    return (atob(url.slice(SVG_BASE64.length)).match(new RegExp(`${MARK}="(\\w+)"`))?.[1] as GlyphId | undefined) ?? null;
  } catch {
    return null;
  }
}
