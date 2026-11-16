import { randomBytes } from 'node:crypto';
import { GOOGLE_STEPS, type GoogleModeId, type GoogleReport, type GoogleStepId } from '@ft/shared';
import { googleSlot } from './account.ts';
import { alertGoogleAccount, googleErrorText, type GoogleHunter } from './hunter.ts';

// Задания «Поиска по Google» — в памяти сервера, как у поиска личных страниц: результат нужен тому, кто искал,
// перезапуск сервера всё забывает. Все запросы идут от одного служебного аккаунта Google, поэтому поиски
// выполняются строго по очереди, с паузой между ними (googleSlot — общая с «Поиском по Email» очередь): частые
// запросы Google карает блокировкой аккаунта и адреса сервера. У пользователя — один незавершённый поиск (новый
// снимает прежний).

export type GoogleJobState = 'running' | 'done' | 'failed' | 'cancelled';

interface Job {
  id: string;
  userId: string;
  mode: GoogleModeId;
  query: string;
  state: GoogleJobState;
  /** queue — ждёт своей очереди. */
  step: GoogleStepId | 'queue';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  report: GoogleReport | null;
  ctrl: AbortController;
  touched: number;
}

export interface GoogleJobView {
  id: string;
  mode: GoogleModeId;
  query: string;
  state: GoogleJobState;
  step: GoogleStepId | 'queue';
  /** Сколько шагов пройдено из stepsTotal — для индикатора. */
  stepsDone: number;
  stepsTotal: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  report: GoogleReport | null;
}

export interface GoogleJobSummary {
  id: string;
  mode: GoogleModeId;
  query: string;
  state: GoogleJobState;
  startedAt: string;
  /** null — поиск не закончен или не удался. */
  found: boolean | null;
}

export interface GoogleJobsOptions {
  timeoutMs: number;
  minIntervalMs: number;
  log: (msg: string) => void;
}

/** Сколько поисков может ждать и выполняться во всём процессе. */
export const MAX_PENDING = 8;
/** Сколько завершённых заданий помнить на пользователя. */
const PER_USER = 20;
/** Завершённое задание живёт столько после последнего обращения. */
const TTL_MS = 60 * 60_000;
const SWEEP_MS = 60_000;

export class GoogleBusy extends Error {
  constructor() {
    super('GOOGLE_BUSY');
  }
}

const jobs = new Map<string, Job>();

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.state !== 'running' && now - j.touched > TTL_MS) jobs.delete(id);
}

setInterval(sweep, SWEEP_MS).unref();

const mine = (userId: string) => [...jobs.values()].filter((j) => j.userId === userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

function finish(job: Job, state: Exclude<GoogleJobState, 'running'>) {
  if (job.state !== 'running') return;
  job.state = state;
  job.finishedAt = new Date().toISOString();
  job.touched = Date.now();
}

async function run(job: Job, hunter: GoogleHunter, opts: GoogleJobsOptions) {
  const { signal } = job.ctrl;
  try {
    job.report = await googleSlot(opts.minIntervalMs, signal, () => hunter.run(job.mode, job.query, { timeoutMs: opts.timeoutMs, signal }, (step) => {
      job.step = step;
      job.touched = Date.now();
    }));
    finish(job, signal.aborted ? 'cancelled' : 'done');
  } catch (e) {
    if (signal.aborted) return finish(job, 'cancelled');
    opts.log(`google: поиск не удался — ${(e as Error)?.message ?? String(e)}`);
    alertGoogleAccount(e);
    job.error = googleErrorText(e);
    finish(job, 'failed');
  }
}

/** Ставит поиск в очередь; прежний незавершённый поиск пользователя снимается. */
export function startJob(userId: string, mode: GoogleModeId, query: string, hunter: GoogleHunter, opts: GoogleJobsOptions): GoogleJobView {
  sweep();
  for (const j of mine(userId)) if (j.state === 'running') cancelJob(userId, j.id);
  if ([...jobs.values()].filter((j) => j.state === 'running').length >= MAX_PENDING) throw new GoogleBusy();
  for (const j of mine(userId).slice(PER_USER - 1)) jobs.delete(j.id);

  const job: Job = {
    id: randomBytes(12).toString('base64url'),
    userId, mode, query,
    state: 'running',
    step: 'queue',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    report: null,
    ctrl: new AbortController(),
    touched: Date.now(),
  };
  jobs.set(job.id, job);
  void run(job, hunter, opts).catch(() => finish(job, 'failed'));
  return view(job);
}

/** null — нет такого задания у этого пользователя. */
export function getJob(userId: string, id: string): GoogleJobView | null {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return null;
  j.touched = Date.now();
  return view(j);
}

export function cancelJob(userId: string, id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.userId !== userId || j.state !== 'running') return false;
  j.ctrl.abort();
  finish(j, 'cancelled');
  return true;
}

export function recentJobs(userId: string): GoogleJobSummary[] {
  sweep();
  return mine(userId).map((j) => ({ id: j.id, mode: j.mode, query: j.query, state: j.state, startedAt: j.startedAt, found: j.report ? j.report.found : null }));
}

function view(j: Job): GoogleJobView {
  const steps: readonly { id: string }[] = GOOGLE_STEPS[j.mode];
  const index = steps.findIndex((s) => s.id === j.step);
  return {
    id: j.id, mode: j.mode, query: j.query, state: j.state, step: j.step,
    stepsDone: j.state === 'done' ? steps.length : Math.max(0, index),
    stepsTotal: steps.length,
    startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error, report: j.report,
  };
}
