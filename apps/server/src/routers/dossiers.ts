import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  AttributeItem, DossierItem, DossierKind, DossierVisibility, ExportRequest, LinkItem, PdfRequest, MediaItem, NoteItem, PostItem, ShareRole,
  SnapshotItem, newId, type Dossier,
} from '@ft/shared';
import { can, roleOf, type Action } from '../authz.ts';
import { exportDossier } from '../export/build.ts';
import { dossierPdf } from '../pdf/report.ts';
import { activeProcedure, authedProcedure, router, type Ctx } from '../trpc.ts';
import { TagIds, checkTagIds } from './tags.ts';

const omitBase = { id: true, position: true, createdAt: true } as const;
const NewItem = z.discriminatedUnion('type', [
  AttributeItem.omit(omitBase),
  LinkItem.omit(omitBase),
  MediaItem.omit(omitBase),
  NoteItem.omit(omitBase),
  SnapshotItem.omit(omitBase),
  PostItem.omit(omitBase),
]);

async function load(ctx: Ctx, id: string, action: Action): Promise<Dossier> {
  const d = await ctx.deps.dossiers.get(id);
  // Чужое недоступное досье неотличимо от несуществующего.
  if (!d || !can(ctx.user!.id, 'read', d)) throw new TRPCError({ code: 'NOT_FOUND' });
  if (!can(ctx.user!.id, action, d)) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
  return d;
}

const withRole = (ctx: Ctx, d: Dossier) => ({ ...d, role: roleOf(ctx.user!.id, d)! });

/**
 * Новые элементы досье: id, позиция за последней, время. Тот же пост/реакция (по внешнему id) или та же ссылка,
 * уже имеющиеся в досье или повторяющиеся в самом списке, пропускаются.
 */
function prepareItems(d: Dossier, inputs: z.infer<typeof NewItem>[]): DossierItem[] {
  const exts = new Set(d.items.flatMap((i) => (i.type === 'post' && i.extId ? [i.extId] : [])));
  const urls = new Set(d.items.flatMap((i) => (i.type === 'link' ? [i.url] : [])));
  let position = Math.max(-1, ...d.items.map((i) => i.position));
  const createdAt = new Date().toISOString();
  const out: DossierItem[] = [];
  for (const input of inputs) {
    if (input.type === 'post' && input.extId) {
      if (exts.has(input.extId)) continue;
      exts.add(input.extId);
    }
    if (input.type === 'link') {
      if (urls.has(input.url)) continue;
      urls.add(input.url);
    }
    out.push(DossierItem.parse({ ...input, id: newId(), position: ++position, createdAt }));
  }
  return out;
}

