import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  FUZZY_MODE_IDS, GEO_RADIUS_MAX_M, GEO_RADIUS_PATH, SEARCH_KINDS, STEP2_FIELDS, STEP2_KINDS, SearchSectionSchema, TG_MODE_IDS,
  checkFulltext, checkMask, detectKind, geoQuery, findFuzzyMode, findKind, findTgMode, normalizePlateMask, parseTgUser, searchParams,
  AttrPdfRequest, AttrXlsxRequest, TgPdfRequest, type LeakCard, type SearchJob, type SearchSection,
} from '@ft/shared';
import { appConfig } from '../config.ts';
import { activeProcedure, authedProcedure, router, type Ctx } from '../trpc.ts';
import { tgSearchPdf } from '../pdf/tgReport.ts';
import { attrSearchPdf } from '../pdf/attrReport.ts';
import { loadAttrJob } from '../export/attrPick.ts';
import { attrSearchXlsx } from '../xlsx/attrBook.ts';
import { step2Begin, step2Of, step2Run } from '../search/step2.ts';
import { waitDone } from '../search/wait.ts';

// Сайт — посредник между браузером и шлюзом: токен пользователя не покидает сервер,
// опрос job.results ведёт сервер, а результат сохраняется снимком (у шлюза он живёт минуты).
// Три раздела повторяют меню бота: attr — /search и /deepsearch, tg — /tgsearch, fuzzy — /regsearch;
// geo — точка и радиус на карте (raw_search.byloc_radius, ответ как у raw-поиска по атрибутам).

