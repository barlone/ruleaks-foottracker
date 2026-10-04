import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'ini';
import { z } from 'zod';

// Конфигурация RuLeaks.Следопыт: config.ini в корне репозитория (шаблон — config.example.ini).
// Любой ключ переопределяется переменной окружения FT_<СЕКЦИЯ>_<КЛЮЧ>,
// например [project-db] password → FT_PROJECT_DB_PASSWORD. Путь к файлу — FT_CONFIG.

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max).default(def);
// ini превращает true/false в boolean, поэтому строки и флаги приводим явно.
const str = (def = '') => z.preprocess((v) => (v === undefined || v === null ? v : String(v)), z.string().trim().default(def));
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? ['true', 'yes', 'on', '1'].includes(v.trim().toLowerCase()) ? true : ['false', 'no', 'off', '0', ''].includes(v.trim().toLowerCase()) ? false : v : v),
    z.boolean().default(def),
  );
const sslmode = z.enum(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']).default('prefer');

const DbSection = z.object({
  /** false — вместо базы используются данные в памяти (демо). */
  enabled: bool(false),
  host: str(),
  port: int(5432, 1, 65535),
  database: str(),
  user: str(),
  password: str(),
  /** Семантика libpq, как PG_SSLMODE у бота. */
  sslmode,
  'pool-max': int(10, 1, 200),
  'connect-timeout-sec': int(3, 1, 60),
});

/** Секции файла. Отдельно от Schema — по ним проверяются неизвестные ключи и env-переопределения. */
const SECTIONS = {
  server: z.object({
    host: str('127.0.0.1'),
    port: int(3001, 1, 65535),
    'cookie-secret': str(),
    /** Вход без бота по Telegram ID пользователя (пока бот не умеет подтверждать вход). Только на localhost. */
    'dev-login': bool(true),
    'session-ttl-days': int(30, 1, 365),
  }),
  telegram: z.object({
    'bot-username': str('ruleaks_bot'),
  }),
  'project-db': DbSection.extend({ database: str('foottracker'), user: str('foottracker') }),
  'bot-db': DbSection.extend({ 'pool-max': int(5, 1, 50) }),
  api: z.object({
    /** false — имитация шлюза с вымышленными данными. */
    enabled: bool(false),
    'base-url': str('https://api.dsstalker.online'),
    /** Шлюз пропускает с одного токена не чаще одного запроса за это время ([limits] min-msec-between-reqs). */
    'min-interval-ms': int(1000, 0, 60_000),
    'timeout-sec': int(30, 1, 600),
    'poll-interval-ms': int(1500, 200, 60_000),
    'job-timeout-sec': int(300, 10, 3600),
  }),
};

const Schema = z.object({
  server: SECTIONS.server.prefault({}),
  telegram: SECTIONS.telegram.prefault({}),
  'project-db': SECTIONS['project-db'].prefault({}),
  'bot-db': SECTIONS['bot-db'].prefault({}),
  api: SECTIONS.api.prefault({}),
});

type Raw = z.infer<typeof Schema>;
type RawDb = z.infer<typeof DbSection>;

export interface DbConfig {
  enabled: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslmode: RawDb['sslmode'];
  poolMax: number;
  connectTimeoutSec: number;
}

export interface AppConfig {
  /** Откуда прочитан конфиг (null — файла нет, всё по умолчанию). */
  file: string | null;
  server: {
    host: string;
    port: number;
    cookieSecret: string;
    /** Сервер слушает только локальный интерфейс (dev-login разрешён, cookie без Secure). */
    loopback: boolean;
    devLogin: boolean;
    sessionTtlMs: number;
  };
  telegram: { botUsername: string };
  /** База сайта: досье, расследования, медиа, сессии. */
  projectDb: DbConfig;
  /** База бота pyruleaks-bot: users, tokens, подписки (только чтение). */
  botDb: DbConfig;
  /** dsstalker-api-gate. */
  api: { enabled: boolean; baseUrl: string; timeoutMs: number; minIntervalMs: number; pollIntervalMs: number; jobTimeoutMs: number };
  /** Предупреждения загрузки: неизвестные ключи, отсутствие файла. */
  warnings: string[];
}

const DEV_COOKIE_SECRET = 'dev-only-cookie-secret-change-me-please';

/** Ищет config.ini вверх от cwd до корня монорепо (package.json с workspaces). */
function findConfig(): string | null {
  if (process.env.FT_CONFIG) return resolve(process.env.FT_CONFIG);
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, 'config.ini');
    if (existsSync(candidate)) return candidate;
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && readFileSync(pkg, 'utf8').includes('"workspaces"')) return null;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function db(d: RawDb): DbConfig {
  return {
    enabled: d.enabled, host: d.host, port: d.port, database: d.database, user: d.user, password: d.password,
    sslmode: d.sslmode, poolMax: d['pool-max'], connectTimeoutSec: d['connect-timeout-sec'],
  };
}

export class ConfigError extends Error {}

