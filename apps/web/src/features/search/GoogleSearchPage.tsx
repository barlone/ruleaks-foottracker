import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { CalendarDays, ExternalLink, FolderPlus, Gamepad2, History, IdCard, Mail, MapPinned } from 'lucide-react';
import {
  GHUNT_URL, GOOGLE_EMAIL_STEPS, GOOGLE_MODES, GOOGLE_QUERY_MAX, GOOGLE_USER_TYPES, findGoogleMode, googleQueryProblem,
  type GoogleCalendar, type GoogleEmailReport, type GoogleMaps, type GoogleModeId, type GooglePlayer, type GoogleProfile, type GoogleSection,
} from '@ft/shared';
import { ProgressDialog } from '../../components/ProgressDialog.tsx';
import { Button, Card, CopyButton, Empty, Input, Spinner, Tag, WarnNote } from '../../components/ui.tsx';
import { errorText } from '../../lib/errors.ts';
import { ago, fmtUtc } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { AddPagesDialog, type PendingPage } from './AddPagesDialog.tsx';
import { SearchLayout } from './common.tsx';
import { useRunOnMount } from './job.ts';

// «Поиск по Google» — перенос GHunt: сервер от имени служебного аккаунта Google собирает сведения об аккаунте
// (google.start), страница раз в секунду спрашивает ход работы (google.job) и показывает отчёт.
// Виды поиска — кнопки над строкой ввода (GOOGLE_MODES); пока перенесён поиск по e-mail.

type Job = RouterOutputs['google']['job'];

/** Вид поиска из адреса страницы — только перенесённый; иначе по e-mail. */
const readyMode = (id: string | undefined): GoogleModeId => {
  const m = id ? findGoogleMode(id) : undefined;
  return m?.ready ? m.id : 'email';
};

export function GoogleSearchPage() {
  // null — раздел выключен в config.ini ([config] google-search).
  const cfg = trpc.google.config.useQuery(undefined, { staleTime: Infinity });
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
        <Empty>Поиск по Google выключен в настройках сервера.</Empty>
      </div>
    );
  }
  return <GoogleSearch demo={cfg.data.demo} />;
}

