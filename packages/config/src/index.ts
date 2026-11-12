import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'ini';
import { z } from 'zod';

export { getIniValue, setIniValue } from './ini-edit.ts';

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

/** Имена подсетей, которые понимает trustProxy Fastify (proxy-addr). */
const PROXY_NAMES = ['loopback', 'linklocal', 'uniquelocal'];
const proxyEntryOk = (e: string) => PROXY_NAMES.includes(e) || (/^([^/]+)(?:\/(\d{1,3}))?$/.test(e) && isIP(e.split('/')[0]!) !== 0);

/**
 * [server] trust-proxy → Fastify trustProxy: false; список адресов и подсетей прокси через запятую — каким доверять;
 * true — доверять всем (клиент подделает адрес заголовком, только с предупреждением). Числа прокси нет: Fastify 5.12
 * молча считает число «никому не доверять», поэтому «1»/«2» здесь — ошибка конфигурации, а не true.
 */
const trustProxy = z.preprocess(
  (v) => {
    if (v === undefined || v === null || typeof v === 'boolean') return v;
    const s = String(v).trim();
    const low = s.toLowerCase();
    if (['true', 'yes', 'on'].includes(low)) return true;
    if (['false', 'no', 'off', '0', ''].includes(low)) return false;
    return s.split(',').map((e) => e.trim()).filter(Boolean).join(',');
  },
  z.union([
    z.boolean(),
    z.string().refine((s) => s.split(',').every(proxyEntryOk), 'false или адреса/подсети прокси через запятую (127.0.0.1, 10.0.0.0/8, loopback)'),
  ]).default(false),
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

/** Способ входа: bot-db — через бота (подписка и токен из его базы), none — без входа, password-sha256 — по паролю. */
export const AUTH_MODES = ['none', 'password-sha256', 'bot-db'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** Публичный Nominatim (OpenStreetMap) — адрес точки Wi-Fi по умолчанию; для продакшена лучше свой экземпляр. */
export const NOMINATIM_PUBLIC = 'https://nominatim.openstreetmap.org';

/** Подложка карты поиска по геоданным. */
export const GEO_TILES = ['raster', 'pmtiles'] as const;

/** Секции файла. Отдельно от Schema — по ним проверяются неизвестные ключи и env-переопределения. */
const SECTIONS = {
  config: z.object({
    auth: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(AUTH_MODES).default('bot-db')),
    /** sha256 пароля в hex (auth = password-sha256). */
    'password-sha256': str(),
    /** Соло-режим (none / password-sha256): Telegram ID и имя единственного пользователя сайта. */
    'user-tg-id': str('0'),
    'user-name': str('Следопыт'),
    /** dev-вход (auth = bot-db, [server] dev-login на localhost): кнопка «Войти как …» с этим Telegram ID. */
    'bot-db-dev-quick-login-tg-id': str(),
    /** Раздел «Поиск по геоданным» (карта — секция [geo-search]). */
    'geo-search': bool(false),
    /** Раздел «Поиск личных страниц» (сервер опрашивает сайты из манифеста Sherlock; секция [pages-search]). */
    'pages-search': bool(true),
    /** Раздел «Поиск по Google» (перенос GHunt; аккаунт Google для запросов — секция [google-search]). */
    'google-search': bool(false),
    /** Раздел «Поиск по Email» (GHunt + MOSINT; ключи сервисов — секция [email-search]). */
    'email-search': bool(true),
  }),
  server: z.object({
    host: str('127.0.0.1'),
    port: int(3001, 1, 65535),
    'cookie-secret': str(),
    /** Вход без бота по Telegram ID пользователя (пока бот не умеет подтверждать вход). Только на localhost. */
    'dev-login': bool(true),
    'session-ttl-days': int(30, 1, 365),
    /** Сервер за обратным прокси (nginx, Cloudflare): каким прокси верить в X-Forwarded-For (см. trustProxy). */
    'trust-proxy': trustProxy,
    /** Флаг Secure у cookie. false — только для входа по голому http не с localhost (браузеры принимают Secure на http://localhost). */
    'secure-cookie': bool(true),
  }),
  telegram: z.object({
    'bot-username': str('ruleaks_bot'),
    /** Общий с ботом секрет подписи ссылок входа (HMAC-SHA256); пусто — вход по ссылке выключен. */
    'login-secret': str(),
    /** Сколько живёт ссылка входа от бота. */
    'login-link-ttl-sec': int(180, 30, 3600),
  }),
  'project-db': DbSection.extend({ database: str('ruleaksfoottracker'), user: str('ruleaksfoottracker') }),
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
    /** UUID-токен шлюза для соло-режима (auth = none / password-sha256); при bot-db токен берётся из базы бота. */
    token: str(),
  }),
  'geo-search': z.object({
    /** raster — публичные растровые тайлы (только для разработки); pmtiles — свои векторные тайлы Protomaps. */
    tiles: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(GEO_TILES).default('raster')),
    'raster-url': str('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
    'raster-attribution': str('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'),
    /** Путь к файлу .pmtiles (сервер раздаёт его по /geo/tiles.pmtiles) или https-адрес (браузер ходит туда сам). */
    pmtiles: str(),
    /** Каталог basemaps-assets (fonts/, sprites/) — раздаётся по /geo/assets/ — или https-адрес. */
    assets: str(),
    /** Язык подписей на векторной карте. */
    lang: str('ru'),
    'max-zoom': int(17, 1, 22),
  }),
  'scanstore-api': z.object({
    /** false — сканы документов из результатов поиска не показываются. */
    enabled: bool(false),
    url: str(),
    /** api_token хранилища (Authorization: Bearer); в браузер не уходит. */
    token: str(),
    'timeout-sec': int(30, 1, 600),
  }),
  'pages-search': z.object({
    /** Сколько ждать ответа одного сайта. */
    'timeout-sec': int(15, 1, 120),
    /** Сколько сайтов опрашивать одновременно в одном поиске. */
    concurrency: int(20, 1, 100),
    /** Выполнять и пробы по e-mail с побочным действием (настоящая регистрация / восстановление пароля на сайте). */
    'side-effect-probes': bool(false),
  }),
  'google-search': z.object({
    /** Мастер-токен Android (aas_et/…) служебного аккаунта Google: npm run google-login. Пусто — имитация. */
    'master-token': str(),
    /** Сколько ждать ответа одного запроса к Google. */
    'timeout-sec': int(20, 1, 120),
    /** Пауза между поисками: Google блокирует аккаунт и адрес сервера за частые запросы. */
    'min-interval-sec': int(3, 0, 600),
    /** Сервис обратного геокодирования (API Nominatim) для адреса точки Wi-Fi; пусто — адрес не определяется. */
    'reverse-geocode': str(NOMINATIM_PUBLIC),
  }),
  'email-search': z.object({
    /** Сколько ждать ответа одного внешнего сервиса. */
    'timeout-sec': int(20, 1, 120),
    /** Аккаунт Google по адресу (ghunt email) — от служебного аккаунта [google-search]; без мастер-токена — имитация. */
    google: bool(true),
    /** Регистрации на сайтах по адресу (blackbird, holehe, MOSINT) — настройки опроса из [pages-search]. */
    sites: bool(true),
    /** Геолокация серверов домена через ipapi.co (туда уходят IP-адреса домена). */
    'ip-geo': bool(true),
    /** Регистрация домена через RDAP (rdap.org). */
    rdap: bool(true),
    /** Дампы текстов psbdmp.ws (туда уходит адрес). Выключено: домен сервиса не разрешается (ноябрь 2026). */
    pastes: bool(false),
    /** Упоминания адреса в вебе: выдача DuckDuckGo (туда уходит адрес). */
    'web-mentions': bool(true),
    /**
     * Существует ли ящик: вопрос почтовому серверу домена по SMTP (порт 25, до RCPT TO, письмо не отправляется).
     * Выключено: нужен открытый исходящий порт 25, а сервер адресата видит соединение с нашего IP.
     */
    'smtp-check': bool(false),
    /** Имя в EHLO — должно совпадать с обратной DNS-записью (PTR) IP сервера; пусто — имя хоста машины. */
    'smtp-helo': str(),
    /** Адрес в MAIL FROM (домен, чей SPF разрешает IP сервера); пусто — пустой отправитель <>. */
    'smtp-from': str(),
    /** Ключи сервисов: пусто — часть отчёта не собирается. */
    'hibp-key': str(),
    /** Ключ RapidAPI с подпиской на BreachDirectory. */
    'breachdirectory-key': str(),
    'intelx-key': str(),
    /** API Intelligence X: бесплатный ключ — free.intelx.io, платный — 2.intelx.io. */
    'intelx-url': str('https://free.intelx.io'),
    'emailrep-key': str(),
    'hunter-key': str(),
  }),
};

