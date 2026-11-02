import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  AttributeItem, DossierItem, DossierKind, DossierVisibility, ExportRequest, LinkItem, PdfRequest, MediaItem, NoteItem, PostItem, ShareRole,
  SnapshotItem, DOSSIER_MEDIA_MAX_BYTES, MEDIA_FILE_MAX_BYTES, dossierMediaBytes, findDuplicate, itemIdentity, markDuplicates, mediaBytes, newId,
  type Dossier,
} from '@ft/shared';
import { can, roleOf, type Action } from '../authz.ts';
import { exportDossier } from '../export/build.ts';
import { dossierPdf } from '../pdf/report.ts';
import { Conflict } from '../ports.ts';
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
 * Новые элементы досье: id, позиция за последней, время. Дубликаты (itemIdentity) имеющихся в досье или элементов
 * самого списка пропускаются. skipped — сколько пропущено без снимков: снимок того же поиска не значение, а источник,
 * и повторный перенос из одного поиска просто не добавляет его второй раз.
 */
function prepareItems(d: Dossier, inputs: z.infer<typeof NewItem>[]): { items: DossierItem[]; skipped: number } {
  const duplicates = markDuplicates(d.items, inputs);
  let position = Math.max(-1, ...d.items.map((i) => i.position));
  const createdAt = new Date().toISOString();
  const items: DossierItem[] = [];
  let skipped = 0;
  inputs.forEach((input, i) => {
    if (!duplicates[i]) items.push(DossierItem.parse({ ...input, id: newId(), position: ++position, createdAt }));
    else if (input.type !== 'snapshot') skipped++;
  });
  return { items, skipped };
}

/**
 * Лимиты встроенных медиа (@ft/shared media.ts): один файл ≤ MEDIA_FILE_MAX_BYTES, всё досье ≤ DOSSIER_MEDIA_MAX_BYTES.
 * replacedId — элемент, который заменяется (updateItem): его прежний размер в сумму не входит.
 */
function checkMediaLimits(d: Dossier, added: readonly DossierItem[], replacedId?: string) {
  const fresh = added.filter((i) => i.type === 'media');
  if (!fresh.length) return;
  for (const i of fresh) {
    if (i.type === 'media' && mediaBytes(i.url) > MEDIA_FILE_MAX_BYTES) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `MEDIA_TOO_LARGE: ${Math.ceil(mediaBytes(i.url) / 1024)} КБ` });
    }
  }
  const used = dossierMediaBytes(d.items.filter((i) => i.id !== replacedId));
  const total = used + dossierMediaBytes(fresh);
  if (total > DOSSIER_MEDIA_MAX_BYTES) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `MEDIA_QUOTA: занято ${Math.ceil(used / 1024)} КБ из ${DOSSIER_MEDIA_MAX_BYTES / 1024}` });
  }
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

  /** Один элемент (ручное добавление): дубликат — ошибка, чтобы окно осталось открытым и показало причину. */
  addItem: activeProcedure.input(z.object({ id: z.string(), item: NewItem })).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'edit');
    const { items } = prepareItems(d, [input.item]);
    if (!items.length) throw new Conflict('DUPLICATE_ITEM');
    checkMediaLimits(d, items);
    return withRole(ctx, await ctx.deps.dossiers.addItems(input.id, items, ctx.user.id));
  }),

  /**
   * Несколько элементов за один запрос (перенос из поиска): одна транзакция, один ответ.
   * Дубликаты пропускаются, остальное добавляется; skipped — сколько пропущено.
   */
  addItems: activeProcedure.input(z.object({ id: z.string(), items: z.array(NewItem).min(1).max(500) })).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'edit');
    const { items, skipped } = prepareItems(d, input.items);
    checkMediaLimits(d, items);
    return { ...withRole(ctx, items.length ? await ctx.deps.dossiers.addItems(input.id, items, ctx.user.id) : d), skipped };
  }),

  updateItem: activeProcedure.input(z.object({ id: z.string(), item: DossierItem })).mutation(async ({ ctx, input }) => {
    const d = await load(ctx, input.id, 'edit');
    const before = d.items.find((i) => i.id === input.item.id);
    // Значение не менялось — не дубликат: старые повторы, появившиеся до этой проверки, можно править.
    if (before && itemIdentity(before) !== itemIdentity(input.item) && findDuplicate(d.items, input.item)) {
      throw new Conflict('DUPLICATE_ITEM');
    }
    checkMediaLimits(d, [input.item], input.item.id);
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
