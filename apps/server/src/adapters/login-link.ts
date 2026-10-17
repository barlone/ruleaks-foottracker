import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Вход по ссылке из бота. Бот по команде пользователя собирает ссылку
//   https://<сайт>/login?tg=<Telegram ID>&ts=<unix-секунды>&n=<случайная строка>&sig=<подпись>[&name=…][&nick=…]
// и подписывает её HMAC-SHA256 на секрете, общем с сайтом ([telegram] login-secret). Промежуточных сервисов и
// таблиц нет: подпись доказывает, что ссылку выдал бот, а Telegram — что команду дал владелец chat_id.
// Строка подписи (поля через перевод строки, отсутствующие name/nick — пустые):
//   tg \n ts \n n \n name \n nick
// sig — base64url без «=». Ссылка одноразовая (n запоминается до истечения срока) и живёт login-link-ttl-sec.

export const LoginLink = z.object({
  tg: z.string().regex(/^\d{1,19}$/),
  ts: z.string().regex(/^\d{1,12}$/),
  n: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  sig: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().max(256).optional(),
  nick: z.string().trim().max(64).regex(/^[A-Za-z0-9_]*$/).optional(),
});
export type LoginLink = z.infer<typeof LoginLink>;

export type LoginLinkFail = 'BAD_LINK' | 'LINK_EXPIRED' | 'LINK_USED';

/** Насколько ts может опережать часы сервера (рассинхрон часов бота и сайта). */
const FUTURE_SKEW_MS = 60_000;

/** Строка, которую подписывают бот и сайт. */
export const loginLinkPayload = (l: Omit<LoginLink, 'sig'>) => [l.tg, l.ts, l.n, l.name ?? '', l.nick ?? ''].join('\n');

export const signLoginLink = (secret: string, l: Omit<LoginLink, 'sig'>) =>
  createHmac('sha256', secret).update(loginLinkPayload(l), 'utf8').digest('base64url');

/** Готовая ссылка — для проверки и dev-инструмента (бот собирает такую же). */
export function makeLoginLink(secret: string, site: string, tg: string, extra: { name?: string; nick?: string } = {}, now = Date.now()): string {
  const l: Omit<LoginLink, 'sig'> = { tg, ts: String(Math.floor(now / 1000)), n: randomBytes(16).toString('base64url'), ...extra };
  // Пробел кодируется как %20, а не «+»: не все разборщики адреса переводят «+» обратно в пробел, и подпись не сойдётся.
  const query = Object.entries({ ...l, sig: signLoginLink(secret, l) })
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');
  return `${site.replace(/\/+$/, '')}/login?${query}`;
}

/** Использованные ссылки — до истечения их срока (после него подпись и так не примется). */
const used = new Map<string, number>();

function sweep(now: number) {
  for (const [k, until] of used) if (until <= now) used.delete(k);
}

/**
 * Проверяет подпись, срок и одноразовость; принятая ссылка сразу помечается использованной.
 * Подпись сверяется первой: по неподписанной ссылке нельзя ни «сжечь» nonce, ни узнать, был ли он.
 */
export function verifyLoginLink(secret: string, link: LoginLink, ttlMs: number, now = Date.now()): { ok: true } | { ok: false; code: LoginLinkFail } {
  if (!secret) return { ok: false, code: 'BAD_LINK' };
  const want = Buffer.from(signLoginLink(secret, link));
  const got = Buffer.from(link.sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, code: 'BAD_LINK' };
  const issued = Number(link.ts) * 1000;
  if (issued > now + FUTURE_SKEW_MS || issued + ttlMs < now) return { ok: false, code: 'LINK_EXPIRED' };
  sweep(now);
  const key = `${link.tg}:${link.n}`;
  if (used.has(key)) return { ok: false, code: 'LINK_USED' };
  used.set(key, issued + ttlMs);
  return { ok: true };
}
