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

/** Теги объекта как jsonb-массив Tag (в порядке position); obj — выражение с id досье/расследования. */
export function tagsJsonSql(kind: 'dossier' | 'investigation', obj: string): string {
  return `coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'ownerId', t.owner_id, 'text', x.text, 'color', t.color)
            ORDER BY ot.position, x.text)
          FROM ${kind}_tags ot JOIN tags t ON t.id = ot.tag_id JOIN tag_texts x ON x.id = t.text_id
          WHERE ot.${kind}_id = ${obj}), '[]'::jsonb)`;
}

/**
 * Условие «у объекта есть все теги из uuid[]-параметра tags» (теги словаря пользователя user; сравнение по тексту —
 * подходит и такой же тег, поставленный соавтором из своего словаря). Пустой массив — без фильтра.
 */
export function tagsFilterSql(kind: 'dossier' | 'investigation', obj: string, tags: string, user: string): string {
  return `NOT EXISTS (SELECT 1 FROM tags f WHERE f.id = ANY(${tags}::uuid[]) AND f.owner_id = ${user}
            AND NOT EXISTS (SELECT 1 FROM ${kind}_tags ot JOIN tags t ON t.id = ot.tag_id
                            WHERE ot.${kind}_id = ${obj} AND t.text_id = f.text_id))`;
}

/** Заменить теги объекта; несуществующие id тегов пропускаются, порядок — как в списке. */
export async function replaceTags(c: Tx, kind: 'dossier' | 'investigation', id: string, tagIds: string[]) {
  await c.query(`DELETE FROM ${kind}_tags WHERE ${kind}_id = $1`, [id]);
  const ids = tagIds.filter(isUuid);
  if (!ids.length) return;
  await c.query(
    `INSERT INTO ${kind}_tags (${kind}_id, tag_id, position)
     SELECT $1, t.id, o.ord FROM unnest($2::uuid[]) WITH ORDINALITY AS o(tag_id, ord)
     JOIN tags t ON t.id = o.tag_id
     ON CONFLICT DO NOTHING`,
    [id, ids],
  );
}
