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
  { id: 'name', label: 'ФИО (+ дата рождения)', param: 'name1', raw: rl('raw_search.bypartname_bday'), deep: null, placeholder: 'Иванов Иван Иванович 01.02.1990' },
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
  { id: 'milpn', label: 'Личный номер (воен.)', param: 'milpn', raw: rl('raw_search.bymilpn'), deep: rl('deep_search.bymilpn'), placeholder: 'Х-136096' },
  { id: 'bsvid', label: 'Свид. о рождении', param: 'bsvid', raw: rl('raw_search.bybsvid'), deep: rl('deep_search.bybsvid'), placeholder: 'I-МЮ123456' },
  { id: 'orgnn', label: 'ИНН организации', param: 'orgnn', raw: rl('raw_search.byorgnn'), deep: null, placeholder: '7701234567' },
  { id: 'addr', label: 'Адрес', param: 'addr1', raw: rl('raw_search.bypartaddr'), deep: null, placeholder: 'Москва Тверская 7' },
].map((k) => ({ ...k, service: 'ruleaks' as const })) satisfies SearchKind[];

export type SearchKindId = (typeof SEARCH_KINDS)[number]['id'];

export function findKind(id: string): SearchKind | undefined {
  return SEARCH_KINDS.find((k) => k.id === id);
}

// ---------------------------------------------------------------------------
// Автоопределение вида поиска — порт бота: app/core/input_detector.py (маски, контрольные
// суммы) и app/bot/search_type_suggester.py (ранжирование). Бот по введённой строке
// показывает кнопки подходящих видов поиска; сайт — пункты «Авто: …» в списке критериев.
// Отличие от бота: в цифровых значениях пробелы, дефисы и скобки не мешают
// («+7 953 952-62-73» — телефон), сайту их удобно вставлять как есть.
// ---------------------------------------------------------------------------

const RE = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?[78]9\d{9}$/,
  // Код региона необязателен; прицепы — «АВ1234».
  plate: /^(?:[А-ЯЁа-яёA-Za-z]{1,2}\d{3,4}[А-ЯЁа-яёA-Za-z]{2}|[А-ЯЁа-яёA-Za-z]{2}\d{4})(?:[-\s]?\d{2,3})?$/,
  vin: /^[A-Z0-9]{17}$/i,
  card: /^[245]\d{15,19}$/,
  fbid: /^1000\d{11,12}$/,
  tgid: /^\d{5,15}$/,
  tgnik: /^@[A-Za-z][A-Za-z0-9_]{3,31}$/,
  snils: /^\d{11}$/,
  inn: /^\d{12}$/,
  pasp: /^\d{10}$/,
  fpasp: /^\d{2}[-\s]?\d{7}$/,
  bsvid: /^[IVXLCDM]{1,4}[\s-]?[A-ZА-ЯЁ]{2}\d{6}$/i,
  milpn: /^[A-Za-zА-ЯЁа-яё][-\s]?\d{6}$/,
  link: /^https?:\/\/\S+/,
  // Ссылки на соцсети без схемы — удобство сайта (в боте только http(s)://).
  linkBare: /^(www\.)?(vk\.com|ok\.ru|t\.me|instagram\.com|facebook\.com)\/\S+/i,
  ip: /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
  // ФИО (фамилия 2+ буквы, имя и отчество могут быть инициалами) с датой рождения или без.
  name: new RegExp(
    String.raw`^(?:([А-Яа-яЁё]{2,})(?:\s+([А-Яа-яЁё]+)){1,2}|([А-Яа-яЁё]{2,}))\s+(\d{2}|\*)[.\-/](\d{2}|\*)[.\-/](\d{4}|\*)$|` +
      String.raw`^([А-Яа-яЁё]{2,})\s+([А-Яа-яЁё]+)(?:\s+([А-Яа-яЁё]+))?$|` +
      String.raw`^([А-Яа-яЁё]{2,})\s+(\d{2}|\*)[.\-/](\d{2}|\*)[.\-/](\d{4}|\*)$`,
  ),
  addr: /^(?=(?:\S+\s+){2,5}\S+$)(?:[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)?\s+){2,3}(?:д(?:ом)?\.?\s*)?\d+[А-Яа-яЁё]?(?:\s+(?:кв(?:артира)?\.?\s*)?\d+)?$/i,
  orgnn: /^\d{10}$/,
};

