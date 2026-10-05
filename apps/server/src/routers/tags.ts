import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { TagColor, TagText, type Tag } from '@ft/shared';
import { activeProcedure, authedProcedure, router, type Ctx } from '../trpc.ts';

// Словарь тегов пользователя. Тексты общие для всех (tag_texts), но каждый видит только свои теги.

export const TagIds = z.array(z.string()).max(50);

/**
 * Новые теги объекта (которых на нём ещё не было) — только из словаря того, кто правит.
 * Поставленные другими теги можно оставить или снять, но не добавить заново.
 */
export async function checkTagIds(ctx: Ctx, current: Tag[], next: string[]): Promise<string[]> {
  const ids = [...new Set(next)];
  const added = ids.filter((id) => !current.some((t) => t.id === id));
  if (added.length) {
    const mine = new Set((await ctx.deps.tags.list(ctx.user!.id)).map((t) => t.id));
    if (added.some((id) => !mine.has(id))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'BAD_TAGS' });
  }
  return ids;
}

export const tagsRouter = router({
  list: authedProcedure.query(({ ctx }) => ctx.deps.tags.list(ctx.user.id)),

  create: activeProcedure
    .input(z.object({ text: TagText, color: TagColor }))
    .mutation(({ ctx, input }) => ctx.deps.tags.create(ctx.user.id, input.text, input.color)),

  update: activeProcedure
    .input(z.object({ id: z.string(), text: TagText.optional(), color: TagColor.optional() }))
    .mutation(({ ctx, input }) => ctx.deps.tags.update(ctx.user.id, input.id, { text: input.text, color: input.color })),

  remove: activeProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.deps.tags.remove(ctx.user.id, input.id);
    return true;
  }),
});
