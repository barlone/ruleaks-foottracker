// Архивы страниц ссылок досье: служба RuLeaks.ArchiveBox снимает страницу в PDF и/или веб-архив WACZ.
// Здесь — общее для сервера (routers/siteArchive.ts, archive/*) и браузера: форматы и вид задания.

/** pdf — печать страницы браузером; wacz — веб-архив (WARC в ZIP) для просмотра «как в браузере». */
export const ARCHIVE_FORMATS = ['pdf', 'wacz'] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

export const ARCHIVE_FORMAT_LABELS: Record<ArchiveFormat, string> = {
  pdf: 'PDF',
  wacz: 'Веб-архив (WACZ)',
};

export const ARCHIVE_FORMAT_EXT: Record<ArchiveFormat, string> = { pdf: 'pdf', wacz: 'wacz' };

/** pending — ещё не начат; running — снимается; ok — файл готов; failed — не получился; skipped — служба пропустила. */
export type ArchivePartStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';

export interface ArchivePartView {
  format: ArchiveFormat;
  status: ArchivePartStatus;
  /** Что сказала служба о неудаче (текст плагина, по-английски) — для подсказки. */
  error: string | null;
  size: number | null;
  sha256: string | null;
}

/**
 * queued — служба ещё не взяла страницу; capturing — Chrome открыл и снимает; finishing — файлы проверяются.
 * done — готово (хотя бы один формат ok); failed — ни один формат не получился или ошибка службы; cancelled — отменено.
 */
export type ArchiveJobState = 'queued' | 'capturing' | 'finishing' | 'uploading' | 'done' | 'failed' | 'cancelled';

export const ARCHIVE_JOB_ACTIVE: readonly ArchiveJobState[] = ['queued', 'capturing', 'finishing', 'uploading'];

/**
 * Сохранение на Google Диск: none — не сохранялось (Диск не подключён); uploading — идёт; saved — файлы на Диске и
 * запись в досье (archiveId — LinkArchive.id); failed — не удалось (error — код).
 */
export interface ArchiveDriveView {
  status: 'none' | 'uploading' | 'saved' | 'failed';
  error: string | null;
  archiveId: string | null;
}

/** Подключение Google Диска пользователя. demo — имитация (Диск в памяти сервера). */
export interface DriveStatusView {
  connected: boolean;
  email: string | null;
  demo: boolean;
  folderName: string;
}

export interface ArchiveJobView {
  id: string;
  dossierId: string;
  itemId: string;
  url: string;
  formats: ArchiveFormat[];
  state: ArchiveJobState;
  startedAt: string;
  finishedAt: string | null;
  /** До какого времени файлы можно скачать (потом удаляются из службы). */
  expiresAt: string | null;
  parts: ArchivePartView[];
  /** Код ошибки задания (ARCHIVE_TIMEOUT, ARCHIVE_UNAVAILABLE, …) — текст в apps/web/src/lib/errors.ts. */
  error: string | null;
  drive: ArchiveDriveView;
}

export const isArchiveActive = (s: ArchiveJobState) => ARCHIVE_JOB_ACTIVE.includes(s);
