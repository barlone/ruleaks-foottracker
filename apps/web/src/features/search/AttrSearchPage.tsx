import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronUp, CornerDownRight, FileSpreadsheet, FileText, Filter, Layers, ListChecks, Search as SearchIcon, ShieldCheck, Zap } from 'lucide-react';
import {
  FIELD_TO_KIND, SCANS_FIELD, STEP2_FIELDS, STEP2_MAX_SEARCHES, attrCopyValue, attrDisplayValue, parseGeoloc, LEAK_FIELDS, SEARCH_KINDS, detectKinds,
  isUkrainianPhone, step2ByText, step2Summary, type DeepRow, type LeakCard, type LeakField, type LeakTuple, type Step2Info,
} from '@ft/shared';
import { Button, Card, CopyButton, Empty, Input, Select, Spinner, Tag } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { searchRoute } from '../../router.tsx';
import { AddToDossierDialog, type PendingValue } from './AddToDossierDialog.tsx';
import { AttrExportDialog } from './AttrExportDialog.tsx';
import { JobStatus, ResultBar, SearchLayout, useRunOnMount, useSearchJob } from './common.tsx';
import { ValueActions } from './ValueActions.tsx';
import type { FoundGeoPoint } from './GeoPointsMap.tsx';
import { ScansBox, useFoundScans } from './ScansBox.tsx';

type Job = RouterOutputs['search']['job'];

/** Отметка значений для переноса в досье: ключ `${поле}:${значение}`. */
export function useSelection() {
  const [selected, setSelected] = useState<Map<string, PendingValue>>(new Map());
  const toggle = (key: string, label: string, value: string) => {
    const id = `${key}:${value}`;
    const next = new Map(selected);
    if (next.has(id)) next.delete(id);
    else next.set(id, { key, label, value });
    setSelected(next);
  };
  return { selected, toggle, reset: () => setSelected(new Map()) };
}

