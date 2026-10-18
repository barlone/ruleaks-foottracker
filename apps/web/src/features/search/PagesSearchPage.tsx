import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { Copy, ExternalLink, FolderPlus, History, UserSearch } from 'lucide-react';
import { BLACKBIRD_URL, HOLEHE_URL, isPagesQuery, PAGES_EMAIL_RE, PAGES_QUERY_MAX, SHERLOCK_URL } from '@ft/shared';
import { ProgressDialog } from '../../components/ProgressDialog.tsx';
import { Button, Card, CopyButton, Empty, Input, Segmented, Spinner, Tag } from '../../components/ui.tsx';
import { copyText } from '../../lib/clipboard.ts';
import { errorText } from '../../lib/errors.ts';
import { ago } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { pagesSearchRoute } from '../../router.tsx';
import { AddPagesDialog, type PendingPage } from './AddPagesDialog.tsx';
import { SearchLayout, useRunOnMount } from './common.tsx';

// «Поиск личных страниц»: имя пользователя → страницы на сайтах и в соцсетях из списка проекта Sherlock.
// Сайты опрашивает сервер (pages.start), страница раз в секунду спрашивает ход работы (pages.job)
// и показывает его в окне процесса; результат — ссылки на найденные страницы.

type Job = RouterOutputs['pages']['job'];
type Result = Job['found'][number];

const STATUS: Record<Result['status'], { label: string; tone: 'mint' | 'dim' | 'warn' | 'danger' }> = {
  claimed: { label: 'найдено', tone: 'mint' },
  available: { label: 'нет', tone: 'dim' },
  unknown: { label: 'нет ответа', tone: 'danger' },
  waf: { label: 'защита от ботов', tone: 'warn' },
  illegal: { label: 'имя не подходит', tone: 'dim' },
};

/** Чем найдена страница. */
const BY_LABEL: Record<Result['by'], string> = { username: 'по нику', email: 'по e-mail' };

/** «@nick» → «nick»; e-mail не трогаем (он не начинается с @). */
const clean = (s: string) => s.trim().replace(/^@/, '');

function problemOf(query: string): string | null {
  if (!query) return null;
  if (query.length > PAGES_QUERY_MAX) return `не длиннее ${PAGES_QUERY_MAX} символов`;
  if (!isPagesQuery(query)) return 'ник без пробелов и / \\ ? # % & или корректный e-mail';
  return null;
}

export function PagesSearchPage() {
  // null — раздел выключен в config.ini ([config] pages-search).
  const cfg = trpc.pages.config.useQuery(undefined, { staleTime: Infinity });
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
        <Empty>Поиск личных страниц выключен в настройках сервера.</Empty>
      </div>
    );
  }
  return <PagesSearch sites={cfg.data.sites} emailSites={cfg.data.emailSites} />;
}

