import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { EMAIL_PARTS, EMAIL_QUERY_MAX, parseEmail, type EmailPartId } from '@ft/shared';
import { appConfig } from '../config.ts';
import { skipReasons, type HuntOptions } from '../email/report.ts';
import { cancelJob, EmailBusy, getJob, recentJobs, startJob } from '../email/jobs.ts';
import { googleSession } from '../google/account.ts';
import { allEmailSites } from '../pages/email-sites.ts';
import { activeProcedure, authedProcedure, router } from '../trpc.ts';

// «Поиск по Email» — GHunt + MOSINT (apps/server/src/email). Запросы делает сервер; задание живёт в памяти
// (email/jobs.ts), браузер его опрашивает. Раздел выключается флагом [config] email-search: config → null,
// остальное — EMAIL_DISABLED. Ключи сервисов ([email-search] *-key) в браузер не уходят — только какие части есть.

const cfg = appConfig;
const log = (msg: string) => console.log(msg);

const opts: HuntOptions = {
  email: cfg.email,
  googleSession: googleSession(),
  googleTimeoutMs: cfg.google.timeoutMs,
  googleMinIntervalMs: cfg.google.minIntervalMs,
  pages: { timeoutMs: cfg.pages.timeoutMs, concurrency: cfg.pages.concurrency, sideEffectProbes: cfg.pages.sideEffectProbes },
  log,
};

const JobId = z.string().min(1).max(64);
const Start = z.object({ query: z.string().trim().min(1).max(EMAIL_QUERY_MAX + 7) }).refine((v) => !!parseEmail(v.query), 'BAD_QUERY');

const enabledProcedure = activeProcedure.use(({ next }) => {
  if (!cfg.email.enabled) throw new TRPCError({ code: 'NOT_FOUND', message: 'EMAIL_DISABLED' });
  return next();
});

/** Какие части собираются для своего домена (без учёта домена — для подсказки на пустой странице). */
function available(): Record<EmailPartId, boolean> {
  const skip = skipReasons(opts, 'corporate');
  return Object.fromEntries(EMAIL_PARTS.map((p) => [p.id, !skip[p.id]])) as Record<EmailPartId, boolean>;
}

export const emailRouter = router({
  /** null — раздел выключен. googleDemo — часть «Аккаунт Google» отвечает вымышленными данными (нет мастер-токена). */
  config: authedProcedure.query(() => (cfg.email.enabled
    ? {
        parts: available(),
        googleDemo: cfg.email.google && !opts.googleSession,
        sites: cfg.email.sites ? allEmailSites(cfg.pages.sideEffectProbes).length : 0,
      }
    : null)),

  start: enabledProcedure.input(Start).mutation(({ ctx, input }) => {
    try {
      return startJob(ctx.user.id, parseEmail(input.query)!, opts);
    } catch (e) {
      if (e instanceof EmailBusy) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'EMAIL_BUSY', cause: e });
      throw e;
    }
  }),

  job: authedProcedure.input(z.object({ id: JobId })).query(({ ctx, input }) => {
    const j = getJob(ctx.user.id, input.id);
    if (!j) throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
    return j;
  }),

  cancel: authedProcedure.input(z.object({ id: JobId })).mutation(({ ctx, input }) => cancelJob(ctx.user.id, input.id)),

  recent: authedProcedure.query(({ ctx }) => recentJobs(ctx.user.id)),
});
