import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { FolderPlus, HardDrive, History, IdCard, Link2, Wifi } from 'lucide-react';
import {
  GHUNT_URL, GOOGLE_MODES, GOOGLE_QUERY_MAX, GOOGLE_STEPS, findGoogleMode, googleQueryProblem,
  type GoogleModeId, type GoogleReport,
} from '@ft/shared';
import { ProgressDialog } from '../../components/ProgressDialog.tsx';
import { Button, Card, Empty, Input, Spinner, Tag, WarnNote } from '../../components/ui.tsx';
import { errorText } from '../../lib/errors.ts';
import { t, tj, tx } from '../../lib/i18n.ts';
import { ago } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { AddPagesDialog, type PendingPage } from './AddPagesDialog.tsx';
import { SearchLayout } from './common.tsx';
import { GoogleDalResult } from './GoogleDalResult.tsx';
import { GoogleDriveResult } from './GoogleDriveResult.tsx';
import { GoogleGeoResult } from './GoogleGeoResult.tsx';
import { AccountResult } from './GoogleParts.tsx';
import { GoogleRunContext, modeInline } from './googleSearch.ts';
import { useRunOnMount } from './job.ts';

// «Поиск по Google» — перенос GHunt: сервер собирает сведения (google.start), страница раз в секунду спрашивает ход
// работы (google.job) и показывает отчёт. Виды поиска — кнопки над строкой ввода (GOOGLE_MODES, модули GHunt).
// Из найденного (участник файла, профиль) можно сразу искать дальше — по Gaia ID здесь же (GoogleRunContext),
// по адресу — в «Поиске по Email» (туда же переехал вид «по e-mail»: ссылки ?mode=email ведут туда).

type Job = RouterOutputs['google']['job'];

const MODE_ICON: Record<GoogleModeId, typeof IdCard> = { gaia: IdCard, drive: HardDrive, geolocate: Wifi, spiderdal: Link2 };

/** Вид поиска из адреса страницы; неизвестный — по Gaia ID. */
const modeOf = (id: string | undefined): GoogleModeId => (id && findGoogleMode(id)?.id) || 'gaia';

export function GoogleSearchPage() {
  const params = useSearch({ from: '/search/google' });
  // null — раздел выключен в config.ini ([config] google-search).
  const cfg = trpc.google.config.useQuery(undefined, { staleTime: Infinity });
  // Поиск по адресу переехал в «Поиск по Email» — старые ссылки ведут туда.
  if (params.mode === 'email') return <Navigate to="/search/email" search={{ q: params.q }} replace />;
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
        <Empty>{t('Поиск по Google выключен в настройках сервера.')}</Empty>
      </div>
    );
  }
  return <GoogleSearch demoModes={cfg.data.demoModes} />;
}