/** «Поиск по атрибутам» — /search и /deepsearch бота. */
export function AttrSearchPage() {
  const params = searchRoute.useSearch();
  const navigate = useNavigate({ from: '/search' });
  const me = trpc.auth.me.useQuery();
  const [value, setValue] = useState(params.q ?? '');
  const [kind, setKind] = useState<string>(params.kind ?? 'auto');
  const [deep, setDeep] = useState(params.deep ?? false);
  // Дополнительный поиск вторым шагом (взаимоисключающий с глубоким) и какие атрибуты брать из его записей.
  const [step2, setStep2] = useState(false);
  const [step2Fields, setStep2Fields] = useState<Set<string>>(() => new Set(STEP2_FIELDS));
  const [jobId, setJobId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // Варианты «Авто: …» — подходящие по маске виды поиска в порядке вероятности (как кнопки в боте).
  // kind: 'auto' — самый вероятный; 'auto:<вид>' — выбранный вариант «Авто»; '<вид>' — выбран вручную.
  const detected = useMemo(() => detectKinds(value), [value]);
  const autoPick = kind.startsWith('auto:') ? kind.slice(5) : null;
  const effectiveKind = kind === 'auto' || autoPick ? (autoPick && detected.includes(autoPick) ? autoPick : detected[0] ?? null) : kind;
  const selectValue = kind === 'auto' || autoPick ? (effectiveKind ? `auto:${effectiveKind}` : 'auto') : kind;
  const kindInfo = SEARCH_KINDS.find((k) => k.id === effectiveKind);
  const label = (id: string) => SEARCH_KINDS.find((k) => k.id === id)?.label ?? id;

  const start = trpc.search.start.useMutation({
    onSuccess: (j) => {
      setJobId(j.id);
      void utils.search.recent.invalidate({ section: 'attr' });
    },
  });
  const job = useSearchJob(jobId);

  function run(k = effectiveKind, v = value, d = deep) {
    if (!k || !v.trim()) return;
    void navigate({ search: { kind: k, q: v, deep: d } });
    start.mutate({ section: 'attr', kind: k, value: v.trim(), deep: d && !step2, step2: step2 ? [...step2Fields] : undefined });
  }

  // Переход по ссылке /search?kind=..&q=.. (из досье или «провалиться» в значение) запускает поиск.
  useRunOnMount(() => {
    setValue(params.q!);
    setKind(params.kind!);
    setDeep(params.deep ?? false);
    start.mutate({ section: 'attr', kind: params.kind!, value: params.q!, deep: params.deep ?? false });
  }, !!(params.q && params.kind), !!me.data?.access.active);

  const pivot = (k: string, v: string) => {
    setValue(v);
    setKind(k);
    run(k, v, deep);
  };

  const disabled = !me.data?.access.active;
  const noStep2Fields = step2 && !step2Fields.size;

  return (
    <SearchLayout
      section="attr"
      title="Поиск по атрибутам"
      subtitle="Телефон, email, ФИО, документы, авто, Telegram ID… Найденное можно сразу перенести в досье."
      activeId={jobId}
      onOpen={setJobId}
    >

        <Card className="animate-fade-up">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <div className="flex gap-3 max-md:flex-col">
              <div className="relative flex-1">
                <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
                <Input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={kindInfo?.placeholder ?? 'Телефон, email, ФИО, ИНН, госномер, Telegram ID…'}
                  className="h-12 pl-10 font-mono text-base"
                  disabled={disabled}
                />
              </div>
              <Select value={selectValue} onChange={(e) => setKind(e.target.value)} className="h-12 md:w-60" disabled={disabled}>
                {detected.length === 0 && <option value="auto">Авто</option>}
                {detected.map((id) => (
                  <option key={`auto:${id}`} value={`auto:${id}`}>Авто: {label(id)}</option>
                ))}
                <option disabled>──────────────</option>
                {SEARCH_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>{k.label}</option>
                ))}
              </Select>
              <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !effectiveKind || !value.trim() || noStep2Fields || start.isPending}>
                {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : 'Искать'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className={clsx('flex cursor-pointer items-center gap-2', !kindInfo?.deep && 'opacity-40')}>
                <input
                  type="checkbox"
                  checked={deep && !step2}
                  onChange={(e) => {
                    setDeep(e.target.checked);
                    if (e.target.checked) setStep2(false);
                  }}
                  disabled={!kindInfo?.deep}
                  className="accent-[var(--color-mint)]"
                />
                <Layers size={14} className="text-mint" /> Глубокий поиск со связями
              </label>
              <label
                className="flex cursor-pointer items-center gap-2"
                title={`После обычного поиска — простые поиски по найденным ИНН, СНИЛС, паспортам, загранпаспортам и свидетельствам о рождении (до ${STEP2_MAX_SEARCHES}); из их записей добавляются отмеченные атрибуты с пометкой ²`}
              >
                <input
                  type="checkbox"
                  checked={step2}
                  onChange={(e) => {
                    setStep2(e.target.checked);
                    if (e.target.checked) setDeep(false);
                  }}
                  className="accent-[var(--color-mint)]"
                />
                <ListChecks size={14} className="text-mint" /> Дополнительный поиск вторым шагом
              </label>
              {(kind === 'auto' || autoPick) && value.trim() && !detected.length && (
                <Tag tone="warn">{isUkrainianPhone(value) ? 'поиск только по номерам РФ' : 'тип не распознан — выберите вручную'}</Tag>
              )}
              {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
            </div>
            {step2 && <Step2Fields value={step2Fields} onChange={setStep2Fields} />}
          </form>
        </Card>

      {jobId && <JobView job={job.data} loading={job.isLoading} error={job.error ? errorText(job.error) : null} onPivot={pivot} />}
      {!jobId && (
        <Empty>
          Введите значение — тип определится автоматически.
          <br />
          Из любого найденного значения можно сделать следующий шаг поиска.
        </Empty>
      )}
    </SearchLayout>
  );
}

