import { TRPCError } from '@trpc/server';
import {
  GEO_MODES, LEAK_FIELDS, SEARCH_KINDS, attrDisplayValue, step2ByText, step2Summary, type Step2Info, type Step2Value,
  type AttrPdfRequest, type DeepRow, type LeakCard, type LeakField, type LeakTuple, type SearchJob,
} from '@ft/shared';
import type { Deps } from '../ports.ts';

// Общее для PDF и Excel по результату поиска по атрибутам / геоданным: что из снимка войдёт в файл.
// Отмеченные значения (ключи «поле:значение», как на странице) — только они; иначе всё. Фильтр «Атрибуты»
// (если включён на странице) сужает и то и другое. Пустые после отбора записи и утечки не выводятся.

/** Поля записи — в порядке LEAK_FIELDS, как на странице. */
export const FIELD_ORDER = Object.keys(LEAK_FIELDS) as LeakField[];
/** Ключ сканов документов в фильтре атрибутов (как на странице). */
export const SCANS_FIELD = 'scans';
export const fieldLabel = (f: string) => LEAK_FIELDS[f as LeakField] ?? f;
/** Подпись значения второго шага, как на странице: «ТЕЛЕФОН² (найден по паспорту)». */
export const step2Label = (x: Step2Value) => `${fieldLabel(x.f).toUpperCase()}² (${step2ByText(x.by)})`;

export interface AttrPick {
  job: SearchJob;
  deep: boolean;
  /** Простой поиск: утечки с отобранными значениями. */
  leaks: LeakCard[];
  /** Глубокий поиск: отобранные строки. */
  rows: DeepRow[];
  /** Все строки ответа по val_id — для «найдено через» (родитель может быть не отобран). */
  byId: Map<number, DeepRow>;
  /** Сканы документов из исходного ответа (не отмечаются, поэтому только при выгрузке без отметок). */
  scanLeaks: LeakCard[];
  /** Итог поиска, как в строке над результатом. */
  summary: string;
  /** Что вошло в файл — для шапки. */
  scope: string;
  /** Итог дополнительного поиска вторым шагом; null — его не было. */
  step2: string | null;
}

/** Свой завершённый поиск по атрибутам или геоданным. */
export async function loadAttrJob(deps: Deps, userId: string, jobId: string): Promise<SearchJob> {
  const job = await deps.searches.get(jobId, userId);
  if (!job || (job.section !== 'attr' && job.section !== 'geo')) throw new TRPCError({ code: 'NOT_FOUND' });
  if (job.state !== 'done') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Поиск ещё не завершён' });
  return job;
}

export function pickAttr(job: SearchJob, req: Pick<AttrPdfRequest, 'only' | 'fields'>): AttrPick {
  const res = (job.result as { job?: { leaks?: LeakCard[]; rows?: DeepRow[] } } | null)?.job;
  const step2 = (job.result as { step2?: Step2Info } | null)?.step2 ?? null;
  const allLeaks = res?.leaks ?? [];
  const allRows = res?.rows ?? [];
  const only = req.only?.length ? new Set(req.only) : null;
  const fields = req.fields?.length ? new Set(req.fields) : null;
  const take = (f: string, v: string) => (!fields || fields.has(f)) && (!only || only.has(`${f}:${v}`));

  const leaks: LeakCard[] = [];
  for (const card of job.deep ? [] : allLeaks) {
    const tuples: LeakTuple[] = [];
    for (const t of card.tuples ?? []) {
      const out: LeakTuple = { tuple: t.tuple };
      let any = false;
      for (const f of FIELD_ORDER) {
        const vs = (t[f] ?? []).filter((v) => take(f, v));
        if (vs.length) {
          out[f] = vs;
          any = true;
        }
      }
      const step2 = t.step2?.filter((x) => take(x.f, x.v));
      if (step2?.length) {
        out.step2 = step2;
        any = true;
      }
      if (any) tuples.push(out);
    }
    if (tuples.length) leaks.push({ leak: card.leak, trusted: card.trusted, tuples });
  }
  const rows = job.deep ? allRows.filter((r) => take(r.prm, r.val)) : [];

  const parts = [
    only ? `только отмеченные значения (${only.size})` : 'весь результат',
    fields ? `атрибуты: ${[...fields].map((f) => (f === SCANS_FIELD ? 'Сканы документов' : fieldLabel(f))).join(', ')}` : '',
  ];
  return {
    job,
    deep: job.deep,
    leaks,
    rows,
    byId: new Map(allRows.map((r) => [r.val_id, r] as const)),
    scanLeaks: !job.deep && !only && (!fields || fields.has(SCANS_FIELD)) ? allLeaks : [],
    summary: job.deep ? `${allRows.length} связанных значений` : `${allLeaks.length} утечек`,
    step2: step2 ? step2Summary(step2) : null,
    scope: parts.filter(Boolean).join('; '),
  };
}

/** Значение так, как оно показано на странице: у геолокации — с радиусом точности, остальное как есть. */
export const shownValue = (f: string, v: string) => (f === 'geolocs' ? attrDisplayValue(f, v) : v);

/** Подпись вида поиска: «Адрес (часть)», «Точка и радиус»… */
export function kindTitle(job: SearchJob): string {
  const list: readonly { id: string; label: string }[] = job.section === 'geo' ? GEO_MODES : SEARCH_KINDS;
  return list.find((k) => k.id === job.kind)?.label ?? job.kind;
}

/** Название раздела для шапки. */
export const sectionTitle = (job: SearchJob) => (job.section === 'geo' ? 'Поиск по геоданным' : 'Поиск по атрибутам');

/** Строки шапки «параметр — значение» (общие для PDF и листа «Запрос» в Excel). */
export function headerRows(p: AttrPick, dateTime: (iso: string) => string): [string, string][] {
  const { job } = p;
  const who = job.params.via ? `Telegram ID ${job.params.tgid} (найден по ${job.params.via})` : null;
  return [
    ['Вид поиска', `${kindTitle(job)}${job.deep ? ' · глубокий поиск со связями' : ''}${p.step2 !== null ? ' · дополнительный поиск вторым шагом' : ''}`],
    ['Запрос', job.query],
    ...(who ? [['Пользователь', who] as [string, string]] : []),
    ['Поиск выполнен', dateTime(job.startedAt)],
    ['Найдено', p.summary],
    ...(p.step2 !== null ? [['Второй шаг (²)', p.step2] as [string, string]] : []),
    ['В файле', p.scope],
  ];
}
