import { loadConfig } from '@ft/config';
import { makeLoginLink } from '../adapters/login-link.ts';

// Ссылка входа, какую собирает бот, — для проверки входа без бота:
//   npm run login-link -- <Telegram ID> [имя] [@ник]
// Секрет и срок — [telegram] login-secret / login-link-ttl-sec из config.ini, адрес сайта — [server] host:port
// (или FT_SITE_URL, если сайт за прокси).

const cfg = loadConfig();
const [tg, name, nick] = process.argv.slice(2);
if (!tg || !/^\d{1,19}$/.test(tg)) {
  console.log('Укажите Telegram ID: npm run login-link -- 123456789 [имя] [@ник]');
  process.exit(2);
}
if (!cfg.telegram.loginSecret) {
  console.log('[telegram] login-secret не задан — вход по ссылке выключен');
  process.exit(2);
}
const site = process.env.FT_SITE_URL ?? `http://${cfg.server.host}:${cfg.server.port}`;
console.log(makeLoginLink(cfg.telegram.loginSecret, site, tg, { name, nick: nick?.replace(/^@/, '') }));
console.log(`Действительна ${cfg.telegram.loginLinkTtlMs / 1000} с, одноразовая.`);
