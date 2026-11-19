import { isUuid } from '@ft/shared';
import type { DriveAccount, DriveAccountRepo } from '../../ports.ts';
import type { Db } from './db.ts';

// Подключённые Google Диски пользователей (таблица drive_accounts). refresh_token приходит уже зашифрованным.

export class PgDriveAccounts implements DriveAccountRepo {
  constructor(private db: Db) {}

  async get(userId: string): Promise<DriveAccount | null> {
    if (!isUuid(userId)) return null;
    const r = await this.db.query<{ email: string; refresh_token: string; folder_id: string | null }>(
      'SELECT email, refresh_token, folder_id FROM drive_accounts WHERE user_id = $1',
      [userId],
    );
    const row = r.rows[0];
    return row ? { userId, email: row.email, refreshToken: row.refresh_token, folderId: row.folder_id } : null;
  }

  async save(a: DriveAccount): Promise<void> {
    await this.db.query(
      `INSERT INTO drive_accounts (user_id, email, refresh_token, folder_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token, folder_id = EXCLUDED.folder_id`,
      [a.userId, a.email, a.refreshToken, a.folderId],
    );
  }

  async remove(userId: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.db.query('DELETE FROM drive_accounts WHERE user_id = $1', [userId]);
  }
}