export function loadConfig(): AppConfig {
  const warnings: string[] = [];
  const file = findConfig();
  const raw: Record<string, Record<string, unknown>> = {};
  if (file) {
    if (!existsSync(file)) throw new ConfigError(`Файл конфигурации не найден: ${file}`);
    for (const [section, body] of Object.entries(parse(readFileSync(file, 'utf8')))) {
      if (body && typeof body === 'object') raw[section] = { ...(body as Record<string, unknown>) };
      else warnings.push(`ключ «${section}» вне секции — пропущен`);
    }
  } else {
    warnings.push('config.ini не найден — используются значения по умолчанию (демо-режим). Шаблон: config.example.ini');
  }

  // Неизвестные секции и ключи — предупреждение (опечатка не должна тихо превращаться в значение по умолчанию).
  const sections = SECTIONS as Record<string, z.ZodObject>;
  for (const [section, body] of Object.entries(raw)) {
    const sec = sections[section];
    if (!sec) {
      warnings.push(`неизвестная секция [${section}]`);
      continue;
    }
    for (const k of Object.keys(body)) if (!(k in sec.shape)) warnings.push(`неизвестный ключ [${section}] ${k}`);
  }

  // Переопределения из окружения: FT_PROJECT_DB_PASSWORD → [project-db] password.
  for (const [section, sec] of Object.entries(sections)) {
    for (const key of Object.keys(sec.shape)) {
      const env = process.env[`FT_${section}_${key}`.toUpperCase().replace(/-/g, '_')];
      if (env !== undefined) (raw[section] ??= {})[key] = env;
    }
  }

  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `[${String(i.path[0])}] ${i.path.slice(1).map(String).join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Ошибка в конфигурации${file ? ` (${file})` : ''}: ${msg}`);
  }
  const c: Raw = parsed.data;

  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(c.server.host);
  const cfg: AppConfig = {
    file,
    server: {
      host: c.server.host,
      port: c.server.port,
      cookieSecret: c.server['cookie-secret'] || DEV_COOKIE_SECRET,
      sessionTtlMs: c.server['session-ttl-days'] * 86400_000,
      loopback,
      devLogin: c.server['dev-login'],
    },
    telegram: { botUsername: c.telegram['bot-username'].replace(/^@/, '') },
    projectDb: db(c['project-db']),
    botDb: db(c['bot-db']),
    api: {
      enabled: c.api.enabled,
      baseUrl: c.api['base-url'].replace(/\/+$/, ''),
      timeoutMs: c.api['timeout-sec'] * 1000,
      minIntervalMs: c.api['min-interval-ms'],
      pollIntervalMs: c.api['poll-interval-ms'],
      jobTimeoutMs: c.api['job-timeout-sec'] * 1000,
    },
    warnings,
  };

  validate(cfg);
  return cfg;
}

/** Включённое подключение должно быть заполнено; наружу (не localhost) — только с настоящим секретом и без dev-login. */
function validate(cfg: AppConfig) {
  const missing: string[] = [];
  for (const [name, d] of [['project-db', cfg.projectDb], ['bot-db', cfg.botDb]] as const) {
    if (!d.enabled) continue;
    for (const k of ['host', 'database', 'user', 'password'] as const) if (!d[k]) missing.push(`[${name}] ${k}`);
  }
  if (cfg.api.enabled && !/^https?:\/\//.test(cfg.api.baseUrl)) missing.push('[api] base-url');
  if (!cfg.server.loopback) {
    if (cfg.server.cookieSecret === DEV_COOKIE_SECRET || cfg.server.cookieSecret.length < 32) missing.push('[server] cookie-secret (не короче 32 символов — сервер слушает не только localhost)');
    if (cfg.server.devLogin) missing.push('[server] dev-login = false (вход без бота допустим только на localhost)');
  }
  if (missing.length) throw new ConfigError(`Не заданы или недопустимы: ${missing.join(', ')}`);
}

/** Строка подключения в формате libpq (для node-postgres / drizzle). */
export function pgUrl(d: DbConfig): string {
  const auth = `${encodeURIComponent(d.user)}${d.password ? `:${encodeURIComponent(d.password)}` : ''}`;
  return `postgres://${auth}@${d.host}:${d.port}/${encodeURIComponent(d.database)}?sslmode=${d.sslmode}&connect_timeout=${d.connectTimeoutSec}`;
}

/** Сводка для лога при старте — без паролей и секретов. */
export function describeConfig(cfg: AppConfig): string[] {
  const dbLine = (d: DbConfig) =>
    d.enabled ? `${d.user}@${d.host}:${d.port}/${d.database} (ssl ${d.sslmode}, pool ${d.poolMax})` : 'выключено — демо-данные в памяти';
  return [
    `конфиг: ${cfg.file ?? 'по умолчанию'}; слушает ${cfg.server.host}:${cfg.server.port}`,
    `БД сайта:  ${dbLine(cfg.projectDb)}`,
    `БД бота:   ${dbLine(cfg.botDb)}`,
    `API:       ${cfg.api.enabled ? `${cfg.api.baseUrl} (таймаут ${cfg.api.timeoutMs / 1000} с, интервал ${cfg.api.minIntervalMs} мс)` : 'выключено — имитация шлюза'}`,
  ];
}