const Schema = z.object({
  config: SECTIONS.config.prefault({}),
  server: SECTIONS.server.prefault({}),
  telegram: SECTIONS.telegram.prefault({}),
  'project-db': SECTIONS['project-db'].prefault({}),
  'bot-db': SECTIONS['bot-db'].prefault({}),
  api: SECTIONS.api.prefault({}),
  'geo-search': SECTIONS['geo-search'].prefault({}),
  'scanstore-api': SECTIONS['scanstore-api'].prefault({}),
  'pages-search': SECTIONS['pages-search'].prefault({}),
  'google-search': SECTIONS['google-search'].prefault({}),
  'email-search': SECTIONS['email-search'].prefault({}),
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
  /** Вход. Соло-режим (none / password-sha256) — один пользователь user, подписка не проверяется. */
  auth: {
    mode: AuthMode;
    /** sha256 пароля, hex в нижнем регистре (только password-sha256). */
    passwordSha256: string;
    user: { tgId: string; displayName: string };
    /** Telegram ID для кнопки быстрого dev-входа (bot-db + dev-login); '' — кнопки нет. В бандл не попадает: отдаётся сервером. */
    devQuickLoginTgId: string;
  };
  server: {
    host: string;
    port: number;
    cookieSecret: string;
    /** Сервер слушает только локальный интерфейс (dev-login разрешён). За nginx на том же хосте — тоже true. */
    loopback: boolean;
    /** Cookie с флагом Secure (по умолчанию да: прод — за HTTPS, а http://localhost браузеры считают безопасным). */
    secureCookie: boolean;
    devLogin: boolean;
    sessionTtlMs: number;
    /** Fastify trustProxy: false, список адресов/подсетей прокси или true (доверять всем). */
    trustProxy: boolean | string;
  };
  /** Бот: имя для ссылок, секрет подписи ссылок входа (общий с ботом) и срок их жизни. */
  telegram: { botUsername: string; loginSecret: string; loginLinkTtlMs: number };
  /** База сайта: досье, расследования, медиа, сессии. */
  projectDb: DbConfig;
  /** База бота pyruleaks-bot: users, tokens, подписки (только чтение). */
  botDb: DbConfig;
  /** dsstalker-api-gate. */
  api: { enabled: boolean; baseUrl: string; token: string; timeoutMs: number; minIntervalMs: number; pollIntervalMs: number; jobTimeoutMs: number };
  /** Поиск по геоданным и подложка его карты. pmtiles / assets — путь на сервере или https-адрес. */
  geo: {
    enabled: boolean;
    tiles: (typeof GEO_TILES)[number];
    rasterUrl: string;
    rasterAttribution: string;
    pmtiles: string;
    assets: string;
    lang: string;
    maxZoom: number;
  };
  /** scanstore-api-gate: картинки сканов документов (ключ scans в записях утечек). */
  scanstore: { enabled: boolean; url: string; token: string; timeoutMs: number };
  /** Поиск личных страниц по имени пользователя (манифест сайтов Sherlock). */
  pages: { enabled: boolean; timeoutMs: number; concurrency: number; sideEffectProbes: boolean };
  /** Поиск по Google (перенос GHunt). masterToken пуст — имитация с вымышленными данными. В браузер токен не уходит. */
  google: {
    enabled: boolean; masterToken: string; timeoutMs: number; minIntervalMs: number;
    /** Базовый адрес Nominatim для адреса точки Wi-Fi ('' — не определять). Туда уходят найденные координаты. */
    reverseGeocodeUrl: string;
  };
  /**
   * Поиск по Email (GHunt + MOSINT). Ключи в браузер не уходят. google — часть «аккаунт Google» (сессия и пауза —
   * из google); sites — регистрации на сайтах (таймаут, параллельность и пробы с побочным действием — из pages).
   */
  email: {
    enabled: boolean;
    timeoutMs: number;
    google: boolean;
    sites: boolean;
    ipGeo: boolean;
    rdap: boolean;
    pastes: boolean;
    web: boolean;
    /** Проверка ящика по SMTP: helo — имя в EHLO, from — адрес в MAIL FROM ('' — пустой отправитель). */
    smtp: { enabled: boolean; helo: string; from: string };
    keys: { hibp: string; breachDirectory: string; intelx: string; emailrep: string; hunter: string };
    intelxUrl: string;
  };
  /** Предупреждения загрузки: неизвестные ключи, отсутствие файла. */
  warnings: string[];
}

const DEV_COOKIE_SECRET = 'dev-only-cookie-secret-change-me-please';

/** Ищет config.ini вверх от cwd до корня монорепо (package.json с workspaces). */
export function findConfig(): string | null {
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
    auth: {
      mode: c.config.auth,
      passwordSha256: c.config['password-sha256'].toLowerCase(),
      user: { tgId: c.config['user-tg-id'], displayName: c.config['user-name'] || 'Следопыт' },
      devQuickLoginTgId: c.config['bot-db-dev-quick-login-tg-id'],
    },
    server: {
      host: c.server.host,
      port: c.server.port,
      cookieSecret: c.server['cookie-secret'] || DEV_COOKIE_SECRET,
      sessionTtlMs: c.server['session-ttl-days'] * 86400_000,
      loopback,
      devLogin: c.server['dev-login'],
      trustProxy: c.server['trust-proxy'],
      secureCookie: c.server['secure-cookie'],
    },
    telegram: {
      botUsername: c.telegram['bot-username'].replace(/^@/, ''),
      loginSecret: c.telegram['login-secret'],
      loginLinkTtlMs: c.telegram['login-link-ttl-sec'] * 1000,
    },
    projectDb: db(c['project-db']),
    botDb: db(c['bot-db']),
    api: {
      enabled: c.api.enabled,
      baseUrl: c.api['base-url'].replace(/\/+$/, ''),
      token: c.api.token,
      timeoutMs: c.api['timeout-sec'] * 1000,
      minIntervalMs: c.api['min-interval-ms'],
      pollIntervalMs: c.api['poll-interval-ms'],
      jobTimeoutMs: c.api['job-timeout-sec'] * 1000,
    },
    geo: {
      enabled: c.config['geo-search'],
      tiles: c['geo-search'].tiles,
      rasterUrl: c['geo-search']['raster-url'],
      rasterAttribution: c['geo-search']['raster-attribution'],
      pmtiles: c['geo-search'].pmtiles,
      assets: c['geo-search'].assets.replace(/\/+$/, ''),
      lang: c['geo-search'].lang || 'ru',
      maxZoom: c['geo-search']['max-zoom'],
    },
    scanstore: {
      enabled: c['scanstore-api'].enabled,
      url: c['scanstore-api'].url.replace(/\/+$/, ''),
      token: c['scanstore-api'].token,
      timeoutMs: c['scanstore-api']['timeout-sec'] * 1000,
    },
    pages: {
      enabled: c.config['pages-search'],
      timeoutMs: c['pages-search']['timeout-sec'] * 1000,
      concurrency: c['pages-search'].concurrency,
      sideEffectProbes: c['pages-search']['side-effect-probes'],
    },
    google: {
      enabled: c.config['google-search'],
      masterToken: c['google-search']['master-token'],
      timeoutMs: c['google-search']['timeout-sec'] * 1000,
      minIntervalMs: c['google-search']['min-interval-sec'] * 1000,
      reverseGeocodeUrl: c['google-search']['reverse-geocode'].replace(/\/+$/, ''),
    },
    email: {
      enabled: c.config['email-search'],
      timeoutMs: c['email-search']['timeout-sec'] * 1000,
      google: c['email-search'].google,
      sites: c['email-search'].sites,
      ipGeo: c['email-search']['ip-geo'],
      rdap: c['email-search'].rdap,
      pastes: c['email-search'].pastes,
      web: c['email-search']['web-mentions'],
      smtp: {
        enabled: c['email-search']['smtp-check'],
        helo: c['email-search']['smtp-helo'].trim() || hostname(),
        from: c['email-search']['smtp-from'].trim(),
      },
      keys: {
        hibp: c['email-search']['hibp-key'],
        breachDirectory: c['email-search']['breachdirectory-key'],
        intelx: c['email-search']['intelx-key'],
        emailrep: c['email-search']['emailrep-key'],
        hunter: c['email-search']['hunter-key'],
      },
      intelxUrl: c['email-search']['intelx-url'].replace(/\/+$/, ''),
    },
    warnings,
  };

  if (cfg.google.enabled && cfg.google.reverseGeocodeUrl === NOMINATIM_PUBLIC && !loopback) {
    warnings.push('[google-search] reverse-geocode — публичный Nominatim: координаты найденных точек Wi-Fi уходят в OpenStreetMap, а его правила не допускают нагрузку сервиса; укажите свой экземпляр или оставьте пустым');
  }
  if (cfg.google.enabled && !cfg.google.masterToken) {
    warnings.push('[google-search] master-token не задан: поиск по Gaia ID и файлу Drive отвечает вымышленными данными (имитация) — получите токен: npm run google-login. Wi-Fi BSSID и Digital Asset Links работают и без него');
  }
  if (cfg.email.enabled && cfg.email.google && !cfg.google.masterToken) {
    warnings.push('[google-search] master-token не задан: часть «Аккаунт Google» поиска по Email — вымышленные данные (имитация); выключить её — [email-search] google = false');
  }

  if (cfg.geo.enabled && cfg.geo.tiles === 'raster' && !loopback) {
    warnings.push('[geo-search] tiles = raster на сервере не на localhost: публичный сервер тайлов не рассчитан на продакшен и видит, какие районы смотрят пользователи — используйте tiles = pmtiles');
  }
  for (const k of ['pmtiles', 'assets'] as const) {
    if (cfg.geo.enabled && cfg.geo.tiles === 'pmtiles' && isUrl(cfg.geo[k]) && !loopback) {
      warnings.push(`[geo-search] ${k} — внешний адрес: браузеры пользователей ходят туда напрямую; в продакшене укажите путь к файлу на этом сервере`);
    }
  }

  // Без бота его база и dev-вход не нужны, а токен API задаётся в конфиге.
  if (cfg.auth.mode === 'bot-db') {
    if (cfg.api.token) warnings.push('[api] token не используется при [config] auth = bot-db — токен берётся из базы бота');
    // Вход по ссылке из настоящего бота при имитации бота: подписка, токен и forcefoottracker не читаются.
    if (cfg.telegram.loginSecret && !cfg.botDb.enabled) {
      warnings.push('[telegram] login-secret задан, а [bot-db] enabled = false: пользователи бота входят, но подписка и флаг forcefoottracker не читаются — у всех «Подписка не оформлена» (только чтение)');
    }
  } else {
    if (cfg.botDb.enabled) warnings.push(`[bot-db] не используется при [config] auth = ${cfg.auth.mode}`);
    cfg.botDb.enabled = false;
    cfg.server.devLogin = false;
  }

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
  if (cfg.geo.enabled && cfg.geo.tiles === 'raster' && !/^https?:\/\/.*\{z\}.*\{x\}.*\{y\}/.test(cfg.geo.rasterUrl)) {
    missing.push('[geo-search] raster-url (https-адрес с {z}, {x}, {y})');
  }
  if (cfg.geo.enabled && cfg.geo.tiles === 'pmtiles') {
    for (const k of ['pmtiles', 'assets'] as const) if (!cfg.geo[k]) missing.push(`[geo-search] ${k} (tiles = pmtiles)`);
  }
  if (cfg.scanstore.enabled) {
    if (!isUrl(cfg.scanstore.url)) missing.push('[scanstore-api] url');
    if (!cfg.scanstore.token) missing.push('[scanstore-api] token');
  }
  if (cfg.google.enabled && cfg.google.reverseGeocodeUrl && !isUrl(cfg.google.reverseGeocodeUrl)) missing.push('[google-search] reverse-geocode (https-адрес Nominatim или пусто)');
  if (cfg.google.enabled && cfg.google.masterToken && !cfg.google.masterToken.startsWith('aas_et/')) {
    missing.push('[google-search] master-token (мастер-токен Android начинается с aas_et/ — npm run google-login)');
  }
  if (cfg.email.enabled && cfg.email.keys.intelx && !isUrl(cfg.email.intelxUrl)) missing.push('[email-search] intelx-url (https://free.intelx.io или https://2.intelx.io)');
  const { mode } = cfg.auth;
  if (mode !== 'bot-db') {
    if (!/^\d{1,19}$/.test(cfg.auth.user.tgId)) missing.push('[config] user-tg-id (только цифры)');
    if (cfg.api.enabled && !cfg.api.token) missing.push(`[api] token (без бота токен API задаётся в конфиге: auth = ${mode})`);
  }
  if (cfg.auth.devQuickLoginTgId && !/^\d{1,19}$/.test(cfg.auth.devQuickLoginTgId)) missing.push('[config] bot-db-dev-quick-login-tg-id (только цифры)');
  if (cfg.telegram.loginSecret && cfg.telegram.loginSecret.length < 32) missing.push('[telegram] login-secret (не короче 32 символов)');
  if (mode === 'bot-db' && !cfg.telegram.loginSecret && !cfg.server.loopback) {
    cfg.warnings.push('[telegram] login-secret не задан: вход по ссылке из бота выключен, а dev-вход вне localhost запрещён — войти на сайт нельзя');
  }
  if (mode === 'password-sha256' && !/^[0-9a-f]{64}$/.test(cfg.auth.passwordSha256)) {
    missing.push('[config] password-sha256 (64 hex-символа: npm run password-hash)');
  }
  if (cfg.server.trustProxy === true) {
    cfg.warnings.push('[server] trust-proxy = true: адрес клиента берётся из самого левого X-Forwarded-For, который клиент пишет сам — укажите адрес прокси (127.0.0.1)');
  }
  if (!cfg.server.secureCookie) {
    cfg.warnings.push('[server] secure-cookie = false: cookie сессии уходит и по http — только для отладки в локальной сети');
  }
  if (!cfg.server.loopback) {
    if (cfg.server.trustProxy === false) {
      cfg.warnings.push('[server] trust-proxy = false: за обратным прокси req.ip — адрес прокси, а не клиента (лимит попыток пароля общий на всех)');
    }
    if (mode === 'none') missing.push('[config] auth (none — только при host = 127.0.0.1 / localhost: сайт открыт без входа)');
    if (cfg.server.cookieSecret === DEV_COOKIE_SECRET || cfg.server.cookieSecret.length < 32) missing.push('[server] cookie-secret (не короче 32 символов — сервер слушает не только localhost)');
    if (cfg.server.devLogin) missing.push('[server] dev-login = false (вход без бота допустим только на localhost)');
  }
  if (missing.length) throw new ConfigError(`Не заданы или недопустимы: ${missing.join(', ')}`);
}

