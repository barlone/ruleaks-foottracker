import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { DriveError, type DriveAccount, type DriveAccountRepo, type DriveFileRef, type DriveStorage, type DriveUpload } from '../../ports.ts';

// Память вместо БД для подключений Диска ([project-db] enabled = false) и имитация самого Диска
// ([google-drive] client-id пуст): «подключение» без Google, файлы — в памяти процесса (пропадают при перезапуске).

export class MemoryDriveAccounts implements DriveAccountRepo {
  private map = new Map<string, DriveAccount>();
  async get(userId: string) {
    return this.map.get(userId) ?? null;
  }
  async save(a: DriveAccount) {
    this.map.set(a.userId, { ...a });
  }
  async remove(userId: string) {
    this.map.delete(userId);
  }
}

interface DemoFile {
  owner: string;
  dossierId: string;
  itemId: string;
  body: Buffer;
  trashed: boolean;
}

export const DEMO_DRIVE_EMAIL = 'demo@drive.example';

export class DemoDriveStorage implements DriveStorage {
  readonly demo = true;
  private files = new Map<string, DemoFile>();

  constructor(private accounts: DriveAccountRepo, readonly folderName: string, private callbackPath: string) {}

  /** Без Google: браузер сразу возвращается на обратный адрес с вымышленным кодом. */
  connectUrl(state: string) {
    return `${this.callbackPath}?code=demo&state=${encodeURIComponent(state)}`;
  }

  async connect(userId: string) {
    await this.accounts.save({ userId, email: DEMO_DRIVE_EMAIL, refreshToken: 'demo', folderId: null });
    return { email: DEMO_DRIVE_EMAIL };
  }

  async status(userId: string) {
    const a = await this.accounts.get(userId);
    return a ? { email: a.email } : null;
  }

  async disconnect(userId: string) {
    await this.accounts.remove(userId);
  }

  async upload(userId: string, place: { dossierId: string; itemId: string }, files: DriveUpload[]) {
    if (!(await this.accounts.get(userId))) throw new DriveError('NOT_CONNECTED', 'Диск не подключён');
    const ids: string[] = [];
    for (const f of files) {
      const chunks: Buffer[] = [];
      for await (const c of f.open()) chunks.push(Buffer.from(c as Buffer));
      const id = `demo${randomBytes(12).toString('base64url')}`;
      this.files.set(id, { owner: userId, dossierId: place.dossierId, itemId: place.itemId, body: Buffer.concat(chunks), trashed: false });
      ids.push(id);
    }
    return ids;
  }

  async open(owner: string, ref: DriveFileRef) {
    if (!(await this.accounts.get(owner))) throw new DriveError('NOT_CONNECTED', 'владелец отключил Диск');
    const f = this.files.get(ref.fileId);
    if (!f || f.trashed || f.owner !== owner) throw new DriveError('NOT_FOUND', 'файла нет (имитация: перезапуск сервера стирает Диск)');
    if (f.dossierId !== ref.dossierId || f.itemId !== ref.itemId) throw new DriveError('CHANGED', 'файл другого досье');
    return { size: f.body.length, body: Readable.from(f.body) };
  }

  async trash(owner: string, fileIds: string[]) {
    for (const id of fileIds) {
      const f = this.files.get(id);
      if (f && f.owner === owner) f.trashed = true;
    }
  }
}
