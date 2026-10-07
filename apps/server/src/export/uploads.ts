import { randomBytes } from 'node:crypto';
import { ImportError, type ExportPackage } from './read.ts';

// Загруженные для импорта файлы — в памяти сервера, пока пользователь смотрит, что внутри, и подтверждает импорт.
// Файл приходит частями (каждая меньше bodyLimit сервера), разобранный пакет хранится до импорта.
// Перезапуск сервера всё забывает — интерфейс тогда предложит загрузить файл заново (UPLOAD_EXPIRED).

const TTL_MS = 30 * 60_000;
/** Предел размера файла импорта. */
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
/** Незавершённых импортов у одного пользователя: лишние (самые старые) забываются. */
const PER_USER = 3;

interface Upload {
  userId: string;
  chunks: Buffer[];
  size: number;
  touched: number;
  pkg: ExportPackage | null;
}

const uploads = new Map<string, Upload>();

function sweep() {
  const now = Date.now();
  for (const [id, u] of uploads) if (now - u.touched > TTL_MS) uploads.delete(id);
}

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
    u.chunks.push(chunk);
    u.size += chunk.length;
    u.touched = Date.now();
    return uploadId;
  }
  const mine = [...uploads.entries()].filter(([, u]) => u.userId === userId).sort((a, b) => a[1].touched - b[1].touched);
  for (const [id] of mine.slice(0, Math.max(0, mine.length - PER_USER + 1))) uploads.delete(id);
  const id = randomBytes(16).toString('base64url');
  uploads.set(id, { userId, chunks: [chunk], size: chunk.length, touched: Date.now(), pkg: null });
  return id;
}

export function getUpload(userId: string, uploadId: string): Upload {
  const u = uploads.get(uploadId);
  if (!u || u.userId !== userId || Date.now() - u.touched > TTL_MS) throw new ImportError('UPLOAD_EXPIRED');
  u.touched = Date.now();
  return u;
}

/** Файл целиком (части склеиваются один раз). */
export function uploadBytes(u: Upload): Uint8Array {
  if (u.chunks.length > 1) u.chunks = [Buffer.concat(u.chunks)];
  return u.chunks[0] ?? new Uint8Array();
}

export function dropUpload(uploadId: string) {
  uploads.delete(uploadId);
}
