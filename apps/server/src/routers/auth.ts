import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { config } from '../config.ts';
import { authedProcedure, loadAccess, publicProcedure, router } from '../trpc.ts';

// Вход только через бота:
// 1) start → nonce + ссылка t.me/<bot>?start=login_<nonce>;
// 2) бот подтверждает вход (в dev — devConfirm);
// 3) status опрашивается страницей входа; на confirmed сервер создаёт сессию и ставит cookie.

const cookieOpts = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.secureCookie,
  signed: true,
  maxAge: config.sessionTtlMs / 1000,
};

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  start: publicProcedure.mutation(({ ctx }) =>
    ctx.deps.bot.createLoginRequest({ userAgent: ctx.req.headers['user-agent'] }),
  ),

  status: publicProcedure.input(z.object({ nonce: z.string().min(10).max(64) })).query(async ({ ctx, input }) => {
    const r = await ctx.deps.bot.getLoginRequest(input.nonce);
    if (r.status !== 'confirmed') return { status: r.status };
    await ctx.deps.bot.consumeLoginRequest(input.nonce);
    const { id } = await ctx.deps.users.upsertByTgId({ tgId: r.tgId, displayName: r.displayName, username: r.username });
    await loadAccess(ctx.deps, r.tgId, true);
    const sid = await ctx.deps.sessions.create(id, config.sessionTtlMs);
    ctx.res.setCookie(config.sessionCookie, sid, cookieOpts);
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
  devConfirm: publicProcedure
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
