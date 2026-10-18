import { createHash } from 'node:crypto';
import type { PageFoundBy } from '@ft/shared';
import type { EmailSite } from './email-sites.ts';
import { OutboundBlocked, outboundFetch } from './outbound.ts';
import type { Site } from './sites.ts';

// Проверка одного сайта по нику — перевод логики sherlock_project/sherlock.py (функция sherlock()):
// запрос к urlProbe (или url) с именем пользователя, вердикт по errorType сайта.
// Проверка по e-mail (checkEmailSite ниже) — логика blackbird/holehe: дёрнуть форму регистрации или
// восстановления пароля и понять по ответу, занят ли адрес.

/** Вердикт по сайту (QueryStatus Sherlock). */
export type PageStatus =
  /** Страница есть. */
  | 'claimed'
  /** Такого пользователя на сайте нет. */
  | 'available'
  /** Имя не подходит под правила сайта (regexCheck) — запрос не делался. */
  | 'illegal'
  /** Сайт показал страницу защиты от ботов (Cloudflare и т. п.) — проверить нельзя. */
  | 'waf'
  /** Ошибка сети, таймаут или ответ не удалось прочитать. */
  | 'unknown';

export interface SiteResult {
  site: string;
  url: string;
  urlMain: string;
  status: PageStatus;
  httpStatus: number | null;
  error: string | null;
  /** Длительность запроса, мс. */
  ms: number;
  nsfw: boolean;
  /** Чем нашли: по нику или по e-mail. */
  by: PageFoundBy;
}

/** Sherlock представляется Firefox: без User-Agent браузера многие сайты отвечают иначе. */
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0';

/** Отпечатки страниц защиты от ботов (WAFHitMsgs Sherlock) — такой ответ не говорит ни да, ни нет. */
const WAF_HITS = [
  '.loading-spinner{visibility:hidden}body.no-js .challenge-running{display:none}body.dark{background-color:#222;color:#d9d9d9}body.dark a{color:#fff}body.dark a:hover{color:#ee730a;text-decoration:underline}body.dark .lds-ring div{border-color:#999 transparent transparent}body.dark .font-red{color:#b20f03}body.dark', // 2024-05-13 Cloudflare
  '<span id="challenge-error-text">', // 2024-11-11 Cloudflare error page
  'AwsWafIntegration.forceRefreshToken', // 2024-11-11 Cloudfront (AWS)
  '{return l.onPageView}}),Object.defineProperty(r,"perimeterxIdentifiers",{enumerable:', // 2024-04-09 PerimeterX / Human Security
  '/shld/v0/verify.js', // 2026-10-18 Apple «Security Verification» (developer.apple.com/forums)
  '<title>Client Challenge</title>', // 2026-10-18 Fastly client challenge (houzz.com), отдаётся с кодом 200
  '/_fs-ch-', // 2026-10-18 Fastly client challenge — пути его ресурсов
  '<title>Vercel Security Checkpoint</title>', // 2026-10-18 Vercel (observablehq.com), отдаётся с кодом 429
  '.elements.namedItem("solution").value=', // 2026-10-18 JS-проверка Reddit (www.reddit.com), отдаётся с кодом 200
  '<title>Just a moment...</title>', // 2026-10-18 Cloudflare challenge без cf-mitigated и загрузчик realmeye.com (200 + meta refresh)
  "<title>Making sure you're not a bot!", // 2026-10-18 Anubis (social.tchncs.de и другие Fediverse-инстансы), отдаётся с кодом 200
  '<title>Making sure you&#39;re not a bot!', // то же с экранированным апострофом
  '<TITLE>ERROR: The request could not be satisfied</TITLE>', // 2026-10-18 CloudFront: гео-блок или WAF (account.venmo.com, 7cups без UA), 403
];

/** Фрагменты адреса, на который сайт уводит редиректом ради проверки на бота или согласия на cookie (там 200, но это не страница). */
const WAF_URL_HITS = [
  '/verify-human/', // developer.apple.com/forums, discussions.apple.com
  'myprivacy.dpgmedia.nl/consent', // 2026-10-18 шлюз согласия DPG Media (tweakers.net и другие их сайты), там 200
  '/.within.website/', // 2026-10-18 Anubis: 307 на свою проверку (hosted.weblate.org), там 200
];

/** Больше тела ответа не читаем: признаки ошибки — в начале страницы, а бесконечный поток не должен держать воркер. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const fill = (s: string, username: string) => s.replaceAll('{}', username);

/** {} → имя пользователя во всех строках JSON-тела (interpolate_string). */
function fillDeep(v: unknown, username: string): unknown {
  if (typeof v === 'string') return fill(v, username);
  if (Array.isArray(v)) return v.map((x) => fillDeep(x, username));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillDeep(x, username)]));
  return v;
}

