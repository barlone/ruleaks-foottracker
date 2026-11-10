// «Поиск по Google» — перенос логики GHunt (https://github.com/mxrch/GHunt, AGPL-3.0) на сервер сайта.
// Здесь — каталог видов поиска (кнопки над строкой ввода) и форма отчёта, общая для сервера и веба.

export const GHUNT_URL = 'https://github.com/mxrch/GHunt';

/** Запрос целиком: вмещает длинный e-mail. */
export const GOOGLE_QUERY_MAX = 254;
/** Простая проверка на e-mail (как в поиске личных страниц). */
export const GOOGLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Виды поиска — модули GHunt. ready: false — модуль ещё не перенесён (кнопка есть, но не нажимается).
 * input — что вводится: от него зависят подсказка и проверка строки.
 */
export const GOOGLE_MODES = [
  { id: 'email', label: 'По e-mail', ready: true, placeholder: 'ivan.petrov@gmail.com', hint: 'Адрес Gmail или любой почты, на которую заведён аккаунт Google: Gaia ID, фото, сервисы, Play Игры, Карты, календарь.' },
  { id: 'gaia', label: 'По Gaia ID', ready: false, placeholder: '102938475610293847561', hint: 'Профиль по 21-значному идентификатору аккаунта Google.' },
  { id: 'drive', label: 'Файл Google Drive', ready: false, placeholder: 'ссылка или ID файла', hint: 'Владелец и участники общего файла или папки Google Drive.' },
  { id: 'geolocate', label: 'Wi-Fi BSSID', ready: false, placeholder: '30:86:2d:c4:29:d0', hint: 'Координаты точки доступа Wi-Fi по её MAC-адресу.' },
  { id: 'spiderdal', label: 'Digital Asset Links', ready: false, placeholder: 'https://example.com', hint: 'Связанные сайты и Android-приложения по домену или пакету.' },
] as const;

export type GoogleModeId = (typeof GOOGLE_MODES)[number]['id'];
export const findGoogleMode = (id: string) => GOOGLE_MODES.find((m) => m.id === id);

/** null — строка годится для вида поиска, иначе — что с ней не так. */
export function googleQueryProblem(mode: GoogleModeId, raw: string): string | null {
  const q = raw.trim();
  if (!q) return null;
  if (q.length > GOOGLE_QUERY_MAX) return `не длиннее ${GOOGLE_QUERY_MAX} символов`;
  if (mode === 'email' && !GOOGLE_EMAIL_RE.test(q)) return 'нужен e-mail: имя@gmail.com';
  return null;
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

// ---------- Отчёт по e-mail (аналог `ghunt email`) ----------

/** Шаги поиска по e-mail в порядке выполнения — по ним идёт индикатор хода работы. */
export const GOOGLE_EMAIL_STEPS = [
  { id: 'auth', label: 'Вход в Google' },
  { id: 'people', label: 'Профиль аккаунта' },
  { id: 'playgames', label: 'Play Игры' },
  { id: 'maps', label: 'Карты Google' },
  { id: 'calendar', label: 'Календарь' },
] as const;
export type GoogleEmailStep = (typeof GOOGLE_EMAIL_STEPS)[number]['id'];

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
  /** Имя профиля. Google обычно его больше не отдаёт — тогда null. */
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

export interface GoogleEmailReport {
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
