import type { FastifyInstance } from 'fastify';
import { ARCHIVE_FORMATS, ARCHIVE_FORMAT_EXT, type ArchiveFormat } from '@ft/shared';
import { archiveFile } from './archive/jobs.ts';
import type { Deps } from './ports.ts';
import { sessionOf } from './trpc.ts';

// Файлы готовых архивов страниц: GET /site-archive/<задание>/<pdf|wacz>[?inline=1]. Только тому, кто заказал
// архив, и пока файлы не удалены (keep-min). PDF можно открыть во вкладке (inline), WACZ — только скачать:
// его содержимое — чужие страницы со скриптами, а показывать их будет отдельный плеер на своём поддомене.
// Vite проксирует /site-archive, на проде — nginx (deploy/nginx).

export const ARCHIVE_FILES_PATH = '/site-archive';

const MIME: Record<ArchiveFormat, string> = { pdf: 'application/pdf', wacz: 'application/zip' };

/** «example.com 2026-11-18.pdf» — домен страницы и дата архива. */
function fileName(url: string, at: string, format: ArchiveFormat): string {
  let host = 'page';
  try {
    host = new URL(url).hostname.replace(/^www\./, '') || host;
  } catch {
    // адрес проверен при постановке
  }
  return `${host} ${at.slice(0, 10)}.${ARCHIVE_FORMAT_EXT[format]}`;
}

export function registerArchiveFiles(app: FastifyInstance, deps: Deps) {
  if (!deps.siteArchive) return;

  app.get<{ Params: { id: string; format: string }; Querystring: { inline?: string } }>(`${ARCHIVE_FILES_PATH}/:id/:format`, async (req, reply) => {
    const { userId } = await sessionOf(deps, req);
    if (!userId) return reply.code(401).send();
    const format = req.params.format as ArchiveFormat;
    if (!ARCHIVE_FORMATS.includes(format)) return reply.code(404).send();
    const got = archiveFile(userId, req.params.id, format);
    if (!got) return reply.code(404).header('Cache-Control', 'no-store').send();

    const name = fileName(got.job.url, got.job.finishedAt ?? got.job.startedAt, format);
    const inline = format === 'pdf' && req.query.inline === '1';
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    reply
      .header('Content-Type', MIME[format])
      .header('Content-Length', got.file.size)
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return reply.send(got.file.open());
  });
}
