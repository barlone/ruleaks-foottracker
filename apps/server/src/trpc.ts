import type {} from '@fastify/cookie'; // аугментация типов req.cookies / res.setCookie
import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import type { Access, User } from '@ft/shared';
import { config } from './config.ts';
import type { Deps } from './ports.ts';
import { Conflict, VersionConflict } from './ports.ts';

export interface Ctx {
  deps: Deps;
  req: CreateFastifyContextOptions['req'];
  res: CreateFastifyContextOptions['res'];
  sid: string | null;
  user: User | null;
}

// Ответ бота о подписке кэшируется: каждый запрос сайта не должен ходить в бота.
const accessCache = new Map<string, { access: Access; at: number }>();

export async function loadAccess(deps: Deps, tgId: string, fresh = false): Promise<Access> {
  const hit = accessCache.get(tgId);
  if (!fresh && hit && Date.now() - hit.at < config.accessCacheMs) return hit.access;
  const access = await deps.bot.getAccess(tgId);
  accessCache.set(tgId, { access, at: Date.now() });
  return access;
}

/** Сессия запроса по cookie: sid и пользователь (или null). Нужна и вне tRPC — например, для раздачи тайлов карты. */
export async function sessionOf(deps: Deps, req: CreateFastifyContextOptions['req']): Promise<{ sid: string | null; userId: string | null }> {
  const raw = req.cookies[config.sessionCookie];
  const unsigned = raw ? req.unsignCookie(raw) : null;
  let sid = unsigned?.valid ? unsigned.value : null;
  // auth = none: входить не нужно, каждый запрос — от имени соло-пользователя.
  let userId = config.authMode === 'none' ? deps.soloUserId : null;
  if (sid && !userId) {
    const session = await deps.sessions.get(sid);
    // Вход по паролю: сессии других пользователей (оставшиеся от входа через бота) не принимаются.
    if (session && (config.authMode !== 'password-sha256' || session.userId === deps.soloUserId)) userId = session.userId;
    else sid = null;
  }
  return { sid, userId };
}

export function makeCreateContext(deps: Deps) {
  return async ({ req, res }: CreateFastifyContextOptions): Promise<Ctx> => {
    const { sid, userId } = await sessionOf(deps, req);
    const u = userId ? await deps.users.get(userId) : null;
    const user: User | null = u ? { ...u, access: await loadAccess(deps, u.tgId) } : null;
    return { deps, req, res, sid, user };
  };
}

// Машиночитаемый код ошибки — в message (NO_SESSION, SUBSCRIPTION_INACTIVE, VERSION_CONFLICT…).
const t = initTRPC.context<Ctx>().create();

export const router = t.router;

/** Переводит доменные ошибки репозиториев в коды tRPC. */
const mapErrors = t.middleware(async ({ next }) => {
  const r = await next();
  if (!r.ok) {
    const cause = r.error.cause;
    if (cause instanceof VersionConflict) {
      throw new TRPCError({ code: 'CONFLICT', message: 'VERSION_CONFLICT', cause });
    }
    if (cause instanceof Conflict) {
      throw new TRPCError({ code: 'CONFLICT', message: cause.message, cause });
    }
    if (cause instanceof Error && cause.message === 'NOT_FOUND') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
    }
    if (cause instanceof Error && cause.message === 'BAD_ID') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_ID' });
    }
  }
  return r;
});

export const publicProcedure = t.procedure.use(mapErrors);

/** Нужна сессия. Чтение своих и расшаренных объектов доступно и без подписки. */
export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'NO_SESSION' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** Нужна активная подписка: поиск и любые изменения. */
export const activeProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.access.active) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'SUBSCRIPTION_INACTIVE' });
  }
  return next();
});
