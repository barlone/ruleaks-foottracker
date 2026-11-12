import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { GOOGLE_MODE_IDS, GOOGLE_QUERY_MAX, googleQueryProblem, normalizeGoogleQuery } from '@ft/shared';
import { appConfig } from '../config.ts';
import { GhuntHunter, type GoogleHunter } from '../google/hunter.ts';
import { cancelJob, getJob, GoogleBusy, recentJobs, startJob } from '../google/jobs.ts';
import { GoogleSession } from '../google/session.ts';
import { activeProcedure, authedProcedure, router } from '../trpc.ts';

// «Поиск по Google» — перенос GHunt (apps/server/src/google). Запросы к Google делает сервер; виды со служебным
// аккаунтом ([google-search] master-token) — от его имени, без токена они отвечают имитацией (google/demo.ts),
// а Wi-Fi BSSID и Digital Asset Links ходят в открытые API и работают всегда. Задание живёт в памяти
// (google/jobs.ts), браузер его опрашивает. Раздел выключается флагом [config] google-search: config → null,
// остальное — GOOGLE_DISABLED.

const google = appConfig.google;
const log = (msg: string) => console.log(msg);

const hunter: GoogleHunter | null = google.enabled
  ? new GhuntHunter(google.masterToken ? new GoogleSession(google.masterToken, log) : null, { reverseGeocodeUrl: google.reverseGeocodeUrl, log })
  : null;

const JobId = z.string().min(1).max(64);
const Start = z.object({ mode: z.enum(GOOGLE_MODE_IDS), query: z.string().trim().min(1).max(GOOGLE_QUERY_MAX) })
  .refine((v) => !googleQueryProblem(v.mode, v.query), 'BAD_QUERY');

const enabledProcedure = activeProcedure.use(({ next }) => {
  if (!hunter) throw new TRPCError({ code: 'NOT_FOUND', message: 'GOOGLE_DISABLED' });
  return next();
});

export const googleRouter = router({
  /** null — раздел выключен. demoModes — виды, отвечающие вымышленными данными (нет мастер-токена). */
  config: authedProcedure.query(() => (hunter ? { demoModes: [...hunter.demoModes], timeoutSec: google.timeoutMs / 1000, reverseGeocode: !!google.reverseGeocodeUrl } : null)),

  start: enabledProcedure.input(Start).mutation(({ ctx, input }) => {
    try {
      // Один и тот же запрос — в одном виде (адрес в нижнем регистре, MAC через двоеточия…): в истории и отчёте.
      return startJob(ctx.user.id, input.mode, normalizeGoogleQuery(input.mode, input.query), hunter!, { timeoutMs: google.timeoutMs, minIntervalMs: google.minIntervalMs, log });
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
