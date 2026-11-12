// «Поиск по Google» — перенос логики GHunt (https://github.com/mxrch/GHunt, AGPL-3.0) на сервер сайта.
// Здесь — каталог видов поиска (кнопки над строкой ввода), разбор ввода и форма отчётов, общие для сервера и веба.

export const GHUNT_URL = 'https://github.com/mxrch/GHunt';

/** Запрос целиком: вмещает длинный e-mail или ссылку на файл Drive. */
export const GOOGLE_QUERY_MAX = 512;
/** Простая проверка на e-mail (как в поиске личных страниц). */
export const GOOGLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Виды поиска — модули GHunt (ghunt/modules/*). account — нужен служебный аккаунт Google (мастер-токен):
 * без него такие виды отвечают имитацией; geolocate и spiderdal ходят в открытые API и аккаунт не используют.
 */
export const GOOGLE_MODES = [
  {
    id: 'email', label: 'По e-mail', account: true,
    placeholder: 'ivan.petrov@gmail.com',
    hint: 'Адрес Gmail или любой почты, на которую заведён аккаунт Google: Gaia ID, фото, сервисы, Play Игры, Карты, календарь.',
  },
  {
    id: 'gaia', label: 'По Gaia ID', account: true,
    placeholder: '102938475610293847561',
    hint: 'Профиль по Gaia ID — 21-значному номеру аккаунта Google (его дают поиск по e-mail, отзывы на Картах, участники файлов Drive): фото, сервисы, Карты.',
  },
  {
    id: 'drive', label: 'Файл Google Drive', account: true,
    placeholder: 'https://drive.google.com/file/d/…  или ID файла',
    hint: 'Файл или папка, открытые по ссылке: владелец и участники (имя, e-mail, Gaia ID), автор последней правки, комментаторы, приложение-источник, метаданные.',
  },
  {
    id: 'geolocate', label: 'Wi-Fi BSSID', account: false,
    placeholder: '30:86:2d:c4:29:d0',
    hint: 'MAC-адрес (BSSID) точки доступа Wi-Fi → её координаты по базе геолокации Google. Несколько адресов через пробел уточняют точку.',
  },
  {
    id: 'spiderdal', label: 'Digital Asset Links', account: false,
    placeholder: 'example.com  или  com.example.app <SHA-256 сертификата>',
    hint: 'Связанные сайты и Android-приложения (в том числе не опубликованные в Play) по Digital Asset Links: домен или пакет с SHA-256 отпечатком сертификата.',
  },
] as const;

export type GoogleModeId = (typeof GOOGLE_MODES)[number]['id'];
export const GOOGLE_MODE_IDS = GOOGLE_MODES.map((m) => m.id) as [GoogleModeId, ...GoogleModeId[]];
export const findGoogleMode = (id: string) => GOOGLE_MODES.find((m) => m.id === id);
/** Виды, которым нужен служебный аккаунт Google. */
export const GOOGLE_ACCOUNT_MODES: readonly GoogleModeId[] = GOOGLE_MODES.filter((m) => m.account).map((m) => m.id);

/** Шаги каждого вида в порядке выполнения — по ним идёт индикатор хода работы. */
export const GOOGLE_STEPS = {
  email: [
    { id: 'auth', label: 'Вход в Google' },
    { id: 'people', label: 'Профиль аккаунта' },
    { id: 'playgames', label: 'Play Игры' },
    { id: 'maps', label: 'Карты Google' },
    { id: 'calendar', label: 'Календарь' },
  ],
  gaia: [
    { id: 'auth', label: 'Вход в Google' },
    { id: 'people', label: 'Профиль аккаунта' },
    { id: 'maps', label: 'Карты Google' },
  ],
  drive: [
    { id: 'auth', label: 'Вход в Google' },
    { id: 'file', label: 'Свойства файла' },
    { id: 'app', label: 'Приложение-источник' },
    { id: 'children', label: 'Содержимое папки' },
    { id: 'comments', label: 'Комментарии' },
  ],
  geolocate: [
    { id: 'locate', label: 'Геолокация точки доступа' },
    { id: 'address', label: 'Адрес по координатам' },
  ],
  spiderdal: [
    { id: 'crawl', label: 'Обход связей' },
    { id: 'playstore', label: 'Проверка в Google Play' },
  ],
} as const satisfies Record<GoogleModeId, readonly { id: string; label: string }[]>;
export type GoogleStepId = (typeof GOOGLE_STEPS)[GoogleModeId][number]['id'];
/** Совместимость: шаги поиска по e-mail. */
export const GOOGLE_EMAIL_STEPS = GOOGLE_STEPS.email;
export type GoogleEmailStep = (typeof GOOGLE_STEPS.email)[number]['id'];

// ---------- Разбор ввода ----------

/** Gaia ID — только цифры (обычно 21). */
export function parseGaiaId(raw: string): string | null {
  const q = raw.trim();
  return /^\d{15,25}$/.test(q) ? q : null;
}

export interface DriveRef {
  id: string;
  /** resourcekey из ссылки: файлы, расшаренные до обновления безопасности 2021 г., без него не открываются. */
  resourceKey: string | null;
}

const DRIVE_ID_RE = /^[A-Za-z0-9_-]{15,}$/;

/**
 * ID файла или папки Drive из ссылки или как есть: …/file/d/<id>/…, …/document|spreadsheets|presentation|forms|drawings/d/<id>,
 * …/drive/folders/<id>, …?id=<id>. resourcekey берётся из параметров ссылки.
 */
export function parseDriveRef(raw: string): DriveRef | null {
  const q = raw.trim();
  if (DRIVE_ID_RE.test(q)) return { id: q, resourceKey: null };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(q) ? q : `https://${q}`);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/i.test(u.hostname)) return null;
  const resourceKey = u.searchParams.get('resourcekey') ?? u.searchParams.get('resourceKey');
  const byPath = /\/(?:d|folders)\/([A-Za-z0-9_-]{15,})/.exec(u.pathname)?.[1];
  const id = byPath ?? u.searchParams.get('id');
  return id && DRIVE_ID_RE.test(id) ? { id, resourceKey: resourceKey || null } : null;
}

