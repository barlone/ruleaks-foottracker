import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { applyPackage, previewPackage } from '../export/import.ts';
import { ImportError, readPackage } from '../export/read.ts';
import { appendChunk, dropUpload, getUpload, uploadBytes } from '../export/uploads.ts';
import { activeProcedure, router } from '../trpc.ts';

// Импорт файла экспорта: upload (частями) → inspect (пароль, что внутри, что будет перезаписано) → commit.
// Файл между шагами лежит в памяти сервера (export/uploads.ts).

/** Ошибки разбора файла — BAD_REQUEST с кодом (BAD_FILE: подробность — после двоеточия). */
const importProcedure = activeProcedure.use(async ({ next }) => {
  const r = await next();
  const cause = r.ok ? null : r.error.cause;
  if (cause instanceof ImportError) {
    const detail = typeof cause.cause === 'string' && cause.code === 'BAD_FILE' ? `: ${cause.cause}` : '';
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${cause.code}${detail}`, cause });
  }
  return r;
});

const UploadId = z.string().min(1).max(64);

export const importsRouter = router({
  /** Часть файла в base64; первая — без uploadId. Части меньше bodyLimit сервера. */
  upload: importProcedure
    .input(z.object({ uploadId: UploadId.optional(), chunk: z.string().min(1).max(8_000_000) }))
    .mutation(({ ctx, input }) => ({ uploadId: appendChunk(ctx.user.id, input.uploadId, Buffer.from(input.chunk, 'base64')) })),

  /** Расшифровать и проверить; можно повторять с другим паролем. */
  inspect: importProcedure
    .input(z.object({ uploadId: UploadId, password: z.string().max(256) }))
    .mutation(async ({ ctx, input }) => {
      const u = getUpload(ctx.user.id, input.uploadId);
      if (!u.pkg) {
        u.pkg = await readPackage(uploadBytes(u), input.password);
        u.chunks = [];
      }
      return previewPackage(ctx.deps, ctx.user.id, u.pkg);
    }),

  commit: importProcedure.input(z.object({ uploadId: UploadId })).mutation(async ({ ctx, input }) => {
    const { pkg } = getUpload(ctx.user.id, input.uploadId);
    if (!pkg) throw new ImportError('UPLOAD_EXPIRED');
    // Повторное нажатие не импортирует второй раз.
    dropUpload(input.uploadId);
    return applyPackage(ctx.deps, ctx.user.id, pkg);
  }),
});