function PagesSearch({ sites, emailSites }: { sites: number; emailSites: number }) {
  const params = pagesSearchRoute.useSearch();
  const navigate = useNavigate({ from: '/search/pages' });
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const [value, setValue] = useState(params.q ?? '');
  const [jobId, setJobId] = useState<string | null>(null);

  const start = trpc.pages.start.useMutation({
    onSuccess: (j) => {
      setJobId(j.id);
      utils.pages.job.setData({ id: j.id }, j);
      void utils.pages.recent.invalidate();
    },
  });
  const job = trpc.pages.job.useQuery(
    { id: jobId ?? '' },
    // После ошибки (задание пропало — сервер перезапущен) прежние данные остаются в кэше: по ним опрос не продолжаем.
    { enabled: !!jobId, refetchInterval: (q) => (!q.state.error && q.state.data?.state === 'running' ? 1000 : false), refetchIntervalInBackground: true },
  );
  const cancel = trpc.pages.cancel.useMutation({
    onSuccess: () => void utils.pages.job.invalidate({ id: jobId ?? '' }),
    onError: (e) => toast(errorText(e), 'error'),
  });
  // Поиск закончился — в истории не должно остаться индикатора «выполняется».
  const state = job.data?.state;
  useEffect(() => {
    if (state && state !== 'running') void utils.pages.recent.invalidate();
  }, [state, utils]);

  const username = clean(value);
  const problem = problemOf(username);
  const isEmail = PAGES_EMAIL_RE.test(username);
  const disabled = !me.data?.access.active;

  function run() {
    if (!username || problem) return;
    void navigate({ search: { q: username } });
    start.mutate({ username });
  }

  useRunOnMount(() => start.mutate({ username: clean(params.q!) }), !!(params.q && !problemOf(clean(params.q)) && me.data?.access.active));

  const j = job.data;
  // Ошибка запроса задания закрывает окно процесса: иначе оно показывало бы устаревшее «выполняется» без выхода.
  const running = !!jobId && !job.error && j?.state === 'running';

  return (
    <SearchLayout
      title="Поиск личных страниц"
      titleExtra={(
        <div className="font-mono text-[11px] text-mute">
          inspired by{' '}
          <a href={SHERLOCK_URL} target="_blank" rel="noreferrer" className="text-mint/80 underline underline-offset-4 hover:text-mint">Sherlock</a>,{' '}
          <a href={HOLEHE_URL} target="_blank" rel="noreferrer" className="text-mint/80 underline underline-offset-4 hover:text-mint">holehe</a>,{' '}
          <a href={BLACKBIRD_URL} target="_blank" rel="noreferrer" className="text-mint/80 underline underline-offset-4 hover:text-mint">blackbird</a>
        </div>
      )}
      subtitle={`По нику (${sites} сайтов) или e-mail (${emailSites} сервисов + поиск по нику из части до @). Поиск занимает одну-две минуты.`}
      history={<PagesHistory activeId={jobId} onOpen={setJobId} />}
    >
      <Card className="animate-fade-up">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <div className="flex gap-3 max-md:flex-col">
            <div className="relative flex-1">
              <UserSearch size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
              <Input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="ник или e-mail: ivan_petrov или ivan@mail.ru"
                className="h-12 pl-10 font-mono text-base"
                disabled={disabled}
                maxLength={PAGES_QUERY_MAX + 1}
              />
            </div>
            <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !username || !!problem || start.isPending}>
              {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : 'Поиск'}
            </Button>
          </div>
          {(isEmail || problem || start.error) && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
              {isEmail && <Tag tone="info">e-mail</Tag>}
              {problem && <Tag tone="warn">{problem}</Tag>}
              {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
            </div>
          )}
        </form>
      </Card>

      <ProgressDialog
        open={running}
        title="Поиск личных страниц"
        value={j && j.total ? j.done / j.total : null}
        status={j ? `Проверено ${j.done} из ${j.total} сайтов` : 'Запуск…'}
        detail={j ? `${j.username} · найдено: ${j.found.length}` : undefined}
        startedAt={j ? new Date(j.startedAt).getTime() : null}
        onCancel={() => jobId && cancel.mutate({ id: jobId })}
        cancelling={cancel.isPending}
      />

      {jobId ? (
        <PagesResults job={j} loading={job.isLoading} error={job.error ? errorText(job.error) : null} />
      ) : (
        <Empty>Введите имя пользователя — результатом будут ссылки на его возможные страницы.</Empty>
      )}
    </SearchLayout>
  );
}

