// Ссылки Гугл-диска в медиа досье. Пользователь вставляет обычную ссылку «Поделиться» (файл должен быть открыт
// «всем, у кого есть ссылка»); сайт показывает картинку через миниатюру Диска, видео — через его встраиваемый плеер.
// Google Drive API и авторизация не нужны; приватные файлы так не показать.

const PATTERNS = [
  /^https?:\/\/drive\.google\.com\/file\/d\/([\w-]{10,})/i,
  /^https?:\/\/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:.*&)?id=([\w-]{10,})/i,
  /^https?:\/\/docs\.google\.com\/(?:uc|file\/d\/([\w-]{10,}))/i,
];

/** ID файла из ссылки Гугл-диска; null — это не ссылка Диска. */
export function googleDriveId(url: string): string | null {
  const s = url.trim();
  for (const re of PATTERNS) {
    const m = re.exec(s);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Картинка (и кадр видео) до 1600 px по ширине; Диск сам отдаёт редирект на googleusercontent. */
export const driveImageUrl = (id: string) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;

/** Встраиваемый плеер Диска для iframe (видео, PDF и другие просматриваемые файлы). */
export const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;

/** Страница файла на Диске — для «открыть на Гугл-диске». */
export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
