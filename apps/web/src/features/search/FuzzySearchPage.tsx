import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { Asterisk, Car } from 'lucide-react';
import { FUZZY_MODES, checkMask, findFuzzyMode, normalizePlateMask, type FuzzyMatch, type FuzzyModeId } from '@ft/shared';
import { Button, Card, Empty, Input, Spinner, Tag } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { fuzzySearchRoute } from '../../router.tsx';
import { AddToDossierDialog } from './AddToDossierDialog.tsx';
import { ValueRow, useSelection } from './AttrSearchPage.tsx';
import { JobStatus, ResultBar, SearchLayout, useRunOnMount, useSearchJob } from './common.tsx';

type Job = RouterOutputs['search']['job'];

/** Поля совпадения → ключи LEAK_FIELDS (подписи и «провалиться в поиск»). */
const MATCH_FIELDS: [keyof FuzzyMatch, string][] = [
  ['names', 'names'], ['addrs', 'addrs'], ['vehicles', 'vehicles'], ['milpns', 'milpns'],
  ['milranks', 'milranks'], ['milposs', 'milposs'], ['milunits', 'milunits'], ['infos', 'infos'],
];

/** «Нечёткий поиск» — /regsearch бота: маски email и госномеров. */
export function FuzzySearchPage() {
  const params = fuzzySearchRoute.useSearch();
  const navigate = useNavigate({ from: '/search/fuzzy' });
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<FuzzyModeId>((params.mode as FuzzyModeId) ?? 'email');
  const [value, setValue] = useState(params.q ?? '');
  const [vehicpart, setVehicpart] = useState(params.vehicpart ?? '');
  const [jobId, setJobId] = useState<string | null>(null);
  const info = findFuzzyMode(mode)!;

  const start = trpc.search.start.useMutation({
    onSuccess: (j) => {
      setJobId(j.id);
      void utils.search.recent.invalidate({ section: 'fuzzy' });
    },
  });
  const job = useSearchJob(jobId);

  const normalized = mode === 'plate' ? normalizePlateMask(value) : value.trim().toLowerCase();
  const problem = value.trim() ? checkMask(normalized) : null;

  function run() {
    if (!value.trim() || problem) return;
    const vp = mode === 'plate' && vehicpart.trim() ? vehicpart.trim() : undefined;
    void navigate({ search: { mode, q: value, vehicpart: vp } });
    start.mutate({ section: 'fuzzy', mode, value: value.trim(), vehicpart: vp });
  }

  useRunOnMount(
    () => start.mutate({ section: 'fuzzy', mode: params.mode as FuzzyModeId, value: params.q!, vehicpart: params.vehicpart }),
    !!(params.q && params.mode),
    !!me.data?.access.active,
  );

  const disabled = !me.data?.access.active;

  return (
    <SearchLayout
      section="fuzzy"
      title="Нечёткий поиск"
      subtitle="Поиск по маске, когда известна только часть значения. Выполняется дольше обычного."
      activeId={jobId}
      onOpen={setJobId}
    >
      <Card className="animate-fade-up">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {FUZZY_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={clsx(
                'cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition',
                mode === m.id ? 'border-mint/60 bg-mint/10 font-semibold text-mint' : 'border-line-soft text-dim hover:border-line hover:text-text',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <div className="flex gap-3 max-md:flex-col">
            <div className="relative flex-1">
              <Asterisk size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
              <Input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={info.placeholder}
                className="h-12 pl-10 font-mono text-base"
                disabled={disabled}
              />
            </div>
            {mode === 'plate' && (
              <div className="relative md:w-56">
                <Car size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
                <Input value={vehicpart} onChange={(e) => setVehicpart(e.target.value)} placeholder="марка: BMW" className="h-12 pl-10" disabled={disabled} />
              </div>
            )}
            <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !value.trim() || !!problem || start.isPending}>
              {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : 'Искать'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
            <span>{info.hint}</span>
            {mode === 'plate' && value.trim() && normalized !== value.trim() && <Tag tone="dim">→ {normalized}</Tag>}
            {problem && <Tag tone="warn">{problem}</Tag>}
            {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
          </div>
        </form>
      </Card>

      {jobId ? <FuzzyJobView job={job.data} loading={job.isLoading} error={job.error ? errorText(job.error) : null} /> : <Empty>Используйте ? для одного неизвестного символа и * для любой последовательности.</Empty>}
    </SearchLayout>
  );
}

function FuzzyJobView({ job, loading, error }: { job: Job | undefined; loading: boolean; error?: string | null }) {
  const navigate = useNavigate();
  const { selected, toggle, reset } = useSelection();
  const [dialog, setDialog] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => reset(), [job?.id]);
  const results = useMemo(() => ((job?.result as { job?: { results?: FuzzyMatch[] } } | null)?.job?.results ?? []), [job?.result]);

  const status = <JobStatus job={job} loading={loading} error={error} />;
  if (!job || job.state !== 'done') return status;

  const matchField = job.kind === 'plate' ? 'plates' : 'emails';
  const pivot = (kind: string, q: string) => void navigate({ to: '/search', search: { kind, q } });
  const summary = `совпадений: ${results.length}`;

  return (
    <>
      <ResultBar summary={summary} selected={selected.size} onAdd={() => setDialog(true)} />
      {results.length === 0 && <Empty>Ничего не найдено</Empty>}
      <div className="grid gap-3 lg:grid-cols-2">
        {results.map((r, i) => {
          const details = MATCH_FIELDS.some(([f]) => ((r[f] as string[] | undefined) ?? []).length > 0);
          return (
          <Card key={i} className="!p-4">
            <ValueRow field={matchField} value={r.match} checked={selected.has(`${matchField}:${r.match}`)} onToggle={toggle} onPivot={pivot} />
            {/* Найденное значение (email или госномер) отделено от остальных сведений тонкой чертой в цвет рамки бокса. */}
            {details && <div className="my-2 border-t border-line" />}
            {MATCH_FIELDS.flatMap(([f, key]) =>
              ((r[f] as string[] | undefined) ?? []).map((v) => (
                <ValueRow key={key + v} field={key} value={v} checked={selected.has(`${key}:${v}`)} onToggle={toggle} onPivot={pivot} />
              )),
            )}
          </Card>
          );
        })}
      </div>
      <AddToDossierDialog
        open={dialog}
        onOpenChange={setDialog}
        values={[...selected.values()]}
        search={{ id: job.id, section: 'fuzzy', kind: job.kind, query: job.query, deep: false, summary }}
      />
    </>
  );
}
