import { randomBytes } from 'node:crypto';
import { EMAIL_PARTS, type EmailPartId, type EmailPartState, type EmailReport, type ParsedEmail } from '@ft/shared';
import { emptyReport, hitsOf, huntEmail, skipReasons, type HuntOptions } from './report.ts';

// Задания «Поиска по Email» — в памяти сервера, как у поиска личных страниц и по Google: отчёт нужен тому, кто искал,
// перезапуск сервера всё забывает. У пользователя — один незавершённый поиск (новый снимает прежний), во всём
// процессе — не больше MAX_RUNNING (каждый — десятки исходящих запросов). Часть «аккаунт Google» встаёт в общую
// очередь служебного аккаунта (google/account.ts), остальные идут сразу.

export type EmailJobState = 'running' | 'done' | 'failed' | 'cancelled';

interface Part {
  id: EmailPartId;
  state: EmailPartState;
  /** Что сейчас делается в части (шаг Google, «12 из 18» сайтов). */
  note: string | null;
}

interface Job {
  id: string;
  userId: string;
  email: string;
  state: EmailJobState;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  report: EmailReport;
  parts: Part[];
  ctrl: AbortController;
  touched: number;
}

export interface EmailJobView {
  id: string;
  email: string;
  state: EmailJobState;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  parts: Part[];
  /** Готовых частей из всех — для индикатора. */
  partsDone: number;
  partsTotal: number;
  /** Отчёт — когда поиск закончен (пока идёт — только ход частей: опрос раз в секунду). */
  report: EmailReport | null;
}

export interface EmailJobSummary {
  id: string;
  email: string;
  state: EmailJobState;
  startedAt: string;
  /** Находок (null — поиск не закончен). */
  hits: number | null;
}

/** Сколько поисков одновременно во всём процессе. */
export const MAX_RUNNING = 4;
const PER_USER = 20;
const TTL_MS = 60 * 60_000;
const SWEEP_MS = 60_000;

export class EmailBusy extends Error {
  constructor() {
    super('EMAIL_BUSY');
  }
}

const jobs = new Map<string, Job>();

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.state !== 'running' && now - j.touched > TTL_MS) jobs.delete(id);
}

setInterval(sweep, SWEEP_MS).unref();

const mine = (userId: string) => [...jobs.values()].filter((j) => j.userId === userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

function finish(job: Job, state: Exclude<EmailJobState, 'running'>) {
  if (job.state !== 'running') return;
  job.state = state;
  job.finishedAt = new Date().toISOString();
  job.touched = Date.now();
}

async function run(job: Job, opts: HuntOptions) {
  const { signal } = job.ctrl;
  try {
    await huntEmail(job.report, opts, signal, {
      set(id, state, note = null) {
        const p = job.parts.find((x) => x.id === id);
        if (!p) return;
        p.state = state;
        p.note = state === 'running' ? note : null;
        job.touched = Date.now();
      },
    });
    finish(job, signal.aborted ? 'cancelled' : 'done');
  } catch (e) {
    if (signal.aborted) return finish(job, 'cancelled');
    opts.log(`email: поиск не удался — ${(e as Error)?.message ?? String(e)}`);
    job.error = 'Внутренняя ошибка поиска';
    finish(job, 'failed');
  }
}

/** Запускает поиск; прежний незавершённый поиск пользователя останавливается. */
export function startJob(userId: string, parsed: ParsedEmail, opts: HuntOptions): EmailJobView {
  sweep();
  for (const j of mine(userId)) if (j.state === 'running') cancelJob(userId, j.id);
  if ([...jobs.values()].filter((j) => j.state === 'running').length >= MAX_RUNNING) throw new EmailBusy();
  for (const j of mine(userId).slice(PER_USER - 1)) jobs.delete(j.id);

  const report = emptyReport(parsed);
  const skip = skipReasons(opts, report.domain.kind);
  const job: Job = {
    id: randomBytes(12).toString('base64url'),
    userId,
    email: parsed.email,
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    report,
    parts: EMAIL_PARTS.map((p) => ({ id: p.id, state: skip[p.id] ? 'skipped' : 'pending', note: null })),
    ctrl: new AbortController(),
    touched: Date.now(),
  };
  jobs.set(job.id, job);
  void run(job, opts).catch(() => finish(job, 'failed'));
  return view(job);
}

/** null — нет такого задания у этого пользователя. */
export function getJob(userId: string, id: string): EmailJobView | null {
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

export function recentJobs(userId: string): EmailJobSummary[] {
  sweep();
  return mine(userId).map((j) => ({ id: j.id, email: j.email, state: j.state, startedAt: j.startedAt, hits: j.state === 'done' ? hitsOf(j.report) : null }));
}

function view(j: Job): EmailJobView {
  const active = j.parts.filter((p) => p.state !== 'skipped');
  return {
    id: j.id, email: j.email, state: j.state, startedAt: j.startedAt, finishedAt: j.finishedAt, error: j.error,
    parts: j.parts.map((p) => ({ ...p })),
    partsDone: active.filter((p) => p.state === 'done').length,
    partsTotal: active.length,
    report: j.state === 'running' ? null : j.report,
  };
}
