import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { ConfigError, loadConfig } from '@ft/config';
import { openClient } from './pg.ts';

// Миграции БД сайта (аналог alembic) на node-pg-migrate.
// Подключение — [project-db] из config.ini (флаг enabled не важен). Миграции — SQL-файлы
// в packages/db/migrations с секциями «-- Up Migration» / «-- Down Migration»; применённые
// версии записываются в таблицу pgmigrations (имя файла без .sql).
//
//   npm run db -- status            что применено и что ждёт
//   npm run db -- up [N]            применить все (или N) новые миграции
//   npm run db -- down [N]          откатить последнюю (или N)
//   npm run db -- create <имя>      новый SQL-файл миграции с UTC-меткой времени
//   npm run db -- manual <файл>     SQL для ручного применения (секция Up + отметка в pgmigrations)

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
const TABLE = 'pgmigrations';

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/\D/g, '').slice(0, 14); // YYYYMMDDHHMMSS (UTC)
}

function create(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error('Укажите имя миграции латиницей: npm run db -- create add-something');
  const file = join(MIGRATIONS_DIR, `${stamp()}_${slug}.sql`);
  writeFileSync(file, `-- ${name}\n\n-- Up Migration\n\n\n-- Down Migration\n\n`);
  console.log(`Создано: ${file}`);
}

/** SQL для ручного применения миграции: от имени владельца базы, в одной транзакции, с отметкой в pgmigrations. */
function manual(fileArg: string) {
  const file = migrationFiles().find((f) => f === fileArg || f === `${fileArg}.sql` || join(MIGRATIONS_DIR, f) === resolve(fileArg));
  if (!file) throw new Error(`Миграция не найдена: ${fileArg}`);
  const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  const up = content.search(/^\s*--[\s-]*up\s+migration/im);
  const down = content.search(/^\s*--[\s-]*down\s+migration/im);
  if (up < 0) throw new Error('В файле нет секции «-- Up Migration»');
  const upSql = content.slice(up, down > up ? down : undefined).trimEnd();
  const name = file.replace(/\.sql$/, '');
  const { projectDb } = loadConfig();
  const owner = projectDb.user || 'ruleaksfoottracker';
  process.stdout.write(`-- Ручное применение миграции ${name}.
-- Сгенерировано: npm run db -- manual ${file}
-- Выполнять в базе ${projectDb.database || 'ruleaksfoottracker'} (\\c ${projectDb.database || 'ruleaksfoottracker'}) под ${owner} или суперпользователем.
-- Всё в одной транзакции: при ошибке ничего не применится.

BEGIN;

-- Объекты должны принадлежать владельцу базы, даже если скрипт выполняет суперпользователь.
SET LOCAL ROLE ${owner};

${upSql}

-- Отметка для node-pg-migrate: эта миграция считается применённой.
CREATE TABLE IF NOT EXISTS public.${TABLE} (id SERIAL PRIMARY KEY, name varchar(255) NOT NULL, run_on timestamp NOT NULL);
INSERT INTO public.${TABLE} (name, run_on) SELECT '${name}', now()
WHERE NOT EXISTS (SELECT FROM public.${TABLE} WHERE name = '${name}');

COMMIT;
`);
}

async function status() {
  const { projectDb } = loadConfig();
  const { client } = await openClient(projectDb, 'ruleaks-foottracker-migrate');
  try {
    const exists = (await client.query(`SELECT to_regclass('public.${TABLE}') IS NOT NULL AS ok`)).rows[0].ok as boolean;
    const applied = new Map<string, string>(
      exists ? (await client.query(`SELECT name, to_char(run_on, 'YYYY-MM-DD HH24:MI:SS') AS run_on FROM public.${TABLE} ORDER BY id`)).rows.map((r) => [r.name, r.run_on]) : [],
    );
    for (const f of migrationFiles()) {
      const name = f.replace(/\.sql$/, '');
      const at = applied.get(name);
      console.log(`${at ? '✓' : '·'} ${name}${at ? `  (${at})` : '  — ожидает'}`);
      applied.delete(name);
    }
    for (const name of applied.keys()) console.log(`? ${name}  — применена, но файла нет`);
  } finally {
    await client.end();
  }
}

async function run(direction: 'up' | 'down', count?: number) {
  const { projectDb } = loadConfig();
  const { client, tls } = await openClient(projectDb, 'ruleaks-foottracker-migrate');
  console.log(`${projectDb.user}@${projectDb.host}:${projectDb.port}/${projectDb.database}${tls ? ' (TLS)' : ''}`);
  try {
    const done = await runner({
      dbClient: client,
      dir: MIGRATIONS_DIR,
      migrationsTable: TABLE,
      direction,
      count: count ?? (direction === 'up' ? Infinity : 1),
      checkOrder: true,
      log: (msg: string) => console.log(msg),
    });
    console.log(done.length ? `${direction === 'up' ? 'Применено' : 'Откачено'}: ${done.map((m) => m.name).join(', ')}` : 'Нечего применять');
  } finally {
    await client.end();
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const n = arg !== undefined && /^\d+$/.test(arg) ? Number(arg) : undefined;
  switch (cmd) {
    case 'status': return status();
    case 'up': return run('up', n);
    case 'down': return run('down', n);
    case 'create': return create(arg ?? '');
    case 'manual': return manual(arg ?? '');
    default:
      console.log('Команды: status | up [N] | down [N] | create <имя> | manual <файл миграции>');
      process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(e instanceof ConfigError ? e.message : e.stack ?? e.message);
  process.exit(1);
});
