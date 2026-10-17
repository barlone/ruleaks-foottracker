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
  sessionCookie: 'ft_sid',
  sessionTtlMs: appConfig.server.sessionTtlMs,
  loginTtlMs: 5 * 60 * 1000,
  /** Сколько кэшировать ответ о подписке. */
  accessCacheMs: 60 * 1000,
  botUsername: appConfig.telegram.botUsername,
  /** Секрет подписи ссылок входа от бота ('' — вход по ссылке выключен) и срок их жизни. */
  loginSecret: appConfig.telegram.loginSecret,
  loginLinkTtlMs: appConfig.telegram.loginLinkTtlMs,
  /** Cookie с флагом Secure, когда сервер доступен не только с localhost (значит, за HTTPS). */
  secureCookie: !appConfig.server.loopback,
};
