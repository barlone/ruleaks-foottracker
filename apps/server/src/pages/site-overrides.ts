import type { Site } from './sites.ts';

// Индивидуальные правила для сайтов из sites.json, у которых манифест Sherlock даёт ложные срабатывания.
// sites.json обновляется из Sherlock целиком (npm run pages-sites-update), поэтому поправки живут здесь
// и накладываются на разобранный манифест в allSites(). Ключ — имя сайта в sites.json (точное).
//
// Что можно задать (всё необязательно, смысл полей — в sites.ts):
//   patch         — поля Site, которые заменить (requestMethod, urlProbe, errorType, errorMsg, headers…);
//   notFoundMsg   — строки в теле ответа, означающие «такой страницы нет» (вдобавок к штатному вердикту;
//                   запрос при этом всегда GET, чтобы тело было);
//   claimedMsg    — строки, хотя бы одна из которых обязана быть в теле, иначе страницы нет
//                   (например, «@ник» или блок профиля — для сайтов, отвечающих 200 на любой адрес);
//   verify        — произвольная проверка после штатного вердикта «найдено»: получает ответ, тело и имя,
//                   возвращает окончательный статус или null, если менять нечего;
//   disabled      — сайт закрыт или проверить его нельзя: исключается из списка целиком (не считается и не показывается).
// Проверки применяются только когда штатная логика сказала «найдено»: отрицательный вердикт они не отменяют.

export interface SiteVerifyContext {
  site: Site;
  username: string;
  url: string;
  response: Response;
  /** Тело ответа текстом (не больше MAX_BODY_BYTES из check.ts); пусто для HEAD. */
  text: string;
  httpStatus: number;
}

export type SiteVerify = (ctx: SiteVerifyContext) => Promise<'claimed' | 'available' | 'waf' | 'unknown' | null> | 'claimed' | 'available' | 'waf' | 'unknown' | null;

export interface SiteOverride {
  disabled?: boolean;
  patch?: Partial<Omit<Site, 'name' | 'notFoundMsg' | 'claimedMsg' | 'verify'>>;
  notFoundMsg?: string[];
  claimedMsg?: string[];
  verify?: SiteVerify;
}

