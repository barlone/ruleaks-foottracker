import { appConfig } from '../config.ts';
import { GoogleSession } from './session.ts';

// Служебный аккаунт Google — один на процесс: им пользуются «Поиск по Google» (Gaia ID, Drive) и «Поиск по Email»
// (часть отчёта ghunt email). Поэтому и сессия (токены, cookie), и очередь запросов у них общие: Google карает
// частые запросы от одного аккаунта и адреса блокировкой, и два раздела не должны слать их одновременно.

let session: GoogleSession | null | undefined;

/** Сессия служебного аккаунта ([google-search] master-token); null — токена нет (виды с аккаунтом — имитация). */
export function googleSession(): GoogleSession | null {
  if (session === undefined) {
    const token = appConfig.google.masterToken;
    session = token ? new GoogleSession(token, (msg) => console.log(msg)) : null;
  }
  return session;
}

/** Хвост очереди: каждая работа ждёт окончания предыдущей. */
let tail: Promise<unknown> = Promise.resolve();
let lastRunAt = 0;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

export class SlotCancelled extends Error {
  constructor() {
    super('отменено в очереди Google');
  }
}

/**
 * Выполняет работу с аккаунтом Google в общей очереди: после всех поставленных раньше и не раньше minIntervalMs после
 * окончания предыдущей. Отменённая до своей очереди работа не выполняется (SlotCancelled) и паузы не продлевает.
 */
export function googleSlot<T>(minIntervalMs: number, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const p = tail.then(async () => {
    await sleep(lastRunAt + minIntervalMs - Date.now(), signal);
    if (signal.aborted) throw new SlotCancelled();
    try {
      return await fn();
    } finally {
      lastRunAt = Date.now();
    }
  });
  tail = p.catch(() => undefined);
  return p;
}