const StartInput = z.discriminatedUnion('section', [
  z.object({
    section: z.literal('attr'),
    kind: z.string(),
    value: z.string().trim().min(1).max(256),
    deep: z.boolean(),
    /** Дополнительный поиск вторым шагом: какие атрибуты брать из его записей (STEP2_FIELDS). Не вместе с deep. */
    step2: z.array(z.string().max(32)).max(64).optional(),
    /** По каким найденным атрибутам искать вторым шагом (STEP2_KINDS); нет — по всем. */
    step2by: z.array(z.string().max(16)).max(16).optional(),
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
  z.object({
    section: z.literal('geo'),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    /** Метры. */
    radius: z.number().int().min(1).max(GEO_RADIUS_MAX_M),
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
  const res = (await waitDone(ctx.deps.gateway, tok, 'ruleaks', first)) as { job?: { leaks?: LeakCard[] } } | null;
  const tgid = res?.job?.leaks?.flatMap((l) => l.tuples ?? []).flatMap((t) => t.tgids ?? [])[0];
  if (!tgid) return { error: 'Не удалось найти пользователя Telegram с таким номером телефона' };
  return { tgid, via: `тел. ${raw.trim()}` };
}

function planAttr(input: Extract<StartInput, { section: 'attr' }>): Plan {
  const kind = findKind(input.kind);
  if (!kind) throw new TRPCError({ code: 'BAD_REQUEST', message: 'UNKNOWN_KIND' });
  const deep = input.deep && !!kind.deep;
  const extra: Record<string, string> = {};
  // Второй шаг — только после простого поиска; отобранные атрибуты хранятся в params снимка.
  if (input.step2 && !deep) {
    const fields = STEP2_FIELDS.filter((f) => input.step2!.includes(f));
    if (!fields.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Отметьте атрибуты для второго шага поиска' });
    const by = input.step2by ? STEP2_KINDS.filter((k) => input.step2by!.includes(k)) : STEP2_KINDS;
    if (!by.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Второй шаг поиска невозможен: не выбраны атрибуты, по которым искать' });
    extra.step2 = fields.join(',');
    extra.step2by = by.join(',');
  }
  // Значение нормализуется и раскладывается по параметрам, как в боте (ФИО → name1..3 + day/month/year).
  return { path: deep ? kind.deep! : kind.raw, params: searchParams(kind, input.value), service: 'ruleaks', kind: kind.id, deep, extra };
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

/** Ответ первого шага с планом второго: задача остаётся running, пока второй шаг идёт фоном. */
function withStep2(job: { kind: string; query: string; params: Record<string, string> }, result: unknown) {
  if (!job.params.step2) return null;
  const by = job.params.step2by?.split(',') ?? STEP2_KINDS;
  const res = step2Begin(result, job.params.step2.split(','), by, { kind: job.kind, value: job.query });
  return { result: res, state: res.step2.queries.length ? ('running' as const) : ('done' as const) };
}

async function advance(ctx: Ctx, id: string) {
  const job = await ctx.deps.searches.get(id, ctx.user!.id);
  if (!job) throw new TRPCError({ code: 'NOT_FOUND' });
  if (job.state !== 'running') return job;
  if (!job.gatewayJobId) {
    // Второй шаг идёт фоном; после перезапуска сервера опрос продолжает его.
    if (step2Of(job.result)) step2Run(ctx.deps, id, ctx.user!.id, await token(ctx));
    return job;
  }
  if (Date.now() - new Date(job.startedAt).getTime() > appConfig.api.jobTimeoutMs) {
    const error = `Поиск не завершился за ${Math.round(appConfig.api.jobTimeoutMs / 1000)} с — повторите запрос позже`;
    await ctx.deps.searches.update(id, { state: 'failed', error });
    return { ...job, state: 'failed' as const, error };
  }
  const ans = await ctx.deps.gateway.poll(await token(ctx), job.gatewayService, job.gatewayJobId);
  if (ans.state === 'done') {
    const step2 = withStep2(job, ans.result);
    if (step2) {
      await ctx.deps.searches.update(id, { ...step2, gatewayJobId: null });
      if (step2.state === 'running') step2Run(ctx.deps, id, ctx.user!.id, await token(ctx));
      return { ...job, ...step2, gatewayJobId: null };
    }
    await ctx.deps.searches.update(id, { state: 'done', result: ans.result });
    return { ...job, state: 'done' as const, result: ans.result };
  }
  if (ans.state === 'failed') {
    await ctx.deps.searches.update(id, { state: 'failed', error: ans.error });
    return { ...job, state: 'failed' as const, error: ans.error };
  }
  return job;
}

/**
 * Опросы одной задачи не идут параллельно (вкладки, повтор запроса): иначе конец первого шага обработали бы
 * дважды и второй мог бы затереть ход второго шага.
 */
const advancing = new Map<string, ReturnType<typeof advance>>();
function advanceOnce(ctx: Ctx, id: string): ReturnType<typeof advance> {
  const key = `${ctx.user!.id}:${id}`;
  let p = advancing.get(key);
  if (!p) {
    p = advance(ctx, id).finally(() => advancing.delete(key));
    advancing.set(key, p);
  }
  return p;
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
      query: input.section === 'geo' ? geoQuery(input.lat, input.lon, input.radius) : input.value,
      startedAt: new Date().toISOString(),
      candidates: null,
      result: null,
      error: null,
    };

    let plan: Plan;
    if (input.section === 'attr') {
      plan = planAttr(input);
      // Поиск по Telegram ID с @ником: сначала ник → ID (search_ids.bynik), как в боте.
      const nik = input.kind === 'tgid' ? parseTgUser(input.value) : null;
      if (nik?.kind === 'nik') {
        const ids = await ctx.deps.gateway.tgIdsByNik(tok, nik.value).catch((e: Error) => e);
        const stop = (state: 'failed' | 'choose', patch: Partial<SearchJob>) =>
          ctx.deps.searches.create({ ...base, ...patch, kind: plan.kind, deep: plan.deep, params: {}, state, gatewayJobId: null, gatewayService: 'ruleaks' });
        if (ids instanceof Error) return stop('failed', { error: ids.message });
        if (ids.length === 0) return stop('failed', { error: `Пользователь @${nik.value} не найден` });
        if (ids.length > 1) return stop('choose', { candidates: ids });
        const kind = findKind('tgid')!;
        plan = { ...plan, params: { [kind.param]: ids[0]! }, extra: { ...plan.extra, tgid: ids[0]!, via: `@${nik.value}` } };
      }
    } else if (input.section === 'fuzzy') plan = planFuzzy(input);
    else if (input.section === 'geo') {
      // Шлюз округляет координаты до 1e-6° (точность locs) — так же и в запросе, и в истории.
      const params = { lat: input.lat.toFixed(6), lon: input.lon.toFixed(6), radius: String(input.radius) };
      plan = { path: GEO_RADIUS_PATH, params, service: 'ruleaks', kind: 'radius', deep: false, extra: params };
    } else {
      const mode = findTgMode(input.mode)!;
      const params: Record<string, string> = {};
      const extra: Record<string, string> = {};
      if (mode.input === 'text') {
        // Заведомо пустой запрос (одни стоп-слова, одни исключения, меньше 3 букв) не тратит запрос к шлюзу.
        const check = checkFulltext(input.value);
        if (check.errors.length) throw new TRPCError({ code: 'BAD_REQUEST', message: check.errors[0]! });
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
    const step2 = ans.state === 'done' ? withStep2({ kind: plan.kind, query: base.query, params: plan.extra }, ans.result) : null;
    if (step2) {
      const job = await ctx.deps.searches.create({
        ...base, ...step2, kind: plan.kind, deep: plan.deep, params: plan.extra, gatewayJobId: null, gatewayService: plan.service,
      });
      if (step2.state === 'running') step2Run(ctx.deps, job.id, ctx.user.id, tok);
      return job;
    }
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
  job: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const job = publicJob(await advanceOnce(ctx, input.id));
    // Пока идёт второй шаг, браузеру нужен только его ход, а не весь (растущий) результат.
    const step2 = job.state === 'running' ? step2Of(job.result) : null;
    return step2 ? { ...job, result: { step2 } } : job;
  }),

  recent: authedProcedure
    .input(z.object({ section: SearchSectionSchema }))
    .query(({ ctx, input }) => ctx.deps.searches.listRecent(ctx.user.id, input.section, 30)),

  clearHistory: authedProcedure
    .input(z.object({ section: SearchSectionSchema }))
    .mutation(({ ctx, input }) => ctx.deps.searches.clear(ctx.user.id, input.section)),

  /** PDF-отчёт по своему завершённому поиску в Telegram (из сохранённого снимка — шлюз не вызывается). */
  exportTgPdf: authedProcedure.input(TgPdfRequest).mutation(async ({ ctx, input }) => {
    const job = await ctx.deps.searches.get(input.jobId, ctx.user.id);
    if (!job || job.section !== 'tg') throw new TRPCError({ code: 'NOT_FOUND' });
    if (job.state !== 'done') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Поиск ещё не завершён' });
    return tgSearchPdf(ctx.deps, ctx.user.id, job, input);
  }),

  /** PDF по своему завершённому поиску по атрибутам / геоданным — как страница результата (из снимка). */
  exportAttrPdf: authedProcedure.input(AttrPdfRequest).mutation(async ({ ctx, input }) =>
    attrSearchPdf(ctx.deps, ctx.user.id, await loadAttrJob(ctx.deps, ctx.user.id, input.jobId), input)),

  /** Excel по своему завершённому поиску по атрибутам / геоданным: построчно (как страница) или поколоночно. */
  exportAttrXlsx: authedProcedure.input(AttrXlsxRequest).mutation(async ({ ctx, input }) =>
    attrSearchXlsx(await loadAttrJob(ctx.deps, ctx.user.id, input.jobId), input)),
});
