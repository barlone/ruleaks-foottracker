import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { ARCHIVE_FORMATS, type DriveStatusView } from '@ft/shared';
import { can } from '../authz.ts';
import { appConfig } from '../config.ts';
import { takeConnectError } from '../archive-files.ts';
import { ArchiveRefused, archiveJob, cancelArchive, dismissArchive, dossierArchives, saveArchiveJob, startArchive } from '../archive/jobs.ts';
import { activeProcedure, authedProcedure, router } from '../trpc.ts';

// Архивы страниц ссылок досье ([config] site-archive): PDF и/или WACZ снимает служба RuLeaks.ArchiveBox,
// задание ведёт сервер (archive/jobs.ts), файлы скачиваются по /site-archive/<задание>/<формат> (archive-files.ts).
// Адрес берётся из самого элемента досье, а не из запроса: архивировать можно только ссылку досье, которое
// пользователь вправе править. Выключено — config → null, остальное — ARCHIVE_DISABLED.

const sa = appConfig.siteArchive;
const Id = z.string().min(1).max(64);

const enabled = <T>(fn: () => T): T => {
  if (!sa.enabled) throw new TRPCError({ code: 'NOT_FOUND', message: 'ARCHIVE_DISABLED' });
  return fn();
};

export const siteArchiveRouter = router({
  /** null — службы нет (кнопок архивации не видно). */
  config: authedProcedure.query(({ ctx }) =>
    sa.enabled && ctx.deps.siteArchive ? { formats: [...ARCHIVE_FORMATS], demo: ctx.deps.siteArchive.demo, keepMin: sa.keepMs / 60_000 } : null,
  ),

  start: activeProcedure
    .input(z.object({ dossierId: Id, itemId: Id, formats: z.array(z.enum(ARCHIVE_FORMATS)).min(1).max(ARCHIVE_FORMATS.length) }))
    .mutation(({ ctx, input }) => enabled(async () => {
      const d = await ctx.deps.dossiers.get(input.dossierId);
      if (!d || !can(ctx.user.id, 'read', d)) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!can(ctx.user.id, 'edit', d)) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
      const item = d.items.find((i) => i.id === input.itemId);
      if (!item || item.type !== 'link' || !/^https?:\/\//i.test(item.url)) throw new TRPCError({ code: 'NOT_FOUND' });
      try {
        return startArchive(ctx.user.id, { dossierId: d.id, itemId: item.id, url: item.url, formats: input.formats });
      } catch (e) {
        if (e instanceof ArchiveRefused) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: e.message, cause: e });
        throw e;
      }
    })),

  job: authedProcedure.input(z.object({ id: Id })).query(({ ctx, input }) => {
    const j = archiveJob(ctx.user.id, input.id);
    if (!j) throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
    return j;
  }),

  /** Задания пользователя по досье (свои; у других редакторов — свои). */
  list: authedProcedure.input(z.object({ dossierId: Id })).query(({ ctx, input }) => (sa.enabled ? dossierArchives(ctx.user.id, input.dossierId) : [])),

  cancel: authedProcedure.input(z.object({ id: Id })).mutation(({ ctx, input }) => cancelArchive(ctx.user.id, input.id)),

  dismiss: authedProcedure.input(z.object({ id: Id })).mutation(({ ctx, input }) => dismissArchive(ctx.user.id, input.id)),

  /** Подключён ли Google Диск пользователя; lastError — чем закончилась последняя попытка подключения (один раз). */
  drive: authedProcedure.query(async ({ ctx }): Promise<(DriveStatusView & { lastError: string | null }) | null> => {
    const drive = ctx.deps.drive;
    if (!sa.enabled || !drive) return null;
    const st = await drive.status(ctx.user.id);
    return { connected: !!st, email: st?.email ?? null, demo: drive.demo, folderName: drive.folderName, lastError: takeConnectError(ctx.user.id) };
  }),

  /** Отключить Диск: доступ отзывается у Google, файлы на Диске остаются, но открыть архивы в досье станет нельзя. */
  disconnectDrive: authedProcedure.mutation(async ({ ctx }) => {
    await ctx.deps.drive?.disconnect(ctx.user.id);
    return true;
  }),

  /** Сохранить готовое задание на Диск (Диск подключили после захвата или прошлая попытка не удалась). */
  saveToDrive: activeProcedure.input(z.object({ id: Id })).mutation(({ ctx, input }) => enabled(() => {
    try {
      return saveArchiveJob(ctx.user.id, input.id);
    } catch (e) {
      if (e instanceof ArchiveRefused) throw new TRPCError({ code: e.message === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT', message: e.message, cause: e });
      throw e;
    }
  })),

  /**
   * Убрать сохранённый архив из ссылки. Файлы на Диске удаляются (в корзину), только если убирает их владелец —
   * чужой Диск редактор досье не трогает.
   */
  removeSaved: activeProcedure
    .input(z.object({ dossierId: Id, itemId: Id, archiveId: Id }))
    .mutation(({ ctx, input }) => enabled(async () => {
      const d = await ctx.deps.dossiers.get(input.dossierId);
      if (!d || !can(ctx.user.id, 'read', d)) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!can(ctx.user.id, 'edit', d)) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
      const item = d.items.find((i) => i.id === input.itemId);
      const record = item?.type === 'link' ? item.archives?.find((a) => a.id === input.archiveId) : undefined;
      if (!item || item.type !== 'link' || !record) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.deps.dossiers.updateItem(d.id, { ...item, archives: item.archives!.filter((a) => a.id !== record.id) });
      const trashed = record.by === ctx.user.id && !!ctx.deps.drive;
      if (trashed) await ctx.deps.drive!.trash(record.by, record.files.map((f) => f.driveFileId));
      return { trashed };
    })),
});