/** СНИЛС: контрольное число по последним двум цифрам. */
function snilsOk(s: string): boolean {
  if (s.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * (9 - i);
  const control = sum < 100 ? sum : sum === 100 || sum === 101 ? 0 : sum % 101 === 100 ? 0 : sum % 101;
  return control === Number(s.slice(9));
}

/** Номер карты: алгоритм Луна. Длиннее 19 цифр — номер счёта, у него другая схема, принимаем. */
function cardOk(s: string): boolean {
  if (s.length > 19) return true;
  let sum = 0;
  let dbl = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = Number(s[i]);
    if (dbl && (d *= 2) > 9) d -= 9;
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** «Иванов И.А. 01.02.1990» → «Иванов И А 01.02.1990» (normalize_name бота): инициалы — отдельные буквы. */
function normalizeName(v: string): string {
  const m = /^(.*?)[\s.,]*((?:\d{2}|\*)[.\-/](?:\d{2}|\*)[.\-/](?:\d{4}|\*))\s*$/.exec(v.trim());
  const [namePart, date] = m ? [m[1]!, m[2]!] : [v, ''];
  return `${namePart.replace(/[\s.,]+/g, ' ').trim()} ${date}`.trim();
}

/** Все подходящие виды поиска в порядке проверки бота (InputDetector.detect). */
function detectAll(raw: string): SearchKindId[] {
  const t = raw.trim();
  if (!t) return [];
  // Цифровое значение с разделителями — проверяем без них.
  const v = /^[\d\s\-+()]+$/.test(t) && /\d/.test(t) ? t.replace(/[\s\-()]/g, '') : t;
  const out: SearchKindId[] = [];
  const add = (k: SearchKindId, ok: boolean) => ok && !out.includes(k) && out.push(k);
  add('email', RE.email.test(v));
  add('phone', RE.phone.test(v));
  add('plate', RE.plate.test(v));
  add('vin', RE.vin.test(v));
  add('card', RE.card.test(v) && cardOk(v));
  add('fbid', RE.fbid.test(v));
  add('tgid', RE.tgid.test(v) || RE.tgnik.test(v));
  add('snils', RE.snils.test(v) && snilsOk(v));
  add('inn', RE.inn.test(v));
  add('pasp', RE.pasp.test(v));
  add('fpasp', RE.fpasp.test(t) || RE.fpasp.test(v));
  add('bsvid', RE.bsvid.test(v));
  add('milpn', RE.milpn.test(v));
  add('link', RE.link.test(v) || RE.linkBare.test(v));
  add('ip', RE.ip.test(v));
  add('name', RE.name.test(normalizeName(v)));
  add('orgnn', RE.orgnn.test(v));
  add('addr', RE.addr.test(v));
  return out;
}

// Ранжирование (search_type_suggester.py): меньше — выше.
const PRIORITY: Record<SearchKindId, number> = {
  phone: 20, email: 10, name: 12, vin: 8, plate: 9, pasp: 18, fpasp: 17, milpn: 16, card: 19,
  tgid: 40, fbid: 35, inn: 22, snils: 21, bsvid: 13, link: 7, ip: 6, orgnn: 30, addr: 32,
};

function score(k: SearchKindId, raw: string): number {
  let s = PRIORITY[k] ?? 100;
  const digits = raw.trim().replace(/[\s\-()]/g, '');
  if (/^\d+$/.test(digits)) {
    const n = digits.length;
    const adj: Partial<Record<number, Partial<Record<SearchKindId, number>>>> = {
      9: { fpasp: -15, tgid: 10 },
      10: { pasp: -15, orgnn: -10, tgid: 8 },
      11: { phone: -10, snils: -6, tgid: 6 },
      12: { inn: -8, tgid: 5 },
    };
    s += adj[n]?.[k] ?? 0;
  }
  return s;
}

/** Сколько вариантов «Авто: …» показывать — как кнопок в боте. */
export const MAX_DETECTED_KINDS = 4;

/** Подходящие виды поиска для введённой строки, самый вероятный — первым. */
export function detectKinds(raw: string): SearchKindId[] {
  const found = detectAll(raw);
  return found
    .map((k, i) => ({ k, i, s: score(k, raw) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, MAX_DETECTED_KINDS)
    .map((x) => x.k);
}

/** Самый вероятный вид поиска (или null). */
export function detectKind(raw: string): SearchKindId | null {
  return detectKinds(raw)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Нормализация значения и параметры запроса — порт InputNormalizer (app/core/normalizers.py)
// и _build_payload (app/bot/handlers/search.py) бота.
// ---------------------------------------------------------------------------

const LAT_TO_CYR: Record<string, string> = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  Ж: 'X', З: '3', И: 'I', Л: 'L', П: 'P', Ф: 'F', Ь: '', Ъ: '', Ы: 'Y', Э: 'E',
};
const mapChars = (s: string, m: Record<string, string>) => [...s].map((c) => m[c] ?? c).join('');

/**
 * Служебные слова адреса, которые не ищутся: база хранит адрес неупорядоченным набором фрагментов (makesrhstr),
 * а у записи в утечке «г.», «кв.» и т.п. может и не быть — с ними в запросе она не найдётся. К тому же шлюз берёт
 * только первые шесть слов, и служебные заняли бы место значимых.
 */
const ADDR_STOP_WORDS = new Set([
  'г', 'гор', 'город', 'ул', 'улица', 'д', 'дом', 'к', 'корп', 'корпус', 'кв', 'квартира', 'с', 'село', 'им', 'имени',
]);

/**
 * «г.Краснодар, ул. им.70-летия Октября 1/2, 60» → «Краснодар 70-летия Октября 1/2 60»: знаки препинания — в пробелы
 * (кроме «/» и «-» внутри слова: 1/2, 70-летия), служебные слова убираются, пробелы схлопываются.
 */
export function normalizeAddr(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N}/-]+/gu, ' ')
    .split(' ')
    .map((w) => w.replace(/^[/-]+|[/-]+$/g, ''))
    .filter((w) => w && !ADDR_STOP_WORDS.has(w.toLowerCase()))
    .join(' ');
}

/** Значение в том виде, в каком его отправляет бот (InputNormalizer.normalize). */
export function normalizeQuery(kind: string, raw: string): string {
  const v = raw.trim();
  switch (kind) {
    case 'phone': {
      const d = v.replace(/\D/g, '');
      if (d.length === 11 && (d[0] === '8' || d[0] === '7')) return `7${d.slice(1)}`;
      if (d.length === 10) return `7${d}`;
      return d;
    }
    case 'email':
      return v.toLowerCase();
    case 'plate':
      return mapChars(v.toUpperCase().replace(/[\s-]/g, ''), LAT_TO_CYR);
    case 'vin':
      return mapChars(v.toUpperCase().replace(/\s/g, ''), CYR_TO_LAT);
    case 'pasp':
    case 'fbid':
      return v.replace(/\D/g, '');
    case 'tgid':
      return /^@[A-Za-z][A-Za-z0-9_]{3,31}$/.test(v) ? v : v.replace(/\D/g, '');
    case 'fpasp':
    case 'inn':
    case 'snils':
    case 'card':
    case 'orgnn':
      return v.replace(/[\s-]/g, '');
    case 'bsvid':
      return mapChars(v.toUpperCase().replace(/[\s-]/g, ''), LAT_TO_CYR);
    case 'milpn': {
      let m = v.toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
      if (m.startsWith('X')) m = `Х${m.slice(1)}`;
      if (!m.includes('-') && /^\p{L}\d+$/u.test(m)) m = `${m[0]}-${m.slice(1)}`;
      return m;
    }
    case 'link':
      return v.replace(/\/+$/, '');
    case 'name':
      return normalizeName(v);
    case 'addr':
      return normalizeAddr(v);
    default:
      return v;
  }
}

const ADDR_PARTS = 6;

/**
 * Параметры запроса к шлюзу для вида поиска (_build_payload бота).
 * ФИО: «Иванов Иван Иванович 03.09.1980» → name1..name3 + day, month, year; недостающее — «*».
 * Адрес: первые шесть слов → addr1..addr6, недостающие — пустые.
 * Остальные виды — одно значение в параметре kind.param.
 */
export function searchParams(kind: SearchKind, raw: string): Record<string, string> {
  const value = normalizeQuery(kind.id, raw);
  if (kind.id === 'name') {
    const date = /\s+(\d{2}|\*)[.\-/](\d{2}|\*)[.\-/](\d{4}|\*)\s*$/.exec(value);
    const names = (date ? value.slice(0, date.index) : value).trim().split(/\s+/).filter(Boolean);
    return {
      name1: names[0] ?? '*',
      name2: names[1] ?? '*',
      name3: names[2] ?? '*',
      day: date?.[1] ?? '*',
      month: date?.[2] ?? '*',
      year: date?.[3] ?? '*',
    };
  }
  if (kind.id === 'addr') {
    const parts = value.split(' ').filter(Boolean).slice(0, ADDR_PARTS);
    return Object.fromEntries(Array.from({ length: ADDR_PARTS }, (_, i) => [`addr${i + 1}`, parts[i] ?? '']));
  }
  return { [kind.param]: value };
}

/** Украинский мобильный (+380…): бэкенд ищет только по номерам РФ (is_ukrainian_phone бота). */
export function isUkrainianPhone(raw: string): boolean {
  return /^\+?380\d{9}$/.test(raw.trim().replace(/[\s\-()]/g, ''));
}

// --- Форма ответа шлюза (service/ruleaks/model.go) ---

/** TLeakTuple: одна запись утечки, все поля — массивы строк. */
export type LeakTuple = {
  tuple: number;
  /** uuid сканов документов человека в хранилище scanstore (не атрибут: показываются картинками). */
  scans?: string[];
  /** Значения, найденные дополнительным поиском вторым шагом по идентификаторам этой записи (не от шлюза). */
  step2?: Step2Value[];
} & Partial<Record<LeakField, string[]>>;

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

/**
 * Значение geolocs: «широта, долгота» и необязательный радиус точности в метрах после @
 * («52.703019, 47.735252 @1000»). Без @ — как раньше, radiusM = null.
 */
export function parseGeoloc(raw: string): { coords: string; radiusM: number | null } {
  const m = raw.match(/^(.*?)\s*@\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return { coords: raw.trim(), radiusM: null };
  return { coords: m[1]!.trim(), radiusM: Number(m[2]!.replace(',', '.')) };
}

/** Значение атрибута для показа: телефон с «+», геолокация с радиусом в скобках. */
export function attrDisplayValue(field: string, value: string): string {
  if ((field === 'phones' || field === 'phone') && /^\d/.test(value.trim())) return `+${value.trim()}`;
  if (field === 'geolocs') {
    const g = parseGeoloc(value);
    return g.radiusM === null ? g.coords : `${g.coords} (радиус ${g.radiusM}м)`;
  }
  return value;
}

/** Коды типов сканов DocScanSort (TYPE_CODES в docsplit.py) → подписи. */
export const SCAN_DOCTYPES: Record<string, string> = {
  passport: 'Паспорт',
  passport_reg: 'Паспорт · прописка',
  passport_other: 'Паспорт · разворот',
  snils: 'СНИЛС',
  inn: 'ИНН',
  driverlic: 'Водительское удостоверение',
  driverlic_back: 'ВУ · оборот',
  drivercard: 'Карта водителя',
  card: 'Карта',
  unknown: 'Документ',
};
export const scanDoctypeLabel = (t: string | undefined) => (t ? SCAN_DOCTYPES[t] ?? t : 'Документ');

/** Значение атрибута для буфера обмена: у геолокации — только координаты, без радиуса. */
export function attrCopyValue(field: string, value: string): string {
  return field === 'geolocs' ? parseGeoloc(value).coords : value;
}

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

// ---------- Дополнительный поиск вторым шагом ----------
// После обычного (raw) поиска по найденным атрибутам, которые с высокой вероятностью определяют человека,
// делаются ещё простые поиски; из их записей берутся только отмеченные пользователем атрибуты и добавляются в ту
// запись первого шага, где был найден идентификатор (LeakTuple.step2), с пометкой, по чему найдены. База утечки,
// где нашлось значение второго шага, не важна и не хранится.

/**
 * По каким найденным атрибутам может идти второй шаг (пользователь выбирает набор) и каким видом поиска.
 * ok — годится ли значение для поиска: v — нормализованное, raw — как в ответе (свидетельство проверяется до
 * нормализации: она переводит латинские X, C, M римской серии в кириллицу). По ОГРНИП у шлюза поиска нет.
 */
export const STEP2_SOURCES = [
  { field: 'inns', kind: 'inn', by: 'ИНН', ok: (v: string) => RE.inn.test(v) },
  { field: 'snilss', kind: 'snils', by: 'СНИЛС', ok: (v: string) => RE.snils.test(v) },
  { field: 'pasps', kind: 'pasp', by: 'паспорту', ok: (v: string) => RE.pasp.test(v) },
  { field: 'forpasps', kind: 'fpasp', by: 'загранпаспорту', ok: (v: string) => /^\d{9}$/.test(v) },
  { field: 'bsvids', kind: 'bsvid', by: 'свидетельству о рождении', ok: (v: string, raw: string) => RE.bsvid.test(v) || RE.bsvid.test(raw.trim()) },
  { field: 'emails', kind: 'email', by: 'email', ok: (v: string) => RE.email.test(v) },
  { field: 'tgids', kind: 'tgid', by: 'Telegram ID', ok: (v: string) => RE.tgid.test(v) },
  { field: 'milpns', kind: 'milpn', by: 'личному номеру', ok: (v: string, raw: string) => RE.milpn.test(raw.trim()) || /^\p{L}-\d{6}$/u.test(v) },
  { field: 'weblinks', kind: 'link', by: 'ссылке', ok: (v: string) => RE.link.test(v) || RE.linkBare.test(v) },
] as const satisfies readonly { field: LeakField; kind: SearchKindId; by: string; ok: (v: string, raw: string) => boolean }[];

export type Step2Kind = (typeof STEP2_SOURCES)[number]['kind'];
export const STEP2_KINDS: Step2Kind[] = STEP2_SOURCES.map((s) => s.kind);

/** Значение второго шага в записи первого: поле, значение и по каким её идентификаторам найдено. */
export interface Step2Value {
  /** Поле LEAK_FIELDS (сканы второго шага дописываются прямо в scans записи). */
  f: LeakField;
  v: string;
  by: SearchKindId[];
}

/** «найден по паспорту, ИНН» */
export function step2ByText(by: readonly string[]): string {
  return `найден по ${by.map((k) => STEP2_SOURCES.find((s) => s.kind === k)?.by ?? k).join(', ')}`;
}

/** Больше поисков второй шаг не делает: запросы к шлюзу идут не чаще раза в секунду. */
export const STEP2_MAX_SEARCHES = 30;

/** Ключ сканов документов среди атрибутов (фильтр результата, выбор для второго шага). */
export const SCANS_FIELD = 'scans';

/** Что можно отобрать из записей второго шага: атрибуты записи и сканы документов. */
export const STEP2_FIELDS: string[] = [...Object.keys(LEAK_FIELDS), SCANS_FIELD];

export interface Step2Query {
  kind: SearchKindId;
  value: string;
  state: 'pending' | 'done' | 'failed';
  error?: string;
  /** Сколько значений добавил этот поиск (по всем записям, где был идентификатор). */
  added?: number;
}

/** Ход и итог второго шага — в result.step2 снимка. */
export interface Step2Info {
  /** Отобранные атрибуты (STEP2_FIELDS). */
  fields: string[];
  queries: Step2Query[];
  /** Найдено идентификаторов сверх STEP2_MAX_SEARCHES — по ним не искали. */
  skipped: number;
}

/**
 * Поиски второго шага по записям первого: значения нормализуются как запрос, проверяются по маске вида поиска,
 * не повторяются и не совпадают с исходным запросом. kinds — выбранные пользователем виды (STEP2_KINDS).
 * Порядок — по кругу: по одному значению каждого вида, затем следующие, — чтобы при лимите STEP2_MAX_SEARCHES
 * в поиск попал каждый выбранный вид, а не только первый (у поиска по организации сотни ИНН).
 */
export function step2Queries(leaks: LeakCard[], first: { kind: string; value: string }, kinds: readonly string[] = STEP2_KINDS): { queries: Step2Query[]; skipped: number } {
  const seen = new Set<string>([`${first.kind}:${normalizeQuery(first.kind, first.value)}`]);
  const lists = STEP2_SOURCES.filter((src) => kinds.includes(src.kind)).map((src) => {
    const list: Step2Query[] = [];
    for (const card of leaks) for (const t of card.tuples ?? []) for (const raw of t[src.field] ?? []) {
      const value = normalizeQuery(src.kind, raw);
      const key = `${src.kind}:${value}`;
      if (!src.ok(value, raw) || seen.has(key)) continue;
      seen.add(key);
      list.push({ kind: src.kind, value, state: 'pending' });
    }
    return list;
  });
  const all: Step2Query[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) all.push(l[i]!);
  return { queries: all.slice(0, STEP2_MAX_SEARCHES), skipped: Math.max(0, all.length - STEP2_MAX_SEARCHES) };
}

/** Итог второго шага одной строкой: «12 из 12 поисков (ИНН, СНИЛС) · добавлено значений: 7 · ошибок: 1». */
export function step2Summary(info: Step2Info): string {
  const done = info.queries.filter((q) => q.state !== 'pending');
  if (!info.queries.length) return 'в результате нет значений, по которым искать';
  const labels = [...new Set(info.queries.map((q) => SEARCH_KINDS.find((k) => k.id === q.kind)?.label ?? q.kind))];
  const failed = done.filter((q) => q.state === 'failed').length;
  const added = done.reduce((n, q) => n + (q.added ?? 0), 0);
  return [
    `${done.length} из ${info.queries.length} поисков (${labels.join(', ')})`,
    `добавлено значений: ${added}`,
    failed ? `ошибок: ${failed}` : '',
    info.skipped ? `сверх лимита не искали: ${info.skipped}` : '',
  ].filter(Boolean).join(' · ');
}

// ======================================================================
// Разделы поиска (как разделы меню бота)
// ======================================================================

/** attr — /search и /deepsearch, tg — /tgsearch, fuzzy — /regsearch, geo — точка и радиус (в боте нет). */
export type SearchSection = 'attr' | 'tg' | 'fuzzy' | 'geo';
export const SEARCH_SECTIONS: SearchSection[] = ['attr', 'tg', 'fuzzy', 'geo'];

// ---------- Поиск личных страниц ----------

/** Имя пользователя для поиска страниц: без пробелов и символов, ломающих адрес (сайт подставляет его в URL). */
export const PAGES_USERNAME_MAX = 64;
export const PAGES_USERNAME_RE = /^[^\s/\\?#%&]+$/;
/** Строка запроса целиком (ник или почта): вмещает длинный e-mail. */
export const PAGES_QUERY_MAX = 254;
/** Простая проверка на e-mail: что-то, @, что-то, точка, что-то — без пробелов. */
export const PAGES_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Как понят запрос поиска личных страниц. */
export type PagesQueryKind = 'username' | 'email';

/** Ник из e-mail — часть до @, без суффикса +метка (user_name+spam@gmail.com → user_name). */
export function pagesNickFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const plus = local.indexOf('+');
  return (plus > 0 ? local.slice(0, plus) : local).trim();
}

/** Разбор запроса: e-mail ищется и как почта, и по нику из части до @; иначе — только ник. */
export function parsePagesQuery(raw: string): { kind: PagesQueryKind; email: string | null; nick: string | null } {
  const q = raw.trim();
  if (PAGES_EMAIL_RE.test(q)) {
    const nick = pagesNickFromEmail(q);
    return { kind: 'email', email: q, nick: PAGES_USERNAME_RE.test(nick) ? nick : null };
  }
  return { kind: 'username', email: null, nick: q };
}

export const isPagesQuery = (s: string) => {
  const q = s.trim();
  return q.length > 0 && q.length <= PAGES_QUERY_MAX && (PAGES_EMAIL_RE.test(q) || PAGES_USERNAME_RE.test(q));
};

/** Как найдена страница: по нику или по e-mail. */
export type PageFoundBy = 'username' | 'email';

/** Проекты, чьи списки сайтов и логика проверки перенесены. */
export const SHERLOCK_URL = 'https://github.com/sherlock-project/sherlock';
export const HOLEHE_URL = 'https://github.com/megadose/holehe';
export const BLACKBIRD_URL = 'https://github.com/p1ngul1n0/blackbird';

// ---------- Поиск по геоданным ----------

/** Записи утечек с геолокациями в круге: lat, lon — градусы, radius — целые метры (шлюз: до 50 км). */
export const GEO_RADIUS_PATH = rl('raw_search.byloc_radius');
export const GEO_RADIUS_MAX_M = 50_000;
export const GEO_MODES = [{ id: 'radius', label: 'Точка и радиус' }] as const;

/** Запрос геопоиска в истории: «широта, долгота @радиус» — как значение geolocs (parseGeoloc). */
export function geoQuery(lat: number, lon: number, radiusM: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)} @${radiusM}`;
}

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
  // comments.likes отвечает как многопользовательский поиск: users[] — авторы сообщений, на которые реагировал
  // пользователь, у каждого сообщения с массивом likes (его реакции).
  { id: 'likes', label: 'Реакции', path: tg('comments.likes'), input: 'user', result: 'multi', hint: 'Реакции пользователя на чужие сообщения' },
  // Как и likes, шлюз отдаёт his_answers многопользовательским ответом (users[] по авторам сообщений).
  { id: 'his_answers', label: 'Ответы пользователя', path: tg('comments.his_answers'), input: 'user', result: 'multi', hint: 'Ответы пользователя на чужие сообщения' },
  { id: 'answers_to_him', label: 'Ответы пользователю', path: tg('comments.answers_to_him'), input: 'user', result: 'multi', hint: 'Кто и что отвечал пользователю' },
  { id: 'month_activity', label: 'Активность по месяцам', path: tg('comments.month_activity'), input: 'user', result: 'month', hint: 'Число комментариев по месяцам' },
  { id: 'week_activity', label: 'Активность по часам', path: tg('comments.week_activity'), input: 'user', result: 'week', hint: 'Распределение по дням недели и часам — помогает оценить часовой пояс и режим дня' },
  // Шлюз ищет через websearch_to_tsquery('russian', …) — синтаксис «как в поисковиках», не to_tsquery (см. tsquery.ts).
  { id: 'fulltext', label: 'Полнотекстовый поиск', path: tg('comments.fulltext_search'), input: 'text', result: 'multi', hint: 'Поиск по тексту комментариев: слова через пробел — все сразу, or — любое из, -слово — исключить, "фраза в кавычках" — слова подряд; окончания не важны' },
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

/**
 * Время сервиса Telegram-комментариев (UTC) — в ISO 8601: «ДД.ММ.ГГГГ ЧЧ:ММ:СС» (время сообщения)
 * или ISO без пояса (время реакции). Нераспознанное — null.
 */
export function tgTimeToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}T${ru[4]}:${ru[5]}:${ru[6] ?? '00'}.000Z`;
  const isoNoTz = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const d = new Date(isoNoTz ? `${s}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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
