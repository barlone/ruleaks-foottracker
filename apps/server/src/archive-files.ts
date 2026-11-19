import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ARCHIVE_FORMATS, type ArchiveFormat } from '@ft/shared';
import { can } from './authz.ts';
import { config } from './config.ts';
import { archiveFile } from './archive/jobs.ts';
import { ARCHIVE_MIME, archiveFileName, contentDisposition } from './archive/names.ts';
import { ARCHIVE_FILES_PATH, DRIVE_CALLBACK_PATH, DRIVE_CONNECT_PATH, SAVED_FILES_PATH } from './archive/paths.ts';
import { DriveError, type Deps } from './ports.ts';
import { sessionOf } from './trpc.ts';

// Файлы архивов страниц и подключение Google Диска — всё под /site-archive/ (Vite и nginx его проксируют):
//  • GET /site-archive/<задание>/<pdf|wacz>[?inline=1] — файлы готового задания, пока они в службе (keep-min); только
//    тому, кто поставил задание;
//  • GET /site-archive/saved/<досье>/<ссылка>/<архив>/<pdf|wacz>[?inline=1] — архив, сохранённый на Google Диск: любому,
//    кто может читать досье, с Диска того, кто снял архив; sha256 сверяется на лету (подменённый файл обрывается);
//  • GET /site-archive/google/connect?back=<путь> → Google (OAuth) → GET /site-archive/google/callback → back.
// PDF можно открыть во вкладке, WACZ — только скачать: в нём чужие страницы со скриптами.

export { ARCHIVE_FILES_PATH };

/** Ошибка подключения Диска, показанная пользователю при следующем запросе состояния (siteArchive.drive). */
const connectErrors = new Map<string, string>();
export const takeConnectError = (userId: string) => {
  const e = connectErrors.get(userId) ?? null;
  connectErrors.delete(userId);
  return e;
};

// --- state OAuth: подписан секретом cookie, одноразовый, 10 минут, привязан к пользователю ---
const STATE_TTL_MS = 10 * 60_000;
const usedNonces = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n);
}, 60_000).unref();

const sign = (payload: string) => createHmac('sha256', `drive-state:${config.cookieSecret}`).update(payload).digest('base64url');

function makeState(userId: string, back: string): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, n: randomBytes(12).toString('base64url'), e: Date.now() + STATE_TTL_MS, b: back })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readState(state: string): { u: string; n: string; e: number; b: string } | null {
  const [payload, sig] = state.split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: string; n: string; e: number; b: string };
    if (s.e < Date.now() || usedNonces.has(s.n)) return null;
    usedNonces.set(s.n, s.e);
    return s;
  } catch {
    return null;
  }
}

/** Куда вернуть после подключения: только путь своего сайта («//чужой.сайт» и «/\…» — нет). */
const safeBack = (b: unknown) => (typeof b === 'string' && /^\/(?![/\\])[^\s]{0,500}$/.test(b) ? b : '/dossiers');

const DRIVE_TEXT: Record<string, string> = {
  NOT_CONNECTED: 'Архив недоступен: тот, кто его снял, отключил свой Google Диск',
  REVOKED: 'Архив недоступен: тот, кто его снял, отозвал доступ к своему Google Диску',
  NOT_FOUND: 'Архив недоступен: файл удалён с Google Диска',
  CHANGED: 'Архив недоступен: файл на Google Диске изменён или не относится к этой ссылке',
};

function plain(reply: FastifyReply, code: number, text: string) {
  return reply.code(code).header('Content-Type', 'text/plain; charset=utf-8').header('Cache-Control', 'no-store').send(text);
}

