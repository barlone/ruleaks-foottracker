import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '@ft/config';
import { ARCHIVE_FORMATS, type ArchiveFormat, type ArchiveJobState, type ArchiveJobView, type ArchivePartView, isArchiveActive } from '@ft/shared';
import { alert, errorLine } from '../alerting.ts';
import { SiteArchiveError, type ArchiveFile, type SiteArchiver } from '../ports.ts';

// Задания архивации страниц — в памяти сервера, как задания поиска личных страниц: архив нужен тому, кто его
// заказал, пока он не скачал файлы. Задание ведёт сам сервер (опрос службы раз в poll-interval), а не опросы
// браузера: окно ожидания можно скрыть и закрыть досье, захват идёт дальше.
// Перезапуск сервера всё забывает; осиротевший crawl служба удалит сама (DELETE_AFTER, docs/ARCHITECTURE.md форка).
// Готовые файлы живут keep-min, затем crawl удаляется из службы. Одновременно — MAX_RUNNING на процесс
// (у службы один Chrome на 1–2 захвата) и PER_USER на пользователя.

type Cfg = AppConfig['siteArchive'];

export const MAX_RUNNING = 4;
const PER_USER_RUNNING = 2;
/** Сколько заданий (с завершёнными) помнить на пользователя. */
const PER_USER = 30;
const SWEEP_MS = 60_000;

export class ArchiveRefused extends Error {}

interface Part {
  status: ArchivePartView['status'];
  error: string | null;
  file: ArchiveFile | null;
  sha256: string | null;
}

interface Job {
  id: string;
  userId: string;
  dossierId: string;
  itemId: string;
  url: string;
  formats: ArchiveFormat[];
  state: ArchiveJobState;
  startedAt: string;
  finishedAt: string | null;
  expiresAt: number | null;
  parts: Map<ArchiveFormat, Part>;
  error: string | null;
  ref: string | null;
  ctrl: AbortController;
}

const jobs = new Map<string, Job>();

let archiver: SiteArchiver | null = null;
let cfg: Cfg;

/** Подключение службы (deps.siteArchive) и настроек; вызывается при старте сервера. */
export function initArchiveJobs(a: SiteArchiver | null, c: Cfg) {
  archiver = a;
  cfg = c;
}

setInterval(() => void sweep(), SWEEP_MS).unref();

async function sweep() {
  const now = Date.now();
  for (const j of jobs.values()) {
    if (j.expiresAt !== null && now > j.expiresAt) {
      jobs.delete(j.id);
      void dropCapture(j);
    }
  }
}

/** Удалить захват из службы (файлы, логи, строку с адресом цели). Ошибка — только в журнал службы и алерт. */
async function dropCapture(j: Job) {
  const ref = j.ref;
  if (!ref || !archiver) return;
  j.ref = null;
  try {
    await archiver.remove(ref);
  } catch (e) {
    console.warn(`site-archive: не удалось удалить crawl ${ref}: ${errorLine(e)}`);
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      done();
    }, { once: true });
  });

function finish(j: Job, state: 'done' | 'failed' | 'cancelled', error: string | null = null) {
  if (!isArchiveActive(j.state)) return;
  j.state = state;
  j.error = error;
  j.finishedAt = new Date().toISOString();
  // Файлы ждут скачивания keep-min; без файлов задание просто остаётся в списке на то же время.
  j.expiresAt = Date.now() + cfg.keepMs;
  for (const p of j.parts.values()) if (p.status === 'pending' || p.status === 'running') p.status = state === 'cancelled' ? 'skipped' : 'failed';
}

async function sha256(file: ArchiveFile): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of file.open()) h.update(chunk as Buffer);
  return h.digest('hex');
}

const errorCode = (e: unknown) =>
  e instanceof SiteArchiveError ? (e.code === 'TIMEOUT' || e.code === 'NET' ? 'ARCHIVE_UNAVAILABLE' : e.code === 'AUTH' ? 'ARCHIVE_UNAVAILABLE' : 'ARCHIVE_FAILED') : 'ARCHIVE_FAILED';

