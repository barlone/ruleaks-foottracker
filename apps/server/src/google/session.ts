import { createHash } from 'node:crypto';
import { API_KEYS, CHROME_APP, PACKAGE_SIGS, WEB_HEADERS, type ApiKeyName, type OAuthApp } from './knowledge.ts';
import { bodyText, cookieHeader, gfetch, GoogleError, query, setCookies, type Ctx } from './net.ts';

// Авторизация GHunt (helpers/auth.py, objects/apis.py). В конфиге лежит только мастер-токен Android (aas_et/…)
// служебного аккаунта Google; всё остальное выводится из него и живёт в памяти процесса:
//   мастер-токен → токен OAuth приложения (android.googleapis.com/auth, «от имени» пакета с его подписью);
//   токен Chrome → uberauth (accounts.google.com/OAuthLogin) → cookie веб-сессии (MergeSession);
//   cookie SAPISID → заголовок Authorization: SAPISIDHASH для внутренних веб-API (People, Calendar).
// OSID отдельных сервисов (GHunt их тоже создаёт) поиску по e-mail не нужны.

const ANDROID_AUTH = 'https://android.googleapis.com/auth';
/** Как у gpsoauth, на который ссылается GHunt: стандартный клиент fetch этот адрес может отвергнуть. */
const ANDROID_AUTH_UA = 'GoogleAuth/1.4';
/** Сколько верить проверенным cookie, не спрашивая CheckCookie снова. */
const COOKIE_CHECK_MS = 10 * 60_000;

/** Ответ android.googleapis.com/auth: строки «ключ=значение» (helpers/utils.py parse_oauth_flow_response). */
export function parseAuthResponse(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return out;
}

async function androidAuth(form: Record<string, string>, ctx: Ctx): Promise<Record<string, string>> {
  const res = await gfetch(ANDROID_AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': ANDROID_AUTH_UA },
    body: query(form),
  }, ctx);
  return parseAuthResponse(await bodyText(res, ctx));
}

/**
 * helpers/auth.py android_master_auth: одноразовый oauth_token (cookie после входа на accounts.google.com/EmbeddedSetup,
 * начинается с oauth2_4/) → мастер-токен и сведения об аккаунте.
 */
export async function masterAuth(oauthToken: string, ctx: Ctx): Promise<{ masterToken: string; email: string; name: string; services: string[] }> {
  const r = await androidAuth({
    Token: oauthToken,
    service: 'ac2dm',
    get_accountid: '1',
    ACCESS_TOKEN: '1',
    add_account: '1',
    callerSig: '38918a453d07199354f8b19af05ec6562ced5788',
    droidguard_results: 'dummy123',
  }, ctx);
  if (!r.Token || !r.Email) throw new GoogleError('AUTH', `обмен oauth_token на мастер-токен не удался${r.Error ? `: ${r.Error}` : ''} — токен одноразовый и живёт недолго`);
  return { masterToken: r.Token, email: r.Email, name: [r.firstName, r.lastName].filter(Boolean).join(' '), services: (r.services ?? '').split(',').filter(Boolean) };
}

/** helpers/auth.py android_oauth_app: токен OAuth приложения по мастер-токену. expiry — unix-время, секунды. */
export async function oauthForApp(masterToken: string, app: OAuthApp, ctx: Ctx): Promise<{ token: string; expiry: number }> {
  const r = await androidAuth({
    app: app.pkg,
    service: `oauth2:${app.scopes.join(' ')}`,
    client_sig: PACKAGE_SIGS[app.pkg]!,
    Token: masterToken,
  }, ctx);
  if (!r.Auth || !r.Expiry) throw new GoogleError('AUTH', `токен OAuth для ${app.pkg} не выдан${r.Error ? `: ${r.Error}` : ''} — мастер-токен отозван или недействителен`);
  return { token: r.Auth, expiry: Number(r.Expiry) };
}

/** helpers/utils.py gen_sapisidhash. */
export function sapisidHash(sapisid: string, origin: string, now = Date.now()): string {
  const ts = Math.floor(now / 1000);
  return `${ts}_${createHash('sha1').update(`${ts} ${sapisid} ${origin}`).digest('hex')}`;
}

/** Сессия служебного аккаунта Google: одна на процесс, поиски идут по очереди (google/jobs.ts). */
export class GoogleSession {
  private readonly masterToken: string;
  private readonly log: (msg: string) => void;
  /** Подробный лог (имена cookie, ответ CheckCookie) — для диагностики входа (npm run google-login). */
  private readonly debug: boolean;
  private readonly tokens = new Map<string, { token: string; expiry: number }>();
  private cookies: Record<string, string> | null = null;
  private cookiesCheckedAt = 0;

  constructor(masterToken: string, log: (msg: string) => void = () => undefined, debug = false) {
    this.masterToken = masterToken;
    this.log = log;
    this.debug = debug;
  }

  /** objects/apis.py _check_and_gen_authorization_token: токен приложения из кэша, пока не истёк. */
  async oauth(app: OAuthApp, ctx: Ctx): Promise<string> {
    const cached = this.tokens.get(app.name);
    if (cached && cached.expiry * 1000 - 60_000 > Date.now()) return cached.token;
    const fresh = await oauthForApp(this.masterToken, app, ctx);
    this.tokens.set(app.name, fresh);
    this.log(`google: выдан токен OAuth «${app.name}»`);
    return fresh.token;
  }