/** Больше точек доступа в одном запросе геолокации не принимаем. */
export const GOOGLE_BSSID_MAX = 20;

/** BSSID (MAC) точек доступа: «30:86:2d:c4:29:d0», «30-86-2D-…», «30862dc429d0»; через пробел, запятую или ;. */
export function parseBssids(raw: string): string[] | null {
  const parts = raw.trim().split(/[\s,;]+/).filter(Boolean);
  if (!parts.length || parts.length > GOOGLE_BSSID_MAX) return null;
  const out: string[] = [];
  for (const p of parts) {
    const hex = p.replace(/[:.-]/g, '').toLowerCase();
    if (!/^[0-9a-f]{12}$/.test(hex)) return null;
    const mac = hex.match(/../g)!.join(':');
    if (!out.includes(mac)) out.push(mac);
  }
  return out;
}

export type DalQuery =
  /** Сайт: хост и схема; www — добавить вариант с www. (как GHunt без --strict). */
  | { kind: 'site'; host: string; http: boolean }
  /** Android-приложение: пакет и SHA-256 отпечаток сертификата в формате API (AB:CD:…). */
  | { kind: 'app'; pkg: string; fingerprint: string };

const PKG_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Отпечаток сертификата: 64 hex-цифры (с двоеточиями или без) → «AB:CD:…». */
export function normalizeFingerprint(raw: string): string | null {
  const hex = raw.replace(/^sha-?256[:=]?/i, '').replace(/[:\s-]/g, '').toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? hex.match(/../g)!.join(':') : null;
}