async function run(j: Job) {
  const a = archiver!;
  const { signal } = j.ctrl;
  const deadline = Date.now() + cfg.jobTimeoutMs;
  try {
    j.ref = await a.start(j.url, j.formats, signal);
    if (signal.aborted) return void dropCapture(j);
    let fails = 0;
    for (;;) {
      await sleep(cfg.pollIntervalMs, signal);
      if (signal.aborted) return void dropCapture(j);
      if (Date.now() > deadline) {
        finish(j, 'failed', 'ARCHIVE_TIMEOUT');
        return void dropCapture(j);
      }
      let p;
      try {
        p = await a.poll(j.ref, signal);
        fails = 0;
      } catch (e) {
        // Короткий сбой связи — не повод бросать захват; несколько подряд — служба лежит.
        if (signal.aborted) return void dropCapture(j);
        if (++fails < 5) continue;
        throw e;
      }
      j.state = p.stage === 'queued' ? 'queued' : 'capturing';
      for (const f of j.formats) {
        const got = p.parts[f];
        if (got) Object.assign(j.parts.get(f)!, { status: got.status, error: got.error, file: got.file });
      }
      if (p.stage !== 'done') continue;
      j.state = 'finishing';
      for (const part of j.parts.values()) {
        if (part.status === 'ok' && part.file) part.sha256 = await sha256(part.file);
        else if (part.status === 'ok') part.status = 'failed';
      }
      const anyOk = [...j.parts.values()].some((x) => x.status === 'ok');
      finish(j, anyOk ? 'done' : 'failed', anyOk ? null : 'ARCHIVE_NO_FILES');
      // Ни одного файла — хранить в службе нечего.
      if (!anyOk) void dropCapture(j);
      return;
    }
  } catch (e) {
    if (signal.aborted) return void dropCapture(j);
    const msg = errorLine(e);
    console.warn(`site-archive: задание ${j.id}: ${msg}`);
    if (e instanceof SiteArchiveError && e.code !== 'PARSE') alert(`site-archive:${e.code}`, `Служба архивации страниц: ${msg}`);
    finish(j, 'failed', errorCode(e));
    void dropCapture(j);
  }
}

const mine = (userId: string) => [...jobs.values()].filter((j) => j.userId === userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

/** Ставит захват ссылки; уже идущий захват той же ссылки тем же пользователем возвращается как есть. */
export function startArchive(userId: string, t: { dossierId: string; itemId: string; url: string; formats: ArchiveFormat[] }): ArchiveJobView {
  if (!archiver) throw new ArchiveRefused('ARCHIVE_DISABLED');
  const same = mine(userId).find((j) => j.itemId === t.itemId && isArchiveActive(j.state));
  if (same) return view(same);
  if (mine(userId).filter((j) => isArchiveActive(j.state)).length >= PER_USER_RUNNING) throw new ArchiveRefused('ARCHIVE_USER_BUSY');
  if ([...jobs.values()].filter((j) => isArchiveActive(j.state)).length >= MAX_RUNNING) throw new ArchiveRefused('ARCHIVE_BUSY');
  for (const j of mine(userId).filter((x) => !isArchiveActive(x.state)).slice(PER_USER - 1)) {
    jobs.delete(j.id);
    void dropCapture(j);
  }
  const formats = ARCHIVE_FORMATS.filter((f) => t.formats.includes(f));
  const job: Job = {
    id: randomBytes(12).toString('base64url'),
    userId,
    ...t,
    formats,
    state: 'queued',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    expiresAt: null,
    parts: new Map(formats.map((f) => [f, { status: 'pending', error: null, file: null, sha256: null }])),
    error: null,
    ref: null,
    ctrl: new AbortController(),
  };
  jobs.set(job.id, job);
  void run(job);
  return view(job);
}

export function archiveJob(userId: string, id: string): ArchiveJobView | null {
  const j = jobs.get(id);
  return j && j.userId === userId ? view(j) : null;
}

/** Задания пользователя по досье — для строк раздела «Ссылки». */
export function dossierArchives(userId: string, dossierId: string): ArchiveJobView[] {
  return mine(userId).filter((j) => j.dossierId === dossierId).map(view);
}

export function cancelArchive(userId: string, id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.userId !== userId || !isArchiveActive(j.state)) return false;
  j.ctrl.abort();
  finish(j, 'cancelled');
  void dropCapture(j);
  return true;
}

/** Убрать задание из списка (и файлы из службы) раньше срока. */
export function dismissArchive(userId: string, id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.userId !== userId) return false;
  if (isArchiveActive(j.state)) cancelArchive(userId, id);
  jobs.delete(id);
  void dropCapture(j);
  return true;
}

/** Файл готового задания для скачивания (маршрут /site-archive/…); null — нет или срок вышел. */
export function archiveFile(userId: string, id: string, format: ArchiveFormat): { job: ArchiveJobView; file: ArchiveFile } | null {
  const j = jobs.get(id);
  if (!j || j.userId !== userId || j.state !== 'done' || (j.expiresAt !== null && Date.now() > j.expiresAt)) return null;
  const p = j.parts.get(format);
  return p?.status === 'ok' && p.file ? { job: view(j), file: p.file } : null;
}

function view(j: Job): ArchiveJobView {
  return {
    id: j.id,
    dossierId: j.dossierId,
    itemId: j.itemId,
    url: j.url,
    formats: j.formats,
    state: j.state,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    expiresAt: j.expiresAt === null ? null : new Date(j.expiresAt).toISOString(),
    parts: j.formats.map((f) => {
      const p = j.parts.get(f)!;
      return { format: f, status: p.status, error: p.error, size: p.file?.size ?? null, sha256: p.sha256 };
    }),
    error: j.error,
  };
}
