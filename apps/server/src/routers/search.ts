import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  FUZZY_MODE_IDS, SEARCH_KINDS, SearchSectionSchema, TG_MODE_IDS,
  checkMask, detectKind, findFuzzyMode, findKind, findTgMode, normalizePlateMask, parseTgUser,
  type LeakCard, type SearchJob, type SearchSection,
} from '@ft/shared';
import type { GatewayAnswer } from '../ports.ts';
import { activeProcedure, authedProcedure, router, type Ctx } from '../trpc.ts';

// Сайт — посредник между браузером и шлюзом: токен пользователя не покидает сервер,
// опрос job.results ведёт сервер, а результат сохраняется снимком (у шлюза он живёт минуты).
// Три раздела повторяют меню бота: attr — /search и /deepsearch, tg — /tgsearch, fuzzy — /regsearch.

const StartInput = z.discriminatedUnion('section', [
  z.object({
    section: z.literal('attr'),
    kind: z.string(),
    value: z.string().trim().min(1).max(256),
    deep: z.boolean(),
    bday: z.string().max(10).optional(),
  }),
  z.object({
    section: z.literal('tg'),
    mode: z.enum(TG_MODE_IDS),
    value: z.string().trim().min(1).max(256),
  }),
  z.object({
    section: z.literal('fuzzy'),
    mode: z.enum(FUZZY_MODE_IDS),
    value: z.string().trim().min(1).max(256),
    vehicpart: z.string().trim().max(64).optional(),
  }),
]);
type StartInput = z.infer<typeof StartInput>;

interface Plan {
  path: string;
  params: Record<string, string>;
  service: 'ruleaks' | 'tgcmnts';
  kind: string;
  deep: boolean;
  /** Что показать в истории и снимке вместо path/params. */
  extra: Record<string, string>;
}

async function token(ctx: Ctx): Promise<string> {
  const t = await ctx.deps.bot.getApiToken(ctx.user!.tgId);
  if (!t) throw new TRPCError({ code: 'FORBIDDEN', message: 'NO_API_TOKEN' });
  return t;
}

/** Дожидается ответа шлюза (для служебных запросов вроде телефон → tgid). */
async function waitDone(ctx: Ctx, tok: string, service: 'ruleaks' | 'tgcmnts', first: GatewayAnswer, timeoutMs = 20_000): Promise<unknown> {
  let ans = first;
  const until = Date.now() + timeoutMs;
  while (ans.state === 'running' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    ans = await ctx.deps.gateway.poll(tok, service, ans.jobId);
  }
  if (ans.state === 'done') return ans.result;
  throw new Error(ans.state === 'failed' ? ans.error : 'Шлюз не ответил вовремя');
}

/** Пользователь Telegram из ID / @ника / телефона — как _parse_identifier и _resolve_tgid_* бота. */
async function resolveTgUser(ctx: Ctx, tok: string, raw: string): Promise<{ tgid: string; via: string } | { candidates: string[] } | { error: string }> {
  const parsed = parseTgUser(raw);
  if (!parsed) return { error: 'Укажите Telegram ID, @ник или телефон' };
  if (parsed.kind === 'tgid') return { tgid: parsed.value, via: 'id' };
  if (parsed.kind === 'nik') {
    const ids = await ctx.deps.gateway.tgIdsByNik(tok, parsed.value);
    if (ids.length === 0) return { error: `Пользователь @${parsed.value} не найден` };
    if (ids.length > 1) return { candidates: ids };
    return { tgid: ids[0]!, via: `@${parsed.value}` };
  }
  const kind = findKind('phone')!;
  const first = await ctx.deps.gateway.start(tok, kind.raw, { [kind.param]: parsed.value });
  const res = (await waitDone(ctx, tok, 'ruleaks', first)) as { job?: { leaks?: LeakCard[] } } | null;
  const tgid = res?.job?.leaks?.flatMap((l) => l.tuples ?? []).flatMap((t) => t.tgids ?? [])[0];
  if (!tgid) return { error: 'Не удалось найти пользователя Telegram с таким номером телефона' };
  return { tgid, via: `тел. ${raw.trim()}` };
}

function planAttr(input: Extract<StartInput, { section: 'attr' }>): Plan {
  const kind = findKind(input.kind);
  if (!kind) throw new TRPCError({ code: 'BAD_REQUEST', message: 'UNKNOWN_KIND' });
  const deep = input.deep && !!kind.deep;
  const params: Record<string, string> = { [kind.param]: input.value };
  if (input.bday) params.bday = input.bday;
  return { path: deep ? kind.deep! : kind.raw, params, service: 'ruleaks', kind: kind.id, deep, extra: input.bday ? { bday: input.bday } : {} };
}

