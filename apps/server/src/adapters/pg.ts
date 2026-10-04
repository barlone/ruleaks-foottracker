import pg from 'pg';
import type { DbConfig } from '@ft/config';

// Пул node-postgres по секции config.ini. sslmode — как у libpq:
// disable — без TLS; allow/prefer — TLS, а если сервер его не поддерживает, без TLS;
// require — TLS без проверки сертификата; verify-ca/verify-full — с проверкой.

function sslOption(mode: DbConfig['sslmode'], tls: boolean): pg.PoolConfig['ssl'] {
  if (!tls || mode === 'disable') return false;
  if (mode === 'verify-ca' || mode === 'verify-full') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function poolConfig(d: DbConfig, tls: boolean, readOnly: boolean): pg.PoolConfig {
  return {
    host: d.host,
    port: d.port,
    database: d.database,
    user: d.user,
    password: d.password,
    ssl: sslOption(d.sslmode, tls),
    max: d.poolMax,
    connectionTimeoutMillis: d.connectTimeoutSec * 1000,
    idleTimeoutMillis: 30_000,
    application_name: 'ruleaks-foottracker',
    // Чужую базу (бота) открываем только на чтение — защита от случайной записи.
    options: readOnly ? '-c default_transaction_read_only=on' : undefined,
  };
}

const NO_TLS = /does not support SSL|server does not support ssl/i;

/** Открывает пул и проверяет подключение одним запросом. */
export async function openPool(d: DbConfig, opts: { readOnly: boolean }): Promise<{ pool: pg.Pool; tls: boolean }> {
  const tryOpen = async (tls: boolean) => {
    const pool = new pg.Pool(poolConfig(d, tls, opts.readOnly));
    try {
      await pool.query('select 1');
      return pool;
    } catch (e) {
      await pool.end().catch(() => {});
      throw e;
    }
  };
  if (d.sslmode === 'disable') return { pool: await tryOpen(false), tls: false };
  try {
    return { pool: await tryOpen(true), tls: true };
  } catch (e) {
    if ((d.sslmode === 'prefer' || d.sslmode === 'allow') && NO_TLS.test((e as Error).message)) {
      return { pool: await tryOpen(false), tls: false };
    }
    throw e;
  }
}
