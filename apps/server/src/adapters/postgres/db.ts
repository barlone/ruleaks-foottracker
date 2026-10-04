import type pg from 'pg';
import { isUuid } from '@ft/shared';
import { VersionConflict } from '../../ports.ts';

// Общие помощники PostgreSQL-хранилища (база ruleaksfoottracker, схема — packages/db/migrations).

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Q = Pick<pg.Pool, 'query'>;

/** Транзакция: BEGIN … COMMIT, при ошибке — ROLLBACK. */
export async function tx<T>(pool: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export function notFound(): never {
  throw new Error('NOT_FOUND');
}

/** Идентификатор из запроса, который не может быть uuid, — объекта заведомо нет. */
export function mustUuid(id: string): string {
  if (!isUuid(id)) notFound();
  return id;
}

/** Идентификатор нового объекта от клиента (узел графа, элемент досье) обязан быть uuid. */
export function newObjectId(id: string): string {
  if (!isUuid(id)) throw new Error('BAD_ID');
  return id;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** jsonb-параметр: node-postgres превращает JS-массивы в массивы PostgreSQL, поэтому сериализуем сами. */
export const json = (v: unknown): string => JSON.stringify(v ?? null);

/** Подстрока для ILIKE с экранированием % и _. */
export function likePattern(q: string | undefined): string | null {
  const t = q?.trim();
  return t ? `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
}

/**
 * Блокирует строку объекта, проверяет версию (если передана) и увеличивает её.
 * Любая правка досье/расследования повышает version — на этом держится оптимистичная блокировка.
 */
export async function lockAndBump(c: Tx, table: 'dossiers' | 'investigations', id: string, expected?: number) {
  mustUuid(id);
  const r = await c.query<{ version: number; owner_id: string }>(
    `SELECT version, owner_id FROM ${table} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  const row = r.rows[0] ?? notFound();
  if (expected !== undefined && row.version !== expected) throw new VersionConflict(row.version);
  await c.query(`UPDATE ${table} SET version = version + 1 WHERE id = $1`, [id]);
  return { ownerId: row.owner_id };
}
