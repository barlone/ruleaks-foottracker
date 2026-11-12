import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { FolderPlus, History, Mail } from 'lucide-react';
import { EMAIL_PARTS, EMAIL_QUERY_MAX, GHUNT_URL, MOSINT_URL, emailQueryProblem, parseEmail, type EmailPartId } from '@ft/shared';
import { ProgressDialog } from '../../components/ProgressDialog.tsx';
import { Button, Card, Empty, Input, Spinner, Tag, WarnNote } from '../../components/ui.tsx';
import { errorText } from '../../lib/errors.ts';
import { ago } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { AddPagesDialog, type PendingPage } from './AddPagesDialog.tsx';
import { SearchLayout } from './common.tsx';
import { EmailReportView } from './EmailReportView.tsx';
import { reportLinks } from './emailSearch.ts';
import { EmailRunContext } from './googleSearch.ts';
import { useRunOnMount } from './job.ts';
import { BackToDossier } from './BackToDossier.tsx';

// «Поиск по Email» — GHunt + MOSINT: сервер собирает отчёт по адресу (email.start), страница раз в секунду спрашивает
// ход работы по частям (email.job) и показывает отчёт. Из найденного (адреса коллег у Hunter, адрес профиля Google)
// можно сразу искать дальше на этой же странице (EmailRunContext).

type Job = RouterOutputs['email']['job'];

const PART_LABEL = Object.fromEntries(EMAIL_PARTS.map((p) => [p.id, p.label])) as Record<EmailPartId, string>;

export function EmailSearchPage() {
  // null — раздел выключен в config.ini ([config] email-search).
  const cfg = trpc.email.config.useQuery(undefined, { staleTime: Infinity });
  if (cfg.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!cfg.data) {
    return (
      <div className="pt-2.5 pb-6 pl-6 pr-[30px]">
        <Empty>Раздел «Исследовать Email» выключен в настройках сервера.</Empty>
      </div>
    );
  }
  return <EmailSearch config={cfg.data} />;
}