/**
 * Ввод Digital Asset Links: «пакет отпечаток» (отпечаток можно с пробелами между байтами) или домен / адрес сайта.
 * Одно слово — всегда сайт: пакет com.example.app и домен с зоной .app неотличимы, а без отпечатка пакет не искать.
 */
export function parseDalQuery(raw: string): DalQuery | null {
  const q = raw.trim();
  const tokens = q.split(/\s+/);
  if (tokens.length >= 2) {
    const fp = normalizeFingerprint(tokens.slice(1).join(''));
    return fp && PKG_RE.test(tokens[0]!) ? { kind: 'app', pkg: tokens[0]!, fingerprint: fp } : null;
  }
  const http = /^http:\/\//i.test(q);
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(q) ? q : `https://${q}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  return HOST_RE.test(host) ? { kind: 'site', host, http } : null;
}

/** null — строка годится для вида поиска, иначе — что с ней не так. */
export function googleQueryProblem(mode: GoogleModeId, raw: string): string | null {
  const q = raw.trim();
  if (!q) return null;
  if (q.length > GOOGLE_QUERY_MAX) return `не длиннее ${GOOGLE_QUERY_MAX} символов`;
  switch (mode) {
    case 'email': return GOOGLE_EMAIL_RE.test(q) ? null : 'нужен e-mail: имя@gmail.com';
    case 'gaia': return parseGaiaId(q) ? null : 'нужен Gaia ID — 21 цифра';
    case 'drive': return parseDriveRef(q) ? null : 'нужна ссылка на файл или папку Google Drive или их ID';
    case 'geolocate': return parseBssids(q) ? null : `нужен MAC-адрес точки доступа: 30:86:2d:c4:29:d0 (до ${GOOGLE_BSSID_MAX} через пробел)`;
    case 'spiderdal': {
      const tokens = q.split(/\s+/);
      if (tokens.length === 1 && PKG_RE.test(q) && !HOST_RE.test(q.toLowerCase())) return 'для пакета нужен и SHA-256 отпечаток сертификата: com.example.app AB:CD:…';
      return parseDalQuery(q) ? null : 'нужен домен (example.com) или пакет с SHA-256 отпечатком сертификата';
    }
  }
}

/** Запрос в том виде, в каком он уходит в поиск и в историю. */
export function normalizeGoogleQuery(mode: GoogleModeId, raw: string): string {
  const q = raw.trim();
  if (mode === 'email') return q.toLowerCase();
  if (mode === 'geolocate') return parseBssids(q)?.join(' ') ?? q;
  if (mode === 'spiderdal') {
    const d = parseDalQuery(q);
    return d?.kind === 'app' ? `${d.pkg} ${d.fingerprint}` : d ? (d.http ? `http://${d.host}` : d.host) : q;
  }
  return q;
}

/** Типы пользователя Google (People API ownerUserType) — пояснения из knowledge/people.py GHunt. */
export const GOOGLE_USER_TYPES: Record<string, string> = {
  USER_TYPE_UNKNOWN: 'тип не определён',
  GOOGLE_USER: 'пользователь Google',
  GPLUS_USER: 'пользователь Currents (Google+)',
  GOOGLE_APPS_USER: 'пользователь Google Workspace',
  OWNER_USER_TYPE_UNKNOWN: 'тип не определён',
  GPLUS_DISABLED_BY_ADMIN: 'Currents отключён администратором',
  GOOGLE_FAMILY_USER: 'участник семейной группы Google',
  GOOGLE_FAMILY_CHILD_USER: 'ребёнок в семейной группе Google',
  GOOGLE_APPS_ADMIN_DISABLED: 'администратор Google Workspace, отключён',
  GOOGLE_ONE_USER: 'подписчик Google One',
  GOOGLE_FAMILY_CONVERTED_CHILD_USER: 'участник семейной группы, переведён в детские',
};

// ---------- Части отчётов ----------

