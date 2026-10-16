import { randomBytes } from 'node:crypto';
import { ImportError, type ExportPackage } from './read.ts';

// Загруженные для импорта файлы — в памяти сервера, пока пользователь смотрит, что внутри, и подтверждает импорт.
// Файл приходит частями (каждая меньше bodyLimit сервера), разобранный пакет хранится до импорта.
// Перезапуск сервера всё забывает — интерфейс тогда предложит загрузить файл заново (UPLOAD_EXPIRED).
//
// Память: файл почти целиком — изображения (в ZIP без сжатия), и до записи в базу он живёт в памяти
// в нескольких видах (части → склеенный буфер → извлечённые картинки пакета), поэтому лимиты жёсткие:
// размер файла, один незавершённый импорт на пользователя и общий потолок на процесс. Настоящие файлы
// экспорта маленькие (фото при загрузке ужимаются до 1600 px, сканы — до 2400 px): единицы-десятки МБ.

const TTL_MS = 30 * 60_000;
/** Предел размера файла импорта. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
/** Сколько байт загруженных файлов (во всех видах) может одновременно ждать импорта во всём процессе. */
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/** Незавершённых импортов у одного пользователя: новая загрузка вытесняет прежнюю. */
const PER_USER = 1;
/** Забытые загрузки убираются и без обращений к хранилищу. */
const SWEEP_MS = 60_000;

interface Upload {
  userId: string;
  chunks: Buffer[];
  /** Размер файла — он же оценка занятой памяти (после inspect вместо частей живут картинки пакета того же объёма). */
  size: number;
  touched: number;
  pkg: ExportPackage | null;
}

const uploads = new Map<string, Upload>();

function sweep() {
  const now = Date.now();
  for (const [id, u] of uploads) if (now - u.touched > TTL_MS) uploads.delete(id);
}

setInterval(sweep, SWEEP_MS).unref();

const totalBytes = () => [...uploads.values()].reduce((n, u) => n + u.size, 0);

/** Добавить часть файла; без uploadId — начать новую загрузку. */
export function appendChunk(userId: string, uploadId: string | undefined, chunk: Buffer): string {
  sweep();
  if (uploadId) {
    const u = getUpload(userId, uploadId);
    if (u.pkg) throw new ImportError('UPLOAD_EXPIRED');
    if (u.size + chunk.length > MAX_IMPORT_BYTES) {
      uploads.delete(uploadId);
      throw new ImportError('FILE_TOO_LARGE');
    }
    if (totalBytes() + chunk.length > MAX_TOTAL_BYTES) {
      uploads.delete(uploadId);
      throw new ImportError('IMPORT_BUSY');
    }
    u.chunks.push(chunk);
    u.size += chunk.length;
    u.touched = Date.now();
    return uploadId;
  }
  // Прежние загрузки этого пользователя (сверх PER_USER - 1) освобождаются: он начал заново.
  const mine = [...uploads.entries()].filter(([, u]) => u.userId === userId).sort((a, b) => a[1].touched - b[1].touched);
  for (const [id] of mine.slice(0, Math.max(0, mine.length - PER_USER + 1))) uploads.delete(id);
  if (totalBytes() + chunk.length > MAX_TOTAL_BYTES) throw new ImportError('IMPORT_BUSY');
  const id = randomBytes(16).toString('base64url');
  uploads.set(id, { userId, chunks: [chunk], size: chunk.length, touched: Date.now(), pkg: null });
  return id;
}

export function getUpload(userId: string, uploadId: string): Upload {
  sweep();
  const u = uploads.get(uploadId);
  if (!u || u.userId !== userId) throw new ImportError('UPLOAD_EXPIRED');
  u.touched = Date.now();
  return u;
}

/** Файл целиком (части склеиваются один раз; на время склейки файл в памяти дважды — потому и лимит на размер). */
export function uploadBytes(u: Upload): Uint8Array {
  if (u.chunks.length > 1) u.chunks = [Buffer.concat(u.chunks)];
  return u.chunks[0] ?? new Uint8Array();
}

export function dropUpload(uploadId: string) {
  uploads.delete(uploadId);
}
