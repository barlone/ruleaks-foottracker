import { createHash, timingSafeEqual } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { config } from '../config.ts';
import { authedProcedure, loadAccess, publicProcedure, router, type Ctx } from '../trpc.ts';

// Способ входа — [config] auth:
// bot-db — через бота:
//   1) start → nonce + ссылка t.me/<bot>?start=login_<nonce>;
//   2) бот подтверждает вход (в dev — devConfirm);
//   3) status опрашивается страницей входа; на confirmed сервер создаёт сессию и ставит cookie.
// password-sha256 — один пользователь, password сверяет sha256 пароля с конфигом и ставит cookie.
// none — входа нет: контекст запроса всегда содержит соло-пользователя (см. trpc.ts).

const cookieOpts = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.secureCookie,
  signed: true,
  maxAge: config.sessionTtlMs / 1000,
};

/** Процедуры входа через бота недоступны в других режимах. */
const botProcedure = publicProcedure.use(({ next }) => {
  if (config.authMode !== 'bot-db') throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
  return next();
});

// Перебор пароля: не больше MAX_FAILS неудачных попыток с адреса за окно, каждая неудача — с задержкой.
const FAIL_WINDOW_MS = 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, number[]>();

function recentFails(ip: string): number[] {
  const now = Date.now();
  const list = (fails.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  if (list.length) fails.set(ip, list);
  else fails.delete(ip);
  return list;
}

function passwordMatches(password: string): boolean {
  const got = createHash('sha256').update(password, 'utf8').digest();
  return timingSafeEqual(got, Buffer.from(config.passwordSha256, 'hex'));
}

async function startSession(ctx: Ctx, userId: string) {
  const sid = await ctx.deps.sessions.create(userId, config.sessionTtlMs);
  ctx.res.setCookie(config.sessionCookie, sid, cookieOpts);
}

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  /** Способ входа ([config] auth): страница входа и кнопка «Выйти» зависят от него. */
  mode: publicProcedure.query(() => config.authMode),

  /** auth = password-sha256: вход единственного пользователя по паролю. */
  password: publicProcedure.input(z.object({ password: z.string().min(1).max(1024) })).mutation(async ({ ctx, input }) => {
    if (config.authMode !== 'password-sha256' || !ctx.deps.soloUserId) throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
    const ip = ctx.req.ip;
    if (recentFails(ip).length >= MAX_FAILS) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'TOO_MANY_ATTEMPTS' });
    if (!passwordMatches(input.password)) {
      fails.set(ip, [...recentFails(ip), Date.now()]);
      await new Promise((r) => setTimeout(r, 700));
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'BAD_PASSWORD' });
    }
    fails.delete(ip);
    await startSession(ctx, ctx.deps.soloUserId);
    return true;
  }),

  start: botProcedure.mutation(({ ctx }) =>
    ctx.deps.bot.createLoginRequest({ userAgent: ctx.req.headers['user-agent'] }),
  ),

  status: botProcedure.input(z.object({ nonce: z.string().min(10).max(64) })).query(async ({ ctx, input }) => {
    const r = await ctx.deps.bot.getLoginRequest(input.nonce);
    if (r.status !== 'confirmed') return { status: r.status };
    await ctx.deps.bot.consumeLoginRequest(input.nonce);
    const { id } = await ctx.deps.users.upsertByTgId({ tgId: r.tgId, displayName: r.displayName, username: r.username });
    await loadAccess(ctx.deps, r.tgId, true);
    await startSession(ctx, id);
    return { status: 'confirmed' as const };
  }),

  /** Повторно спросить бота о подписке (после продления в боте). */
  refreshAccess: authedProcedure.mutation(({ ctx }) => loadAccess(ctx.deps, ctx.user.tgId, true)),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.sid) await ctx.deps.sessions.delete(ctx.sid);
    ctx.res.clearCookie(config.sessionCookie, { path: '/' });
    return true;
  }),

  logoutEverywhere: authedProcedure.mutation(async ({ ctx }) => {
    await ctx.deps.sessions.deleteAllForUser(ctx.user.id);
    ctx.res.clearCookie(config.sessionCookie, { path: '/' });
    return true;
  }),

  /** Какой вход без бота доступен: profiles — демо-учётки, tgid — по Telegram ID пользователя бота, null — никакого. */
  devLogin: publicProcedure.query(({ ctx }) => ctx.deps.bot.devLogin),

  /** dev: подтверждает вход вместо бота (демо-учётка или реальный пользователь бота по Telegram ID). */
  devConfirm: botProcedure
    .input(z.union([
      z.object({ nonce: z.string(), profile: z.enum(['active', 'expired', 'colleague']) }),
      z.object({ nonce: z.string(), tgId: z.string().trim().regex(/^\d{1,20}$/, 'Telegram ID — только цифры') }),
    ]))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.deps.bot.devLogin) throw new TRPCError({ code: 'NOT_FOUND' });
      const { nonce, ...who } = input;
      const r = await ctx.deps.bot.devConfirm(nonce, who);
      if (!r.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: r.error });
      return true;
    }),
});
