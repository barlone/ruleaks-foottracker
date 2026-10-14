import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { isUuid } from '@ft/shared';
import { ScanStoreError } from './adapters/http/scanstore.ts';
import type { Deps } from './ports.ts';
import { sessionOf } from './trpc.ts';

// Картинки сканов документов ([scanstore-api]): браузер берёт их по /scans/<uuid>, сервер проксирует запрос
// в scanstore со своим токеном. Только вошедшим пользователям — как и сохранённые результаты поиска, откуда
// берутся uuid (подписка не проверяется: при истёкшей сайт доступен на чтение).

export const SCANS_PATH = '/scans';

export function registerScanFiles(app: FastifyInstance, deps: Deps) {
  const store = deps.scans;
  if (!store) return;

  app.get<{ Params: { id: string } }>(`${SCANS_PATH}/:id`, async (req, reply) => {
    if ((await sessionOf(deps, req)).userId === null) return reply.code(401).send();
    const id = req.params.id.toLowerCase();
    if (!isUuid(id)) return reply.code(404).send();

    let img;
    try {
      // Только ETag (sha256 скана): условный запрос по дате мог бы подтвердить чужой закэшированный ответ (ports.ts).
      img = await store.image(id, { ifNoneMatch: req.headers['if-none-match'] });
    } catch (e) {
      if (!(e instanceof ScanStoreError)) throw e;
      req.log.warn(`scans: ${e.message}`);
      return reply.code(502).send();
    }
    // Скан неизменяем: браузер держит его в кэше сутки и потом перепроверяет по ETag (sha256).
    reply.header('Cache-Control', 'private, max-age=86400');
    if (img.status === 'not-found') return reply.code(404).header('Cache-Control', 'no-store').send();
    if (img.etag) reply.header('ETag', img.etag);
    if (img.status === 'not-modified') return reply.code(304).send();
    reply.header('Content-Type', img.contentType).header('X-Content-Type-Options', 'nosniff');
    if (img.length) reply.header('Content-Length', img.length);
    if (img.lastModified) reply.header('Last-Modified', img.lastModified);
    return reply.send(Readable.fromWeb(img.body as import('node:stream/web').ReadableStream<Uint8Array>));
  });
}
