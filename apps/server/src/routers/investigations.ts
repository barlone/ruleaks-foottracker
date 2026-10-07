import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  ExportRequest, Fact, PdfRequest, GraphEdge, GraphNode, Hypothesis, InvestigationVisibility, ShareRole, newId, type Investigation,
} from '@ft/shared';
import { can, roleOf, type Action } from '../authz.ts';
import { exportInvestigation } from '../export/build.ts';
import { investigationPdf } from '../pdf/report.ts';
import { activeProcedure, authedProcedure, publicProcedure, router, type Ctx } from '../trpc.ts';
import { TagIds, checkTagIds } from './tags.ts';

async function load(ctx: Ctx, id: string, action: Action): Promise<Investigation> {
  const inv = await ctx.deps.investigations.get(id);
  const uid = ctx.user?.id ?? null;
  if (!inv || !can(uid, 'read', inv)) throw new TRPCError({ code: 'NOT_FOUND' });
  if (!can(uid, action, inv)) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_RIGHTS' });
  return inv;
}

/** Публичное расследование не раскрывает список доступов и непубличные досье. */
async function present(ctx: Ctx, inv: Investigation) {
  const uid = ctx.user?.id ?? null;
  const role = roleOf(uid, inv) ?? 'viewer';
  const dossierIds = [...new Set(inv.nodes.map((n) => n.dossierId).filter((x): x is string => !!x))];
  const dossiers = await Promise.all(dossierIds.map((id) => ctx.deps.dossiers.get(id)));
  const readable = new Set(dossiers.filter((d) => d && uid && can(uid, 'read', d)).map((d) => d!.id));
  return {
    ...inv,
    shares: role === 'owner' ? inv.shares : [],
    nodes: inv.nodes.map((n) => ({ ...n, dossierId: n.dossierId && readable.has(n.dossierId) ? n.dossierId : null })),
    role,
  };
}

const now = () => new Date().toISOString();

