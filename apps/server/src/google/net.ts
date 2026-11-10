import { connect } from 'node:http2';

// Сеть для «Поиска по Google»: fetch без следования редиректам (как httpx в GHunt — по редиректу Google
// сообщает о капче и о недействительных cookie), таймаут на запрос, отмена задания и список разрешённых хостов.

export type GoogleErrorCode = 'AUTH' | 'BLOCKED' | 'TIMEOUT' | 'HTTP' | 'PARSE';

/** Ошибка запроса к Google. message — подробности для журнала сервера; пользователю показывается текст по code. */
export class GoogleError extends Error {
  readonly code: GoogleErrorCode;
  constructor(code: GoogleErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Ctx {
  timeoutMs: number;
  /** Отмена задания. */
  signal: AbortSignal;
}

/** Куда ходит перенос GHunt. Адреса собираются в коде, но проверка не даёт ошибке в них увести запрос (и токен) в сторону. */
const HOSTS = new Set([
  'android.googleapis.com',
  'accounts.google.com',
  'people-pa.clients6.google.com',
  'clients6.google.com',
  'www.googleapis.com',
  'www.google.com',
  'playgateway-pa.googleapis.com',
]);

function allowed(url: URL) {
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) throw new GoogleError('HTTP', `адрес не разрешён: ${url.origin}`);
}

const signalOf = (ctx: Ctx) => AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.timeoutMs)]);

function netError(e: unknown, ctx: Ctx, what: string): never {
  if (e instanceof GoogleError) throw e;
  if (ctx.signal.aborted) throw e; // отмена задания — не ошибка Google
  const name = (e as Error)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') throw new GoogleError('TIMEOUT', `${what}: нет ответа за ${ctx.timeoutMs / 1000} с`);
  throw new GoogleError('HTTP', `${what}: ${(e as Error)?.message ?? String(e)}`);
}

export interface GInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

/** Запрос к Google. Редирект возвращается как есть; редирект на страницу капчи — ошибка BLOCKED. */
export async function gfetch(url: string | URL, init: GInit, ctx: Ctx): Promise<Response> {
  const u = new URL(url);
  allowed(u);
  let res: Response;
  try {
    res = await fetch(u, { method: init.method ?? 'GET', headers: init.headers, body: init.body, redirect: 'manual', signal: signalOf(ctx) });
  } catch (e) {
    netError(e, ctx, u.hostname);
  }
  if (res.status >= 300 && res.status < 400 && (res.headers.get('location') ?? '').startsWith('https://www.google.com/sorry')) {
    await res.body?.cancel().catch(() => undefined);
    throw new GoogleError('BLOCKED', `${u.hostname}: Google требует капчу`);
  }
  return res;
}

/** Тело ответа текстом; сетевой сбой посреди чтения — ошибка Google, а не необработанное исключение. */
export async function bodyText(res: Response, ctx: Ctx): Promise<string> {
  try {
    return await res.text();
  } catch (e) {
    netError(e, ctx, new URL(res.url || 'https://google.com').hostname);
  }
}

/** JSON ответа; префикс защиты от XSSI «)]}'» отбрасывается. */
export async function bodyJson(res: Response, ctx: Ctx): Promise<unknown> {
  const text = (await bodyText(res, ctx)).replace(/^\)\]\}'\s*/, '');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GoogleError('PARSE', `${new URL(res.url || 'https://google.com').hostname}: ответ не JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
}

/** Строка запроса: массив — повтор ключа (как httpx), логическое — true/false. */
export function query(params: Record<string, string | number | boolean | readonly string[]>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const x of v) q.append(k, String(x));
    else q.append(k, String(v));
  }
  return q.toString();
}

export const cookieHeader = (cookies: Record<string, string>) => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

/** Cookie из заголовков Set-Cookie ответа (имя → значение; атрибуты не нужны — cookie идут только на хосты Google). */
export function setCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(';', 1)[0]!;
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Унарный вызов gRPC поверх HTTP/2 (fetch в Node ходит по HTTP/1.1, а gRPC без HTTP/2 не работает).
 * message — сериализованное сообщение Protocol Buffers; возвращается сообщение ответа без 5-байтового префикса.
 */
export function grpcUnary(host: string, path: string, headers: Record<string, string>, message: Buffer, ctx: Ctx): Promise<Buffer> {
  allowed(new URL(`https://${host}`));
  const signal = signalOf(ctx);
  return new Promise<Buffer>((resolve, reject) => {
    const session = connect(`https://${host}`);
    let settled = false;
    const done = (err: unknown, value?: Buffer) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      session.destroy();
      if (!err) return resolve(value!);
      try {
        netError(err, ctx, host);
      } catch (e) {
        reject(e as Error);
      }
    };
    const onAbort = () => done(signal.reason ?? new DOMException('aborted', 'AbortError'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    session.on('error', done);

    const prefix = Buffer.alloc(5); // флаг сжатия (0) + длина сообщения, big-endian
    prefix.writeUInt32BE(message.length, 1);
    const req = session.request({ ':method': 'POST', ':path': path, 'content-type': 'application/grpc', te: 'trailers', ...headers });
    const chunks: Buffer[] = [];
    let status = 0;
    let grpcStatus: string | undefined;
    let grpcMessage: string | undefined;
    const readStatus = (h: Record<string, unknown>) => {
      if (h['grpc-status'] !== undefined) grpcStatus = String(h['grpc-status']);
      if (h['grpc-message'] !== undefined) grpcMessage = String(h['grpc-message']);
    };
    req.on('response', (h) => {
      status = Number(h[':status']);
      readStatus(h); // ответ без тела: статус gRPC приходит сразу в заголовках
    });
    req.on('trailers', readStatus);
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', done);
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (status === 401 || status === 403 || grpcStatus === '16' || grpcStatus === '7') {
        return done(new GoogleError('AUTH', `${host}: отказ в доступе (HTTP ${status}, grpc-status ${grpcStatus ?? '—'}${grpcMessage ? `: ${grpcMessage}` : ''})`));
      }
      if (status !== 200 || (grpcStatus !== undefined && grpcStatus !== '0')) {
        return done(new GoogleError('HTTP', `${host}: HTTP ${status}, grpc-status ${grpcStatus ?? '—'}${grpcMessage ? `: ${grpcMessage}` : ''}`));
      }
      if (body.length < 5) return done(new GoogleError('PARSE', `${host}: пустой ответ gRPC`));
      if (body[0] !== 0) return done(new GoogleError('PARSE', `${host}: сжатый ответ gRPC не поддерживается`));
      const len = body.readUInt32BE(1);
      if (body.length < 5 + len) return done(new GoogleError('PARSE', `${host}: ответ gRPC оборван`));
      done(null, body.subarray(5, 5 + len));
    });
    req.end(Buffer.concat([prefix, message]));
  });
}
