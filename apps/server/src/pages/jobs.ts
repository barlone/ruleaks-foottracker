import { randomBytes } from 'node:crypto';
import { checkSite, type SiteResult } from './check.ts';
import { allSites } from './sites.ts';

// Задания поиска личных страниц — в памяти сервера (как загрузки импорта): результат нужен только
// тому, кто искал, и пока он смотрит страницу. Перезапуск сервера всё забывает.
// У пользователя идёт не больше одного поиска (новый останавливает прежний), во всём процессе —
// не больше MAX_RUNNING: каждый поиск — это сотни исходящих запросов параллельно.

export type JobState = 'running' | 'done' | 'cancelled';

export interface PagesJob {
  id: string;
  userId: string;
  username: string;
  state: JobState;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  /** Результаты в порядке получения ответов. */
  results: SiteResult[];
  ctrl: AbortController;
  touched: number;
}

/** Что видит браузер. Полный список результатов — только у завершённого задания: опрос идёт каждую секунду. */
export interface PagesJobView {
  id: string;
  username: string;
  state: JobState;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  /** Найденные страницы (пока идёт поиск — пополняется). */
  found: SiteResult[];
  /** Все проверки, когда поиск закончен. */
  results: SiteResult[] | null;
}

export interface PagesJobSummary {
  id: string;
  username: string;
  state: JobState;
  startedAt: string;
  done: number;
  total: number;
  found: number;
}

export interface JobsOptions {
  timeoutMs: number;
  concurrency: number;
}

/** Сколько поисков одновременно во всём процессе. */
export const MAX_RUNNING = 4;
/** Сколько завершённых заданий помнить на пользователя. */
const PER_USER = 20;
/** Завершённое задание живёт столько после последнего обращения. */
const TTL_MS = 60 * 60_000;
const SWEEP_MS = 60_000;

export class PagesBusy extends Error {
  constructor() {
    super('PAGES_BUSY');
  }
}

const jobs = new Map<string, PagesJob>();

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.state !== 'running' && now - j.touched > TTL_MS) jobs.delete(id);
}

setInterval(sweep, SWEEP_MS).unref();

const mine = (userId: string) => [...jobs.values()].filter((j) => j.userId === userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

function finish(job: PagesJob, state: Exclude<JobState, 'running'>) {
  if (job.state !== 'running') return;
  job.state = state;
  job.finishedAt = new Date().toISOString();
  job.touched = Date.now();
}

async function run(job: PagesJob, username: string, opts: JobsOptions) {
  const sites = allSites();
  const { signal } = job.ctrl;
  let next = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const site = sites[next++];
      if (!site) return;
      const r = await checkSite(site, username, { timeoutMs: opts.timeoutMs, signal });
      if (signal.aborted) return;
      job.results.push(r);
      job.touched = Date.now();
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, sites.length) }, worker));
  finish(job, signal.aborted ? 'cancelled' : 'done');
}

/** Запускает поиск; прежний незавершённый поиск пользователя останавливается. */
export function startJob(userId: string, username: string, opts: JobsOptions): PagesJobView {
  sweep();
  for (const j of mine(userId)) if (j.state === 'running') cancelJob(userId, j.id);
  if ([...jobs.values()].filter((j) => j.state === 'running').length >= MAX_RUNNING) throw new PagesBusy();
  // Лишние завершённые — долой (самые старые).
  for (const j of mine(userId).slice(PER_USER - 1)) jobs.delete(j.id);

  const job: PagesJob = {
    id: randomBytes(12).toString('base64url'),
    userId,
    username,
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: allSites().length,
    results: [],
    ctrl: new AbortController(),
    touched: Date.now(),
  };
  jobs.set(job.id, job);
  void run(job, username, opts).catch(() => finish(job, 'done'));
  return view(job);
}

/** null — нет такого задания у этого пользователя. */
export function getJob(userId: string, id: string): PagesJobView | null {
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

export function recentJobs(userId: string): PagesJobSummary[] {
  sweep();
  return mine(userId).map((j) => ({
    id: j.id, username: j.username, state: j.state, startedAt: j.startedAt, done: j.results.length, total: j.total,
    found: j.results.filter((r) => r.status === 'claimed').length,
  }));
}

function view(j: PagesJob): PagesJobView {
  return {
    id: j.id,
    username: j.username,
    state: j.state,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    total: j.total,
    done: j.results.length,
    found: j.results.filter((r) => r.status === 'claimed'),
    results: j.state === 'running' ? null : j.results,
  };
}
