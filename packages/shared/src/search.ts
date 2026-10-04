// Каталог видов поиска шлюза dsstalker-api-gate.
// Пути и имена параметров повторяют app/api/endpoints.py и app/api/client.py бота
// (pyruleaks-bot): сайт ходит в тот же API с токеном пользователя.

export type SearchService = 'ruleaks' | 'tgcmnts';

export interface SearchKind {
  id: string;
  label: string;
  /** Имя query-параметра шлюза для основного значения. */
  param: string;
  /** Путь raw-поиска (быстрый, по индексу). */
  raw: string;
  /** Путь deep-поиска (связи, тяжёлый). null — глубокого поиска нет. */
  deep: string | null;
  placeholder: string;
  service: SearchService;
}

const rl = (p: string) => `/ruleaks/v1/${p}`;

export const SEARCH_KINDS = [
  { id: 'phone', label: 'Телефон', param: 'phone', raw: rl('raw_search.byphone'), deep: rl('deep_search.byphone'), placeholder: '+7 916 123-45-67' },
  { id: 'email', label: 'Email', param: 'email', raw: rl('raw_search.byemail'), deep: rl('deep_search.byemail'), placeholder: 'user@mail.ru' },
  { id: 'name', label: 'ФИО (+ дата рождения)', param: 'name1', raw: rl('raw_search.bypartname_bday'), deep: rl('deep_search.bypartname_bday'), placeholder: 'Иванов Иван 01.02.1990' },
  { id: 'tgid', label: 'Telegram ID', param: 'tgid', raw: rl('raw_search.bytgid'), deep: rl('deep_search.bytgid'), placeholder: '123456789' },
  { id: 'inn', label: 'ИНН', param: 'inn', raw: rl('raw_search.byinn'), deep: rl('deep_search.byinn'), placeholder: '771234567890' },
  { id: 'snils', label: 'СНИЛС', param: 'snils', raw: rl('raw_search.bysnils'), deep: rl('deep_search.bysnils'), placeholder: '123-456-789 01' },
  { id: 'pasp', label: 'Паспорт РФ', param: 'pasp', raw: rl('raw_search.bypasp'), deep: rl('deep_search.bypasp'), placeholder: '4510 123456' },
  { id: 'fpasp', label: 'Загранпаспорт', param: 'fpasp', raw: rl('raw_search.byfpasp'), deep: rl('deep_search.byfpasp'), placeholder: '75 1234567' },
  { id: 'plate', label: 'Госномер', param: 'plate', raw: rl('raw_search.byplate'), deep: rl('deep_search.byplate'), placeholder: 'А123ВС777' },
  { id: 'vin', label: 'VIN', param: 'vin', raw: rl('raw_search.byvin'), deep: rl('deep_search.byvin'), placeholder: 'XTA210990Y1234567' },
  { id: 'card', label: 'Банковская карта', param: 'card', raw: rl('raw_search.bycard'), deep: rl('deep_search.bycard'), placeholder: '2200 1234 5678 9012' },
  { id: 'link', label: 'Ссылка на соцсеть', param: 'link', raw: rl('raw_search.bylink'), deep: rl('deep_search.bylink'), placeholder: 'vk.com/id1' },
  { id: 'fbid', label: 'Facebook ID', param: 'fbid', raw: rl('raw_search.byfbid'), deep: rl('deep_search.byfbid'), placeholder: '100001234567890' },
  { id: 'ip', label: 'IP-адрес', param: 'ip', raw: rl('raw_search.byip'), deep: rl('deep_search.byip'), placeholder: '95.31.18.119' },
  { id: 'milpn', label: 'Личный номер (воен.)', param: 'milpn', raw: rl('raw_search.bymilpn'), deep: rl('deep_search.bymilpn'), placeholder: 'АБ-123456' },
  { id: 'bsvid', label: 'Свид. о рождении', param: 'bsvid', raw: rl('raw_search.bybsvid'), deep: rl('deep_search.bybsvid'), placeholder: 'I-МЮ 123456' },
  { id: 'orgnn', label: 'ИНН организации', param: 'orgnn', raw: rl('raw_search.byorgnn'), deep: null, placeholder: '7701234567' },
  { id: 'addr', label: 'Адрес (часть)', param: 'addr1', raw: rl('raw_search.bypartaddr'), deep: null, placeholder: 'Москва Тверская 7' },
].map((k) => ({ ...k, service: 'ruleaks' as const })) satisfies SearchKind[];

export type SearchKindId = (typeof SEARCH_KINDS)[number]['id'];

export function findKind(id: string): SearchKind | undefined {
  return SEARCH_KINDS.find((k) => k.id === id);
}

