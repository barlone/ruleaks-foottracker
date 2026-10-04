import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { Check, CornerDownRight, Layers, Search as SearchIcon, ShieldCheck, Zap } from 'lucide-react';
import { FIELD_TO_KIND, LEAK_FIELDS, SEARCH_KINDS, detectKind, type DeepRow, type LeakCard, type LeakField } from '@ft/shared';
import { Button, Card, Empty, Input, Select, Spinner, Tag } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { searchRoute } from '../../router.tsx';
import { AddToDossierDialog, type PendingValue } from './AddToDossierDialog.tsx';
import { JobStatus, ResultBar, SearchLayout, useRunOnMount, useSearchJob } from './common.tsx';

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

  const detected = useMemo(() => detectKind(value), [value]);
  const effectiveKind = kind === 'auto' ? detected : kind;
  const kindInfo = SEARCH_KINDS.find((k) => k.id === effectiveKind);

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
              <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-12 md:w-56" disabled={disabled}>
                <option value="auto">Авто{detected ? `: ${SEARCH_KINDS.find((k) => k.id === detected)?.label}` : ''}</option>
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
              {kind === 'auto' && value && !detected && <Tag tone="warn">тип не распознан — выберите вручную</Tag>}
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
  useEffect(() => setSelected(new Map()), [job?.id]);

  const status = <JobStatus job={job} loading={loading} />;
  if (!job || job.state !== 'done') return status;

  const res = job.result as { job?: { leaks?: LeakCard[]; rows?: DeepRow[] } } | null;
  const leaks = res?.job?.leaks ?? [];
  const rows = res?.job?.rows ?? [];
  const summary = job.deep ? `${rows.length} связанных значений` : `${leaks.length} утечек`;

  const toggle = (key: string, label: string, value: string) => {
    const id = `${key}:${value}`;
    const next = new Map(selected);
    if (next.has(id)) next.delete(id);
    else next.set(id, { key, label, value });
    setSelected(next);
  };

  return (
    <>
      <ResultBar summary={summary} selected={selected.size} onAdd={() => setDialog(true)} />

      {job.deep ? (
        <DeepResult rows={rows} selected={selected} onToggle={toggle} onPivot={onPivot} />
      ) : (
        <div className="space-y-4">
          {leaks.length === 0 && <Empty>Ничего не найдено</Empty>}
          {leaks.map((card, i) => (
            <Card
              key={i}
              title={<>{card.leak} {card.trusted && <ShieldCheck size={13} className="text-mint" />}</>}
              actions={<Tag tone="dim">{card.tuples?.length ?? 0} зап.</Tag>}
            >
              {card.tuples?.map((t) => (
                <div key={t.tuple} className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {(Object.keys(LEAK_FIELDS) as LeakField[]).flatMap((f) =>
                    (t[f] ?? []).map((v) => (
                      <ValueRow key={f + v} field={f} value={v} checked={selected.has(`${f}:${v}`)} onToggle={toggle} onPivot={onPivot} />
                    )),
                  )}
                </div>
              ))}
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
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-mint/5">
      <button
        onClick={() => onToggle(field, label, value)}
        className={clsx('grid size-4 shrink-0 cursor-pointer place-items-center rounded border', checked ? 'border-mint bg-mint text-mint-ink' : 'border-line')}
        title="Отметить для досье"
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </button>
      <span className="w-32 shrink-0 font-mono text-[11px] uppercase tracking-wide text-mute">{label}</span>
      <span className="min-w-0 flex-1 break-words font-mono text-sm">{value}</span>
      {via && <span className="hidden truncate font-mono text-[10px] text-mute md:inline">через {via}</span>}
      {pivotKind && (
        <button
          onClick={() => onPivot(pivotKind, value)}
          className="cursor-pointer text-mute opacity-0 transition hover:text-mint group-hover:opacity-100"
          title="Искать по этому значению"
        >
          <Zap size={14} />
        </button>
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
