// Запросы «Поиска по Email» к внешним сервисам (HIBP, BreachDirectory, IntelX, psbdmp, EmailRep, Hunter, ipapi,
// DuckDuckGo). Адреса сервисов зашиты в коде, поэтому — обычный fetch, но без следования редиректам: сервис,
// ответивший редиректом, ответил не то (а увести сервер на внутренний адрес ему незачем позволять). Ответ читается
// с пределом размера, ошибки сводятся к кодам EmailError; пользователю — общий текст (emailErrorText), подробности —
// в журнал сервера.

export interface Ctx {
  timeoutMs: number;
  signal: AbortSignal;
}

export type EmailErrorCode = 'AUTH' | 'LIMIT' | 'TIMEOUT' | 'HTTP' | 'PARSE' | 'NET';

export class EmailError extends Error {
  readonly code: EmailErrorCode;

  constructor(code: EmailErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Представляемся честно и без сведений о сайте и пользователе: части сервисов (HIBP, EmailRep) User-Agent обязателен. */
export const API_USER_AGENT = 'foottracker-email-osint/1.0';
/** Для страниц, которые без браузерного User-Agent отвечают иначе (выдача DuckDuckGo). */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';

const MAX_BODY = 4 * 1024 * 1024;

/** Сигнал запроса: отмена поиска или таймаут одного запроса. */
export const requestSignal = (ctx: Ctx) => AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.timeoutMs)]);

function netError(e: unknown, what: string): Error {
  if (e instanceof EmailError) return e;
  const err = e as Error;
  if (err?.name === 'TimeoutError') return new EmailError('TIMEOUT', `${what}: нет ответа за отведённое время`);
  if (err?.name === 'AbortError') return err;
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  return new EmailError('NET', `${what}: ${cause?.code ?? ''} ${cause?.message ?? err?.message ?? String(e)}`.trim());
}

export interface XInit {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
}

/** fetch без редиректов, с таймаутом и отменой; сетевые сбои — EmailError NET / TIMEOUT. */
export async function xfetch(url: string, init: XInit, ctx: Ctx, what: string): Promise<Response> {
  try {
    return await fetch(url, { method: init.method ?? 'GET', headers: { 'User-Agent': API_USER_AGENT, ...init.headers }, body: init.body, redirect: 'manual', signal: requestSignal(ctx) });
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    throw netError(e, what);
  }
}

/** Тело ответа текстом (не больше max байт); обрыв и таймаут чтения — EmailError. */
export async function readText(res: Response, ctx: Ctx, what: string, max = MAX_BODY): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size >= max) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    throw netError(e, what);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

export async function readJson(res: Response, ctx: Ctx, what: string): Promise<unknown> {
  const text = await readText(res, ctx, what);
  try {
    return JSON.parse(text);
  } catch {
    throw new EmailError('PARSE', `${what}: ответ не JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Неуспешный ответ → ошибка: 401/403 — ключ не принят, 429 — превышен лимит запросов, остальное — HTTP. */
export async function statusError(res: Response, ctx: Ctx, what: string): Promise<EmailError> {
  const body = (await readText(res, ctx, what, 2048).catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
  const msg = `${what}: HTTP ${res.status} ${body}`;
  if (res.status === 401 || res.status === 403) return new EmailError('AUTH', msg);
  if (res.status === 429) return new EmailError('LIMIT', msg);
  return new EmailError('HTTP', msg);
}

/** Текст ошибки для пользователя. */
export function emailErrorText(e: unknown): string {
  if (!(e instanceof EmailError)) return 'Внутренняя ошибка проверки';
  switch (e.code) {
    case 'AUTH': return 'Сервис не принял ключ API сайта — проверка недоступна, пока администратор не обновит ключ';
    case 'LIMIT': return 'Исчерпан лимит запросов к сервису — повторите позже';
    case 'TIMEOUT': return 'Сервис не ответил вовремя — повторите поиск';
    case 'NET': return 'Сервис недоступен — нет соединения';
    default: return 'Сервис ответил не так, как ожидалось — возможно, он изменился или закрыт';
  }
}

// Помощники разбора чужого JSON: значение нужного типа или null.
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
export const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
export const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason as Error);
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason as Error);
    }, { once: true });
  });
