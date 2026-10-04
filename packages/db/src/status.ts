import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Состояние миграций: какие файлы из packages/db/migrations записаны в pgmigrations.
// Используется командой `npm run db -- status` и сервером при старте.

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
export const MIGRATIONS_TABLE = 'pgmigrations';

interface Queryable {
  query<R extends object = Record<string, unknown>>(sql: string): Promise<{ rows: R[] }>;
}

export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => f.replace(/\.sql$/, ''));
}

export async function migrationStatus(db: Queryable) {
  const exists = (await db.query<{ ok: boolean }>(`SELECT to_regclass('public.${MIGRATIONS_TABLE}') IS NOT NULL AS ok`)).rows[0]?.ok;
  const rows = exists
    ? (await db.query<{ name: string; run_on: string }>(
        `SELECT name, to_char(run_on, 'YYYY-MM-DD HH24:MI:SS') AS run_on FROM public.${MIGRATIONS_TABLE} ORDER BY id`,
      )).rows
    : [];
  const applied = new Map(rows.map((r) => [r.name, r.run_on]));
  const files = migrationNames();
  return {
    applied,
    pending: files.filter((n) => !applied.has(n)),
    unknown: [...applied.keys()].filter((n) => !files.includes(n)),
    files,
  };
}
