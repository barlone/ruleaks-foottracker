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

export const config = {
  port: appConfig.server.port,
  host: appConfig.server.host,
  cookieSecret: appConfig.server.cookieSecret,
  sessionCookie: 'ft_sid',
  sessionTtlMs: appConfig.server.sessionTtlMs,
  loginTtlMs: 5 * 60 * 1000,
  /** Сколько кэшировать ответ о подписке. */
  accessCacheMs: 60 * 1000,
  botUsername: appConfig.telegram.botUsername,
  /** demo: данные в памяти и auth.devConfirm — имитация подтверждения входа ботом. */
  devMode: appConfig.server.mode === 'demo',
};
