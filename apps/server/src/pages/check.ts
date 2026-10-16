import type { Site } from './sites.ts';

// Проверка одного сайта — перевод логики sherlock_project/sherlock.py (функция sherlock()):
// запрос к urlProbe (или url) с именем пользователя, вердикт по errorType сайта.

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
}

/** Sherlock представляется Firefox: без User-Agent браузера многие сайты отвечают иначе. */
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0';

/** Отпечатки страниц защиты от ботов (WAFHitMsgs Sherlock) — такой ответ не говорит ни да, ни нет. */
const WAF_HITS = [
  '.loading-spinner{visibility:hidden}body.no-js .challenge-running{display:none}body.dark{background-color:#222;color:#d9d9d9}body.dark a{color:#fff}body.dark a:hover{color:#ee730a;text-decoration:underline}body.dark .lds-ring div{border-color:#999 transparent transparent}body.dark .font-red{color:#b20f03}body.dark', // 2024-05-13 Cloudflare
  '<span id="challenge-error-text">', // 2024-11-11 Cloudflare error page
  'AwsWafIntegration.forceRefreshToken', // 2024-11-11 Cloudfront (AWS)
  '{return l.onPageView}}),Object.defineProperty(r,"perimeterxIdentifiers",{enumerable:', // 2024-04-09 PerimeterX / Human Security
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
  const base = { site: site.name, url, urlMain: site.urlMain, httpStatus: null, error: null, nsfw: site.nsfw };
  if (site.regexCheck && !site.regexCheck.test(username)) return { ...base, status: 'illegal', ms: 0 };

  const probe = site.urlProbe ? fill(site.urlProbe, username) : url;
  // Для вердикта по коду ответа тело не нужно — достаточно HEAD.
  const method = site.requestMethod ?? (site.errorType === 'status_code' ? 'HEAD' : 'GET');
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...site.headers };
  let body: string | undefined;
  if (site.requestPayload !== undefined) {
    body = JSON.stringify(fillDeep(site.requestPayload, username));
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  }
  // response_url: сайт уводит редиректом, когда пользователя нет — нужен код первого ответа.
  const redirect = site.errorType === 'response_url' ? 'manual' : 'follow';
  const signals = [AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])];

  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  let res: Response;
  let text = '';
  try {
    res = await fetch(probe, { method, headers, body, redirect, signal: AbortSignal.any(signals) });
    if (method === 'HEAD') await res.body?.cancel().catch(() => undefined);
    else text = await readText(res, MAX_BODY_BYTES);
  } catch (e) {
    return { ...base, status: 'unknown', error: describeError(e), ms: ms() };
  }

  const http = res.status;
  if (WAF_HITS.some((h) => text.includes(h))) return { ...base, status: 'waf', httpStatus: http, ms: ms() };

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
  return { ...base, status, httpStatus: http, ms: ms() };
}
