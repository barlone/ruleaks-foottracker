import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { GOOGLE_QUERY_MAX, googleQueryProblem } from '@ft/shared';
import { appConfig } from '../config.ts';
import { DemoHunter } from '../google/demo.ts';
import { GhuntHunter, type GoogleHunter } from '../google/email.ts';
import { cancelJob, getJob, GoogleBusy, recentJobs, startJob } from '../google/jobs.ts';
import { GoogleSession } from '../google/session.ts';
import { activeProcedure, authedProcedure, router } from '../trpc.ts';

// «Поиск по Google» — перенос GHunt (apps/server/src/google). Запросы к Google делает сервер от имени одного
// служебного аккаунта ([google-search] master-token); задание живёт в памяти (google/jobs.ts), браузер его опрашивает.
// Раздел выключается флагом [config] google-search: тогда config → null, остальное — GOOGLE_DISABLED.
// Без мастер-токена раздел работает в режиме имитации (google/demo.ts) — как шлюз при [api] enabled = false.

const google = appConfig.google;
const log = (msg: string) => console.log(msg);

const hunter: GoogleHunter | null = !google.enabled ? null : google.masterToken ? new GhuntHunter(new GoogleSession(google.masterToken, log), log) : new DemoHunter();

const JobId = z.string().min(1).max(64);
// Пока перенесён один вид поиска GHunt — по e-mail; остальные кнопки в вебе выключены (GOOGLE_MODES.ready).
const Start = z.object({ mode: z.literal('email'), query: z.string().trim().min(1).max(GOOGLE_QUERY_MAX) })
  .refine((v) => !googleQueryProblem(v.mode, v.query), 'BAD_QUERY');

const enabledProcedure = activeProcedure.use(({ next }) => {
  if (!hunter) throw new TRPCError({ code: 'NOT_FOUND', message: 'GOOGLE_DISABLED' });
  return next();
});

export const googleRouter = router({
  /** null — раздел выключен. demo — ответы вымышленные (нет мастер-токена). */
  config: authedProcedure.query(() => (hunter ? { demo: hunter.demo, timeoutSec: google.timeoutMs / 1000 } : null)),

  start: enabledProcedure.input(Start).mutation(({ ctx, input }) => {
    try {
      // Адреса Google не различают регистр — в истории и отчёте адрес в одном виде.
      return startJob(ctx.user.id, input.mode, input.query.toLowerCase(), hunter!, { timeoutMs: google.timeoutMs, minIntervalMs: google.minIntervalMs, log });
    } catch (e) {
      if (e instanceof GoogleBusy) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'GOOGLE_BUSY', cause: e });
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