  /** Токен приложения больше не годится (ответ 401) — следующий вызов oauth() запросит новый. */
  dropOauth(app: OAuthApp) {
    this.tokens.delete(app.name);
  }

  /** helpers/auth.py gen_cookies_and_osids (без OSID): токен Chrome → uberauth → cookie веб-сессии. */
  private async generateCookies(ctx: Ctx): Promise<Record<string, string>> {
    const token = await this.oauth(CHROME_APP, ctx);
    const login = await gfetch(`https://accounts.google.com/OAuthLogin?${query({ source: 'ChromiumBrowser', issueuberauth: 1 })}`, {
      headers: { ...WEB_HEADERS, Authorization: `OAuth ${token}` },
    }, ctx);
    const uberAuth = (await bodyText(login, ctx)).trim();
    if (login.status !== 200 || !uberAuth || /\s|</.test(uberAuth)) {
      this.dropOauth(CHROME_APP);
      throw new GoogleError('AUTH', `OAuthLogin не выдал uberauth (HTTP ${login.status})`);
    }
    const merge = await gfetch(`https://accounts.google.com/MergeSession?${query({
      uberauth: uberAuth,
      continue: 'https://www.google.com',
      source: 'ChromiumAccountReconcilor',
      externalCcResult: 'doubleclick:null,youtube:null',
    })}`, { headers: WEB_HEADERS }, ctx);
    const cookies = setCookies(merge);
    await merge.body?.cancel().catch(() => undefined);
    if (this.debug) this.log(`google: MergeSession → HTTP ${merge.status}, cookie: ${Object.keys(cookies).join(', ') || 'нет'}`);
    if (!cookies.SAPISID) throw new GoogleError('AUTH', `MergeSession не выдал cookie сессии (HTTP ${merge.status}, cookie: ${Object.keys(cookies).join(', ') || 'нет'})`);
    this.log(`google: создана веб-сессия служебного аккаунта (cookie: ${Object.keys(cookies).length})`);
    return cookies;
  }

  /** helpers/auth.py check_cookies. */
  private async cookiesValid(cookies: Record<string, string>, ctx: Ctx): Promise<boolean> {
    const res = await gfetch(`https://accounts.google.com/CheckCookie?${query({ continue: 'https://www.google.com/robots.txt' })}`, {
      headers: { ...WEB_HEADERS, Cookie: cookieHeader(cookies) },
    }, ctx);
    await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location') ?? '';
    const ok = res.status === 302 && !location.startsWith('https://support.google.com') && !location.startsWith('https://accounts.google.com/CookieMismatch');
    // Адрес в Location без query (там может быть continue-токен) — для диагностики.
    if (this.debug) this.log(`google: CheckCookie → HTTP ${res.status}${location ? `, Location ${location.split('?')[0]}` : ''} → ${ok ? 'принято' : 'не принято'}`);
    return ok;
  }

  /** helpers/auth.py check_and_gen: действующие cookie сессии — из памяти или созданные заново. */
  async sessionCookies(ctx: Ctx): Promise<Record<string, string>> {
    if (this.cookies && Date.now() - this.cookiesCheckedAt < COOKIE_CHECK_MS) return this.cookies;
    if (this.cookies && (await this.cookiesValid(this.cookies, ctx))) {
      this.cookiesCheckedAt = Date.now();
      return this.cookies;
    }
    this.cookies = null;
    const cookies = await this.generateCookies(ctx);
    if (!(await this.cookiesValid(cookies, ctx))) throw new GoogleError('AUTH', 'созданные cookie сессии Google не проходят проверку CheckCookie');
    this.cookies = cookies;
    this.cookiesCheckedAt = Date.now();
    return cookies;
  }

  /** API ответил 401/403 — cookie считаются негодными, следующий запрос создаст сессию заново. */
  dropCookies() {
    this.cookies = null;
    this.cookiesCheckedAt = 0;
  }

  /**
   * objects/apis.py _load_endpoint, режим sapisidhash: заголовки запроса к внутреннему веб-API от имени сессии —
   * ключ API веб-клиента, его Origin и подпись SAPISIDHASH.
   */
  async webApiHeaders(keyName: ApiKeyName, ctx: Ctx): Promise<Record<string, string>> {
    const cookies = await this.sessionCookies(ctx);
    const { key, origin } = API_KEYS[keyName];
    return {
      ...WEB_HEADERS,
      'X-Goog-Api-Key': key,
      Origin: origin,
      Referer: origin,
      Authorization: `SAPISIDHASH ${sapisidHash(cookies.SAPISID!, origin)}`,
      Cookie: cookieHeader(cookies),
    };
  }

  /**
   * Запрос к внутреннему веб-API с одной повторной попыткой: 401 — сессия протухла раньше срока проверки,
   * её создают заново и повторяют запрос. Второй отказ — ошибка AUTH.
   */
  async webApi(keyName: ApiKeyName, url: string, ctx: Ctx): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await gfetch(url, { headers: await this.webApiHeaders(keyName, ctx) }, ctx);
      if (res.status !== 401) return res;
      await res.body?.cancel().catch(() => undefined);
      this.dropCookies();
      if (attempt > 0) throw new GoogleError('AUTH', `${new URL(url).hostname}: HTTP 401 и с новой сессией`);
    }
  }
}