/** Упрощённое автоопределение типа ввода (полная версия — app/services/input_detector.py бота). */
export function detectKind(raw: string): SearchKindId | null {
  const v = raw.trim();
  if (!v) return null;
  const digits = v.replace(/[\s\-()+]/g, '');
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(v)) return 'email';
  if (/^(https?:\/\/)?(www\.)?(vk\.com|ok\.ru|t\.me|instagram\.com|facebook\.com)\//i.test(v)) return 'link';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return 'ip';
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(v)) return 'vin';
  if (/^[АВЕКМНОРСТУХABEKMHOPCTYX]\d{3}[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\d{2,3}$/i.test(v.replace(/\s/g, ''))) return 'plate';
  if (/^\d{3}-?\d{3}-?\d{3}[\s-]?\d{2}$/.test(v)) return 'snils';
  if (/^\d+$/.test(digits)) {
    if (/^(\+?7|8)\d{10}$/.test(digits)) return 'phone';
    if (digits.length === 16) return 'card';
    if (digits.length === 12) return 'inn';
    if (digits.length === 10 && /\s/.test(v)) return 'pasp';
    if (digits.length === 10) return 'orgnn';
    if (digits.length >= 5 && digits.length <= 11) return 'tgid';
  }
  if (/^[А-ЯЁа-яё-]+(\s+[А-ЯЁа-яё.-]+){0,2}(\s+\d{2}\.\d{2}\.\d{4})?$/.test(v)) return 'name';
  return null;
}

// --- Форма ответа шлюза (service/ruleaks/model.go) ---

/** TLeakTuple: одна запись утечки, все поля — массивы строк. */
export type LeakTuple = { tuple: number } & Partial<Record<LeakField, string[]>>;

export interface LeakCard {
  leak: string;
  trusted?: boolean;
  tuples?: LeakTuple[];
}

/** TDataRow deep-поиска: параметр, значение и через какое значение найдено. */
export interface DeepRow {
  prm: string;
  val: string;
  val_id: number;
  link4: string;
  link4_id: number;
}

export const LEAK_FIELDS = {
  names: 'ФИО',
  bdays: 'Дата рождения',
  ddays: 'Дата смерти',
  pbnames: 'Место рождения',
  addrs: 'Адрес',
  inns: 'ИНН',
  snilss: 'СНИЛС',
  pasps: 'Паспорт',
  forpasps: 'Загранпаспорт',
  bsvids: 'Свид. о рождении',
  ogrnips: 'ОГРНИП',
  phones: 'Телефон',
  emails: 'Email',
  niks: 'Ник',
  tgids: 'Telegram ID',
  skypes: 'Skype',
  weblinks: 'Ссылка',
  milpns: 'Личный номер',
  milranks: 'Звание',
  milposs: 'Должность (воен.)',
  milunits: 'В/ч',
  works: 'Работа',
  orgs: 'Организация',
  educs: 'Образование',
  plates: 'Госномер',
  vehicles: 'Транспорт',
  bankcards: 'Карта',
  geolocs: 'Геолокация',
  ips: 'IP',
  regdates: 'Дата регистрации',
  infos: 'Прочее',
} as const;

export type LeakField = keyof typeof LEAK_FIELDS;

/** По какому виду поиска можно «провалиться» из поля результата. */
export const FIELD_TO_KIND: Partial<Record<LeakField, SearchKindId>> = {
  phones: 'phone',
  emails: 'email',
  inns: 'inn',
  snilss: 'snils',
  pasps: 'pasp',
  forpasps: 'fpasp',
  tgids: 'tgid',
  plates: 'plate',
  bankcards: 'card',
  ips: 'ip',
  milpns: 'milpn',
  bsvids: 'bsvid',
  weblinks: 'link',
  names: 'name',
};

// ======================================================================
// Разделы поиска (как разделы меню бота)
// ======================================================================

/** attr — /search и /deepsearch, tg — /tgsearch, fuzzy — /regsearch. */
export type SearchSection = 'attr' | 'tg' | 'fuzzy';
export const SEARCH_SECTIONS: SearchSection[] = ['attr', 'tg', 'fuzzy'];

// ---------- Поиск в Telegram (app/bot/handlers/tg_search.py) ----------

const tg = (p: string) => `/tgcmnts/v1/${p}`;

export interface TgMode {
  id: string;
  label: string;
  path: string;
  /** user — нужен пользователь (ID, @ник или телефон), text — выражение полнотекстового поиска. */
  input: 'user' | 'text';
  /** Форма ответа: комментарии одного пользователя, многих, или счётчики активности. */
  result: 'comments' | 'multi' | 'month' | 'week';
  hint: string;
}

export const TG_MODES = [
  { id: 'comments', label: 'Комментарии', path: tg('comments.get'), input: 'user', result: 'comments', hint: 'Комментарии пользователя в группах и каналах' },
  { id: 'likes', label: 'Реакции', path: tg('comments.likes'), input: 'user', result: 'comments', hint: 'Реакции пользователя на чужие сообщения' },
  { id: 'his_answers', label: 'Ответы пользователя', path: tg('comments.his_answers'), input: 'user', result: 'comments', hint: 'Ответы пользователя на чужие сообщения' },
  { id: 'answers_to_him', label: 'Ответы пользователю', path: tg('comments.answers_to_him'), input: 'user', result: 'multi', hint: 'Кто и что отвечал пользователю' },
  { id: 'month_activity', label: 'Активность по месяцам', path: tg('comments.month_activity'), input: 'user', result: 'month', hint: 'Число комментариев по месяцам' },
  { id: 'week_activity', label: 'Активность по часам', path: tg('comments.week_activity'), input: 'user', result: 'week', hint: 'Распределение по дням недели и часам — помогает оценить часовой пояс и режим дня' },
  { id: 'fulltext', label: 'Полнотекстовый поиск', path: tg('comments.fulltext_search'), input: 'text', result: 'multi', hint: 'Поиск по тексту комментариев. Операторы: & (и), | (или), скобки. Пример: (орлан | о-30) & краснополь' },
] as const satisfies readonly TgMode[];

