import { Worker } from 'node:worker_threads';
import type { Content } from 'pdfmake/interfaces';

// Клиент воркера вёрстки PDF (pdf/worker.ts): один воркер на процесс, задания выполняются по очереди
// (вёрстка синхронна, второй поток не ускорил бы её, а памяти со шрифтами стоил бы столько же).
// Воркер поднимается при первом отчёте и останавливается после простоя — pdfmake со шрифтами держит десятки МБ.
// Главный поток тем временем свободен: другие пользователи ищут и правят досье, пока строится чей-то отчёт.

/** Задание на вёрстку. Только данные: содержимое уходит через structuredClone, функций в нём быть не может. */
export interface PdfJob {
  title: string;
  /** Подпись в нижнем колонтитуле (название без эмодзи). */
  footerTitle: string;
  author: string;
  note: string;
  password: string;
  content: Content[];
  /**
   * Ограничения для читателя (печать, копирование текста). Нет — печать и копирование разрешены.
   * С ограничениями PDF шифруется и без пароля на открытие: ограничения записаны под случайным паролем владельца.
   */
  permissions?: { printing: 'none' | 'low' | 'high'; copying: boolean };
  landscape?: boolean;
  /** Водяной знак по диагонали каждой страницы. */
  watermark?: string;
}

export type WorkerRequest = { id: number; job: PdfJob };
export type WorkerResponse = { id: number; data: Uint8Array } | { id: number; error: string };

/** Отчёт дольше этого считается зависшим: воркер убивается, все ожидающие получают ошибку. */
const JOB_TIMEOUT_MS = 10 * 60_000;
/** Простой, после которого воркер останавливается (следующий отчёт поднимет его заново, ~1 с). */
const IDLE_MS = 5 * 60_000;

interface Pending {
  resolve: (buf: Buffer) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

let worker: Worker | null = null;
let idle: NodeJS.Timeout | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function fail(e: Error) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(e);
  }
  pending.clear();
  stop();
}

function stop() {
  if (idle) clearTimeout(idle);
  idle = null;
  void worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url));
  // Воркер не держит процесс: при остановке сервера ждать его не нужно.
  w.unref();
  w.on('message', (m: WorkerResponse) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if ('error' in m) p.reject(new Error(m.error));
    else p.resolve(Buffer.from(m.data.buffer, m.data.byteOffset, m.data.byteLength));
    if (!pending.size) {
      if (idle) clearTimeout(idle);
      idle = setTimeout(stop, IDLE_MS);
      idle.unref();
    }
  });
  w.on('error', (e: unknown) => fail(new Error(`Сборка PDF прервана: ${e instanceof Error ? e.message : String(e)}`)));
  w.on('exit', (code) => {
    if (worker === w) worker = null;
    if (pending.size) fail(new Error(`Сборка PDF прервана (поток завершился с кодом ${code})`));
  });
  worker = w;
  return w;
}

/** Собирает PDF в воркере и возвращает его байты. */
export function renderPdf(job: PdfJob): Promise<Buffer> {
  const w = ensureWorker();
  if (idle) clearTimeout(idle);
  idle = null;
  const id = ++seq;
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      fail(new Error('Сборка PDF не уложилась в отведённое время'));
      reject(new Error('Сборка PDF не уложилась в отведённое время'));
    }, JOB_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, job } satisfies WorkerRequest);
  });
}
