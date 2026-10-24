import {
  LEAK_FIELDS, SCANS_FIELD, STEP2_SOURCES, findKind, normalizeQuery, searchParams, step2Queries,
  type LeakCard, type LeakField, type Step2Info, type Step2Query,
} from '@ft/shared';
import { appConfig } from '../config.ts';
import type { Deps } from '../ports.ts';
import { waitDone } from './wait.ts';

// Дополнительный поиск вторым шагом (поиск по атрибутам): после обычного поиска — простые поиски по найденным
// ИНН, СНИЛС, паспортам, загранпаспортам и свидетельствам о рождении (STEP2_SOURCES); из их записей берутся
// отмеченные пользователем атрибуты и дописываются в те записи первого шага, где был найден идентификатор
// (LeakTuple.step2 — с тем, по чему найдено; база утечки второго шага не важна).
// Идёт фоном на сервере, а не по опросу браузера: поисков десятки, а шлюз пропускает запрос в секунду. Ход пишется
// в снимок после каждого поиска (result.step2, слитые записи — в result.job.leaks); задача всё это время running
// без gatewayJobId. После перезапуска сервера опрос задачи (search.job) продолжает с первого невыполненного поиска.

type Body = { job?: { leaks?: LeakCard[] } } & Record<string, unknown>;
export type Step2Result = Body & { step2: Step2Info };

const FIELDS = Object.keys(LEAK_FIELDS) as LeakField[];
/** Столько ошибок подряд (шлюз недоступен, токен не принят) — остальные поиски не делаются. */
const MAX_FAILS_IN_ROW = 3;

/** Ответ первого шага → снимок с планом второго. */
export function step2Begin(result: unknown, fields: string[], by: readonly string[], first: { kind: string; value: string }): Step2Result {
  const body = (result ?? {}) as Body;
  const { queries, skipped } = step2Queries(body.job?.leaks ?? [], first, by);
  return { ...body, step2: { fields, queries, skipped } };
}

export const step2Of = (result: unknown): Step2Info | null => (result as Partial<Step2Result> | null)?.step2 ?? null;

/**
 * Ответ поиска второго шага → в записи первого шага, где есть его идентификатор. Значение, которое в записи уже
 * есть (своё или найденное раньше), не повторяется — у найденного раньше дописывается ещё один «найден по».
 * Сканы — прямо в scans записи (у них нет подписи атрибута). Возвращает число добавленных значений.
 */
export function step2Merge(leaks: LeakCard[], q: Pick<Step2Query, 'kind' | 'value'>, found: LeakCard[], fields: Set<string>): number {
  const src = STEP2_SOURCES.find((s) => s.kind === q.kind);
  if (!src) return 0;
  const targets = leaks.flatMap((c) => c.tuples ?? []).filter((t) => t[src.field]?.some((v) => normalizeQuery(q.kind, v) === q.value));
  const values = found.flatMap((c) => c.tuples ?? []);
  let added = 0;
  for (const t of targets) {
    const add = (f: LeakField, v: string) => {
      if (t[f]?.includes(v)) return;
      const list = (t.step2 ??= []);
      const had = list.find((x) => x.f === f && x.v === v);
      if (had) {
        if (!had.by.includes(q.kind)) had.by.push(q.kind);
        return;
      }
      list.push({ f, v, by: [q.kind] });
      added++;
    };
    for (const ft of values) {
      for (const f of FIELDS) if (fields.has(f)) for (const v of ft[f] ?? []) add(f, v);
      if (fields.has(SCANS_FIELD)) {
        for (const id of ft.scans ?? []) {
          if (t.scans?.includes(id)) continue;
          (t.scans ??= []).push(id);
          added++;
        }
      }
    }
  }
  return added;
}

/** Задачи, второй шаг которых идёт в этом процессе. */
const running = new Set<string>();

/** Запускает второй шаг задачи фоном, если он ещё не идёт. */
export function step2Run(deps: Deps, id: string, userId: string, token: string) {
  if (running.has(id)) return;
  running.add(id);
  void run(deps, id, userId, token)
    .catch(async (e: Error) => {
      console.error(`search step2 ${id}: ${e.stack ?? e.message}`);
      await deps.searches.update(id, { state: 'failed', error: 'Второй шаг поиска прервался из-за ошибки на сервере' }).catch(() => {});
    })
    .finally(() => running.delete(id));
}

async function run(deps: Deps, id: string, userId: string, token: string) {
  const job = await deps.searches.get(id, userId);
  if (!job || job.state !== 'running' || !step2Of(job.result)) return;
  const res = structuredClone(job.result) as Step2Result;
  const leaks = ((res.job ??= {}).leaks ??= []);
  const fields = new Set(res.step2.fields);
  let fails = 0;
  for (const q of res.step2.queries) {
    if (q.state !== 'pending') continue;
    if (fails >= MAX_FAILS_IN_ROW) {
      q.state = 'failed';
      q.error = 'не выполнялся: несколько ошибок подряд';
      continue;
    }
    const kind = findKind(q.kind)!;
    try {
      const first = await deps.gateway.start(token, kind.raw, searchParams(kind, q.value));
      const body = (await waitDone(deps.gateway, token, 'ruleaks', first, appConfig.api.jobTimeoutMs)) as Body | null;
      q.added = step2Merge(leaks, q, body?.job?.leaks ?? [], fields);
      q.state = 'done';
      fails = 0;
    } catch (e) {
      q.state = 'failed';
      q.error = (e as Error).message;
      fails++;
    }
    await deps.searches.update(id, { result: res });
  }
  await deps.searches.update(id, { state: 'done', result: res });
}
