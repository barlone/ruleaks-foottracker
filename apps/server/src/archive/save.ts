import { newId, type ArchiveFormat, type LinkArchive } from '@ft/shared';
import { can } from '../authz.ts';
import { DriveError, type ArchiveFile, type Deps } from '../ports.ts';
import { ARCHIVE_MIME, archiveFileName } from './names.ts';

// Сохранение готового архива на Google Диск того, кто его снял, и запись LinkArchive в ссылку досье.
// Права проверяются заново: за время захвата пользователя могли лишить доступа, а ссылку — удалить.
// Файлы, оставшиеся без записи в досье (ссылка удалена во время загрузки), уходят в корзину Диска.

export class SaveFailed extends Error {}

export interface SaveInput {
  userId: string;
  dossierId: string;
  itemId: string;
  url: string;
  at: string;
  files: Array<{ format: ArchiveFormat; file: ArchiveFile; sha256: string }>;
}

/** Код ошибки сохранения для задания (тексты — apps/web/src/lib/errors.ts). */
export function saveErrorCode(e: unknown): string {
  if (e instanceof SaveFailed) return e.message;
  if (e instanceof DriveError) {
    return { NOT_CONNECTED: 'DRIVE_NOT_CONNECTED', REVOKED: 'DRIVE_REVOKED', SCOPE: 'DRIVE_SCOPE' }[e.code as string] ?? 'DRIVE_FAILED';
  }
  return 'DRIVE_FAILED';
}

export async function saveArchiveToDrive(deps: Deps, s: SaveInput, signal: AbortSignal): Promise<string> {
  const drive = deps.drive;
  if (!drive) throw new SaveFailed('ARCHIVE_DISABLED');
  const d = await deps.dossiers.get(s.dossierId);
  if (!d || !can(s.userId, 'edit', d)) throw new SaveFailed('NO_RIGHTS');
  if (!d.items.some((i) => i.id === s.itemId && i.type === 'link')) throw new SaveFailed('ARCHIVE_LINK_GONE');

  const uploads = s.files.map((f) => ({
    format: f.format, name: archiveFileName(s.url, s.at, f.format), mime: ARCHIVE_MIME[f.format], size: f.file.size, sha256: f.sha256, open: () => f.file.open(),
  }));
  let ids: string[];
  try {
    ids = await drive.upload(s.userId, { dossierId: d.id, dossierTitle: d.title, itemId: s.itemId }, uploads, signal);
  } catch (e) {
    // Доступ отозван в аккаунте Google — подключение больше не годится.
    if (e instanceof DriveError && e.code === 'REVOKED') await deps.driveAccounts.remove(s.userId);
    throw e;
  }

  const user = await deps.users.get(s.userId);
  const record: LinkArchive = {
    id: newId(),
    at: s.at,
    by: s.userId,
    byName: user?.displayName,
    files: uploads.map((u, i) => ({ format: u.format, driveFileId: ids[i]!, name: u.name, size: u.size, sha256: u.sha256 })),
  };
  // Досье перечитывается: пока шла загрузка, его могли править.
  const fresh = await deps.dossiers.get(s.dossierId);
  const item = fresh?.items.find((i) => i.id === s.itemId);
  if (!fresh || !item || item.type !== 'link') {
    await drive.trash(s.userId, ids);
    throw new SaveFailed('ARCHIVE_LINK_GONE');
  }
  await deps.dossiers.updateItem(fresh.id, { ...item, archives: [...(item.archives ?? []), record].slice(-50) });
  return record.id;
}