function EmailSearch({ config }: { config: NonNullable<RouterOutputs['email']['config']> }) {
  const params = useSearch({ from: '/search/email' });
  const navigate = useNavigate({ from: '/search/email' });
  const me = trpc.auth.me.useQuery();
  const pages = trpc.pages.config.useQuery(undefined, { staleTime: Infinity });
  const utils = trpc.useUtils();
  const [value, setValue] = useState(params.q ?? '');
  const [jobId, setJobId] = useState<string | null>(null);

  const start = trpc.email.start.useMutation({
    onSuccess: (j) => {
      setJobId(j.id);
      utils.email.job.setData({ id: j.id }, j);
      void utils.email.recent.invalidate();
    },
  });
  const job = trpc.email.job.useQuery(
    { id: jobId ?? '' },
    // После ошибки (задание пропало — сервер перезапущен) прежние данные остаются в кэше: по ним опрос не продолжаем.
    { enabled: !!jobId, refetchInterval: (q) => (!q.state.error && q.state.data?.state === 'running' ? 1000 : false), refetchIntervalInBackground: true },
  );
  const cancel = trpc.email.cancel.useMutation({
    onSuccess: () => void utils.email.job.invalidate({ id: jobId ?? '' }),
    onError: (e) => toast(errorText(e), 'error'),
  });
  const j = job.data;
  const state = j?.state;
  useEffect(() => {
    if (state && state !== 'running') void utils.email.recent.invalidate();
  }, [state, utils]);
  // Открыли поиск из истории — в строке его адрес.
  useEffect(() => {
    if (j) setValue(j.email);
  }, [j?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = value.trim();
  const problem = emailQueryProblem(query);
  const disabled = !me.data?.access.active;

  const run = useCallback((q: string) => {
    const parsed = parseEmail(q);
    if (!parsed) return;
    setValue(parsed.email);
    void navigate({ search: (prev) => ({ ...prev, q: parsed.email }) }); // from (досье) остаётся
    start.mutate({ query: parsed.email });
    // start из useMutation стабилен по поведению; navigate — тоже.
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  useRunOnMount(() => run(params.q!), !!params.q, !!me.data?.access.active);

  const running = !!jobId && !job.error && j?.state === 'running';
  const now = j?.parts.filter((p) => p.state === 'running').map((p) => (p.note ? `${PART_LABEL[p.id]}: ${p.note}` : PART_LABEL[p.id])) ?? [];
  const available = EMAIL_PARTS.filter((p) => config.parts[p.id]);

  return (
    <EmailRunContext.Provider value={disabled ? null : run}>
      <SearchLayout
        title="Исследовать Email"
        titleExtra={(
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {params.from && <BackToDossier id={params.from} />}
            <div className="font-mono text-[11px] text-mute">
              inspired by{' '}
              <a href={GHUNT_URL} target="_blank" rel="noreferrer" className="text-mint/80 underline underline-offset-4 hover:text-mint">GHunt</a>
              {' · '}
              <a href={MOSINT_URL} target="_blank" rel="noreferrer" className="text-mint/80 underline underline-offset-4 hover:text-mint">MOSINT</a>
            </div>
          </div>
        )}
        subtitle="Что известно об адресе электронной почты: аккаунт Google, регистрации на сайтах, утечки и дампы, репутация, домен и его почтовые серверы."
        history={<EmailHistory activeId={jobId} onOpen={setJobId} />}
      >
        {config.googleDemo && (
          <WarnNote>Режим имитации: служебный аккаунт Google на сервере не настроен — часть «Аккаунт Google» отвечает вымышленными данными. Остальные проверки настоящие.</WarnNote>
        )}
        <Card className="animate-fade-up">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(query);
            }}
          >
            <div className="flex gap-3 max-md:flex-col">
              <div className="relative flex-1">
                <Mail size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
                <Input
                  autoFocus
                  type="email"
                  inputMode="email"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="ivan.petrov@gmail.com"
                  className="h-12 pl-10 font-mono text-base"
                  disabled={disabled}
                  maxLength={EMAIL_QUERY_MAX + 8}
                />
              </div>
              <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !query || !!problem || start.isPending}>
                {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : 'Искать'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
              <span>
                Только адрес электронной почты. Проверки зависят от домена: у своего домена — ещё его записи DNS
                и почтовые политики, регистрация, серверы и сотрудники (Hunter); у Gmail и бесплатных сервисов — то,
                что касается самого адреса.
              </span>
              {problem && <Tag tone="warn">{problem}</Tag>}
              {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
            </div>
          </form>
        </Card>

        <ProgressDialog
          open={running}
          title="Исследовать Email"
          value={j && j.partsTotal ? j.partsDone / j.partsTotal : null}
          status={now.length ? now.join(' · ') : 'Запуск…'}
          detail={j?.email}
          startedAt={j ? new Date(j.startedAt).getTime() : null}
          onCancel={() => jobId && cancel.mutate({ id: jobId })}
          cancelling={cancel.isPending}
        />

        {jobId ? (
          <EmailResult job={j} loading={job.isLoading} error={job.error ? errorText(job.error) : null} pagesEnabled={!!pages.data} />
        ) : (
          <Empty>
            Введите адрес — сервер проверит его по источникам:
            <br />
            <span className="font-mono text-xs text-mute">{available.map((p) => p.label).join(' · ')}</span>
          </Empty>
        )}
      </SearchLayout>
    </EmailRunContext.Provider>
  );
}

function EmailHistory({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }) {
  const recent = trpc.email.recent.useQuery(undefined, { refetchInterval: (q) => (!q.state.error && q.state.data?.some((j) => j.state === 'running') ? 3000 : false) });
  const items = recent.data ?? [];
  return (
    <Card title={<><History size={13} /> История</>}>
      {!items.length && <div className="font-mono text-xs text-mute">Пока пусто</div>}
      <div className="max-h-[60vh] space-y-1 overflow-auto">
        {items.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            className={clsx('block w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition hover:bg-mint/5', s.id === activeId && 'bg-mint/10')}
          >
            <div className="truncate font-mono text-sm">{s.email}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-mute">
              {s.hits !== null && <span className={s.hits ? 'text-mint' : ''}>{s.hits ? `находок: ${s.hits}` : 'ничего не найдено'}</span>}
              {s.state === 'failed' && <span className="text-danger">ошибка</span>}
              {s.state === 'cancelled' && <span className="text-warn">остановлен</span>}
              <span className="shrink-0">· {ago(s.startedAt)}</span>
              {s.state === 'running' && <Spinner className="size-2.5" />}
            </div>
          </button>
        ))}
      </div>
      {items.length > 0 && <div className="mt-3 border-t border-line-soft pt-3 font-mono text-[10px] text-mute">Результаты хранятся в памяти сервера около часа.</div>}
    </Card>
  );
}

function EmailResult({ job, loading, error, pagesEnabled }: { job: Job | undefined; loading: boolean; error: string | null; pagesEnabled: boolean }) {
  const [adding, setAdding] = useState<PendingPage[] | null>(null);

  if (error) return <Card><div className="text-danger">{error}</div></Card>;
  if (loading || !job) return <Empty><Spinner /></Empty>;
  if (job.state === 'running') {
    return (
      <Card>
        <div className="flex items-center gap-3 font-mono text-sm text-mint">
          <Spinner /> Идёт поиск: {job.email}
        </div>
      </Card>
    );
  }
  if (job.state === 'failed') return <Card><div className="text-danger">{job.error ?? 'Поиск не удался'}</div></Card>;
  const report = job.report;
  if (job.state === 'cancelled' || !report) return <Empty>Поиск остановлен.</Empty>;

  const links = reportLinks(report);
  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-4 py-2.5 backdrop-blur">
        <div className="min-w-0 truncate font-mono text-xs text-dim">
          <span className="text-mint">{report.email}</span>
          {job.finishedAt && <span className="ml-2">· {ago(job.finishedAt)}</span>}
        </div>
        <Button variant="primary" size="sm" onClick={() => setAdding(links)} disabled={!links.length} title={links.length ? 'Найденные ссылки — в «Соцсети и ссылки» досье' : 'Ссылок для досье нет'}>
          <FolderPlus size={15} /> Ссылки в досье
        </Button>
      </div>

      <EmailReportView report={report} pagesEnabled={pagesEnabled} />

      <AddPagesDialog open={!!adding} onOpenChange={(v) => !v && setAdding(null)} pages={adding ?? []} username={report.email} note={`Исследование Email: ${report.email}`} />
    </>
  );
}
