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
  // Страница /profile/<ник> — 200 с «Page Not Found» в разметке у всех (профиль рисует JS); различает только
  // /api/og/<ник>: 404 JSON для несуществующего, 200 PNG для существующего.
  Codolio: {
    patch: { urlProbe: 'https://codolio.com/api/og/{}', errorType: 'status_code', errorCode: null, errorMsg: [], requestMethod: 'GET' },
  },
  // Несуществующего игрока уводит 302 на /dashboard, а там обычная страница без «Player not found» из манифеста.
  // Редиректы не следуем: 2xx — игрок есть, редирект — нет.
  Clozemaster: {
    patch: { errorType: 'response_url', errorMsg: [] },
  },
  // У Discord нет публичных страниц профиля: манифест только спрашивает API «занят ли ник», а в результат попадает
  // ссылка на главную discord.com — она бесполезна и уходит в досье как «страница». Сайт исключён.
  Discord: { disabled: true },
  // API отвечает 404 {"error": "User not found"}, а манифест ждёт «Server Error (500)» — любой ник считался найденным.
  'Discord.bio': {
    patch: { errorType: 'status_code', errorCode: null, errorMsg: [] },
    notFoundMsg: ['"User not found"'],
  },
  // Непубличный аккаунт — 404 «Uh-oh! The profile you're trying to view isn't public yet» без текста из манифеста
  // («Whoops, that page is gone» — только у несуществующего), и такой ник считался найденным. Страницы у него нет:
  // вердикт по коду ответа.
  Dribbble: {
    patch: { errorType: 'status_code', errorCode: null, errorMsg: [] },
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
  // Часть ника после точки сайт (Rails) считает расширением формата: /irina.krasnonos → профиль irina. Ники с точкой
  // не проверяем; несуществующий профиль — 404 с заголовком «…doesn't exist (404 Not found)».
  ReverbNation: {
    patch: { regexCheck: /^[^.]+$/ },
    notFoundMsg: ['(404 Not found)'],
  },
  // Сайт переделан в видеочат: любой /<ник>, включая эталонного пользователя манифеста, — 404 с главной страницей.
  RocketTube: { disabled: true },
  // Несуществующий профиль — 302 на главную (там 200), редирект следовался и ник считался найденным. Часть ников
  // (barlone) сайт отдаёт с кодом 200 и текстом «User Not Found» в теле — тоже «нет».
  Shelf: {
    patch: { errorType: 'response_url' },
    notFoundMsg: ['User Not Found'],
  },
  // Профилей /<ник> больше нет (даже эталонный «splice» — Not Found), с сервера приходит каркас SPA с кодом 200.
  Splice: { disabled: true },
  // Закрыт проверкой Anubis (200 «Making sure you're not a bot!»), ловится в WAF_HITS только по телу — нужен GET.
  'social.tchncs.de': {
    patch: { requestMethod: 'GET' },
  },
  // Любой /user/<ник> — 200 с пустым каркасом веб-плеера (профиль рисует JS за reCAPTCHA); oEmbed пользователей
  // не поддерживает, /embed/user — 404, API требует OAuth. С сервера проверить нельзя.
  Spotify: { disabled: true },
  // Страница /p/<ник> — каркас SPA (200 на любой ник); профиль она берёт из /data/profile/<ник>: JSON с "user"
  // для существующего, HTML-страница с кодом 200 — для несуществующего.
  Instapaper: {
    patch: { urlProbe: 'https://www.instapaper.com/data/profile/{}?page=1' },
    claimedMsg: ['"user": {', '"user":{'],
  },
  // Сервис закрыт: любой адрес — 403 без текста из манифеста.
  Trovo: { disabled: true },
  // Несуществующий канал — 200 с <title>Twitch</title> без описания (текст из манифеста устарел); у канала
  // заголовок «Имя - Twitch». Имя на Twitch — только буквы, цифры и «_».
  Twitch: {
    patch: { regexCheck: /^[A-Za-z0-9_]{1,25}$/ },
    claimedMsg: [' - Twitch</title>'],
  },
  // Профили закрыты для гостей: любой member.php?username=… (даже эталонный red) — 200 «Вы не авторизованы на сайте».
  Velomania: { disabled: true },
  // Доступен только из США: CloudFront отвечает 403 «could not be satisfied»; обход манифеста через test1.venmo.com
  // с подменой Host тоже даёт 403 (голый ответ балансировщика) — без текста из манифеста всё считалось найденным.
  Venmo: {
    patch: { urlProbe: null, headers: {} },
    verify: ({ httpStatus }) => (httpStatus === 403 ? 'waf' : null),
  },
  // Ник с точкой — 404 с пустым телом, без «Not Found» из манифеста, и считался найденным. Вердикт по коду.
  Vero: {
    patch: { errorType: 'status_code', errorCode: null, errorMsg: [] },
  },
  // Несуществующий профиль — 404 (HEAD при этом 200) с «Profil nelze zobrazit»; манифест ждёт устаревшее
  // «Neexistujicí profil». Проверяем GET-ом по коду и по новому тексту.
  'Chatujme.cz': {
    patch: { errorType: 'status_code', errorCode: null, errorMsg: [], requestMethod: 'GET' },
    notFoundMsg: ['Profil nelze zobrazit', 'Neexistujicí profil'],
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

/**
 * Инстансы Mastodon из манифеста. Имя пользователя там — только буквы, цифры и «_»; ник с точкой Rails принимает
 * за расширение формата (/@irina.krasnonos → 406 «not available in the requested format» или 200 заглушкой),
 * и проверка по коду давала «найдено».
 */
const MASTODON_HOSTS = new Set(['chaos.social', 'fosstodon.org', 'framapiaf.org', 'mamot.fr', 'mastodon.social', 'mastodon.xyz', 'mstdn.social', 'mstdn.io', 'social.tchncs.de', 'mastodon.cloud']);
const MASTODON_NAME = /^[A-Za-z0-9_]+$/;

/** Накладывает правило на сайт; сайты без правила возвращаются как есть. */
export function applyOverride(site: Site): Site {
  if (!site.regexCheck && MASTODON_HOSTS.has(new URL(site.url).hostname)) site = { ...site, regexCheck: MASTODON_NAME };
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
