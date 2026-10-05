import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { Check, CornerDownRight, Filter, Layers, Search as SearchIcon, ShieldCheck, Zap } from 'lucide-react';
import { FIELD_TO_KIND, LEAK_FIELDS, SEARCH_KINDS, detectKinds, isUkrainianPhone, type DeepRow, type LeakCard, type LeakField } from '@ft/shared';
import { Button, Card, CopyButton, Empty, Input, Select, Spinner, Tag } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { searchRoute } from '../../router.tsx';
import { AddToDossierDialog, type PendingValue } from './AddToDossierDialog.tsx';
import { JobStatus, ResultBar, SearchLayout, useRunOnMount, useSearchJob } from './common.tsx';
import { ValueActions } from './ValueActions.tsx';

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
    start.mutate({ section: 'attr', kind: k, value: v.trim(), deep: d });
  }

  // Переход по ссылке /search?kind=..&q=.. (из досье или «провалиться» в значение) запускает поиск.
  useRunOnMount(() => {
    setValue(params.q!);
    setKind(params.kind!);
    setDeep(params.deep ?? false);
    start.mutate({ section: 'attr', kind: params.kind!, value: params.q!, deep: params.deep ?? false });
  }, !!(params.q && params.kind && me.data?.access.active));

  const pivot = (k: string, v: string) => {
    setValue(v);
    setKind(k);
    run(k, v, deep);
  };

  const disabled = !me.data?.access.active;

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
              <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !effectiveKind || !value.trim() || start.isPending}>
                {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : 'Искать'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className={clsx('flex cursor-pointer items-center gap-2', !kindInfo?.deep && 'opacity-40')}>
                <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} disabled={!kindInfo?.deep} className="accent-[var(--color-mint)]" />
                <Layers size={14} className="text-mint" /> Глубокий поиск со связями
              </label>
              {(kind === 'auto' || autoPick) && value.trim() && !detected.length && (
                <Tag tone="warn">{isUkrainianPhone(value) ? 'поиск только по номерам РФ' : 'тип не распознан — выберите вручную'}</Tag>
              )}
              {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
            </div>
          </form>
        </Card>

      {jobId && <JobView job={job.data} loading={job.isLoading} onPivot={pivot} />}
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

function JobView({ job, loading, onPivot }: { job: Job | undefined; loading: boolean; onPivot: (kind: string, value: string) => void }) {
  const [selected, setSelected] = useState<Map<string, PendingValue>>(new Map());
  const [dialog, setDialog] = useState(false);
  // Фильтр по найденным атрибутам: пусто — показывать всё.
  const [fields, setFields] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Map());
    setFields(new Set());
  }, [job?.id]);

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
  const status = <JobStatus job={job} loading={loading} />;
  if (!job || job.state !== 'done') return status;

  const res = job.result as { job?: { leaks?: LeakCard[]; rows?: DeepRow[] } } | null;
  const leaks = res?.job?.leaks ?? [];
  const rows = res?.job?.rows ?? [];
  const summary = job.deep ? `${rows.length} связанных значений` : `${leaks.length} утечек`;

  // Атрибуты, которые есть в результатах, и сколько у каждого значений.
  const counts = new Map<string, number>();
  if (job.deep) for (const r of rows) counts.set(r.prm, (counts.get(r.prm) ?? 0) + 1);
  else for (const c of leaks) for (const t of c.tuples ?? []) for (const f of Object.keys(LEAK_FIELDS) as LeakField[]) {
    const n = t[f]?.length ?? 0;
    if (n) counts.set(f, (counts.get(f) ?? 0) + n);
  }
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
  const visibleLeaks = leaks.filter((c) => c.tuples?.some((t) => fieldOrder.some((f) => shown(f) && t[f as LeakField]?.length)));

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
      <ResultBar summary={summary} selected={selected.size} onAdd={() => setDialog(true)} />

      {found.length > 0 && (
        <FieldFilter found={found} counts={counts} active={active} onToggle={toggleField} onReset={() => setFields(new Set())} />
      )}

      {job.deep ? (
        <DeepResult rows={rows.filter((r) => shown(r.prm))} selected={selected} onToggle={toggle} onPivot={onPivot} />
      ) : (
        <div className="space-y-4">
          {leaks.length === 0 && <Empty>Ничего не найдено</Empty>}
          {visibleLeaks.map((card, i) => (
            <Card
              key={i}
              title={<>{card.leak} {card.trusted && <ShieldCheck size={13} className="text-mint" />}</>}
              actions={<Tag tone="dim">{card.tuples?.length ?? 0} зап.</Tag>}
            >
              {/* Записи одной утечки разделены тонкой серой чертой. Две колонки — только когда сам бокс
                  достаточно широк (container query), иначе значения с иконками действий не помещаются. */}
              <div className="@container divide-y divide-white/10">
                {card.tuples?.filter((t) => fieldOrder.some((f) => shown(f) && t[f as LeakField]?.length)).map((t) => (
                  <div key={t.tuple} className="grid gap-x-6 gap-y-1.5 py-3 first:pt-0 last:pb-0 @4xl:grid-cols-2">
                    {(Object.keys(LEAK_FIELDS) as LeakField[]).filter(shown).flatMap((f) =>
                      (t[f] ?? []).map((v) => (
                        <ValueRow key={f + v} field={f} value={v} checked={selected.has(`${f}:${v}`)} onToggle={toggle} onPivot={onPivot} />
                      )),
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <AddToDossierDialog
        open={dialog}
        onOpenChange={setDialog}
        values={[...selected.values()]}
        search={{ id: job.id, section: 'attr', kind: job.kind, query: job.query, deep: job.deep, summary }}
      />
    </>
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
          <button
            key={f}
            type="button"
            onClick={() => onToggle(f)}
            className={clsx(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] uppercase tracking-wide transition',
              on ? 'border-mint bg-mint/15 text-mint' : 'border-line-soft text-dim hover:border-line hover:text-text',
            )}
          >
            {LEAK_FIELDS[f as LeakField] ?? f}
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
  field, value, checked, onToggle, onPivot, via,
}: {
  field: string;
  value: string;
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
      <span className="w-32 shrink-0 font-mono text-[11px] uppercase tracking-wide text-mute">{label}</span>
      <span className="min-w-[7rem] flex-1 break-words font-mono text-sm">{value}</span>
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
        <CopyButton value={value} title={`Скопировать: ${label}`} />
      </div>
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
  if (!rows.length) return <Empty>Ничего не найдено</Empty>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map(([prm, list]) => (
        <Card key={prm} title={LEAK_FIELDS[prm as LeakField] ?? prm} actions={<Tag tone="dim">{list.length}</Tag>}>
          {list.map((r) => (
            <div key={r.val_id}>
              <ValueRow field={prm} value={r.val} checked={selected.has(`${prm}:${r.val}`)} onToggle={onToggle} onPivot={onPivot} />
              {r.link4_id > 0 && (
                <div className="ml-8 flex items-center gap-1 font-mono text-[10px] text-mute">
                  <CornerDownRight size={10} /> найдено через {r.link4}
                </div>
              )}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