export interface GooglePhoto {
  url: string;
  /** Стандартная картинка Google (силуэт / буква), а не загруженная пользователем. */
  isDefault: boolean;
  /** Средний хеш картинки 8×8 (как imagehash.average_hash в GHunt); null — картинку не удалось разобрать. */
  flathash: string | null;
}

export interface GoogleProfile {
  /** Постоянный 21-значный идентификатор аккаунта. */
  gaiaId: string;
  /** Адрес из профиля (может отличаться от запрошенного — основной адрес аккаунта). */
  email: string | null;
  /** Имя профиля, если Google его отдал. */
  name: string | null;
  photo: GooglePhoto | null;
  cover: { url: string; isDefault: boolean } | null;
  /** Последнее изменение профиля, ISO (UTC). */
  lastUpdated: string | null;
  userTypes: string[];
  /** Google Chat: тип сущности и ID организации Workspace. */
  entityType: string | null;
  customerId: string | null;
  /** Аккаунт организации (Google Workspace). */
  enterprise: boolean | null;
  /** Сервисы Google, в которых аккаунт активен. */
  apps: string[];
}

/** Часть отчёта, которая собирается отдельным запросом: её сбой не роняет весь поиск. */
export type GoogleSection<T> = { status: 'ok'; data: T } | { status: 'error'; error: string } | { status: 'skipped' };

export interface GooglePlayer {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Профиль открыт: тогда есть игры и достижения. */
  visible: boolean;
  gamerTag: string | null;
  title: string | null;
  level: number | null;
  xp: string | null;
  playedGames: number;
  achievements: number;
  lastPlayed: { name: string; at: string | null } | null;
  /** Игра с наибольшим числом достижений. */
  topGame: { name: string; achievements: number } | null;
  /** Последние сыгранные игры (не больше 20). */
  games: { name: string; lastPlayed: string | null; achievements: number | null }[];
}

export interface GoogleMaps {
  profileUrl: string;
  /** ok — есть статистика; empty — отзывов, оценок и фото нет; blocked — Google показал капчу этому серверу. */
  state: 'ok' | 'empty' | 'blocked';
  /** Счётчики как их называет Google (Reviews, Ratings, Photos…). */
  stats: Record<string, number>;
}

export interface GoogleCalendarEvent {
  title: string | null;
  /** Начало, ISO (UTC); null — событие на весь день или без времени. */
  start: string | null;
  end: string | null;
  location: string | null;
  link: string | null;
}

export interface GoogleCalendar {
  /** Публичный календарь есть. */
  found: boolean;
  id: string | null;
  summary: string | null;
  timeZone: string | null;
  /** Всего событий выгружено. */
  total: number;
  /** Последние события (не больше 20). */
  events: GoogleCalendarEvent[];
  icsUrl: string | null;
  /** Другие имена владельца, встреченные в событиях. */
  otherNames: string[];
}

// ---------- Отчёты ----------

/** `ghunt email`. */
export interface GoogleEmailReport {
  mode: 'email';
  email: string;
  /** Аккаунт Google на этот адрес есть. */
  found: boolean;
  /** Контейнеры People API, где найдена цель (PROFILE, CONTACT, DOMAIN_PROFILE…). */
  containers: string[];
  /** null — есть только в контактах поискового аккаунта, публичного профиля нет. */
  profile: GoogleProfile | null;
  playGames: GoogleSection<GooglePlayer | null>;
  maps: GoogleSection<GoogleMaps>;
  calendar: GoogleSection<GoogleCalendar>;
  /** Отчёт собран имитацией (нет мастер-токена в конфиге) — данные вымышленные. */
  demo: boolean;
}

/** `ghunt gaia`: то же, что по e-mail, но без Play Игр и календаря (для них нужен адрес). */
export interface GoogleGaiaReport {
  mode: 'gaia';
  gaiaId: string;
  found: boolean;
  containers: string[];
  profile: GoogleProfile | null;
  maps: GoogleSection<GoogleMaps>;
  demo: boolean;
}