function GoogleSearch({ demo }: { demo: boolean }) {
  const params = useSearch({ from: '/search/google' });
  const navigate = useNavigate({ from: '/search/google' });
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<GoogleModeId>(readyMode(params.mode));
  const [value, setValue] = useState(params.q ?? '');
  const [jobId, setJobId] = useState<string | null>(null);
  const info = findGoogleMode(mode)!;

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
    setMode(readyMode(j.mode));
    setValue(j.query);
  }, [j?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = value.trim();
  const problem = googleQueryProblem(mode, query);
  const disabled = !me.data?.access.active;

  function run(m: GoogleModeId = mode, q = query) {
    // Сервер пока принимает только перенесённый вид поиска.
    if (m !== 'email' || !q || googleQueryProblem(m, q)) return;
    void navigate({ search: { mode: m, q } });
    start.mutate({ mode: m, query: q });
  }

  useRunOnMount(() => run(readyMode(params.mode), params.q!.trim()), !!params.q, !!me.data?.access.active);

  // Ошибка запроса задания закрывает окно процесса: иначе оно показывало бы устаревшее «выполняется» без выхода.
  const running = !!jobId && !job.error && j?.state === 'running';
  const step = j ? (j.step === 'queue' ? 'В очереди: поиски идут по одному' : GOOGLE_EMAIL_STEPS.find((s) => s.id === j.step)?.label) : undefined;

  return (
    <SearchLayout
      title="Поиск по Google"
      titleExtra={(
        <div className="font-mono text-[11px] text-mute">
          inspired by{' '}
          <a href={GHUNT_URL} target="_blank" rel="noreferrer" className="text-mint/80 underline underline-offset-4 hover:text-mint">GHunt</a>
        </div>
      )}
      subtitle="Что аккаунт Google раскрывает о владельце: идентификатор, фото, сервисы, игры, отзывы на Картах, календарь."
      history={<GoogleHistory activeId={jobId} onOpen={setJobId} />}
    >
      {demo && <WarnNote>Режим имитации: служебный аккаунт Google на сервере не настроен — ответы вымышленные.</WarnNote>}
      <Card className="animate-fade-up">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {GOOGLE_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              disabled={!m.ready}
              title={m.ready ? undefined : `${m.hint} Ещё не перенесено.`}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-sm transition',
                !m.ready
                  ? 'cursor-not-allowed border-line-soft text-mute opacity-60'
                  : mode === m.id ? 'cursor-pointer border-mint/60 bg-mint/10 font-semibold text-mint' : 'cursor-pointer border-line-soft text-dim hover:border-line hover:text-text',
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
              <Mail size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
              <Input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={info.placeholder}
                className="h-12 pl-10 font-mono text-base"
                disabled={disabled}
                maxLength={GOOGLE_QUERY_MAX + 1}
              />
            </div>
            <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !query || !!problem || start.isPending}>
              {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : 'Искать'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
            <span>{info.hint}</span>
            {problem && <Tag tone="warn">{problem}</Tag>}
            {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
          </div>
        </form>
      </Card>

      <ProgressDialog
        open={running}
        title="Поиск по Google"
        value={j && j.step !== 'queue' ? j.stepsDone / j.stepsTotal : null}
        status={step ?? 'Запуск…'}
        detail={j?.query}
        startedAt={j ? new Date(j.startedAt).getTime() : null}
        onCancel={() => jobId && cancel.mutate({ id: jobId })}
        cancelling={cancel.isPending}
      />

      {jobId ? (
        <GoogleResult job={j} loading={job.isLoading} error={job.error ? errorText(job.error) : null} />
      ) : (
        <Empty>
          Введите адрес почты — если на него заведён аккаунт Google, сервер соберёт то,
          <br />
          что Google отдаёт о нём любому вошедшему пользователю.
        </Empty>
      )}
    </SearchLayout>
  );
}

function GoogleHistory({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }) {
  const recent = trpc.google.recent.useQuery(undefined, { refetchInterval: (q) => (!q.state.error && q.state.data?.some((j) => j.state === 'running') ? 3000 : false) });
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
            <div className="truncate font-mono text-sm">{s.query}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-mute">
              <span className="truncate">{findGoogleMode(s.mode)?.label ?? s.mode}</span>
              {s.found === true && <span className="text-mint">найден</span>}
              {s.found === false && <span>не найден</span>}
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

function GoogleResult({ job, loading, error }: { job: Job | undefined; loading: boolean; error: string | null }) {
  const [adding, setAdding] = useState<PendingPage[] | null>(null);

  if (error) return <Card><div className="text-danger">{error}</div></Card>;
  if (loading || !job) return <Empty><Spinner /></Empty>;
  if (job.state === 'running') {
    return (
      <Card>
        <div className="flex items-center gap-3 font-mono text-sm text-mint">
          <Spinner /> Идёт поиск: {job.query}
        </div>
      </Card>
    );
  }
  if (job.state === 'failed') return <Card><div className="text-danger">{job.error ?? 'Поиск не удался'}</div></Card>;
  const report = job.report;
  if (job.state === 'cancelled' || !report) return <Empty>Поиск остановлен.</Empty>;
  if (!report.found) return <Empty>Аккаунт Google на адрес {report.email} не найден.</Empty>;
  if (!report.profile) {
    return (
      <Card>
        <div className="text-sm text-warn">
          Публичного аккаунта Google на адрес {report.email} нет: адрес встречается только в данных служебного аккаунта
          {report.containers.length > 0 && <> (контейнеры: {report.containers.join(', ')})</>}.
        </div>
      </Card>
    );
  }

  // Ссылки, которые можно положить в досье: страница участника Карт и публичный календарь.
  const links: PendingPage[] = [];
  if (report.maps.status === 'ok' && report.maps.data.state === 'ok') links.push({ site: 'Google Карты', url: report.maps.data.profileUrl });
  if (report.calendar.status === 'ok' && report.calendar.data.icsUrl) links.push({ site: 'Google Календарь', url: report.calendar.data.icsUrl });

  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-4 py-2.5 backdrop-blur">
        <div className="font-mono text-xs text-dim">
          <span className="text-mint">аккаунт найден</span> · Gaia ID {report.profile.gaiaId}
          {report.containers.length > 1 && <> · контейнеры: {report.containers.join(', ')}</>}
        </div>
        <Button variant="primary" size="sm" onClick={() => setAdding(links)} disabled={!links.length} title={links.length ? 'Страница на Картах и календарь — в «Соцсети и ссылки» досье' : 'Публичных ссылок у аккаунта нет'}>
          <FolderPlus size={15} /> Ссылки в досье
        </Button>
      </div>

      <ProfileCard profile={report.profile} asked={report.email} />
      <div className="grid items-start gap-6 2xl:grid-cols-2">
        <SectionCard title="Play Игры" icon={<Gamepad2 size={13} />} section={report.playGames}>{(p) => <PlayerView player={p} />}</SectionCard>
        <SectionCard title="Карты Google" icon={<MapPinned size={13} />} section={report.maps}>{(m) => <MapsView maps={m} />}</SectionCard>
      </div>
      <SectionCard title="Календарь" icon={<CalendarDays size={13} />} section={report.calendar}>{(c) => <CalendarView calendar={c} />}</SectionCard>

      <AddPagesDialog open={!!adding} onOpenChange={(v) => !v && setAdding(null)} pages={adding ?? []} username={report.email} note={`Поиск по Google: ${report.email}`} />
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm max-sm:flex-col max-sm:gap-0.5">
      <span className="w-48 shrink-0 pt-0.5 font-mono text-xs text-mute">{label}</span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-mint">{children}</span>;
const None = ({ children = 'нет данных' }: { children?: ReactNode }) => <span className="text-mute">{children}</span>;

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 font-mono text-xs text-mint hover:underline">
      <ExternalLink size={12} className="shrink-0" />
      <span className="truncate">{children}</span>
    </a>
  );
}

/** Адрес картинки Google покрупнее: суффикс размера =s100 → =s1024. У имитации адрес — data:, его не трогаем. */
const bigPhoto = (url: string) => (url.startsWith('https://') ? url.replace(/=s\d+[^=/]*$/, '=s1024') : url);

/** Картинка профиля. Грузится браузером прямо с серверов Google, без Referer. */
function Photo({ url, alt, className }: { url: string; alt: string; className?: string }) {
  return <img src={url} alt={alt} referrerPolicy="no-referrer" loading="lazy" className={clsx('shrink-0 rounded-xl border border-line bg-bg-soft object-cover', className)} />;
}

function ProfileCard({ profile, asked }: { profile: GoogleProfile; asked: string }) {
  return (
    <Card title={<><IdCard size={13} /> Аккаунт Google</>}>
      <div className="flex gap-5 max-md:flex-col">
        {profile.photo && (
          <a href={bigPhoto(profile.photo.url)} target="_blank" rel="noreferrer" title="Открыть фото" className="shrink-0 self-start">
            <Photo url={profile.photo.url} alt="Фото профиля" className="size-28" />
          </a>
        )}
        <div className="min-w-0 flex-1 divide-y divide-line-soft">
          <Row label="Gaia ID">
            <span className="inline-flex items-center gap-2"><Mono>{profile.gaiaId}</Mono><CopyButton value={profile.gaiaId} title="Скопировать Gaia ID" /></span>
          </Row>
          <Row label="E-mail">
            <span className="font-mono">{profile.email ?? asked}</span>
            {profile.email && profile.email.toLowerCase() !== asked.toLowerCase() && <span className="ml-2 text-xs text-mute">запрошен {asked}</span>}
          </Row>
          {profile.name && <Row label="Имя">{profile.name}</Row>}
          <Row label="Фото профиля">
            {!profile.photo ? <None /> : profile.photo.isDefault ? <None>стандартное</None> : <Tag>своё фото</Tag>}
          </Row>
          {profile.cover && (
            <Row label="Обложка">
              {profile.cover.isDefault ? <None>стандартная</None> : <Ext href={profile.cover.url}>{profile.cover.url}</Ext>}
            </Row>
          )}
          <Row label="Профиль изменён">{profile.lastUpdated ? <>{fmtUtc(profile.lastUpdated)} <span className="text-xs text-mute">UTC</span></> : <None />}</Row>
          <Row label="Тип пользователя">
            {profile.userTypes.length ? (
              <div className="flex flex-wrap gap-1.5">
                {profile.userTypes.map((t) => <Tag key={t} tone="dim"><span title={t}>{GOOGLE_USER_TYPES[t] ?? t}</span></Tag>)}
              </div>
            ) : <None />}
          </Row>
          <Row label="Аккаунт организации">{profile.enterprise === null ? <None /> : profile.enterprise ? <Tag tone="info">Google Workspace</Tag> : 'нет'}</Row>
          <Row label="Google Chat">
            {profile.entityType || profile.customerId ? (
              <span className="font-mono text-xs">
                {profile.entityType && <>тип {profile.entityType}</>}
                {profile.entityType && profile.customerId && ' · '}
                {profile.customerId && <>организация {profile.customerId}</>}
              </span>
            ) : <None />}
          </Row>
          <Row label="Активные сервисы">
            {profile.apps.length ? (
              <div className="flex flex-wrap gap-1.5">{profile.apps.map((a) => <Tag key={a}>{a}</Tag>)}</div>
            ) : <None />}
          </Row>
        </div>
      </div>
    </Card>
  );
}

/** Часть отчёта: не собиралась — ничего, не удалась — ошибка, иначе содержимое. */
function SectionCard<T>({ title, icon, section, children }: { title: string; icon: ReactNode; section: GoogleSection<T>; children: (data: T) => ReactNode }) {
  if (section.status === 'skipped') return null;
  return (
    <Card title={<>{icon} {title}</>}>
      {section.status === 'error' ? <div className="text-sm text-danger">{section.error}</div> : children(section.data)}
    </Card>
  );
}

function PlayerView({ player }: { player: GooglePlayer | null }) {
  if (!player) return <None>Игрового профиля на этот адрес нет.</None>;
  return (
    <div className="flex gap-4">
      {player.avatarUrl && <Photo url={player.avatarUrl} alt="Аватар игрока" className="size-16" />}
      <div className="min-w-0 flex-1 divide-y divide-line-soft">
        <Row label="Имя игрока">{player.name || <None />}{player.gamerTag && player.gamerTag !== player.name && <span className="ml-2 font-mono text-xs text-dim">{player.gamerTag}</span>}</Row>
        <Row label="ID игрока">
          <span className="inline-flex items-center gap-2"><Mono>{player.id}</Mono><CopyButton value={player.id} title="Скопировать ID игрока" /></span>
        </Row>
        {!player.visible ? (
          <Row label="Профиль"><None>закрыт — игры и достижения не видны</None></Row>
        ) : (
          <>
            {(player.level !== null || player.title) && (
              <Row label="Уровень">{player.level ?? '—'}{player.title && <span className="ml-2 text-dim">«{player.title}»</span>}{player.xp && <span className="ml-2 font-mono text-xs text-mute">{player.xp} XP</span>}</Row>
            )}
            <Row label="Игр / достижений">{player.playedGames} / {player.achievements}</Row>
            {player.lastPlayed && (
              <Row label="Последняя игра">{player.lastPlayed.name}{player.lastPlayed.at && <span className="ml-2 font-mono text-xs text-mute">{fmtUtc(player.lastPlayed.at)} UTC</span>}</Row>
            )}
            {player.topGame && <Row label="Больше всего достижений">{player.topGame.name} <span className="font-mono text-xs text-mute">({player.topGame.achievements})</span></Row>}
            {player.games.length > 0 && (
              <Row label="Игры">
                <div className="space-y-0.5">
                  {player.games.map((g, i) => (
                    <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                      <span>{g.name}</span>
                      <span className="font-mono text-[11px] text-mute">
                        {g.lastPlayed ? fmtUtc(g.lastPlayed) : ''}{g.achievements ? ` · достижений ${g.achievements}` : ''}
                      </span>
                    </div>
                  ))}
                  {player.playedGames > player.games.length && <div className="font-mono text-[11px] text-mute">…и ещё {player.playedGames - player.games.length}</div>}
                </div>
              </Row>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Названия счётчиков Карт, как их отдаёт Google (hl=en). */
const MAPS_STATS: Record<string, string> = { Reviews: 'Отзывы', Ratings: 'Оценки', Photos: 'Фото', Videos: 'Видео', Answers: 'Ответы', Edits: 'Правки', 'Reported incorrect': 'Сообщения об ошибках', 'Places added': 'Добавлено мест', 'Roads added': 'Добавлено дорог', 'Facts checked': 'Проверено фактов', 'Q&A': 'Вопросы и ответы', 'Published lists': 'Списки' };

function MapsView({ maps }: { maps: GoogleMaps }) {
  const stats = Object.entries(maps.stats).filter(([, n]) => n > 0);
  return (
    <div className="divide-y divide-line-soft">
      <Row label="Страница участника"><Ext href={maps.profileUrl}>{maps.profileUrl}</Ext></Row>
      <Row label="Вклад">
        {maps.state === 'blocked' ? (
          <span className="text-warn">Google ограничил запросы с этого сервера (капча) — статистика не получена.</span>
        ) : maps.state === 'empty' || !stats.length ? (
          <None>отзывов, оценок и фото нет</None>
        ) : (
          <div className="flex flex-wrap gap-1.5">{stats.map(([k, n]) => <Tag key={k}>{MAPS_STATS[k] ?? k}: {n}</Tag>)}</div>
        )}
      </Row>
    </div>
  );
}

/** «1 ч 30 мин» между двумя моментами; пусто — нет времени или нулевая длительность. */
function duration(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const min = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  if (!(min > 0)) return '';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d && `${d} дн`, h && `${h} ч`, m && `${m} мин`].filter(Boolean).join(' ');
}

function CalendarView({ calendar }: { calendar: GoogleCalendar }) {
  if (!calendar.found) return <None>Публичного календаря нет.</None>;
  return (
    <div className="divide-y divide-line-soft">
      <Row label="ID календаря"><span className="font-mono">{calendar.id ?? '—'}</span></Row>
      {calendar.summary && <Row label="Название">{calendar.summary}</Row>}
      <Row label="Часовой пояс">{calendar.timeZone ?? <None />}</Row>
      {calendar.otherNames.length > 0 && (
        <Row label="Другие имена владельца">
          <div className="flex flex-wrap gap-1.5">{calendar.otherNames.map((n) => <Tag key={n} tone="info">{n}</Tag>)}</div>
        </Row>
      )}
      {calendar.icsUrl && <Row label="Выгрузка (.ics)"><Ext href={calendar.icsUrl}>{calendar.icsUrl}</Ext></Row>}
      <Row label={`События: ${calendar.total}`}>
        {!calendar.events.length ? <None>событий нет</None> : (
          <div className="space-y-1">
            {calendar.events.map((e, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-36 shrink-0 font-mono text-[11px] text-mute">{e.start ? `${fmtUtc(e.start)} UTC` : 'весь день'}</span>
                {e.link ? <a href={e.link} target="_blank" rel="noreferrer" className="hover:text-mint hover:underline">{e.title ?? 'без названия'}</a> : <span>{e.title ?? 'без названия'}</span>}
                {duration(e.start, e.end) && <span className="font-mono text-[11px] text-mute">{duration(e.start, e.end)}</span>}
                {e.location && <span className="text-xs text-dim">· {e.location}</span>}
              </div>
            ))}
            {calendar.total > calendar.events.length && <div className="font-mono text-[11px] text-mute">Показаны последние {calendar.events.length}.</div>}
          </div>
        )}
      </Row>
    </div>
  );
}
