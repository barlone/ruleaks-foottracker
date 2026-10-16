import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { PAGES_USERNAME_MAX, PAGES_USERNAME_RE } from '@ft/shared';
import { appConfig } from '../config.ts';
import { cancelJob, getJob, PagesBusy, recentJobs, startJob } from '../pages/jobs.ts';
import { allSites } from '../pages/sites.ts';
import { activeProcedure, authedProcedure, router } from '../trpc.ts';

// «Поиск личных страниц» — по имени пользователя на сайтах из манифеста Sherlock (pages/sites.ts).
// Запросы к сайтам делает сервер (из браузера мешает CORS), задание живёт в памяти (pages/jobs.ts).
// Раздел выключается флагом [config] pages-search: тогда config → null, остальное — PAGES_DISABLED.

const pages = appConfig.pages;

const Username = z.string().trim().min(1).max(PAGES_USERNAME_MAX).regex(PAGES_USERNAME_RE, 'BAD_USERNAME');
const JobId = z.string().min(1).max(64);

const enabledProcedure = activeProcedure.use(({ next }) => {
  if (!pages.enabled) throw new TRPCError({ code: 'NOT_FOUND', message: 'PAGES_DISABLED' });
  return next();
});

export const pagesRouter = router({
  /** null — раздел выключен. */
  config: authedProcedure.query(() => (pages.enabled ? { sites: allSites().length, timeoutSec: pages.timeoutMs / 1000 } : null)),

  start: enabledProcedure.input(z.object({ username: Username })).mutation(({ ctx, input }) => {
    try {
      return startJob(ctx.user.id, input.username, { timeoutMs: pages.timeoutMs, concurrency: pages.concurrency });
    } catch (e) {
      if (e instanceof PagesBusy) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'PAGES_BUSY', cause: e });
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