export function registerArchiveFiles(app: FastifyInstance, deps: Deps) {
  if (!deps.siteArchive) return;

  // Файлы задания — пока они в службе.
  app.get<{ Params: { id: string; format: string }; Querystring: { inline?: string } }>(`${ARCHIVE_FILES_PATH}/:id/:format`, async (req, reply) => {
    const { userId } = await sessionOf(deps, req);
    if (!userId) return reply.code(401).send();
    const format = req.params.format as ArchiveFormat;
    if (!ARCHIVE_FORMATS.includes(format)) return reply.code(404).send();
    const got = archiveFile(userId, req.params.id, format);
    if (!got) return plain(reply, 404, 'Файлы архива уже удалены со службы');
    const name = archiveFileName(got.job.url, got.job.finishedAt ?? got.job.startedAt, format);
    reply
      .header('Content-Type', ARCHIVE_MIME[format])
      .header('Content-Length', got.file.size)
      .header('Content-Disposition', contentDisposition(name, format === 'pdf' && req.query.inline === '1'))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return reply.send(got.file.open());
  });

  const drive = deps.drive;
  if (!drive) return;

  // Сохранённый на Диск архив — любому читателю досье.
  app.get<{ Params: { dossierId: string; itemId: string; archiveId: string; format: string }; Querystring: { inline?: string } }>(
    `${SAVED_FILES_PATH}/:dossierId/:itemId/:archiveId/:format`,
    async (req, reply) => {
      const { userId } = await sessionOf(deps, req);
      if (!userId) return reply.code(401).send();
      const { dossierId, itemId, archiveId } = req.params;
      const format = req.params.format as ArchiveFormat;
      const d = ARCHIVE_FORMATS.includes(format) ? await deps.dossiers.get(dossierId).catch(() => null) : null;
      if (!d || !can(userId, 'read', d)) return reply.code(404).send();
      const item = d.items.find((i) => i.id === itemId);
      const record = item?.type === 'link' ? item.archives?.find((a) => a.id === archiveId) : undefined;
      const file = record?.files.find((f) => f.format === format);
      if (!record || !file) return reply.code(404).send();

      let got;
      try {
        got = await drive.open(record.by, { dossierId, itemId, fileId: file.driveFileId });
      } catch (e) {
        if (e instanceof DriveError && DRIVE_TEXT[e.code]) return plain(reply, e.code === 'NOT_FOUND' ? 404 : 410, DRIVE_TEXT[e.code]!);
        req.log.warn(`drive: отдача архива ${archiveId}: ${(e as Error).message}`);
        return plain(reply, 502, 'Google Диск не ответил — повторите позже');
      }
      if (got.size && got.size !== file.size) {
        (got.body as unknown as { destroy?: () => void }).destroy?.();
        return plain(reply, 409, DRIVE_TEXT.CHANGED!);
      }
      // Подмену содержимого при том же размере видно только по sha256 — в конце потока; тогда передача обрывается
      // (Content-Length известен — браузер считает загрузку неудавшейся).
      const hash = createHash('sha256');
      const check = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        },
        flush(cb) {
          const sha = hash.digest('hex');
          if (sha === file.sha256) return cb();
          req.log.warn(`drive: архив ${archiveId} (${format}) — sha256 не совпал, передача оборвана`);
          cb(new Error('sha256 mismatch'));
        },
      });
      reply
        .header('Content-Type', ARCHIVE_MIME[format])
        .header('Content-Length', file.size)
        .header('Content-Disposition', contentDisposition(file.name, format === 'pdf' && req.query.inline === '1'))
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Archive-SHA256', file.sha256)
        .header('Cache-Control', 'private, no-store');
      return reply.send(got.body.pipe(check));
    },
  );

  // Подключение Диска: только со своей страницы (хук same-origin), затем — к Google.
  app.get<{ Querystring: { back?: string } }>(DRIVE_CONNECT_PATH, async (req, reply) => {
    const { userId } = await sessionOf(deps, req);
    if (!userId) return reply.code(401).send();
    return reply.header('Cache-Control', 'no-store').redirect(drive.connectUrl(makeState(userId, safeBack(req.query.back))));
  });

  // Возврат из Google — приходит с чужого сайта (accounts.google.com), поэтому вне хука same-origin; защищён state.
  // Cookie сессии (SameSite=Lax) приходит при переходе верхнего уровня — пользователь должен совпасть с тем, кто начал.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(DRIVE_CALLBACK_PATH, async (req, reply) => {
    const { userId } = await sessionOf(deps, req);
    const s = typeof req.query.state === 'string' ? readState(req.query.state) : null;
    if (!userId || !s || s.u !== userId) return plain(reply, 400, 'Ссылка подключения Google Диска устарела — начните подключение заново со страницы досье');
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    if (req.query.error || typeof req.query.code !== 'string') {
      connectErrors.set(userId, 'DRIVE_DENIED');
      return reply.redirect(s.b);
    }
    try {
      const { email } = await drive.connect(userId, req.query.code);
      req.log.info(`drive: пользователь ${userId} подключил Диск ${email.replace(/^(.).*(@.*)$/, '$1…$2')}`);
    } catch (e) {
      const code = e instanceof DriveError && e.code === 'SCOPE' ? 'DRIVE_SCOPE' : 'DRIVE_CONNECT_FAILED';
      req.log.warn(`drive: подключение не удалось: ${(e as Error).message}`);
      connectErrors.set(userId, code);
    }
    return reply.redirect(s.b);
  });
}