export const SITE_OVERRIDES: Record<string, SiteOverride> = {
  // Уводит 302 на /forums/verify-human/ (JS-проверка, там 200) — это ловит isWafChallenge по адресу.
  // Если проверка пропустит, несуществующий профиль — страница «Error - Page Not Found» (404, но подстрахуемся по тексту).
  'Apple Developer': {
    patch: { requestMethod: 'GET' },
    notFoundMsg: ['<title>Error - Page Not Found', 'The page you’re looking for can’t be found'],
  },
  // Страница профиля — пустой каркас SPA (200 на любой адрес), профиль грузится через API поиска:
  // page_type=account_details отвечает 200 для существующего аккаунта и 400 для несуществующего.
  'Archive.org': {
    patch: {
      urlProbe: 'https://archive.org/services/search/beta/page_production/?page_type=account_details&page_target=%40{}&page_elements=%5B%22uploads%22%5D&hits_per_page=1&page=1',
      errorType: 'status_code',
      errorCode: [400, 404],
      requestMethod: 'GET',
    },
  },
  // API валидации имени отвечает isValid:false и на занятое имя, и на недопустимое (точка, дефис, цифра в начале) —
  // манифест считает занятым любое isValid:false. Недопустимые имена не проверяем, занятое узнаём по тексту.
  'BoardGameGeek': {
    patch: { regexCheck: /^[A-Za-z][A-Za-z0-9_]*$/ },
    claimedMsg: ['already taken'],
  },
  // На любой адрес отвечает 200 заглушкой «Вход через SberID» (JS ставит cookie и переходит дальше, настоящий
  // ответ — 404 — виден только после этого). Без браузера проверить нельзя: показываем «защита от ботов».
  Championat: {
    patch: { requestMethod: 'GET' },
    verify: ({ text }) => (text.includes('Вход через SberID') ? 'waf' : null),
  },
  // Несуществующего игрока уводит 302 на /dashboard, а там обычная страница без «Player not found» из манифеста.
  // Редиректы не следуем: 2xx — игрок есть, редирект — нет.
  Clozemaster: {
    patch: { errorType: 'response_url', errorMsg: [] },
  },
  // API отвечает 404 {"error": "User not found"}, а манифест ждёт «Server Error (500)» — любой ник считался найденным.
  'Discord.bio': {
    patch: { errorType: 'status_code', errorCode: null, errorMsg: [] },
    notFoundMsg: ['"User not found"'],
  },
  // Сервис закрыт: любой /u/<ник> — 301 на freepik.com/photos (там 200, и ник считался найденным).
  EyeEm: { disabled: true },
  // Домен припаркован на GoDaddy: любой адрес — 200 со страницей парковки.
  'F3.cool': { disabled: true },
  // Несуществующий профиль — 200 с <title>undefined | GeeksforGeeks Profile (манифест ждёт устаревшее «false | …»).
  GeeksforGeeks: {
    notFoundMsg: ['<title>undefined '],
  },
  // Ник без точки сайт уводит на /explore/… с заголовком из манифеста, а ник с точкой — 404 «404 Not Found»,
  // где этого заголовка нет, и страница считалась найденной.
  Giphy: {
    notFoundMsg: ['<title>404 Not Found'],
  },
  // При частых запросах с одного адреса HN отвечает 419 и телом «Sorry» (без точки — манифест ждёт «Sorry.»),
  // и такая блокировка считалась профилем. Профиль узнаём по заголовку страницы.
  HackerNews: {
    verify: ({ httpStatus, text }) => (httpStatus === 419 ? 'waf' : text.includes('<title>Profile: ') ? 'claimed' : 'available'),
  },
  // Отвечает 200 на любой ник; несуществующий — страница с заголовком «User not found | Hashnode».
  Hashnode: {
    patch: { requestMethod: 'GET' },
    notFoundMsg: ['<title>User not found | Hashnode'],
  },
  // Серверу сайт отдаёт 200 со страницей Fastly «Client Challenge» (ловится в WAF_HITS, но только по телу — нужен GET).
  // Если пропустит, несуществующий профиль — страница «Page Not Found».
  Houzz: {
    patch: { requestMethod: 'GET' },
    notFoundMsg: ['<title>Page Not Found', 'The page you requested was not found'],
  },
  // Любой /user/<ник> (даже существующий) — форма входа, сайт закрыт для гостей: проверить нельзя.
  Hubski: { disabled: true },
  // Несуществующий пользователь — 404 с «User not found»; манифест ждёт устаревшее «The requested user does not exist…».
  interpals: {
    patch: { errorType: 'status_code', errorCode: null, errorMsg: [] },
    notFoundMsg: ['User not found'],
  },
  // Серверу сайт отвечает 403 своей страницей «High traffic» (или Cloudflare «One moment») без «This user doesn't
  // exist» из манифеста — блокировка считалась профилем.
  LibraryThing: {
    verify: ({ httpStatus, text }) => (httpStatus === 403 || /<title>LibraryThing \| (High traffic|One moment)/.test(text) ? 'waf' : null),
  },
  // Инстанс закрыт: любой адрес — 301 на страницу-заглушку media.mastodon.cloud (там 200).
  'mastodon.cloud': { disabled: true },
  // Несуществующий профиль — 200 со страницей «Parece que esta página não existe» (существующий уводится
  // редиректом на страницу продавца); манифест смотрит только на код — всё считалось найденным.
  mercadolivre: {
    patch: { requestMethod: 'GET' },
    notFoundMsg: ['página não existe'],
  },
  // Несуществующий канал — 200 с canonical на главную (<link rel="canonical" href="https://odysee.com"/>); манифест
  // ждёт устаревшую форму тега (content="odysee.com"). У канала canonical ведёт на /@Имя:id.
  Odysee: {
    notFoundMsg: ['<link rel="canonical" href="https://odysee.com"/>', '<link rel="canonical" content="odysee.com"/>'],
  },
  // API availability отвечает available:false и на занятое имя, и на недопустимое (точка и т. п., с флагом
  // "invalid") — манифест считал занятым любое. Недопустимые имена не проверяем, ответ с "invalid" — «нет».
  'omg.lol': {
    patch: { regexCheck: /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/ },
    notFoundMsg: ['"invalid": "true"', '"invalid":"true"', '"invalid": true', '"invalid":true'],
  },
  // API отвечает 302 на /404 (там 200), когда пользователя нет, и JSON 200, когда есть. Редиректы не следуем.
  Rarible: {
    patch: { errorType: 'response_url' },
  },
  // Эндпоинт signup/check_nickname исчез (сайт переехал на WordPress, там HTML) — JSON манифеста не встречался,
  // любой ник считался найденным. Страница пользователя отвечает 404, когда его нет (у авторов — 301 на /staff/…).
  dailykos: {
    patch: { urlProbe: null, errorType: 'status_code', errorCode: null, errorMsg: [] },
  },
  // Отвечает 202 на любой адрес (страница AWS WAF challenge), а несуществующий профиль — «Not Found» с кодом 200.
  // Манифест проверяет только код ответа HEAD-ом, поэтому любой ник считался найденным.
  '7Cups': {
    patch: { requestMethod: 'GET' },
    notFoundMsg: ['<title>Not Found', 'The content you\'re attempting to access could not be found'],
  },
};

/** Накладывает правило на сайт; сайты без правила возвращаются как есть. */
export function applyOverride(site: Site): Site {
  const o = SITE_OVERRIDES[site.name];
  if (!o) return site;
  return {
    ...site,
    ...o.patch,
    notFoundMsg: o.notFoundMsg ?? site.notFoundMsg,
    claimedMsg: o.claimedMsg ?? site.claimedMsg,
    verify: o.verify ?? site.verify,
  };
}