function GoogleSearch({ demoModes }: { demoModes: GoogleModeId[] }) {
  const params = useSearch({ from: '/search/google' });
  const navigate = useNavigate({ from: '/search/google' });
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<GoogleModeId>(modeOf(params.mode));
  const [value, setValue] = useState(params.q ?? '');
  const [jobId, setJobId] = useState<string | null>(null);
  const info = findGoogleMode(mode)!;
  const Icon = MODE_ICON[mode];

  const start = trpc.google.start.useMutation({
    onSuccess: (j) => {
      setJobId(j.id);
      utils.google.job.setData({ id: j.id }, j);
      void utils.google.recent.invalidate();
    },
  });
  const job = trpc.google.job.useQuery(
    { id: jobId ?? '' },
    // После ошибки (задание пропало — сервер перезапущен) прежние данные остаются в кэше: по ним опрос не продолжаем.
    { enabled: !!jobId, refetchInterval: (q) => (!q.state.error && q.state.data?.state === 'running' ? 1000 : false), refetchIntervalInBackground: true },
  );
  const cancel = trpc.google.cancel.useMutation({
    onSuccess: () => void utils.google.job.invalidate({ id: jobId ?? '' }),
    onError: (e) => toast(errorText(e), 'error'),
  });
  const j = job.data;
  // Поиск закончился — в истории не должно остаться индикатора «выполняется».
  const state = j?.state;
  useEffect(() => {
    if (state && state !== 'running') void utils.google.recent.invalidate();
  }, [state, utils]);
  // Открыли поиск из истории — кнопка вида и строка запроса как у него.
  useEffect(() => {
    if (!j) return;
    setMode(j.mode);
    setValue(j.query);
  }, [j?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = value.trim();
  const problem = googleQueryProblem(mode, query);
  const disabled = !me.data?.access.active;

  const run = useCallback((m: GoogleModeId, q: string) => {
    const text = q.trim();
    if (!text || googleQueryProblem(m, text)) return;
    setMode(m);
    setValue(text);
    void navigate({ search: { mode: m, q: text } });
    start.mutate({ mode: m, query: text });
    // start из useMutation стабилен по поведению; navigate — тоже.
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  useRunOnMount(() => run(modeOf(params.mode), params.q!), !!params.q, !!me.data?.access.active);

  // Ошибка запроса задания закрывает окно процесса: иначе оно показывало бы устаревшее «выполняется» без выхода.
  const running = !!jobId && !job.error && j?.state === 'running';
  const steps: readonly { id: string; label: string }[] = j ? GOOGLE_STEPS[j.mode] : [];
  const stepLabel = j ? steps.find((s) => s.id === j.step)?.label : undefined;
  const step = j ? (j.step === 'queue' ? t('В очереди: поиски идут по одному') : stepLabel && t(stepLabel)) : undefined;

  return (
    <GoogleRunContext.Provider value={disabled ? null : run}>
      <SearchLayout
        title={t('Поиск по Google')}
        titleExtra={(
          <div className="font-mono text-[11px] text-mute">
            inspired by{' '}
            <a href={GHUNT_URL} target="_blank" rel="noreferrer" className="text-mint/80 underline underline-offset-4 hover:text-mint">GHunt</a>
          </div>
        )}
        subtitle={t('Что Google раскрывает об аккаунте по Gaia ID, файле Drive, точке доступа Wi-Fi и связях сайтов с приложениями. Аккаунт по адресу почты — в разделе «Исследовать Email».')}
        history={<GoogleHistory activeId={jobId} onOpen={setJobId} />}
      >
        {demoModes.includes(mode) && (
          <WarnNote>{t('Режим имитации: служебный аккаунт Google на сервере не настроен — ответы по Gaia ID и файлу Drive вымышленные.')}</WarnNote>
        )}
        <Card className="animate-fade-up">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {GOOGLE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={clsx(
                  'cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition',
                  mode === m.id ? 'border-mint/60 bg-mint/10 font-semibold text-mint' : 'border-line-soft text-dim hover:border-line hover:text-text',
                )}
              >
                {t(m.label)}
              </button>
            ))}
          </div>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(mode, query);
            }}
          >
            <div className="flex gap-3 max-md:flex-col">
              <div className="relative flex-1">
                <Icon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
                <Input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={t(info.placeholder)}
                  className="h-12 pl-10 font-mono text-base"
                  disabled={disabled}
                  maxLength={GOOGLE_QUERY_MAX + 1}
                />
              </div>
              <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !query || !!problem || start.isPending}>
                {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : t('Искать')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
              <span>{t(info.hint)}</span>
              {problem && <Tag tone="warn">{tx(problem)}</Tag>}
              {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
            </div>
          </form>
        </Card>

        <ProgressDialog
          open={running}
          title={t('Поиск по Google: {mode}', { mode: modeInline(findGoogleMode(j?.mode ?? mode)?.label ?? '') })}
          value={j && j.step !== 'queue' ? j.stepsDone / j.stepsTotal : null}
          status={step ?? t('Запуск…')}
          detail={j?.query}
          startedAt={j ? new Date(j.startedAt).getTime() : null}
          onCancel={() => jobId && cancel.mutate({ id: jobId })}
          cancelling={cancel.isPending}
        />

        {jobId ? (
          <GoogleResult job={j} loading={job.isLoading} error={job.error ? errorText(job.error) : null} />
        ) : (
          <Empty>
            {tj('Выберите вид поиска и введите запрос — сервер соберёт то,{br}что Google отдаёт о нём любому вошедшему пользователю.', { br: <br /> })}
          </Empty>
        )}
      </SearchLayout>
    </GoogleRunContext.Provider>
  );
}

function GoogleHistory({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }) {
  const recent = trpc.google.recent.useQuery(undefined, { refetchInterval: (q) => (!q.state.error && q.state.data?.some((j) => j.state === 'running') ? 3000 : false) });
  const items = recent.data ?? [];
  return (
    <Card title={<><History size={13} /> {t('История')}</>}>
      {!items.length && <div className="font-mono text-xs text-mute">{t('Пока пусто')}</div>}
      <div className="max-h-[60vh] space-y-1 overflow-auto">
        {items.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            className={clsx('block w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition hover:bg-mint/5', s.id === activeId && 'bg-mint/10')}
          >
            <div className="truncate font-mono text-sm">{s.query}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-mute">
              <span className="truncate">{t(findGoogleMode(s.mode)?.label ?? s.mode)}</span>
              {s.found === true && <span className="text-mint">{t('найдено')}</span>}
              {s.found === false && <span>{t('не найдено')}</span>}
              {s.state === 'failed' && <span className="text-danger">{t('ошибка')}</span>}
              {s.state === 'cancelled' && <span className="text-warn">{t('остановлен')}</span>}
              <span className="shrink-0">· {ago(s.startedAt)}</span>
              {s.state === 'running' && <Spinner className="size-2.5" />}
            </div>
          </button>
        ))}
      </div>
      {items.length > 0 && <div className="mt-3 border-t border-line-soft pt-3 font-mono text-[10px] text-mute">{t('Результаты хранятся в памяти сервера около часа.')}</div>}
    </Card>
  );
}