export interface GoogleDriveUser {
  name: string | null;
  email: string | null;
  gaiaId: string | null;
  /** owner, writer, commenter, reader, none… */
  role: string;
  photoUrl: string | null;
  /** Последним правил файл. */
  lastModifying: boolean;
}

export interface GoogleDriveApp {
  /** Номер проекта Google Cloud (sourceAppId). */
  id: string;
  name: string | null;
  homePage: string | null;
  iconUrl: string | null;
  supportEmail: string | null;
}

export interface GoogleDriveFile {
  id: string;
  title: string;
  mimeType: string;
  /** Подпись типа (knowledge/drive.py mime_types); null — тип неизвестен. */
  typeLabel: string | null;
  isFolder: boolean;
  /** Байт; null — у документов Google размера нет. */
  size: number | null;
  md5: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  link: string | null;
  description: string | null;
  /** Роли, выданные «всем, у кого есть ссылка»; null — по ссылке не открыт. */
  linkRoles: string[] | null;
  sourceAppId: string | null;
  image: { width: number; height: number; rotation: number | null } | null;
  video: { width: number; height: number; durationMs: number | null } | null;
  parents: { id: string; isRoot: boolean }[];
  users: GoogleDriveUser[];
  /** Автор последней правки — даже если его нет среди участников. */
  lastModifyingUser: { name: string | null; email: string | null; photoUrl: string | null } | null;
  /** Права служебного аккаунта сверх стандартных для файла по ссылке (knowledge/drive.py default_*_capabilities). */
  extraCapabilities: string[];
}

export interface GoogleDriveComments {
  /** Комментариев и ответов всего. */
  total: number;
  /** Авторы по числу сообщений (не больше 20). */
  authors: { name: string; photoUrl: string | null; count: number }[];
}

/** `ghunt drive`. */
export interface GoogleDriveReport {
  mode: 'drive';
  fileId: string;
  found: boolean;
  /** found = false: файла нет или служебному аккаунту он не открыт (не расшарен по ссылке). */
  file: GoogleDriveFile | null;
  sourceApp: GoogleSection<GoogleDriveApp | null>;
  /** Элементов в папке; 1000 — «1000 и больше». */
  children: GoogleSection<number>;
  comments: GoogleSection<GoogleDriveComments>;
  demo: boolean;
}

export interface GoogleAddress {
  /** Адрес одной строкой, как его отдал геокодер. */
  display: string;
  city: string | null;
  country: string | null;
}

/** `ghunt geolocate`. */
export interface GoogleGeoReport {
  mode: 'geolocate';
  bssids: string[];
  found: boolean;
  lat: number | null;
  lon: number | null;
  /** Точность, метров. */
  accuracyM: number | null;
  /** Обратное геокодирование (Nominatim); skipped — выключено в конфиге. */
  address: GoogleSection<GoogleAddress | null>;
  demo: false;
}

export interface GoogleDalSite {
  site: string;
  /** Через какой актив найден; null — это исходная цель. */
  leakedBy: string | null;
}

export interface GoogleDalPackage {
  name: string;
  /** true — есть в Google Play, false — нет (приватный пакет), null — не удалось проверить. */
  public: boolean | null;
  fingerprints: { sha256: string; leakedBy: string | null }[];
}

/** `ghunt spiderdal`. */
export interface GoogleDalReport {
  mode: 'spiderdal';
  query: string;
  found: boolean;
  sites: GoogleDalSite[];
  packages: GoogleDalPackage[];
  /** Сколько активов опрошено и за сколько кругов. */
  scanned: number;
  rounds: number;
  /** Обход остановлен по пределу числа активов. */
  truncated: boolean;
  demo: false;
}

export type GoogleReport = GoogleEmailReport | GoogleGaiaReport | GoogleDriveReport | GoogleGeoReport | GoogleDalReport;
