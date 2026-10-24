import {
  LEAK_FIELDS, SCANS_FIELD, findKind, searchParams, step2Queries, type LeakCard, type LeakField, type LeakTuple, type Step2Info,
} from '@ft/shared';
import { appConfig } from '../config.ts';
import type { Deps } from '../ports.ts';
import { waitDone } from './wait.ts';

// Дополнительный поиск вторым шагом (поиск по атрибутам): после обычного поиска — простые поиски по найденным
// ИНН, СНИЛС, паспортам, загранпаспортам и свидетельствам о рождении (STEP2_SOURCES); из их записей берутся
// отмеченные пользователем атрибуты и сливаются в карточки утечек первого шага с пометкой step: 2.
// Идёт фоном на сервере, а не по опросу браузера: поисков десятки, а шлюз пропускает запрос в секунду. Ход пишется
// в снимок после каждого поиска (result.step2, слитые записи — в result.job.leaks); задача всё это время running
// без gatewayJobId. После перезапуска сервера опрос задачи (search.job) продолжает с первого невыполненного поиска.

type Body = { job?: { leaks?: LeakCard[] } } & Record<string, unknown>;
export type Step2Result = Body & { step2: Step2Info };

const FIELDS = Object.keys(LEAK_FIELDS) as LeakField[];
/** Столько ошибок подряд (шлюз недоступен, токен не принят) — остальные поиски не делаются. */
const MAX_FAILS_IN_ROW = 3;

/** Ответ первого шага → снимок с планом второго. */
export function step2Begin(result: unknown, fields: string[], first: { kind: string; value: string }): Step2Result {
  const body = (result ?? {}) as Body;
  const { queries, skipped } = step2Queries(body.job?.leaks ?? [], first);
  return { ...body, step2: { fields, queries, skipped } };
}

export const step2Of = (result: unknown): Step2Info | null => (result as Partial<Step2Result> | null)?.step2 ?? null;

/** Записи второго шага — в карточки утечек (новые утечки — в конец). Возвращает число добавленных записей. */
export function step2Merge(leaks: LeakCard[], found: LeakCard[], fields: Set<string>): number {
  let added = 0;
  for (const card of found) {
    let target = leaks.find((c) => c.leak === card.leak);
    for (const t of card.tuples ?? []) {
      // Та же запись уже есть (из первого шага или найдена другим поиском второго).
      if (target?.tuples?.some((x) => x.tuple === t.tuple)) continue;
      const out: LeakTuple = { tuple: t.tuple, step: 2 };
      let any = false;
      for (const f of FIELDS) {
        if (fields.has(f) && t[f]?.length) {
          out[f] = t[f];
          any = true;
        }
      }
      if (fields.has(SCANS_FIELD) && t.scans?.length) {
        out.scans = t.scans;
        any = true;
      }
      if (!any) continue;
      if (!target) leaks.push((target = { leak: card.leak, trusted: card.trusted, tuples: [] }));
      (target.tuples ??= []).push(out);
      added++;
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
      q.added = step2Merge(leaks, body?.job?.leaks ?? [], fields);
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
