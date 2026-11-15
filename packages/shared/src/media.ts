// Ограничения на встроенные медиафайлы досье. Файлового хранилища пока нет: картинка лежит в самом элементе
// (data URL в jsonb), поэтому размер ограничен — иначе страница досье и экспорт раздуваются. Большие файлы
// пользователь держит у себя (Гугл-диск и т. п.) и кладёт в досье ссылку; внешние URL в лимит не входят.

/** Один медиафайл. */
export const MEDIA_FILE_MAX_BYTES = 1024 * 1024;
/** Все медиафайлы одного досье. */
export const DOSSIER_MEDIA_MAX_BYTES = 5 * 1024 * 1024;

/** Размер встроенного изображения (data URL) в байтах; внешняя ссылка — 0. */
export function mediaBytes(url: string): number {
  if (!url.startsWith('data:')) return 0;
  const comma = url.indexOf(',');
  if (comma < 0) return 0;
  const body = url.slice(comma + 1);
  if (!/;base64$/i.test(url.slice(0, comma))) return body.length;
  const pad = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - pad;
}

type WithImages = { type: string; url?: string; shots?: readonly { url: string }[] };

/** Встроенные изображения элемента досье: сам медиафайл или снимки страницы у ссылки. */
export function itemImages(i: WithImages): string[] {
  if (i.type === 'media') return i.url ? [i.url] : [];
  if (i.type === 'link') return (i.shots ?? []).map((s) => s.url);
  return [];
}

/** Сколько байт медиа уже лежит в досье (только встроенные изображения: медиафайлы и снимки страниц у ссылок). */
export function dossierMediaBytes(items: readonly WithImages[]): number {
  let total = 0;
  for (const i of items) for (const url of itemImages(i)) total += mediaBytes(url);
  return total;
}

/** «1,2 МБ», «340 КБ». */
export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',').replace(',0', '')} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
}
