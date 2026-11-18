import { ConfigError, loadConfig, type AppConfig } from '@ft/config';

// Настройки читаются из config.ini (шаблон — config.example.ini в корне репозитория).

function load(): AppConfig {
  try {
    return loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
}

export const appConfig = load();

const { auth } = appConfig;

export const config = {
  port: appConfig.server.port,
  host: appConfig.server.host,
  /** none | password-sha256 | bot-db ([config] auth). */
  authMode: auth.mode,
  passwordSha256: auth.passwordSha256,
  devQuickLoginTgId: auth.devQuickLoginTgId,
  // При входе по паролю хеш пароля входит в секрет подписи cookie: смена пароля завершает все сессии.
  cookieSecret: auth.mode === 'password-sha256' ? `${appConfig.server.cookieSecret}:${auth.passwordSha256}` : appConfig.server.cookieSecret,
  // Префикс __Host-: браузер принимает такую cookie только с Secure, Path=/ и без Domain и не даёт поставить или
  // перезаписать её с поддомена (cookie tossing с соседнего waczplayer.<домен>). Без Secure префикс недопустим —
  // тогда прежние имена.
  sessionCookie: appConfig.server.secureCookie ? '__Host-ft_sid' : 'ft_sid',
  loginCookie: appConfig.server.secureCookie ? '__Host-ft_login' : 'ft_login',
  /** Имена до префикса: у вошедших раньше они остались в браузере, при новом входе и выходе стираются. */
  legacyCookies: appConfig.server.secureCookie ? ['ft_sid', 'ft_login'] : [],
  sessionTtlMs: appConfig.server.sessionTtlMs,
  loginTtlMs: 5 * 60 * 1000,
  /** Сколько кэшировать ответ о подписке. */
  accessCacheMs: 60 * 1000,
  botUsername: appConfig.telegram.botUsername,
  /** Секрет подписи ссылок входа от бота ('' — вход по ссылке выключен) и срок их жизни. */
  loginSecret: appConfig.telegram.loginSecret,
  loginLinkTtlMs: appConfig.telegram.loginLinkTtlMs,
  /**
   * Cookie с флагом Secure ([server] secure-cookie, по умолчанию да). Раньше флаг зависел от host, но на проде
   * сервер слушает 127.0.0.1 за nginx — и cookie сессии уходила без Secure.
   */
  secureCookie: appConfig.server.secureCookie,
};
