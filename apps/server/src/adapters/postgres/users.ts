import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@ft/shared';
import { isUuid } from '@ft/shared';
import { DEFAULT_DISPLAY_NAME, type SessionRepo, type UserRepo } from '../../ports.ts';
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

  async upsertByTgId(u: { tgId: string; displayName: string | null; username: string | null }) {
    return tx(this.db, async (c) => {
      // @username в Telegram уникален: если он «переехал» к другому, у прежнего владельца он устарел.
      if (u.username) {
        await c.query(`UPDATE users SET username = NULL WHERE lower(username) = lower($1) AND tg_id <> $2`, [u.username, u.tgId]);
      }
      // Неизвестные имя/ник (null) не затирают записанные раньше: по @username делятся досье.
      const r = await c.query<{ id: string }>(
        `INSERT INTO users (tg_id, display_name, username, last_seen_at) VALUES ($1, coalesce($2::text, $4::text), $3::text, now())
         ON CONFLICT (tg_id) DO UPDATE
           SET display_name = coalesce($2::text, users.display_name), username = coalesce($3::text, users.username), last_seen_at = now()
         RETURNING id`,
        [u.tgId, u.displayName, u.username, DEFAULT_DISPLAY_NAME],
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

/**
 * Как часто обновлять sessions.last_seen_at. Сессия проверяется на каждом запросе (tRPC, картинки сканов,
 * тайлы карты — сотни в секунду у одного пользователя), и запись при каждом из них раздувала бы таблицу и WAL.
 * Поле нужно лишь с точностью до минут («когда последний раз заходил»).
 */
const LAST_SEEN_STEP_MS = 5 * 60_000;

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
    const h = hash(sid);
    const r = await this.db.query<{ user_id: string; last_seen_at: Date }>(
      `SELECT user_id, last_seen_at FROM sessions WHERE id_hash = $1 AND expires_at > now()`,
      [h],
    );
    const row = r.rows[0];
    if (!row) return null;
    // Отметка «был в сети» — не чаще раза в LAST_SEEN_STEP_MS и не на пути запроса: ответ её не ждёт.
    // Условие повторено в SQL, чтобы параллельные запросы одной сессии не писали строку наперегонки.
    if (Date.now() - row.last_seen_at.getTime() >= LAST_SEEN_STEP_MS) {
      void this.db
        .query(`UPDATE sessions SET last_seen_at = now() WHERE id_hash = $1 AND last_seen_at < now() - $2::float8 * interval '1 millisecond'`, [h, LAST_SEEN_STEP_MS])
        .catch(() => {});
    }
    return { userId: row.user_id };
  }

  async delete(sid: string) {
    await this.db.query(`DELETE FROM sessions WHERE id_hash = $1`, [hash(sid)]);
  }

  async deleteAllForUser(userId: string) {
    await this.db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  }
}
