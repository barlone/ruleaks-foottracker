import { Readable, Transform } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isUuid } from '@ft/shared';
import { config } from './config.ts';
import { ScanStoreError, type Deps } from './ports.ts';
import { sessionOf } from './trpc.ts';

// Картинки сканов документов ([scanstore-api]): браузер берёт их по /scans/<uuid>, сервер проксирует запрос
// в scanstore со своим токеном. Только вошедшим пользователям — как и сохранённые результаты поиска, откуда
// берутся uuid (подписка не проверяется: при истёкшей сайт доступен на чтение).
// Каждый запрос пишется в лог одной строкой «scans <uuid> → <ответ> …»: по ней видно, дошёл ли запрос
// до сервера, что ответило хранилище и сколько отдано браузеру.

export const SCANS_PATH = '/scans';

/** Почему запрос без сессии: нет cookie, подпись не сходится (сменился cookie-secret / пароль) или сессии нет в базе. */
function noSessionReason(req: FastifyRequest): string {
  const raw = req.cookies[config.sessionCookie];
  if (!raw) return `нет cookie ${config.sessionCookie}`;
  return req.unsignCookie(raw).valid ? 'сессия не найдена или не принята' : 'подпись cookie не сходится';
}

export function registerScanFiles(app: FastifyInstance, deps: Deps) {
  const store = deps.scans;
  if (!store) return;

  app.get<{ Params: { id: string } }>(`${SCANS_PATH}/:id`, async (req, reply) => {
    const t0 = Date.now();
    const id = req.params.id.toLowerCase();
    const log = (level: 'info' | 'warn', msg: string) => req.log[level](`scans ${id} → ${msg} · ${Date.now() - t0} мс`);

    if ((await sessionOf(deps, req)).userId === null) {
      log('warn', `401: ${noSessionReason(req)}`);
      return reply.code(401).send();
    }
    if (!isUuid(id)) {
      log('warn', '404: не uuid');
      return reply.code(404).send();
    }

    let img;
    try {
      // Только ETag (sha256 скана): условный запрос по дате мог бы подтвердить чужой закэшированный ответ (ports.ts).
      img = await store.image(id, { ifNoneMatch: req.headers['if-none-match'] });
    } catch (e) {
      if (!(e instanceof ScanStoreError)) throw e;
      log('warn', `502: ${e.message}`);
      return reply.code(502).send();
    }
    // Скан неизменяем: браузер держит его в кэше сутки и потом перепроверяет по ETag (sha256).
    reply.header('Cache-Control', 'private, max-age=86400');
    if (img.status === 'not-found') {
      log('warn', '404: хранилище не знает этот скан');
      return reply.code(404).header('Cache-Control', 'no-store').send();
    }
    if (img.etag) reply.header('ETag', img.etag);
    if (img.status === 'not-modified') {
      log('info', '304: не изменился (ETag)');
      return reply.code(304).send();
    }
    reply.header('Content-Type', img.contentType).header('X-Content-Type-Options', 'nosniff');
    if (img.length) reply.header('Content-Length', img.length);
    if (img.lastModified) reply.header('Last-Modified', img.lastModified);

    // Сколько байт реально ушло браузеру и не оборвалась ли передача (хранилище или клиент).
    let sent = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        sent += chunk.length;
        cb(null, chunk);
      },
    });
    const body = Readable.fromWeb(img.body as ReadableStream<Uint8Array>);
    body.on('error', (e) => log('warn', `200, обрыв при чтении из хранилища после ${sent} байт: ${e.message}`));
    reply.raw.once('close', () => {
      const whole = reply.raw.writableFinished;
      log(whole ? 'info' : 'warn', `200 ${img.contentType}, ${sent} из ${img.length ?? '?'} байт${whole ? '' : ', передача прервана'}`);
    });
    return reply.send(body.pipe(counter));
  });
}