/** Внешний адрес (а не путь к файлу на сервере). */
export const isUrl = (s: string) => /^https?:\/\//i.test(s);

/** Строка подключения в формате libpq (для node-postgres / drizzle). */
export function pgUrl(d: DbConfig): string {
  const auth = `${encodeURIComponent(d.user)}${d.password ? `:${encodeURIComponent(d.password)}` : ''}`;
  return `postgres://${auth}@${d.host}:${d.port}/${encodeURIComponent(d.database)}?sslmode=${d.sslmode}&connect_timeout=${d.connectTimeoutSec}`;
}

/** Сводка для лога при старте — без паролей и секретов. */
export function describeConfig(cfg: AppConfig): string[] {
  const dbLine = (d: DbConfig) =>
    d.enabled ? `${d.user}@${d.host}:${d.port}/${d.database} (ssl ${d.sslmode}, pool ${d.poolMax})` : 'выключено — демо-данные в памяти';
  const auth = {
    'bot-db': 'через Telegram-бота',
    none: `без входа, соло-пользователь ${cfg.auth.user.displayName} (tg ${cfg.auth.user.tgId})`,
    'password-sha256': `по паролю, соло-пользователь ${cfg.auth.user.displayName} (tg ${cfg.auth.user.tgId})`,
  }[cfg.auth.mode];
  return [
    `конфиг: ${cfg.file ?? 'по умолчанию'}; слушает ${cfg.server.host}:${cfg.server.port}`,
    `вход:      ${auth}`,
    `БД сайта:  ${dbLine(cfg.projectDb)}`,
    `БД бота:   ${cfg.auth.mode === 'bot-db' ? dbLine(cfg.botDb) : 'не используется (вход без бота)'}`,
    `API:       ${cfg.api.enabled ? `${cfg.api.baseUrl} (таймаут ${cfg.api.timeoutMs / 1000} с, интервал ${cfg.api.minIntervalMs} мс)` : 'выключено — имитация шлюза'}`,
    `сканы:     ${cfg.scanstore.enabled ? `${cfg.scanstore.url} (таймаут ${cfg.scanstore.timeoutMs / 1000} с)` : 'выключены'}`,
    `геопоиск:  ${!cfg.geo.enabled ? 'выключен' : cfg.geo.tiles === 'raster' ? `растровые тайлы ${new URL(cfg.geo.rasterUrl.replace(/[{}]/g, '')).host}` : `PMTiles ${cfg.geo.pmtiles}`}`,
    `страницы:  ${cfg.pages.enabled ? `поиск личных страниц (таймаут ${cfg.pages.timeoutMs / 1000} с, параллельно ${cfg.pages.concurrency})` : 'выключен'}`,
    `Google:    ${!cfg.google.enabled ? 'выключен' : `${cfg.google.masterToken ? 'поиск по Google' : 'Gaia ID, Drive — имитация (нет мастер-токена); Wi-Fi и Asset Links — настоящие'} (таймаут ${cfg.google.timeoutMs / 1000} с, пауза ${cfg.google.minIntervalMs / 1000} с, адрес Wi-Fi: ${cfg.google.reverseGeocodeUrl || 'не определяется'})`}`,
    `Email:     ${cfg.email.enabled ? describeEmail(cfg) : 'выключен'}`,
  ];
}

function describeEmail(cfg: AppConfig): string {
  const e = cfg.email;
  const keyed = Object.entries({ HIBP: e.keys.hibp, BreachDirectory: e.keys.breachDirectory, IntelX: e.keys.intelx, EmailRep: e.keys.emailrep, Hunter: e.keys.hunter })
    .filter(([, v]) => v).map(([k]) => k);
  const free = [e.google && (cfg.google.masterToken ? 'Google' : 'Google (имитация)'), e.sites && 'сайты', 'DNS', e.rdap && 'RDAP', e.ipGeo && 'ipapi', e.pastes && 'psbdmp', e.web && 'DuckDuckGo']
    .filter(Boolean);
  return `${free.join(', ')}; с ключами: ${keyed.length ? keyed.join(', ') : 'нет'} (таймаут ${e.timeoutMs / 1000} с)`;
}
