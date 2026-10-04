import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  AttributeItem, DossierItem, DossierKind, DossierVisibility, LinkItem, MediaItem, NoteItem, ShareRole, SnapshotItem,
  newId, type Dossier,
} from '@ft/shared';
import { can, roleOf, type Action } from '../authz.ts';
import { activeProcedure, authedProcedure, router, type Ctx } from '../trpc.ts';

const omitBase = { id: true, position: true, createdAt: true } as const;
const NewItem = z.discriminatedUnion('type', [
  AttributeItem.omit(omitBase),
  LinkItem.omit(omitBase),
  MediaItem.omit(omitBase),
  NoteItem.omit(omitBase),
  SnapshotItem.omit(omitBase),
]);

async function load(ctx: Ctx, id: string, action: Action): Promise<Dossier> {
  const d = await ctx.deps.dossiers.get(id);
  // Чужое недоступное досье неотличимо от несуществующего.
  if (!d || !can(ctx.user!.id, 'read', d)) throw new TRPCError({ code: 'NOT_FOUND' });
  if (!can(ctx.user!.id, action, d)) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
  return d;
}

const withRole = (ctx: Ctx, d: Dossier) => ({ ...d, role: roleOf(ctx.user!.id, d)! });

export const dossiersRouter = router({
  list: authedProcedure
    .input(z.object({ scope: z.enum(['all', 'mine', 'shared']), q: z.string().max(100).optional() }))
    .query(({ ctx, input }) => ctx.deps.dossiers.list(ctx.user.id, input.scope, input.q)),

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
    const members = await Promise.all(d.memberIds.map((m) => ctx.deps.dossiers.get(m)));
    return {
      ...withRole(ctx, d),
      members: members
        .filter((m): m is Dossier => !!m && can(ctx.user.id, 'read', m))
        .map((m) => ({ id: m.id, title: m.title, coverMediaUrl: m.coverMediaUrl })),
    };
  }),

  create: activeProcedure
    .input(z.object({ kind: DossierKind, title: z.string().trim().min(1).max(256), summaryMd: z.string().max(100_000).default(''), tags: z.array(z.string()).default([]) }))
    .mutation(({ ctx, input }) => ctx.deps.dossiers.create({ ...input, ownerId: ctx.user.id })),

  update: activeProcedure
    .input(z.object({
      id: z.string(),
      version: z.number().int(),
      patch: z.object({
        title: z.string().trim().min(1).max(256),
        summaryMd: z.string().max(100_000),
        tags: z.array(z.string().max(64)).max(50),
        memberIds: z.array(z.string()),
        coverMediaUrl: z.string().nullable(),
      }).partial(),
    }))
    .mutation(async ({ ctx, input }) => {
      await load(ctx, input.id, 'edit');
      return withRole(ctx, await ctx.deps.dossiers.update(input.id, input.version, input.patch));
    }),

  addItem: activeProcedure.input(z.object({ id: z.string(), item: NewItem })).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'edit');
    const item = DossierItem.parse({
      ...input.item,
      id: newId(),
      position: Math.max(-1, ...d.items.map((i) => i.position)) + 1,
      createdAt: new Date().toISOString(),
    });
    return withRole(ctx, await ctx.deps.dossiers.addItem(input.id, item, ctx.user.id));
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

  remove: activeProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await load(ctx, input.id, 'manage');
    await ctx.deps.dossiers.remove(input.id);
    return true;
  }),
});