function PagesHistory({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }) {
  const recent = trpc.pages.recent.useQuery(undefined, { refetchInterval: (q) => (!q.state.error && q.state.data?.some((j) => j.state === 'running') ? 3000 : false) });
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
            <div className="truncate font-mono text-sm">{s.username}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-mute">
              <span className="text-mint">найдено {s.found}</span>
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

function PagesResults({ job, loading, error }: { job: Job | undefined; loading: boolean; error: string | null }) {
  const [view, setView] = useState<'found' | 'all'>('found');
  // Что переносить в досье: одна страница (кнопка в карточке) или все найденные (кнопка в панели).
  const [adding, setAdding] = useState<PendingPage[] | null>(null);
  // Новый поиск — снова список найденных.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setView('found'), [job?.id]);

  // Сервер отдаёт результаты в порядке ответов сайтов — показываем по алфавиту.
  const bySite = (a: Result, b: Result) => a.site.localeCompare(b.site, 'en');
  const all = useMemo(() => [...(job?.results ?? [])].sort(bySite), [job?.results]);
  const found = useMemo(() => [...(job?.found ?? [])].sort(bySite), [job?.found]);
  const counts = useMemo(() => {
    const c = { claimed: 0, available: 0, unknown: 0, waf: 0, illegal: 0 };
    for (const r of all) c[r.status]++;
    return c;
  }, [all]);

  if (error) return <Card><div className="text-danger">{error}</div></Card>;
  if (loading || !job) return <Empty><Spinner /></Empty>;
  if (job.state === 'running') {
    return (
      <Card>
        <div className="flex items-center gap-3 font-mono text-sm text-mint">
          <Spinner /> Проверено {job.done} из {job.total} сайтов… найдено: {job.found.length}
        </div>
      </Card>
    );
  }

  const copyAll = async () => {
    const ok = await copyText(found.map((r) => r.url).join('\n'));
    toast(ok ? `Скопировано ссылок: ${found.length}` : 'Не удалось скопировать', ok ? 'ok' : 'error');
  };

  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-4 py-2.5 backdrop-blur">
        <div className="font-mono text-xs text-dim">
          <span className="text-mint">найдено: {found.length}</span> · проверено {job.done} из {job.total}
          {counts.unknown > 0 && <> · без ответа {counts.unknown}</>}
          {counts.waf > 0 && <> · защита от ботов {counts.waf}</>}
          {counts.illegal > 0 && <> · имя не подходит {counts.illegal}</>}
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={view} onChange={setView} options={[{ value: 'found', label: 'найденные' }, { value: 'all', label: 'все сайты' }]} />
          <Button variant="primary" size="sm" onClick={() => setAdding(found)} disabled={!found.length}>
            <FolderPlus size={15} /> Все найденные в досье
          </Button>
          <Button size="sm" onClick={() => void copyAll()} disabled={!found.length}>
            <Copy size={14} /> Скопировать ссылки
          </Button>
        </div>
      </div>

      {job.state === 'cancelled' && (
        <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-warn">
          Поиск остановлен: проверено {job.done} из {job.total} сайтов.
        </div>
      )}

      {view === 'found' ? (
        found.length === 0 ? (
          <Empty>Страниц с таким именем не найдено</Empty>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {found.map((r) => <FoundCard key={`${r.by}:${r.site}`} r={r} onAdd={() => setAdding([r])} />)}
          </div>
        )
      ) : (
        <Card compact>
          <div className="divide-y divide-line-soft">
            {all.map((r) => (
              <div key={`${r.by}:${r.site}`} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="w-44 shrink-0 truncate font-semibold">{r.site}</span>
                <Tag tone={r.by === 'email' ? 'info' : 'dim'} className="shrink-0">{BY_LABEL[r.by]}</Tag>
                <Tag tone={STATUS[r.status].tone} className="shrink-0">{STATUS[r.status].label}</Tag>
                <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs text-dim hover:text-mint">{r.url}</a>
                <span className="max-w-56 shrink-0 truncate font-mono text-[10px] text-mute" title={r.error ?? undefined}>
                  {r.error ?? (r.httpStatus ? `HTTP ${r.httpStatus}` : '')}{r.ms ? ` · ${r.ms} мс` : ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <AddPagesDialog open={!!adding} onOpenChange={(v) => !v && setAdding(null)} pages={adding ?? []} username={job.username} />
    </>
  );
}

function FoundCard({ r, onAdd }: { r: Result; onAdd: () => void }) {
  return (
    <Card compact className="!p-3.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{r.site}</span>
        <Tag tone={r.by === 'email' ? 'info' : 'dim'}>{BY_LABEL[r.by]}</Tag>
        {r.nsfw && <Tag tone="warn">18+</Tag>}
        <span className="font-mono text-[10px] text-mute">{r.ms} мс</span>
        <button
          type="button"
          onClick={onAdd}
          title="Добавить в досье"
          aria-label="Добавить в досье"
          className="shrink-0 cursor-pointer text-mute transition hover:text-mint"
        >
          <FolderPlus size={15} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <a href={r.url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs text-mint hover:underline">
          <ExternalLink size={12} className="shrink-0" />
          <span className="truncate">{r.url}</span>
        </a>
        <CopyButton value={r.url} title="Скопировать ссылку" />
      </div>
    </Card>
  );
}