export const dossiersRouter = router({
  list: authedProcedure
    .input(z.object({
      scope: z.enum(['all', 'mine', 'shared']),
      title: z.string().max(256).optional(),
      tagIds: z.array(z.string()).max(50).optional(),
    }))
    .query(({ ctx, input: { scope, ...filter } }) => ctx.deps.dossiers.list(ctx.user.id, scope, filter)),

  /** Короткий список для выбора досье (добавить в досье, привязать узел графа). */
  options: authedProcedure.query(async ({ ctx }) => {
    const [mine, shared] = await Promise.all([
      ctx.deps.dossiers.list(ctx.user.id, 'mine'),
      ctx.deps.dossiers.list(ctx.user.id, 'shared'),
    ]);
    return [...mine, ...shared].map((d) => ({ id: d.id, title: d.title, kind: d.kind, role: d.role }));
  }),

  get: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'read');
    // Участникам нужны только название и обложка — шапки, а не полные досье с элементами.
    const heads = new Map((await ctx.deps.dossiers.heads(d.memberIds)).map((h) => [h.id, h]));
    return {
      ...withRole(ctx, d),
      members: d.memberIds.flatMap((id) => {
        const m = heads.get(id);
        return m && can(ctx.user.id, 'read', m) ? [{ id: m.id, title: m.title, coverMediaUrl: m.coverMediaUrl }] : [];
      }),
    };
  }),

  create: activeProcedure
    .input(z.object({ kind: DossierKind, title: z.string().trim().min(1).max(256), summaryMd: z.string().max(100_000).default('') }))
    .mutation(({ ctx, input }) => ctx.deps.dossiers.create({ ...input, ownerId: ctx.user.id })),

  update: activeProcedure
    .input(z.object({
      id: z.string(),
      version: z.number().int(),
      patch: z.object({
        title: z.string().trim().min(1).max(256),
        summaryMd: z.string().max(100_000),
        tagIds: TagIds,
        memberIds: z.array(z.string()),
        coverMediaUrl: z.string().nullable(),
      }).partial(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await load(ctx, input.id, 'edit');
      const patch = { ...input.patch };
      if (patch.tagIds) patch.tagIds = await checkTagIds(ctx, d.tags, patch.tagIds);
      if (patch.memberIds) {
        // Добавить в группу можно только досье, которое правящий может читать (саму группу — нет);
        // уже состоящие участники остаются, даже если правящему они недоступны (их поставил владелец).
        const added = [...new Set(patch.memberIds)].filter((m) => !d.memberIds.includes(m));
        const readable = new Set((await ctx.deps.dossiers.heads(added)).filter((h) => can(ctx.user.id, 'read', h)).map((h) => h.id));
        if (added.some((m) => m === d.id || !readable.has(m))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_MEMBERS' });
        patch.memberIds = [...new Set(patch.memberIds)];
      }
      return withRole(ctx, await ctx.deps.dossiers.update(input.id, input.version, patch));
    }),

  addItem: activeProcedure.input(z.object({ id: z.string(), item: NewItem })).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'edit');
    const items = prepareItems(d, [input.item]);
    return withRole(ctx, items.length ? await ctx.deps.dossiers.addItems(input.id, items, ctx.user.id) : d);
  }),

  /** Несколько элементов за один запрос (перенос из поиска): одна транзакция, один ответ. */
  addItems: activeProcedure.input(z.object({ id: z.string(), items: z.array(NewItem).min(1).max(500) })).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'edit');
    const items = prepareItems(d, input.items);
    return withRole(ctx, items.length ? await ctx.deps.dossiers.addItems(input.id, items, ctx.user.id) : d);
  }),

  updateItem: activeProcedure.input(z.object({ id: z.string(), item: DossierItem })).mutation(async ({ ctx, input }) => {
    await load(ctx, input.id, 'edit');
    return withRole(ctx, await ctx.deps.dossiers.updateItem(input.id, input.item));
  }),

  removeItem: activeProcedure.input(z.object({ id: z.string(), itemId: z.string() })).mutation(async ({ ctx, input }) => {
    await load(ctx, input.id, 'edit');
    return withRole(ctx, await ctx.deps.dossiers.removeItem(input.id, input.itemId));
  }),

  reorderItems: activeProcedure.input(z.object({ id: z.string(), orderedIds: z.array(z.string()) })).mutation(async ({ ctx, input }) => {
    await load(ctx, input.id, 'edit');
    return withRole(ctx, await ctx.deps.dossiers.reorderItems(input.id, input.orderedIds));
  }),

  setVisibility: activeProcedure
    .input(z.object({ id: z.string(), version: z.number().int(), visibility: DossierVisibility }))
    .mutation(async ({ ctx, input }) => {
      await load(ctx, input.id, 'manage');
      return withRole(ctx, await ctx.deps.dossiers.update(input.id, input.version, { visibility: input.visibility }));
    }),

  /** Поделиться с исследователем по @username Telegram. */
  share: activeProcedure
    .input(z.object({ id: z.string(), username: z.string().min(2).max(64), role: ShareRole }))
    .mutation(async ({ ctx, input }) => {
      const d = await load(ctx, input.id, 'manage');
      const u = await ctx.deps.users.findByUsername(input.username);
      if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });
      if (u.id === d.ownerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'SELF_SHARE' });
      const shares = [...d.shares.filter((s) => s.userId !== u.id), { userId: u.id, displayName: u.displayName, role: input.role }];
      const next = await ctx.deps.dossiers.setShares(input.id, shares, ctx.user.id);
      return withRole(ctx, d.visibility === 'private' ? await ctx.deps.dossiers.update(input.id, next.version, { visibility: 'shared' }) : next);
    }),

  unshare: activeProcedure.input(z.object({ id: z.string(), userId: z.string() })).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'manage');
    return withRole(ctx, await ctx.deps.dossiers.setShares(input.id, d.shares.filter((s) => s.userId !== input.userId), ctx.user.id));
  }),

  /** Файл экспорта (ZIP, base64) — всем, кто может читать досье; мутация, чтобы пароль не попал в URL. */
  exportFile: authedProcedure.input(ExportRequest).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'read');
    return exportDossier(ctx.deps, ctx.user.id, d, input);
  }),

  /** PDF-отчёт (base64); пароль — шифрование самого PDF. */
  exportPdf: authedProcedure.input(PdfRequest).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'read');
    return dossierPdf(ctx.deps, ctx.user.id, d, input);
  }),

  remove: activeProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await load(ctx, input.id, 'manage');
    await ctx.deps.dossiers.remove(input.id);
    return true;
  }),
});