function planFuzzy(input: Extract<StartInput, { section: 'fuzzy' }>): Plan {
  const mode = findFuzzyMode(input.mode)!;
  const mask = input.mode === 'plate' ? normalizePlateMask(input.value) : input.value.toLowerCase();
  const bad = checkMask(mask);
  if (bad) throw new TRPCError({ code: 'BAD_REQUEST', message: bad });
  const params: Record<string, string> = { [mode.param]: mask };
  const extra: Record<string, string> = {};
  if (input.mode === 'plate' && input.vehicpart) {
    // Как checkVehicPart шлюза: 3+ букв/цифр, иначе фильтр бесполезен и поднимает лимит строк впустую.
    if ((input.vehicpart.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Марка авто — минимум 3 буквы или цифры' });
    params.vehicpart = extra.vehicpart = input.vehicpart;
  }
  return { path: mode.path, params, service: 'ruleaks', kind: mode.id, deep: false, extra };
}

async function advance(ctx: Ctx, id: string) {
  const job = await ctx.deps.searches.get(id, ctx.user!.id);
  if (!job) throw new TRPCError({ code: 'NOT_FOUND' });
  if (job.state !== 'running' || !job.gatewayJobId) return job;
  const ans = await ctx.deps.gateway.poll(await token(ctx), job.gatewayService, job.gatewayJobId);
  if (ans.state === 'done') {
    await ctx.deps.searches.update(id, { state: 'done', result: ans.result });
    return { ...job, state: 'done' as const, result: ans.result };
  }
  if (ans.state === 'failed') {
    await ctx.deps.searches.update(id, { state: 'failed', error: ans.error });
    return { ...job, state: 'failed' as const, error: ans.error };
  }
  return job;
}

const publicJob = ({ userId: _u, gatewayJobId: _g, gatewayService: _s, ...job }: SearchJob & { userId: string; gatewayJobId: string | null; gatewayService: string }): SearchJob => job;

export const searchRouter = router({
  kinds: authedProcedure.query(() => SEARCH_KINDS),

  detect: authedProcedure.input(z.object({ value: z.string().max(256) })).query(({ input }) => detectKind(input.value)),

  start: activeProcedure.input(StartInput).mutation(async ({ ctx, input }) => {
    const tok = await token(ctx);
    const base = {
      userId: ctx.user.id,
      section: input.section as SearchSection,
      query: input.value,
      startedAt: new Date().toISOString(),
      candidates: null,
      result: null,
      error: null,
    };

    let plan: Plan;
    if (input.section === 'attr') plan = planAttr(input);
    else if (input.section === 'fuzzy') plan = planFuzzy(input);
    else {
      const mode = findTgMode(input.mode)!;
      const params: Record<string, string> = {};
      const extra: Record<string, string> = {};
      if (mode.input === 'text') {
        params.expression = input.value;
      } else {
        const who = await resolveTgUser(ctx, tok, input.value).catch((e: Error) => ({ error: e.message }));
        const failed = (state: 'failed' | 'choose', patch: Partial<SearchJob>) =>
          ctx.deps.searches.create({ ...base, ...patch, kind: mode.id, deep: false, params: {}, state, gatewayJobId: null, gatewayService: 'tgcmnts' });
        if ('error' in who) return failed('failed', { error: who.error });
        if ('candidates' in who) return failed('choose', { candidates: who.candidates });
        params.tgid = extra.tgid = who.tgid;
        extra.via = who.via;
      }
      plan = { path: mode.path, params, service: 'tgcmnts', kind: mode.id, deep: false, extra };
    }

    const ans = await ctx.deps.gateway.start(tok, plan.path, plan.params);
    return ctx.deps.searches.create({
      ...base,
      kind: plan.kind,
      deep: plan.deep,
      params: plan.extra,
      state: ans.state,
      error: ans.state === 'failed' ? ans.error : null,
      result: ans.state === 'done' ? ans.result : null,
      gatewayJobId: ans.jobId,
      gatewayService: plan.service,
    });
  }),

  /** Клиент опрашивает раз в 1–2 с; позже заменяется на SSE /events. */
  job: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => publicJob(await advance(ctx, input.id))),

  recent: authedProcedure
    .input(z.object({ section: SearchSectionSchema }))
    .query(({ ctx, input }) => ctx.deps.searches.listRecent(ctx.user.id, input.section, 30)),

  clearHistory: authedProcedure
    .input(z.object({ section: SearchSectionSchema }))
    .mutation(({ ctx, input }) => ctx.deps.searches.clear(ctx.user.id, input.section)),
});