/** Что показать в верхней панели отчёта и какие ссылки можно унести в досье. */
function summaryOf(r: GoogleReport): { text: string; links: PendingPage[]; title: string } {
  switch (r.mode) {
    case 'gaia': {
      const links: PendingPage[] = [];
      if (r.maps.status === 'ok' && r.maps.data.state === 'ok') links.push({ site: t('Google Карты'), url: r.maps.data.profileUrl });
      const extra = r.containers.length > 1 ? ` · ${t('контейнеры: {list}', { list: r.containers.join(', ') })}` : '';
      return { text: r.profile ? `${t('аккаунт найден')} · Gaia ID ${r.profile.gaiaId}${extra}` : t('аккаунт найден'), links, title: r.gaiaId };
    }
    case 'drive':
      return {
        text: r.file ? `${t(r.file.isFolder ? 'папка найдена' : 'файл найден')} · ${r.file.title}` : t('не найден'),
        links: r.file?.link ? [{ site: r.file.title ? `Google Drive: ${r.file.title}` : 'Google Drive', url: r.file.link }] : [],
        title: r.file?.title || r.fileId,
      };
    case 'geolocate':
      return {
        text: r.lat !== null && r.lon !== null
          ? t('точка найдена · {lat}, {lon} ± {m} м', { lat: r.lat.toFixed(5), lon: r.lon.toFixed(5), m: r.accuracyM ?? 0 })
          : t('не найдена'),
        links: r.lat !== null && r.lon !== null ? [{ site: t('Точка Wi-Fi {bssid}', { bssid: r.bssids[0] ?? '' }), url: `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}` }] : [],
        title: r.bssids.join(', '),
      };
    case 'spiderdal':
      return {
        text: t('сайтов {sites} · пакетов {packages} · опрошено {scanned} активов за {rounds} кр.', { sites: r.sites.length, packages: r.packages.length, scanned: r.scanned, rounds: r.rounds }),
        links: [
          ...r.sites.map((s) => ({ site: t('Сайт (Digital Asset Links)'), url: s.site })),
          ...r.packages.filter((p) => p.public).map((p) => ({ site: `Google Play: ${p.name}`, url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(p.name)}` })),
        ],
        title: r.query,
      };
  }
}

function GoogleResult({ job, loading, error }: { job: Job | undefined; loading: boolean; error: string | null }) {
  const [adding, setAdding] = useState<PendingPage[] | null>(null);

  if (error) return <Card><div className="text-danger">{error}</div></Card>;
  if (loading || !job) return <Empty><Spinner /></Empty>;
  if (job.state === 'running') {
    return (
      <Card>
        <div className="flex items-center gap-3 font-mono text-sm text-mint">
          <Spinner /> {t('Идёт поиск: {query}', { query: job.query })}
        </div>
      </Card>
    );
  }
  if (job.state === 'failed') return <Card><div className="text-danger">{job.error ? tx(job.error) : t('Поиск не удался')}</div></Card>;
  const report = job.report;
  if (job.state === 'cancelled' || !report) return <Empty>{t('Поиск остановлен.')}</Empty>;

  const { text, links, title } = summaryOf(report);
  const mode = findGoogleMode(report.mode)!;
  return (
    <>
      {report.found && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-4 py-2.5 backdrop-blur">
          <div className="min-w-0 truncate font-mono text-xs text-dim">
            <span className="text-mint">{text}</span>
            {report.demo && <span className="ml-2 text-warn">· {t('имитация')}</span>}
          </div>
          <Button variant="primary" size="sm" onClick={() => setAdding(links)} disabled={!links.length} title={links.length ? t('Найденные ссылки — в «Соцсети» досье') : t('Ссылок для досье нет')}>
            <FolderPlus size={15} /> {t('Ссылки в досье')}
          </Button>
        </div>
      )}

      {report.mode === 'gaia' && <AccountResult report={report} />}
      {report.mode === 'drive' && <GoogleDriveResult report={report} />}
      {report.mode === 'geolocate' && <GoogleGeoResult report={report} />}
      {report.mode === 'spiderdal' && <GoogleDalResult report={report} />}

      <AddPagesDialog open={!!adding} onOpenChange={(v) => !v && setAdding(null)} pages={adding ?? []} username={title} note={t('Поиск по Google ({mode}): {query}', { mode: modeInline(mode.label), query: job.query })} />
    </>
  );
}
