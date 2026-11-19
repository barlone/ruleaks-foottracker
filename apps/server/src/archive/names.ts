import { ARCHIVE_FORMAT_EXT, type ArchiveFormat } from '@ft/shared';

// Имена и типы файлов архива — одинаковые при скачивании из задания, на Диске и при отдаче с Диска.

export const ARCHIVE_MIME: Record<ArchiveFormat, string> = { pdf: 'application/pdf', wacz: 'application/zip' };

/** «example.com 2026-11-18 14-05.pdf» — домен страницы и время архива (UTC). */
export function archiveFileName(url: string, at: string, format: ArchiveFormat): string {
  let host = 'page';
  try {
    host = new URL(url).hostname.replace(/^www\./, '') || host;
  } catch {
    // адрес проверен при постановке
  }
  return `${host} ${at.slice(0, 10)} ${at.slice(11, 16).replace(':', '-')}.${ARCHIVE_FORMAT_EXT[format]}`;
}

/** Content-Disposition с именем по-русски (filename* по RFC 5987) и запасным ASCII. */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