/** Тело ответа текстом, не больше max байт. */
async function readText(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

/** Коды сетевых ошибок Node/undici — короткой русской подписью (полный текст с адресами пользователю не нужен). */
const NET_ERRORS: Record<string, string> = {
  UND_ERR_CONNECT_TIMEOUT: 'нет соединения (таймаут)',
  UND_ERR_HEADERS_TIMEOUT: 'нет ответа (таймаут)',
  UND_ERR_BODY_TIMEOUT: 'нет ответа (таймаут)',
  UND_ERR_SOCKET: 'соединение оборвано',
  ENOTFOUND: 'адрес не найден (DNS)',
  EAI_AGAIN: 'адрес не найден (DNS)',
  ECONNREFUSED: 'соединение отклонено',
  ECONNRESET: 'соединение сброшено',
  ETIMEDOUT: 'нет соединения (таймаут)',
  EHOSTUNREACH: 'хост недоступен',
  ENETUNREACH: 'сеть недоступна',
};

function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e instanceof OutboundBlocked) return e.message;
  if (e.name === 'TimeoutError') return 'нет ответа (таймаут)';
  if (e.name === 'AbortError') return 'отменено';
  // undici заворачивает сетевую ошибку в TypeError: fetch failed { cause }.
  const cause = (e as { cause?: unknown }).cause;
  const err = cause instanceof Error ? cause : e;
  const code = (err as NodeJS.ErrnoException).code;
  if (code && NET_ERRORS[code]) return NET_ERRORS[code];
  if (code?.startsWith('ERR_TLS') || code?.startsWith('ERR_SSL') || /certificate/i.test(err.message)) return 'ошибка TLS-сертификата';
  const text = code ? `${code}: ${err.message}` : err.message;
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

export interface CheckOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Есть ли у пользователя страница на сайте. Никогда не бросает: сетевые ошибки — status 'unknown'. */
export async function checkSite(site: Site, username: string, opts: CheckOptions): Promise<SiteResult> {
  // Пробел в имени — %20, остальное как есть (так делает Sherlock).
  const url = fill(site.url, username.replaceAll(' ', '%20'));
  const base = { site: site.name, url, urlMain: site.urlMain, httpStatus: null, error: null, nsfw: site.nsfw, by: 'username' as const };
  if (site.regexCheck && !site.regexCheck.test(username)) return { ...base, status: 'illegal', ms: 0 };

  const probe = site.urlProbe ? fill(site.urlProbe, username) : url;
  // Для вердикта по коду ответа тело не нужно — достаточно HEAD; индивидуальным проверкам по телу нужен GET.
  const needBody = site.notFoundMsg.length > 0 || site.claimedMsg.length > 0 || site.verify !== null;
  const method = site.requestMethod ?? (site.errorType === 'status_code' && !needBody ? 'HEAD' : 'GET');
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...site.headers };
  let body: string | undefined;
  if (site.requestPayload !== undefined) {
    body = JSON.stringify(fillDeep(site.requestPayload, username));
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  }
  // response_url: сайт уводит редиректом, когда пользователя нет — нужен код первого ответа.
  const follow = site.errorType !== 'response_url';
  const signals = [AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])];

  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  let res: Response;
  let text = '';
  try {
    res = await outboundFetch(probe, { method, headers, body, follow, signal: AbortSignal.any(signals) });
    if (method === 'HEAD') await res.body?.cancel().catch(() => undefined);
    else text = await readText(res, MAX_BODY_BYTES);
  } catch (e) {
    return { ...base, status: 'unknown', error: describeError(e), ms: ms() };
  }

  const http = res.status;
  if (isWafChallenge(res, text)) return { ...base, status: 'waf', httpStatus: http, ms: ms() };

  let status: PageStatus;
  switch (site.errorType) {
    case 'message':
      status = site.errorMsg.some((m) => text.includes(m)) ? 'available' : 'claimed';
      break;
    case 'status_code':
      status = site.errorCode?.includes(http) || http >= 300 || http < 200 ? 'available' : 'claimed';
      break;
    case 'response_url':
      status = http >= 200 && http < 300 ? 'claimed' : 'available';
      break;
  }
  // Индивидуальные правила сайта (site-overrides.ts) — только уточняют «найдено».
  if (status === 'claimed') {
    if (site.notFoundMsg.some((m) => text.includes(m))) status = 'available';
    else if (site.claimedMsg.length > 0 && !site.claimedMsg.some((m) => text.includes(m))) status = 'available';
    else if (site.verify) {
      try {
        status = (await site.verify({ site, username, url, response: res, text, httpStatus: http })) ?? status;
      } catch (e) {
        return { ...base, status: 'unknown', error: describeError(e), httpStatus: http, ms: ms() };
      }
    }
  }
  return { ...base, status, httpStatus: http, ms: ms() };
}

