import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { RelationNote, RelationText, type Dossier, type DossierRelation } from '@ft/shared';
import { can } from '../authz.ts';
import { activeProcedure, authedProcedure, router, type Ctx } from '../trpc.ts';

// Связи между досье персон. Связь видна в обоих досье; другая сторона — только если её досье можно читать.
// Тип связи общий, пояснение — своё у каждой стороны (в досье A «сын», в досье B «отец»).
// Добавить связь — право правки своего досье и чтения другого; пояснение стороны — право правки её досье
// (пояснение другой стороны при добавлении — если её досье тоже можно править); удалить — правка любой из сторон.

async function readable(ctx: Ctx, id: string): Promise<Dossier | null> {
  const d = await ctx.deps.dossiers.get(id);
  return d && can(ctx.user!.id, 'read', d) ? d : null;
}

/** Связь, которую пользователь может менять: правка хотя бы одного из двух досье. */
async function editableRelation(ctx: Ctx, id: string): Promise<DossierRelation> {
  const r = await ctx.deps.relations.get(id);
  if (!r) throw new TRPCError({ code: 'NOT_FOUND' });
  const [a, b] = await Promise.all([ctx.deps.dossiers.get(r.fromId), ctx.deps.dossiers.get(r.toId)]);
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
    const others = new Map((await Promise.all(otherIds.map((id) => readable(ctx, id)))).filter((x): x is Dossier => !!x).map((x) => [x.id, x]));
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
        /** Править пояснение этой стороны. */
        canEditNote: editHere,
        /** Удалить связь — правка любой из сторон. */
        canRemove: editHere || can(ctx.user.id, 'edit', o),
        createdAt: r.createdAt,
      }];
    });
  }),

  /** Одна или несколько связей между двумя персонами (по одной на тип; пояснения — для каждой стороны). */
  add: activeProcedure
    .input(z.object({
      dossierId: z.string(),
      otherId: z.string(),
      links: z.array(z.object({ typeId: z.string(), note: RelationNote.optional(), otherNote: RelationNote.optional() })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.deps.dossiers.get(input.dossierId);
      if (!d || !can(ctx.user.id, 'read', d)) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!can(ctx.user.id, 'edit', d)) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
      const o = await readable(ctx, input.otherId);
      if (!o || o.id === d.id || d.kind !== 'person' || o.kind !== 'person') throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_RELATION' });
      const types = new Set((await ctx.deps.relations.listTypes(ctx.user.id)).map((t) => t.id));
      if (input.links.some((l) => !types.has(l.typeId))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_RELATION_TYPE' });
      // Пояснение в чужом досье — только если его тоже можно править; иначе его допишет владелец того досье.
      const editOther = can(ctx.user.id, 'edit', o);
      for (const l of input.links) {
        await ctx.deps.relations.add(
          {
            dossierId: d.id, otherId: o.id, typeId: l.typeId, note: nullable(l.note),
            otherNote: editOther && l.otherNote !== undefined ? nullable(l.otherNote) : undefined,
          },
          ctx.user.id,
        );
      }
      return true;
    }),

  /** Пояснение связи в досье dossierId — нужна правка именно этого досье. */
  setNote: activeProcedure
    .input(z.object({ id: z.string(), dossierId: z.string(), note: RelationNote }))
    .mutation(async ({ ctx, input }) => {
      const r = await ctx.deps.relations.get(input.id);
      if (!r || (r.fromId !== input.dossierId && r.toId !== input.dossierId)) throw new TRPCError({ code: 'NOT_FOUND' });
      const d = await ctx.deps.dossiers.get(input.dossierId);
      if (!d || !can(ctx.user.id, 'read', d)) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!can(ctx.user.id, 'edit', d)) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
      await ctx.deps.relations.setNote(input.id, input.dossierId, nullable(input.note));
      return true;
    }),

  remove: activeProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await editableRelation(ctx, input.id);
    await ctx.deps.relations.remove(input.id);
    return true;
  }),
});