/** Результат raw/deep-поиска по утечкам: и «Поиск по атрибутам», и «Поиск по геоданным» (у шлюза ответ того же вида). */
export function JobView({ job, loading, error, onPivot }: { job: Job | undefined; loading: boolean; error?: string | null; onPivot: (kind: string, value: string) => void }) {
  const [selected, setSelected] = useState<Map<string, PendingValue>>(new Map());
  const [dialog, setDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'xlsx'>('pdf');
  const [exportOpen, setExportOpen] = useState(false);
  const exportAs = (f: 'pdf' | 'xlsx') => {
    setExportFormat(f);
    setExportOpen(true);
  };
  // Сканы — до ранних return: хуки. Ссылка на leaks стабильна между опросами (structural sharing react-query).
  const scanLeaks = job?.state === 'done' && !job.deep ? ((job.result as { job?: { leaks?: LeakCard[] } } | null)?.job?.leaks ?? null) : null;
  const scans = useFoundScans(scanLeaks);
  // Фильтр по найденным атрибутам: пусто — показывать всё.
  const [fields, setFields] = useState<Set<string>>(new Set());
  // Свёрнутые карточки утечек — по индексу в leaks.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelected(new Map());
    setFields(new Set());
    setCollapsed(new Set());
  }, [job?.id]);
  const toggleCollapsed = (i: number) => {
    const next = new Set(collapsed);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setCollapsed(next);
  };

  if (job?.state === 'choose') {
    return (
      <Card title="Ник принадлежит нескольким пользователям">
        <p className="mb-3 text-sm text-dim">Выберите Telegram ID для запроса «{job.query}»:</p>
        <div className="flex flex-wrap gap-2">
          {job.candidates?.map((id) => (
            <Button key={id} onClick={() => onPivot('tgid', id)}>{id}</Button>
          ))}
        </div>
      </Card>
    );
  }
  const status = <JobStatus job={job} loading={loading} error={error} />;
  if (!job || job.state !== 'done') return status;

  const res = job.result as { job?: { leaks?: LeakCard[]; rows?: DeepRow[] } } | null;
  const leaks = res?.job?.leaks ?? [];
  const rows = res?.job?.rows ?? [];
  const step2 = (job.result as { step2?: Step2Info } | null)?.step2 ?? null;
  const step2Added = step2?.queries.reduce((n, q) => n + (q.added ?? 0), 0) ?? 0;
  const summary = job.deep
    ? `${rows.length} связанных значений`
    : `${leaks.length} утечек${step2 ? `, вторым шагом добавлено значений: ${step2Added}` : ''}`;

  // Атрибуты, которые есть в результатах, и сколько у каждого значений.
  const counts = new Map<string, number>();
  if (job.deep) for (const r of rows) counts.set(r.prm, (counts.get(r.prm) ?? 0) + 1);
  else for (const c of leaks) for (const t of c.tuples ?? []) for (const f of Object.keys(LEAK_FIELDS) as LeakField[]) {
    const n = (t[f]?.length ?? 0) + (t.step2?.filter((x) => x.f === f).length ?? 0);
    if (n) counts.set(f, (counts.get(f) ?? 0) + n);
  }
  // Сканы документов — не атрибут, а картинки (отдельный бокс), но в фильтре включаются так же.
  if (scans.count) counts.set(SCANS_FIELD, scans.count);
  const fieldOrder = Object.keys(LEAK_FIELDS);
  const found = [...counts.keys()].sort((a, b) => (fieldOrder.indexOf(a) + 1 || 999) - (fieldOrder.indexOf(b) + 1 || 999));
  const active = new Set([...fields].filter((f) => counts.has(f)));
  const shown = (f: string) => !active.size || active.has(f);
  const toggleField = (f: string) => {
    const next = new Set(active);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setFields(next);
  };
  // В записи есть что показать: свои значения или найденные вторым шагом.
  const tupleShown = (t: LeakTuple) => fieldOrder.some((f) => shown(f) && t[f as LeakField]?.length) || !!t.step2?.some((x) => shown(x.f));
  const visibleLeaks = leaks.filter((c) => c.tuples?.some(tupleShown));

  const toggle = (key: string, label: string, value: string) => {
    const id = `${key}:${value}`;
    const next = new Map(selected);
    if (next.has(id)) next.delete(id);
    else next.set(id, { key, label, value });
    setSelected(next);
  };

  return (
    <>
      {job.params.via && (
        <div className="font-mono text-xs text-dim">
          Telegram ID <span className="text-mint">{job.params.tgid}</span> · найден по {job.params.via}
        </div>
      )}
      {step2 && (
        <div className="font-mono text-xs text-dim" title={step2Errors(step2)}>
          Второй шаг<sup className="text-mint">2</sup>: {step2Summary(step2)}
        </div>
      )}
      <ResultBar
        summary={summary}
        selected={selected.size}
        onAdd={() => setDialog(true)}
        lead={
          <>
            <Button size="sm" onClick={() => exportAs('pdf')} title={selected.size ? 'Отмеченное — в PDF' : 'Весь результат — в PDF'}>
              <FileText size={15} /> PDF
            </Button>
            <Button size="sm" onClick={() => exportAs('xlsx')} title={selected.size ? 'Отмеченное — в Excel' : 'Весь результат — в Excel'}>
              <FileSpreadsheet size={15} /> Excel
            </Button>
          </>
        }
      />

      {found.length > 0 && (
        <FieldFilter found={found} counts={counts} active={active} onToggle={toggleField} onReset={() => setFields(new Set())} />
      )}

      {!job.deep && shown('geolocs') && counts.has('geolocs') && <FoundGeoMap leaks={leaks} />}

      {scans.count > 0 && shown(SCANS_FIELD) && <ScansBox key={job.id} scans={scans} />}

      {job.deep ? (
        <DeepResult rows={rows.filter((r) => shown(r.prm))} selected={selected} onToggle={toggle} onPivot={onPivot} />
      ) : (
        <div className="space-y-4">
          {leaks.length === 0 && <Empty>Ничего не найдено</Empty>}
          {visibleLeaks.map((card) => {
            const i = leaks.indexOf(card);
            const folded = collapsed.has(i);
            return (
              <Card
                key={i}
                className={folded ? '[&>header]:mb-0' : undefined}
                title={<>{card.leak} {card.trusted && <ShieldCheck size={13} className="text-mint" />}</>}
                actions={
                  <>
                    <Tag tone="dim">{card.tuples?.length ?? 0} зап.</Tag>
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(i)}
                      title={folded ? 'Развернуть' : 'Свернуть'}
                      className="cursor-pointer rounded-md p-1 text-mute transition hover:bg-mint/10 hover:text-mint"
                    >
                      {folded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    </button>
                  </>
                }
              >
                {/* Записи одной утечки разделены тонкой серой чертой. Две колонки — только когда сам бокс
                    достаточно широк (container query), иначе значения с иконками действий не помещаются. */}
                {!folded && (
                  <div className="@container divide-y divide-white/10">
                    {card.tuples?.filter(tupleShown).map((t) => {
                      const own = (Object.keys(LEAK_FIELDS) as LeakField[]).filter(shown).flatMap((f) =>
                        (t[f] ?? []).map((v) => (
                          <ValueRow key={f + v} field={f} value={v} checked={selected.has(`${f}:${v}`)} onToggle={toggle} onPivot={onPivot} />
                        )),
                      );
                      const extra = (t.step2 ?? []).filter((x) => shown(x.f));
                      return (
                        <div key={t.tuple} className="grid gap-x-6 gap-y-1.5 py-3 first:pt-0 last:pb-0 @4xl:grid-cols-2">
                          {own}
                          {/* Найденное вторым шагом по идентификаторам этой записи — под пунктирной чертой. */}
                          {extra.length > 0 && own.length > 0 && <div className="col-span-full my-1 border-t border-dashed border-white/15" />}
                          {extra.map((x) => (
                            <ValueRow key={`2:${x.f}${x.v}`} field={x.f} value={x.v} by={x.by} checked={selected.has(`${x.f}:${x.v}`)} onToggle={toggle} onPivot={onPivot} />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AttrExportDialog
        format={exportFormat}
        job={job}
        selected={[...selected.keys()]}
        fields={[...active]}
        scans={scans.count}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
      <AddToDossierDialog
        open={dialog}
        onOpenChange={setDialog}
        values={[...selected.values()]}
        search={{ id: job.id, section: job.section, kind: job.kind, query: job.query, deep: job.deep, summary }}
      />
    </>
  );
}

// MapLibre тяжёлый — грузится, только когда в результатах есть геолокации.
const GeoPointsMap = lazy(() => import('./GeoPointsMap.tsx').then((m) => ({ default: m.GeoPointsMap })));

/** «широта, долгота» → числа; null — не координаты. */
function latLon(coords: string): { lat: number; lon: number } | null {
  const m = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/**
 * Бокс с картой найденных геолокаций (простой поиск). Одинаковые точки объединяются, в подписи —
 * утечка и «Прочее» каждой записи. Карта есть, только если раздел геопоиска включён: от него — настройки тайлов.
 */
function FoundGeoMap({ leaks }: { leaks: LeakCard[] }) {
  const geo = trpc.geo.config.useQuery(undefined, { staleTime: Infinity });
  // Выбранная дата геосканирования; null — «Все».
  const [date, setDate] = useState<string | null>(null);
  // Выключенные базы (утечки); пусто — на карте точки всех баз.
  const [off, setOff] = useState<Set<string>>(new Set());
  useEffect(() => {
    setDate(null);
    setOff(new Set());
  }, [leaks]);
  const toggleLeak = (leak: string) => {
    const next = new Set(off);
    if (next.has(leak)) next.delete(leak);
    else next.add(leak);
    setOff(next);
  };

  // Каждая геолокация каждой записи — отдельно: при выборе даты точка и её подпись собираются только из записей этой даты.
  const records = useMemo(() => {
    const out: { key: string; leak: string; lat: number; lon: number; radiusM: number | null; value: string; line: string; date: string | null }[] = [];
    for (const card of leaks) for (const t of card.tuples ?? []) {
      const date = scanDate(t.infos ?? []);
      for (const v of t.geolocs ?? []) {
        const g = parseGeoloc(v);
        const ll = latLon(g.coords);
        if (!ll) continue;
        out.push({ key: `${ll.lat},${ll.lon},${g.radiusM ?? ''}`, leak: card.leak, ...ll, radiusM: g.radiusM, value: attrDisplayValue('geolocs', v), line: [card.leak, ...(t.infos ?? [])].join(' · '), date });
      }
    }
    return out;
  }, [leaks]);

  // Фильтры перекрёстные: счётчики дат — по включённым базам, счётчики баз — по выбранной дате.
  const byLeak = useMemo(() => records.filter((r) => !off.has(r.leak)), [records, off]);
  const byDate = useMemo(() => (date ? records.filter((r) => r.date === date) : records), [records, date]);

  // Даты по возрастанию и сколько точек у каждой.
  const dates = useMemo(() => {
    const n = new Map<string, Set<string>>();
    for (const r of records) if (r.date) n.set(r.date, n.get(r.date) ?? new Set());
    for (const r of byLeak) if (r.date) n.get(r.date)!.add(r.key);
    return [...n].map(([d, keys]) => ({ d, count: keys.size })).sort((x, y) => dateKey(x.d).localeCompare(dateKey(y.d)));
  }, [records, byLeak]);

  // Базы с геолокациями — в порядке карточек результата, у каждой — число точек.
  const bases = useMemo(() => {
    const n = new Map<string, Set<string>>();
    for (const r of records) n.set(r.leak, n.get(r.leak) ?? new Set());
    for (const r of byDate) n.get(r.leak)!.add(r.key);
    return [...n].map(([leak, keys]) => ({ leak, count: keys.size }));
  }, [records, byDate]);

  const points = useMemo(() => {
    const byKey = new Map<string, FoundGeoPoint>();
    for (const r of byLeak) {
      if (date && r.date !== date) continue;
      let p = byKey.get(r.key);
      if (!p) byKey.set(r.key, (p = { lat: r.lat, lon: r.lon, radiusM: r.radiusM, lines: [r.value] }));
      p.lines.push(r.line);
    }
    return [...byKey.values()];
  }, [byLeak, date]);
  const total = useMemo(() => new Set(byLeak.map((r) => r.key)).size, [byLeak]);
  const totalBases = useMemo(() => new Set(byDate.map((r) => r.key)).size, [byDate]);

  if (!geo.data || !records.length) return null;
  return (
    <Card title="Геолокации на карте" actions={<Tag tone="dim">{points.length}</Tag>}>
      {/* isolate — z-index элементов управления карты не выходят за её пределы. */}
      <div className="isolate overflow-hidden rounded-xl border border-line">
        <Suspense fallback={<div className="grid h-[560px] place-items-center"><Spinner className="size-6" /></div>}>
          <GeoPointsMap config={geo.data} points={points} className="ft-map h-[560px] w-full" />
        </Suspense>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[11px] text-dim">Базы:</span>
        <button type="button" onClick={() => setOff(new Set())} className={chip(off.size === 0)} title="Показать точки всех баз">
          Все <span className={off.size === 0 ? 'text-mint/70' : 'text-mute'}>{totalBases}</span>
        </button>
        {bases.map(({ leak, count }) => {
          const on = !off.has(leak);
          return (
            <button key={leak} type="button" onClick={() => toggleLeak(leak)} className={chip(on)} title={on ? 'Скрыть точки этой базы' : 'Показать точки этой базы'}>
              {leak} <span className={on ? 'text-mint/70' : 'text-mute'}>{count}</span>
            </button>
          );
        })}
      </div>
      {dates.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[11px] text-dim">Геосканирование:</span>
          <button type="button" onClick={() => setDate(null)} className={chip(date === null)}>
            Все <span className={date === null ? 'text-mint/70' : 'text-mute'}>{total}</span>
          </button>
          {dates.map(({ d, count }) => (
            <button key={d} type="button" onClick={() => setDate(d)} className={chip(date === d)}>
              {d} <span className={date === d ? 'text-mint/70' : 'text-mute'}>{count}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Дата из примечания «геосканирование от 17.01.2023»; null — нет такого примечания. */
function scanDate(infos: string[]): string | null {
  for (const s of infos) {
    const m = s.match(/геосканирован\S*\s+от\s+(\d{2})\.(\d{2})\.(\d{4})/i);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  return null;
}

/** ДД.ММ.ГГГГ → ГГГГММДД для сортировки. */
const dateKey = (d: string) => d.split('.').reverse().join('');

const fieldLabel = (f: string) => (f === SCANS_FIELD ? 'Сканы документов' : LEAK_FIELDS[f as LeakField] ?? f);

/** Кнопка-переключатель (фильтр результата, атрибуты второго шага, базы и даты на карте). */
const chip = (on: boolean) =>
  clsx(
    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] uppercase tracking-wide transition',
    on ? 'border-mint bg-mint/15 text-mint' : 'border-line-soft text-dim hover:border-line hover:text-text',
  );

/** Ошибки поисков второго шага — подсказкой к его итогу. */
function step2Errors(info: Step2Info): string | undefined {
  const failed = info.queries.filter((q) => q.state === 'failed');
  return failed.length ? failed.map((q) => `${q.value}: ${q.error ?? 'ошибка'}`).join('\n') : undefined;
}

/** Какие атрибуты брать из записей второго шага: изначально все; «Все» включает или снимает разом. */
function Step2Fields({ value, onChange }: { value: Set<string>; onChange: (v: Set<string>) => void }) {
  const all = value.size === STEP2_FIELDS.length;
  const toggle = (f: string) => {
    const next = new Set(value);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-soft bg-bg-soft px-3 py-2.5">
      <span className="mr-1 flex items-center gap-1.5 font-mono text-xs text-dim">
        <ListChecks size={13} className="text-mint" /> Брать из второго шага:
      </span>
      <button type="button" onClick={() => onChange(all ? new Set() : new Set(STEP2_FIELDS))} className={chip(all)}>
        Все
      </button>
      {STEP2_FIELDS.map((f) => (
        <button key={f} type="button" onClick={() => toggle(f)} className={chip(value.has(f))}>
          {fieldLabel(f)}
        </button>
      ))}
      {!value.size && <span className="font-mono text-[11px] text-warn">отметьте хотя бы один атрибут</span>}
    </div>
  );
}

/** Бокс фильтра: только атрибуты, найденные в результатах; клик включает/выключает атрибут. */
function FieldFilter({
  found, counts, active, onToggle, onReset,
}: {
  found: string[];
  counts: Map<string, number>;
  active: Set<string>;
  onToggle: (f: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2.5">
      <span className="mr-1 flex items-center gap-1.5 font-mono text-xs text-dim">
        <Filter size={13} className="text-mint" /> Атрибуты:
      </span>
      {found.map((f) => {
        const on = active.has(f);
        return (
          <button key={f} type="button" onClick={() => onToggle(f)} className={chip(on)}>
            {fieldLabel(f)}
            <span className={on ? 'text-mint/70' : 'text-mute'}>{counts.get(f)}</span>
          </button>
        );
      })}
      {active.size > 0 && (
        <button type="button" onClick={onReset} className="ml-1 cursor-pointer font-mono text-[11px] text-mute hover:text-mint">
          показать все
        </button>
      )}
    </div>
  );
}

export function ValueRow({
  field, value, by, checked, onToggle, onPivot, via,
}: {
  field: string;
  value: string;
  /** Значение найдено вторым шагом по этим идентификаторам записи: у подписи «²» и «найден по …». */
  by?: readonly string[];
  checked: boolean;
  onToggle: (key: string, label: string, value: string) => void;
  onPivot: (kind: string, value: string) => void;
  via?: string;
}) {
  const label = LEAK_FIELDS[field as LeakField] ?? field;
  const pivotKind = FIELD_TO_KIND[field as LeakField];
  return (
    <div className="group flex flex-wrap items-center gap-2 rounded-md px-1.5 py-1 hover:bg-mint/5">
      <button
        onClick={() => onToggle(field, label, value)}
        className={clsx('grid size-4 shrink-0 cursor-pointer place-items-center rounded border', checked ? 'border-mint bg-mint text-mint-ink' : 'border-line')}
        title="Отметить для досье"
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </button>
      <span className="w-32 shrink-0 font-mono text-[11px] uppercase tracking-wide text-mute">
        {label}
        {by && (
          <>
            <sup className="ml-0.5 text-mint" title="Найдено дополнительным поиском вторым шагом">2</sup>
            <span className="block text-[10px] normal-case tracking-normal text-mute/80">({step2ByText(by)})</span>
          </>
        )}
      </span>
      <span className="min-w-[7rem] flex-1 break-words font-mono text-sm">{field === 'geolocs' ? attrDisplayValue(field, value) : value}</span>
      {via && <span className="hidden truncate font-mono text-[10px] text-mute md:inline">через {via}</span>}
      {/* Иконки держатся вместе: в узкой колонке они переносятся под значение, а не ломают его по символам. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {pivotKind && (
          <button
            onClick={() => onPivot(pivotKind, value)}
            className="cursor-pointer text-mute opacity-0 transition hover:text-mint group-hover:opacity-100"
            title="Искать по этому значению"
          >
            <Zap size={14} />
          </button>
        )}
        <ValueActions field={field} value={value} />
        <CopyButton value={attrCopyValue(field, value)} title={`Скопировать: ${label}`} />
      </div>
    </div>
  );
}

/** Подпись «найдено через …» под строкой deep-поиска: имя и значение родительского атрибута с копированием. */
function FoundVia({ row, parent }: { row: DeepRow; parent?: DeepRow }) {
  const via = parent?.val ?? '';
  const label = LEAK_FIELDS[(parent?.prm ?? row.link4) as LeakField] ?? row.link4;
  return (
    <div className="ml-8 flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-mute">
      <CornerDownRight size={10} className="shrink-0" />
      <span className="shrink-0">найдено через {row.link4}</span>
      {via && (
        <>
          <span className="break-all text-text/70">{via}</span>
          <CopyButton
            value={attrCopyValue(parent?.prm ?? '', via)}
            title={`Скопировать: ${label}`}
            className="[&>svg]:size-3"
          />
        </>
      )}
    </div>
  );
}

function DeepResult({
  rows, selected, onToggle, onPivot,
}: {
  rows: DeepRow[];
  selected: Map<string, PendingValue>;
  onToggle: (key: string, label: string, value: string) => void;
  onPivot: (kind: string, value: string) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, DeepRow[]>();
    for (const r of rows) m.set(r.prm, [...(m.get(r.prm) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  // link4_id — это val_id родительской строки в том же ответе: по нему достаём значение, через которое найдена эта.
  const byId = useMemo(() => new Map(rows.map((r) => [r.val_id, r] as const)), [rows]);
  if (!rows.length) return <Empty>Ничего не найдено</Empty>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map(([prm, list]) => (
        <Card key={prm} title={LEAK_FIELDS[prm as LeakField] ?? prm} actions={<Tag tone="dim">{list.length}</Tag>}>
          {list.map((r) => (
            <div key={r.val_id}>
              <ValueRow field={prm} value={r.val} checked={selected.has(`${prm}:${r.val}`)} onToggle={onToggle} onPivot={onPivot} />
              {r.link4_id > 0 && <FoundVia row={r} parent={byId.get(r.link4_id)} />}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