/**
 * Страница защиты от ботов или ограничение запросов: по коду 429, по заголовкам (видны и при HEAD — AWS WAF
 * отвечает 202 с x-amzn-waf-action, Cloudflare ставит cf-mitigated: challenge), по адресу после редиректов
 * (WAF_URL_HITS) или по отпечаткам в теле (WAF_HITS Sherlock).
 */
function isWafChallenge(res: Response, text: string): boolean {
  // 429 — сайт ограничил запросы: ответ ничего не говорит о странице.
  if (res.status === 429) return true;
  if (res.headers.get('x-amzn-waf-action') === 'challenge') return true;
  if (res.headers.get('cf-mitigated') === 'challenge') return true;
  if (WAF_URL_HITS.some((h) => res.url.includes(h))) return true;
  return WAF_HITS.some((h) => text.includes(h));
}

/** Преобразование адреса перед подстановкой в запрос (input_operation blackbird). */
function transformAccount(email: string, op: EmailSite['inputOp']): string {
  return op === 'sha256' ? createHash('sha256').update(email, 'utf8').digest('hex') : email;
}

/**
 * {account} (плейсхолдер blackbird, не {} Sherlock) → адрес с кодированием по месту подстановки:
 * в адресе и form-теле — percent-кодирование (иначе «+» в user+tag@… сайт читает как пробел, а «&» и «#»
 * ломают запрос), в JSON-теле — экранирование строки JSON. sha256-хеш кодирование не меняет.
 */
function fillAccount(s: string, account: string, where: 'url' | 'form' | 'json'): string {
  const v = where === 'json' ? JSON.stringify(account).slice(1, -1) : encodeURIComponent(account);
  return s.replaceAll('{account}', v);
}

/** Вид тела запроса — по Content-Type, иначе по первому символу (blackbird хранит JSON-тело строкой). */
function bodyKind(headers: Record<string, string>, data: string): 'form' | 'json' {
  const ct = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (/json/i.test(ct)) return 'json';
  if (/x-www-form-urlencoded/i.test(ct)) return 'form';
  return /^\s*[[{]/.test(data) ? 'json' : 'form';
}

/** Значение cookie по имени из заголовков Set-Cookie ответа. */
function cookieValue(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    const m = /^([^=]+)=([^;]*)/.exec(c.trim());
    if (m && m[1] === name) return m[2] ?? null;
  }
  return null;
}

/** Есть ли у адреса учётка на сайте — логика blackbird checkSite / модулей holehe. */
export async function checkEmailSite(site: EmailSite, email: string, opts: CheckOptions): Promise<SiteResult> {
  const base = { site: site.name, url: site.urlMain, urlMain: site.urlMain, httpStatus: null, error: null, nsfw: site.nsfw, by: 'email' as const };
  const account = transformAccount(email, site.inputOp);
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...site.headers };
  const signal = () => AbortSignal.any([AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])]);

  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    // pre_check: сходить за cookie и подставить её значение в заголовки ({<cookieName>_value}).
    if (site.preCheck) {
      const pre = await outboundFetch(site.preCheck.url, { method: 'GET', headers: { 'User-Agent': USER_AGENT }, follow: true, signal: signal() });
      await pre.body?.cancel().catch(() => undefined);
      const value = cookieValue(pre, site.preCheck.cookieName);
      if (!value) return { ...base, status: 'unknown', error: 'не получена cookie для проверки', ms: ms() };
      const ph = `{${site.preCheck.cookieName}_value}`;
      for (const k of Object.keys(headers)) headers[k] = headers[k]!.replaceAll(ph, value);
    }

    let body: string | undefined;
    if (site.data) {
      const kind = bodyKind(headers, site.data);
      body = fillAccount(site.data, account, kind);
      // fetch без Content-Type пометил бы строку как text/plain — сайт форму не разберёт.
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = kind === 'json' ? 'application/json' : 'application/x-www-form-urlencoded';
      }
    }
    const res = await outboundFetch(fillAccount(site.uriCheck, account, 'url'), { method: site.method, headers, body, follow: true, signal: signal() });
    const text = await readText(res, MAX_BODY_BYTES);
    const http = res.status;
    if (isWafChallenge(res, text)) return { ...base, status: 'waf', httpStatus: http, ms: ms() };

    // blackbird: занят, если код = eCode, в теле есть eString, нет mString и код не равен mCode.
    const claimed = http === site.eCode && text.includes(site.eString)
      && (!site.mString || !text.includes(site.mString))
      && (site.mCode === null || http !== site.mCode);
    return { ...base, status: claimed ? 'claimed' : 'available', httpStatus: http, ms: ms() };
  } catch (e) {
    return { ...base, status: 'unknown', error: describeError(e), ms: ms() };
  }
}