export type TgModeId = (typeof TG_MODES)[number]['id'];
export const TG_MODE_IDS = TG_MODES.map((m) => m.id) as [TgModeId, ...TgModeId[]];
export const TG_BYNIK_PATH = tg('search_ids.bynik');

export function findTgMode(id: string): TgMode | undefined {
  return TG_MODES.find((m) => m.id === id);
}

/** Как в боте (_parse_identifier): Telegram ID, @ник или телефон (телефон → tgid через raw-поиск). */
export function parseTgUser(raw: string): { kind: 'tgid' | 'nik' | 'phone'; value: string } | null {
  const v = raw.trim();
  const digits = v.replace(/[\s\-()+]/g, '');
  if (/^(\+7|8)/.test(v.replace(/\s/g, '')) && /^(7|8)\d{10}$/.test(digits)) return { kind: 'phone', value: `7${digits.slice(1)}` };
  if (/^\d{5,15}$/.test(digits)) return { kind: 'tgid', value: digits };
  const nik = v.replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
  if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(nik)) return { kind: 'nik', value: nik };
  return null;
}

/** TCmntsMsg / TCmntsGrp / TCmntsUser шлюза (service/tgcomments/model.go). */
export interface TgGroup { grp_id: number; name: string; url?: string; color?: number }
export interface TgComment {
  msg_id: number;
  r2msg_id: number;
  grp_id: number;
  usr_id: number;
  dt: string;
  url: string;
  text: string;
  r2text: string;
  likes?: { emoji: string; at: string }[];
}
export interface TgUser { id: number; names?: string[]; niks?: string[] }
export interface TgUserMsgs { user?: TgUser; groups?: TgGroup[]; comments?: TgComment[] }
/** month_activity: {год: {месяц 1–12: число}} */
export type TgMonthActivity = Record<string, Record<string, number>>;
export const WEEK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
/** week_activity: {год: {monday: [24 числа], …}} */
export type TgWeekActivity = Record<string, Partial<Record<(typeof WEEK_DAYS)[number], number[]>>>;

// ---------- Нечёткий поиск (app/bot/handlers/regex_search.py) ----------

export interface FuzzyMode {
  id: string;
  label: string;
  path: string;
  param: string;
  placeholder: string;
  hint: string;
}

export const FUZZY_MODES = [
  {
    id: 'email', label: 'Маска email', path: rl('regexp_search.emails'), param: 'emailmask', placeholder: 'nero??@mail.ru',
    hint: '? — один любой символ, * — любая последовательность. Примеры: nero??@mail.ru · nero01@*.ru · nero??@*',
  },
  {
    id: 'plate', label: 'Маска госномера', path: rl('regexp_search.plates'), param: 'platemask', placeholder: '?07?АУ??',
    hint: '? — неизвестный символ, * — любая последовательность. Можно уточнить маркой авто: ?07?АУ?? + BMW',
  },
] as const satisfies readonly FuzzyMode[];

export type FuzzyModeId = (typeof FUZZY_MODES)[number]['id'];
export const FUZZY_MODE_IDS = FUZZY_MODES.map((m) => m.id) as [FuzzyModeId, ...FuzzyModeId[]];

export function findFuzzyMode(id: string): FuzzyMode | undefined {
  return FUZZY_MODES.find((m) => m.id === id);
}

/** Латиница → кириллица в госномере, как в боте (_LATIN_TO_CYRILLIC). */
export function normalizePlateMask(mask: string): string {
  const map: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
  return mask.toUpperCase().replace(/\s+/g, '').replace(/[ABEKMHOPCTYX]/g, (c) => map[c] ?? c);
}

/** Проверка маски, как checkGlobMask шлюза: с * нужна серия из 3+ букв/цифр подряд. */
export function checkMask(mask: string): string | null {
  if (!mask.trim()) return 'Пустая маска';
  if (mask.includes('*') && !/[\p{L}\p{N}]{3,}/u.test(mask)) return 'С «*» в маске нужна серия минимум из 3 букв или цифр подряд';
  if (!mask.includes('*') && (mask.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3) return 'Нужно минимум 3 известных символа';
  return null;
}

/** TRegExpSearchMatch шлюза. */
export interface FuzzyMatch {
  match: string;
  names?: string[];
  addrs?: string[];
  milpns?: string[];
  milranks?: string[];
  milposs?: string[];
  milunits?: string[];
  vehicles?: string[];
  infos?: string[];
}
