import pg from 'pg';
import type { DbConfig } from '@ft/config';

// Подключение node-postgres по секции config.ini. Общий для сервера (пулы) и миграций (клиент).
// sslmode — как у libpq:
//   disable — без TLS; allow/prefer — TLS, а если сервер его не поддерживает, без TLS;
//   require — TLS без проверки сертификата; verify-ca/verify-full — с проверкой.

function sslOption(mode: DbConfig['sslmode'], tls: boolean): pg.ClientConfig['ssl'] {
  if (!tls || mode === 'disable') return false;
  if (mode === 'verify-ca' || mode === 'verify-full') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function clientConfig(d: DbConfig, tls: boolean, opts: { readOnly?: boolean; appName?: string } = {}): pg.ClientConfig {
  return {
    host: d.host,
    port: d.port,
    database: d.database,
    user: d.user,
    password: d.password,
    ssl: sslOption(d.sslmode, tls),
    connectionTimeoutMillis: d.connectTimeoutSec * 1000,
    application_name: opts.appName ?? 'ruleaks-foottracker',
    // Чужую базу (бота) открываем только на чтение — защита от случайной записи.
    options: opts.readOnly ? '-c default_transaction_read_only=on' : undefined,
  };
}

const NO_TLS = /does not support SSL|server does not support ssl/i;

/** Пробует с TLS, при allow/prefer откатывается на соединение без TLS. */
async function withTlsFallback<T>(d: DbConfig, open: (tls: boolean) => Promise<T>): Promise<{ value: T; tls: boolean }> {
  if (d.sslmode === 'disable') return { value: await open(false), tls: false };
  try {
    return { value: await open(true), tls: true };
  } catch (e) {
    if ((d.sslmode === 'prefer' || d.sslmode === 'allow') && NO_TLS.test((e as Error).message)) {
      return { value: await open(false), tls: false };
    }
    throw e;
  }
}

/** Пул с проверкой подключения одним запросом. */
export async function openPool(d: DbConfig, opts: { readOnly: boolean }): Promise<{ pool: pg.Pool; tls: boolean }> {
  const { value, tls } = await withTlsFallback(d, async (tls) => {
    const pool = new pg.Pool({ ...clientConfig(d, tls, opts), max: d.poolMax, idleTimeoutMillis: 30_000 });
    try {
      await pool.query('select 1');
      return pool;
    } catch (e) {
      await pool.end().catch(() => {});
      throw e;
    }
  });
  return { pool: value, tls };
}

/** Одиночный клиент (миграции). */
export async function openClient(d: DbConfig, appName: string): Promise<{ client: pg.Client; tls: boolean }> {
  const { value, tls } = await withTlsFallback(d, async (tls) => {
    const client = new pg.Client(clientConfig(d, tls, { appName }));
    try {
      await client.connect();
      return client;
    } catch (e) {
      await client.end().catch(() => {});
      throw e;
    }
  });
  return { client: value, tls };
}
