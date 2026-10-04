import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@ft/shared';
import { isUuid } from '@ft/shared';
import type { SessionRepo, UserRepo } from '../../ports.ts';
import { tx, type Db } from './db.ts';

type StoredUser = Omit<User, 'access'>;

interface UserRow {
  id: string;
  tg_id: string;
  display_name: string;
  username: string | null;
}

const toUser = (r: UserRow): StoredUser => ({ id: r.id, tgId: r.tg_id, displayName: r.display_name, username: r.username });

/** Пользователь сайта = пользователь бота (по tg_id). Подписку и токен API здесь не храним. */
export class PgUsers implements UserRepo {
  constructor(private db: Db) {}

  async upsertByTgId(u: { tgId: string; displayName: string; username: string | null }) {
    return tx(this.db, async (c) => {
      // @username в Telegram уникален: если он «переехал» к другому, у прежнего владельца он устарел.
      if (u.username) {
        await c.query(`UPDATE users SET username = NULL WHERE lower(username) = lower($1) AND tg_id <> $2`, [u.username, u.tgId]);
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO users (tg_id, display_name, username, last_seen_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (tg_id) DO UPDATE
           SET display_name = EXCLUDED.display_name, username = EXCLUDED.username, last_seen_at = now()
         RETURNING id`,
        [u.tgId, u.displayName, u.username],
      );
      return { id: r.rows[0]!.id };
    });
  }

  async get(id: string) {
    if (!isUuid(id)) return null;
    const r = await this.db.query<UserRow>(`SELECT id, tg_id::text, display_name, username FROM users WHERE id = $1`, [id]);
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }

  async findByUsername(username: string) {
    const r = await this.db.query<UserRow>(
      `SELECT id, tg_id::text, display_name, username FROM users WHERE lower(username) = lower($1)`,
      [username.replace(/^@/, '')],
    );
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }
}

/** В cookie — случайный идентификатор, в БД — только его sha256. */
const hash = (sid: string) => createHash('sha256').update(sid).digest();

export class PgSessions implements SessionRepo {
  constructor(private db: Db) {}

  async create(userId: string, ttlMs: number) {
    const sid = randomBytes(32).toString('base64url');
    await this.db.query(`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + $3::float8 * interval '1 millisecond')`, [
      hash(sid), userId, ttlMs,
    ]);
    // Заодно убрать истёкшие — их немного, индекс по expires_at.
    await this.db.query(`DELETE FROM sessions WHERE expires_at < now()`);
    return sid;
  }

  async get(sid: string) {
    const r = await this.db.query<{ user_id: string }>(
      `UPDATE sessions SET last_seen_at = now()
       WHERE id_hash = $1 AND expires_at > now()
       RETURNING user_id`,
      [hash(sid)],
    );
    return r.rows[0] ? { userId: r.rows[0].user_id } : null;
  }

  async delete(sid: string) {
    await this.db.query(`DELETE FROM sessions WHERE id_hash = $1`, [hash(sid)]);
  }

  async deleteAllForUser(userId: string) {
    await this.db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  }
}
