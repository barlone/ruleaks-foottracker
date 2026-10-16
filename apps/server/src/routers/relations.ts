import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { RelationNote, RelationText, type DossierRelation } from '@ft/shared';
import { can } from '../authz.ts';
import type { DossierHead } from '../ports.ts';
import { activeProcedure, authedProcedure, router, type Ctx } from '../trpc.ts';

// Связи между досье персон. Связь видна в обоих досье; другая сторона — только если её досье можно читать.
// Тип связи общий, пояснение — своё у каждой стороны (в досье A «сын», в досье B «отец»).
// Добавить/изменить связи — право правки своего досье и чтения другого; пояснение другой стороны — если её досье
// тоже можно править; удалить — правка любой из сторон.

// Для прав и подписей хватает шапок досье (DossierHead) — полные досье с элементами здесь не нужны.

/** Шапки досье из списка, которые пользователь может читать, по id. */
async function readableHeads(ctx: Ctx, ids: string[]): Promise<Map<string, DossierHead>> {
  const heads = await ctx.deps.dossiers.heads(ids);
  return new Map(heads.filter((h) => can(ctx.user!.id, 'read', h)).map((h) => [h.id, h]));
}

async function readable(ctx: Ctx, id: string): Promise<DossierHead | null> {
  return (await readableHeads(ctx, [id])).get(id) ?? null;
}

/** Связь, которую пользователь может менять: правка хотя бы одного из двух досье. */
async function editableRelation(ctx: Ctx, id: string): Promise<DossierRelation> {
  const r = await ctx.deps.relations.get(id);
  if (!r) throw new TRPCError({ code: 'NOT_FOUND' });
  const heads = new Map((await ctx.deps.dossiers.heads([r.fromId, r.toId])).map((h) => [h.id, h]));
  const a = heads.get(r.fromId);
  const b = heads.get(r.toId);
  const uid = ctx.user!.id;
  if (!(a && can(uid, 'read', a)) && !(b && can(uid, 'read', b))) throw new TRPCError({ code: 'NOT_FOUND' });
  if (!(a && can(uid, 'edit', a)) && !(b && can(uid, 'edit', b))) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
  return r;
}

const nullable = (s: string | undefined) => (s ? s : null);

export const relationsRouter = router({
  /** Предопределённые типы + словарь пользователя. */
  types: authedProcedure.query(({ ctx }) => ctx.deps.relations.listTypes(ctx.user.id)),

  createType: activeProcedure
    .input(z.object({ text: RelationText }))
    .mutation(({ ctx, input }) => ctx.deps.relations.createType(ctx.user.id, input.text)),

  removeType: activeProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.deps.relations.removeType(ctx.user.id, input.id);
    return true;
  }),

  /** Связи досье с другими персонами (досье, которые пользователь не может открыть, не показываются). */
  list: authedProcedure.input(z.object({ dossierId: z.string() })).query(async ({ ctx, input }) => {
    const d = await readable(ctx, input.dossierId);
    if (!d) throw new TRPCError({ code: 'NOT_FOUND' });
    const rels = await ctx.deps.relations.list(d.id);
    const otherIds = [...new Set(rels.map((r) => (r.fromId === d.id ? r.toId : r.fromId)))];
    const others = await readableHeads(ctx, otherIds);
    const editHere = can(ctx.user.id, 'edit', d);
    return rels.flatMap((r) => {
      const outgoing = r.fromId === d.id;
      const o = others.get(outgoing ? r.toId : r.fromId);
      if (!o) return [];
      return [{
        id: r.id,
        typeId: r.typeId,
        typeText: r.typeText,
        /** Пояснение в этом досье и в досье другой персоны. */
        note: outgoing ? r.fromNote : r.toNote,
        otherNote: outgoing ? r.toNote : r.fromNote,
        /** in — связь указана в досье другой персоны. */
        direction: outgoing ? ('out' as const) : ('in' as const),
        other: { id: o.id, title: o.title, coverMediaUrl: o.coverMediaUrl },
        /** Править связи с этой персоной из этого досье. */
        canEdit: editHere,
        /** Удалить связь — правка любой из сторон. */
        canRemove: editHere || can(ctx.user.id, 'edit', o),
        createdAt: r.createdAt,
      }];
    });
  }),

  /**
   * Связи с другой персоной: по одной на тип, пояснения — для каждой стороны.
   * replace = false (окно «Новая связь») — добавить/обновить указанные; replace = true (правка) — набор связей
   * с этой персоной становится ровно таким: снятые типы удаляются (нужна правка любой из сторон — она есть).
   */
  save: activeProcedure
    .input(z.object({
      dossierId: z.string(),
      otherId: z.string(),
      links: z.array(z.object({ typeId: z.string(), note: RelationNote.optional(), otherNote: RelationNote.optional() })).max(20),
      replace: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await readable(ctx, input.dossierId);
      if (!d) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!can(ctx.user.id, 'edit', d)) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
      const o = await readable(ctx, input.otherId);
      if (!o || o.id === d.id || d.kind !== 'person' || o.kind !== 'person') throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_RELATION' });
      if (!input.replace && !input.links.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_RELATION' });

      // Между этими двумя досье — в любом направлении.
      const existing = (await ctx.deps.relations.list(d.id)).filter((r) => r.fromId === o.id || r.toId === o.id);
      // Допустимые типы: предопределённые, свой словарь и уже стоящие на связи (их мог поставить соавтор).
      const types = new Set([...(await ctx.deps.relations.listTypes(ctx.user.id)).map((t) => t.id), ...existing.map((r) => r.typeId)]);
      if (input.links.some((l) => !types.has(l.typeId))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_RELATION_TYPE' });

      if (input.replace) {
        const keep = new Set(input.links.map((l) => l.typeId));
        for (const r of existing) if (!keep.has(r.typeId)) await ctx.deps.relations.remove(r.id);
      }
      // Пояснение в чужом досье — только если его тоже можно править; иначе его допишет владелец того досье.
      const editOther = can(ctx.user.id, 'edit', o);
      for (const l of input.links) {
        await ctx.deps.relations.add(
          {
            // undefined — не трогать пояснение существующей связи, '' — очистить.
            dossierId: d.id, otherId: o.id, typeId: l.typeId, note: l.note === undefined ? undefined : nullable(l.note),
            otherNote: editOther && l.otherNote !== undefined ? nullable(l.otherNote) : undefined,
          },
          ctx.user.id,
        );
      }
      return true;
    }),

  remove: activeProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await editableRelation(ctx, input.id);
    await ctx.deps.relations.remove(input.id);
    return true;
  }),
});
