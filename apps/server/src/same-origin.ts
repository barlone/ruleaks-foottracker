import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DRIVE_CALLBACK_PATH } from './archive/paths.ts';

// Запросы к серверу принимаются только со страниц самого сайта. SameSite=Lax у cookie сессии защищает от чужих
// сайтов, но не от соседних поддоменов того же домена (waczplayer.<домен> — тот же site): архивный JS, открытый в
// плеере, мог бы отправить сюда запрос с cookie пользователя (CSRF). Отличает их только Sec-Fetch-Site:
// same-origin — своя страница, none — адрес открыт пользователем сам (закладка, ссылка из Telegram),
// same-site / cross-site — чужая страница. Подделать этот заголовок из JS нельзя.
// Без Sec-Fetch-Site (старый браузер) сверяется Origin с адресом запроса; запрос без обоих — не из браузера
// (curl, служебные скрипты) и пропускается: cookie сессии у него может быть только своя.

const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

/** Почему запрос отклонён как пришедший с чужой страницы, или null — пропустить. */
export function crossSiteReason(req: FastifyRequest): string | null {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string') return ALLOWED_FETCH_SITES.has(site) ? null : `Sec-Fetch-Site: ${site}`;
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return null;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return `Origin: ${origin.slice(0, 100)}`; // в т.ч. «null» из песочницы
  }
  // req.host — Host (или X-Forwarded-Host при trust-proxy); nginx передаёт Host как есть, Vite в dev — тоже.
  return host === req.host ? null : `Origin: ${origin.slice(0, 100)}`;
}

/**
 * Адреса, куда браузер приходит с чужого сайта по задумке: возврат из Google после подключения Диска
 * (accounts.google.com → сюда). Защищён подписанным одноразовым state, привязанным к пользователю (archive-files.ts).
 */
const CROSS_SITE_ENTRY = new Set([DRIVE_CALLBACK_PATH]);

/** Хук на все маршруты (кроме /health и CROSS_SITE_ENTRY): /trpc, /geo, /scans, /site-archive и будущие. */
export function registerSameOriginGuard(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    if (req.method === 'GET' && CROSS_SITE_ENTRY.has(req.url.split('?')[0]!)) return;
    const reason = crossSiteReason(req);
    if (!reason) return;
    // Адрес — без query: у запросов tRPC там вход процедуры (искомые значения).
    req.log.warn(`cross-site ${req.method} ${req.url.split('?')[0]?.slice(0, 200)} отклонён: ${reason}`);
    return reply.code(403).header('Cache-Control', 'no-store').send({ error: 'CROSS_SITE' });
  });
}