export const investigationsRouter = router({
  list: authedProcedure
    .input(z.object({
      scope: z.enum(['all', 'mine', 'shared', 'public']),
      title: z.string().max(256).optional(),
      tagIds: z.array(z.string()).max(50).optional(),
    }))
    .query(({ ctx, input: { scope, ...filter } }) => ctx.deps.investigations.list(ctx.user.id, scope, filter)),

  /** Публичные расследования открываются и без входа. */
  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => present(ctx, await load(ctx, input.id, 'read'))),

  create: activeProcedure
    .input(z.object({ title: z.string().trim().min(1).max(256), descriptionMd: z.string().max(100_000).default('') }))
    .mutation(({ ctx, input }) => ctx.deps.investigations.create({ ...input, ownerId: ctx.user.id })),

  update: activeProcedure
    .input(z.object({
      id: z.string(),
      version: z.number().int(),
      patch: z.object({ title: z.string().trim().min(1).max(256), descriptionMd: z.string().max(100_000), tagIds: TagIds }).partial(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inv = await load(ctx, input.id, 'edit');
      const patch = { ...input.patch };
      if (patch.tagIds) patch.tagIds = await checkTagIds(ctx, inv.tags, patch.tagIds);
      return present(ctx, await ctx.deps.investigations.update(input.id, input.version, patch));
    }),

  saveGraph: activeProcedure
    .input(z.object({ id: z.string(), version: z.number().int(), nodes: z.array(GraphNode).max(2000), edges: z.array(GraphEdge).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      await load(ctx, input.id, 'edit');
      const ids = new Set(input.nodes.map((n) => n.id));
      const edges = input.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
      return present(ctx, await ctx.deps.investigations.saveGraph(input.id, input.version, input.nodes, edges));
    }),

  upsertFact: activeProcedure
    .input(z.object({ id: z.string(), fact: Fact.omit({ id: true, createdAt: true }).extend({ id: z.string().optional() }) }))
    .mutation(async ({ ctx, input }) => {
      const inv = await load(ctx, input.id, 'edit');
      const prev = inv.facts.find((f) => f.id === input.fact.id);
      const fact = { ...input.fact, id: prev?.id ?? newId(), createdAt: prev?.createdAt ?? now() };
      return present(ctx, await ctx.deps.investigations.upsertFact(input.id, fact, ctx.user.id));
    }),

  removeFact: activeProcedure.input(z.object({ id: z.string(), factId: z.string() })).mutation(async ({ ctx, input }) => {
    await load(ctx, input.id, 'edit');
    return present(ctx, await ctx.deps.investigations.removeFact(input.id, input.factId));
  }),

  upsertHypothesis: activeProcedure
    .input(z.object({ id: z.string(), hypothesis: Hypothesis.omit({ id: true, createdAt: true }).extend({ id: z.string().optional() }) }))
    .mutation(async ({ ctx, input }) => {
      const inv = await load(ctx, input.id, 'edit');
      const prev = inv.hypotheses.find((h) => h.id === input.hypothesis.id);
      const h = { ...input.hypothesis, id: prev?.id ?? newId(), createdAt: prev?.createdAt ?? now() };
      return present(ctx, await ctx.deps.investigations.upsertHypothesis(input.id, h, ctx.user.id));
    }),

  removeHypothesis: activeProcedure.input(z.object({ id: z.string(), hypothesisId: z.string() })).mutation(async ({ ctx, input }) => {
    await load(ctx, input.id, 'edit');
    return present(ctx, await ctx.deps.investigations.removeHypothesis(input.id, input.hypothesisId));
  }),

  setVisibility: activeProcedure
    .input(z.object({ id: z.string(), version: z.number().int(), visibility: InvestigationVisibility }))
    .mutation(async ({ ctx, input }) => {
      await load(ctx, input.id, 'manage');
      return present(ctx, await ctx.deps.investigations.update(input.id, input.version, { visibility: input.visibility }));
    }),

  share: activeProcedure
    .input(z.object({ id: z.string(), username: z.string().min(2).max(64), role: ShareRole }))
    .mutation(async ({ ctx, input }) => {
      const inv = await load(ctx, input.id, 'manage');
      const u = await ctx.deps.users.findByUsername(input.username);
      if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: 'USER_NOT_FOUND' });
      if (u.id === inv.ownerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'SELF_SHARE' });
      const shares = [...inv.shares.filter((s) => s.userId !== u.id), { userId: u.id, displayName: u.displayName, role: input.role }];
      const next = await ctx.deps.investigations.setShares(input.id, shares, ctx.user.id);
      return present(ctx, inv.visibility === 'private' ? await ctx.deps.investigations.update(input.id, next.version, { visibility: 'shared' }) : next);
    }),

  unshare: activeProcedure.input(z.object({ id: z.string(), userId: z.string() })).mutation(async ({ ctx, input }) => {
    const inv = await load(ctx, input.id, 'manage');
    return present(ctx, await ctx.deps.investigations.setShares(input.id, inv.shares.filter((s) => s.userId !== input.userId), ctx.user.id));
  }),

  /** Файл экспорта (ZIP, base64): досье узлов — только те, что экспортирующий может читать. */
  exportFile: authedProcedure.input(ExportRequest).mutation(async ({ ctx, input }) => {
    const inv = await load(ctx, input.id, 'read');
    return exportInvestigation(ctx.deps, ctx.user.id, inv, input);
  }),

  /** PDF-отчёт (base64): досье узлов — только те, что пользователь может читать. */
  exportPdf: authedProcedure.input(PdfRequest).mutation(async ({ ctx, input }) => {
    const inv = await load(ctx, input.id, 'read');
    return investigationPdf(ctx.deps, ctx.user.id, inv, input);
  }),

  remove: activeProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await load(ctx, input.id, 'manage');
    await ctx.deps.investigations.remove(input.id);
    return true;
  }),
});
