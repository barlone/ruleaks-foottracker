import type { ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { CalendarDays, ExternalLink, Gamepad2, IdCard, Mail, MapPinned, Search } from 'lucide-react';
import {
  GOOGLE_USER_TYPES,
  type GoogleCalendar, type GoogleEmailReport, type GoogleGaiaReport, type GoogleMaps, type GooglePlayer, type GoogleProfile, type GoogleSection,
} from '@ft/shared';
import { Card, CopyButton, Tag } from '../../components/ui.tsx';
import { fmtUtc } from '../../lib/format.ts';
import { t, tn, tx } from '../../lib/i18n.ts';
import { trpc } from '../../lib/trpc.ts';
import { bigPhoto, durationText, useEmailRun, useGoogleRun } from './googleSearch.ts';

// Общие части отчётов об аккаунтах Google («Поиск по Google» — по Gaia ID, «Поиск по Email» — по адресу):
// строки «подпись — значение», ссылки, картинки, часть отчёта с ошибкой, карточка профиля, Play Игры, Карты, календарь.

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm max-sm:flex-col max-sm:gap-0.5">
      <span className="w-48 shrink-0 pt-0.5 font-mono text-xs text-mute">{label}</span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

export const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-mint">{children}</span>;
export const None = ({ children }: { children?: ReactNode }) => <span className="text-mute">{children ?? t('нет данных')}</span>;

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 font-mono text-xs text-mint hover:underline">
      <ExternalLink size={12} className="shrink-0" />
      <span className="truncate">{children}</span>
    </a>
  );
}

/** Картинка с серверов Google — грузится браузером напрямую, без Referer. */
export function Photo({ url, alt, className }: { url: string; alt: string; className?: string }) {
  return <img src={url} alt={alt} referrerPolicy="no-referrer" loading="lazy" className={clsx('shrink-0 rounded-xl border border-line bg-bg-soft object-cover', className)} />;
}

type SearchKind = 'email' | 'gaia';
const RUN_ICON: Record<SearchKind, typeof Mail> = { email: Mail, gaia: IdCard };
const RUN_TITLE: Record<SearchKind, string> = { email: 'Искать по этому адресу (поиск по Email)', gaia: 'Искать по этому Gaia ID' };

/**
 * Значение (e-mail, Gaia ID) с копированием и кнопкой «искать дальше»: на странице своего раздела — поиск прямо на ней
 * (контекст запуска), иначе — переход в раздел (адрес — «Поиск по Email», Gaia ID — «Поиск по Google»).
 */
export function Searchable({ value, mode, mono = true }: { value: string; mode: SearchKind; mono?: boolean }) {
  const googleRun = useGoogleRun();
  const emailRun = useEmailRun();
  const navigate = useNavigate();
  // Раздел может быть выключен в настройках сервера — тогда и вести некуда.
  const google = trpc.google.config.useQuery(undefined, { staleTime: Infinity, enabled: mode === 'gaia' && googleRun === undefined });
  const email = trpc.email.config.useQuery(undefined, { staleTime: Infinity, enabled: mode === 'email' && emailRun === undefined });
  const run = mode === 'email' ? emailRun : googleRun;
  const onClick = run
    ? () => (mode === 'email' ? emailRun!(value) : googleRun!(mode, value))
    : run === undefined && (mode === 'email' ? email.data : google.data)
      ? () => void (mode === 'email' ? navigate({ to: '/search/email', search: { q: value } }) : navigate({ to: '/search/google', search: { mode, q: value } }))
      : null;
  const Icon = RUN_ICON[mode] ?? Search;
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span className={clsx('truncate', mono && 'font-mono text-mint')}>{value}</span>
      <CopyButton value={value} title={t('Скопировать')} />
      {onClick && (
        <button type="button" onClick={onClick} title={t(RUN_TITLE[mode])} aria-label={t(RUN_TITLE[mode])} className="shrink-0 cursor-pointer text-mute transition hover:text-mint">
          <Icon size={14} />
        </button>
      )}
    </span>
  );
}

/** Часть отчёта: не собиралась — ничего, не удалась — ошибка, иначе содержимое. */
export function SectionCard<T>({ title, icon, section, children }: { title: string; icon: ReactNode; section: GoogleSection<T>; children: (data: T) => ReactNode }) {
  if (section.status === 'skipped') return null;
  return (
    <Card title={<>{icon} {title}</>}>
      {section.status === 'error' ? <div className="text-sm text-danger">{tx(section.error)}</div> : children(section.data)}
    </Card>
  );
}

/** Профиль аккаунта Google (People API). asked — запрошенный адрес; у поиска по Gaia ID его нет. */
export function ProfileCard({ profile, asked }: { profile: GoogleProfile; asked: string | null }) {
  const email = profile.email ?? asked;
  return (
    <Card title={<><IdCard size={13} /> {t('Аккаунт Google')}</>}>
      <div className="flex gap-5 max-md:flex-col">
        {profile.photo && (
          <a href={bigPhoto(profile.photo.url)} target="_blank" rel="noreferrer" title={t('Открыть фото')} className="shrink-0 self-start">
            <Photo url={profile.photo.url} alt={t('Фото профиля')} className="size-28" />
          </a>
        )}
        <div className="min-w-0 flex-1 divide-y divide-line-soft">
          <Row label="Gaia ID"><Searchable value={profile.gaiaId} mode="gaia" /></Row>
          <Row label="E-mail">
            {email ? <Searchable value={email} mode="email" mono={false} /> : <None>{t('не известен')}</None>}
            {asked && profile.email && profile.email.toLowerCase() !== asked.toLowerCase() && <span className="ml-2 text-xs text-mute">{t('запрошен {email}', { email: asked })}</span>}
          </Row>
          {profile.name && <Row label={t('Имя')}>{profile.name}</Row>}
          <Row label={t('Фото профиля')}>
            {!profile.photo ? <None /> : profile.photo.isDefault ? <None>{t('стандартное')}</None> : <Tag>{t('своё фото')}</Tag>}
          </Row>
          {profile.cover && (
            <Row label={t('Обложка')}>
              {profile.cover.isDefault ? <None>{t('стандартная')}</None> : <Ext href={profile.cover.url}>{profile.cover.url}</Ext>}
            </Row>
          )}
          <Row label={t('Профиль изменён')}>{profile.lastUpdated ? <>{fmtUtc(profile.lastUpdated)} <span className="text-xs text-mute">UTC</span></> : <None />}</Row>
          <Row label={t('Тип пользователя')}>
            {profile.userTypes.length ? (
              <div className="flex flex-wrap gap-1.5">
                {profile.userTypes.map((ut) => <Tag key={ut} tone="dim"><span title={ut}>{GOOGLE_USER_TYPES[ut] ? t(GOOGLE_USER_TYPES[ut]) : ut}</span></Tag>)}
              </div>
            ) : <None />}
          </Row>
          <Row label={t('Аккаунт организации')}>{profile.enterprise === null ? <None /> : profile.enterprise ? <Tag tone="info">Google Workspace</Tag> : t('нет')}</Row>
          <Row label="Google Chat">
            {profile.entityType || profile.customerId ? (
              <span className="font-mono text-xs">
                {profile.entityType && t('тип {type}', { type: profile.entityType })}
                {profile.entityType && profile.customerId && ' · '}
                {profile.customerId && t('организация {id}', { id: profile.customerId })}
              </span>
            ) : <None />}
          </Row>
          <Row label={t('Активные сервисы')}>
            {profile.apps.length ? <div className="flex flex-wrap gap-1.5">{profile.apps.map((a) => <Tag key={a}>{a}</Tag>)}</div> : <None />}
          </Row>
        </div>
      </div>
    </Card>
  );
}

/** Названия счётчиков Карт, как их отдаёт Google (hl=en). */
const MAPS_STATS: Record<string, string> = {
  Reviews: 'Отзывы', Ratings: 'Оценки', Photos: 'Фото', Videos: 'Видео', Answers: 'Ответы', Edits: 'Правки',
  'Reported incorrect': 'Сообщения об ошибках', 'Places added': 'Добавлено мест', 'Roads added': 'Добавлено дорог',
  'Facts checked': 'Проверено фактов', 'Q&A': 'Вопросы и ответы', 'Published lists': 'Списки',
};

export function MapsView({ maps }: { maps: GoogleMaps }) {
  const stats = Object.entries(maps.stats).filter(([, n]) => n > 0);
  return (
    <div className="divide-y divide-line-soft">
      <Row label={t('Страница участника')}><Ext href={maps.profileUrl}>{maps.profileUrl}</Ext></Row>
      <Row label={t('Вклад')}>
        {maps.state === 'blocked' ? (
          <span className="text-warn">{t('Google ограничил запросы с этого сервера (капча) — статистика не получена.')}</span>
        ) : maps.state === 'empty' || !stats.length ? (
          <None>{t('отзывов, оценок и фото нет')}</None>
        ) : (
          <div className="flex flex-wrap gap-1.5">{stats.map(([k, n]) => <Tag key={k}>{MAPS_STATS[k] ? t(MAPS_STATS[k]) : k}: {n}</Tag>)}</div>
        )}
      </Row>
    </div>
  );
}

/** Отчёт по аккаунту: по адресу (профиль, Play Игры, Карты, календарь) или по Gaia ID (профиль, Карты). */
export function AccountResult({ report }: { report: GoogleEmailReport | GoogleGaiaReport }) {
  if (!report.found) {
    return (
      <Card>
        <div className="text-sm text-dim">
          {report.mode === 'email'
            ? t('Аккаунт Google на адрес {email} не найден.', { email: report.email })
            : t('Аккаунт Google с Gaia ID {id} не найден.', { id: report.gaiaId })}
        </div>
      </Card>
    );
  }
  if (!report.profile) {
    const containers = report.containers.length > 0 ? ` (${t('контейнеры: {list}', { list: report.containers.join(', ') })})` : '';
    return (
      <Card>
        <div className="text-sm text-warn">
          {report.mode === 'email'
            ? t('Публичного аккаунта Google на адрес {email} нет: он встречается только в данных служебного аккаунта{containers}.', { email: report.email, containers })
            : t('Публичного аккаунта Google с Gaia ID {id} нет: он встречается только в данных служебного аккаунта{containers}.', { id: report.gaiaId, containers })}
        </div>
      </Card>
    );
  }
  return (
    <>
      <ProfileCard profile={report.profile} asked={report.mode === 'email' ? report.email : null} />
      <div className="grid items-start gap-6 2xl:grid-cols-2">
        {report.mode === 'email' && <SectionCard title={t('Play Игры')} icon={<Gamepad2 size={13} />} section={report.playGames}>{(p) => <PlayerView player={p} />}</SectionCard>}
        <SectionCard title={t('Карты Google')} icon={<MapPinned size={13} />} section={report.maps}>{(m) => <MapsView maps={m} />}</SectionCard>
      </div>
      {report.mode === 'email' && <SectionCard title={t('Календарь')} icon={<CalendarDays size={13} />} section={report.calendar}>{(c) => <CalendarView calendar={c} />}</SectionCard>}
      {report.mode === 'gaia' && (
        <p className="font-mono text-[11px] text-mute">{t('Play Игры и календарь ищутся по адресу почты: если он есть в профиле выше, нажмите на значок поиска рядом с ним — откроется поиск по Email.')}</p>
      )}
    </>
  );
}

function PlayerView({ player }: { player: GooglePlayer | null }) {
  if (!player) return <None>{t('Игрового профиля на этот адрес нет.')}</None>;
  return (
    <div className="flex gap-4">
      {player.avatarUrl && <Photo url={player.avatarUrl} alt={t('Аватар игрока')} className="size-16" />}
      <div className="min-w-0 flex-1 divide-y divide-line-soft">
        <Row label={t('Имя игрока')}>{player.name || <None />}{player.gamerTag && player.gamerTag !== player.name && <span className="ml-2 font-mono text-xs text-dim">{player.gamerTag}</span>}</Row>
        <Row label={t('ID игрока')}>
          <span className="inline-flex items-center gap-2"><Mono>{player.id}</Mono><CopyButton value={player.id} title={t('Скопировать ID игрока')} /></span>
        </Row>
        {!player.visible ? (
          <Row label={t('Профиль')}><None>{t('закрыт — игры и достижения не видны')}</None></Row>
        ) : (
          <>
            {(player.level !== null || player.title) && (
              <Row label={t('Уровень')}>{player.level ?? '—'}{player.title && <span className="ml-2 text-dim">«{player.title}»</span>}{player.xp && <span className="ml-2 font-mono text-xs text-mute">{player.xp} XP</span>}</Row>
            )}
            <Row label={t('Игр / достижений')}>{player.playedGames} / {player.achievements}</Row>
            {player.lastPlayed && (
              <Row label={t('Последняя игра')}>{player.lastPlayed.name}{player.lastPlayed.at && <span className="ml-2 font-mono text-xs text-mute">{fmtUtc(player.lastPlayed.at)} UTC</span>}</Row>
            )}
            {player.topGame && <Row label={t('Больше всего достижений')}>{player.topGame.name} <span className="font-mono text-xs text-mute">({player.topGame.achievements})</span></Row>}
            {player.games.length > 0 && (
              <Row label={t('Игры')}>
                <div className="space-y-0.5">
                  {player.games.map((g, i) => (
                    <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                      <span>{g.name}</span>
                      <span className="font-mono text-[11px] text-mute">{g.lastPlayed ? fmtUtc(g.lastPlayed) : ''}{g.achievements ? ` · ${tn(g.achievements, '{n} достижение|{n} достижения|{n} достижений')}` : ''}</span>
                    </div>
                  ))}
                  {player.playedGames > player.games.length && <div className="font-mono text-[11px] text-mute">{t('…и ещё {n}', { n: player.playedGames - player.games.length })}</div>}
                </div>
              </Row>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CalendarView({ calendar }: { calendar: GoogleCalendar }) {
  if (!calendar.found) return <None>{t('Публичного календаря нет.')}</None>;
  return (
    <div className="divide-y divide-line-soft">
      <Row label={t('ID календаря')}><span className="font-mono">{calendar.id ?? '—'}</span></Row>
      {calendar.summary && <Row label={t('Название')}>{calendar.summary}</Row>}
      <Row label={t('Часовой пояс')}>{calendar.timeZone ?? <None />}</Row>
      {calendar.otherNames.length > 0 && (
        <Row label={t('Другие имена владельца')}>
          <div className="flex flex-wrap gap-1.5">{calendar.otherNames.map((n) => <Tag key={n} tone="info">{n}</Tag>)}</div>
        </Row>
      )}
      {calendar.icsUrl && <Row label={t('Выгрузка (.ics)')}><Ext href={calendar.icsUrl}>{calendar.icsUrl}</Ext></Row>}
      <Row label={t('События: {n}', { n: calendar.total })}>
        {!calendar.events.length ? <None>{t('событий нет')}</None> : (
          <div className="space-y-1">
            {calendar.events.map((e, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-36 shrink-0 font-mono text-[11px] text-mute">{e.start ? `${fmtUtc(e.start)} UTC` : t('весь день')}</span>
                {e.link ? <a href={e.link} target="_blank" rel="noreferrer" className="hover:text-mint hover:underline">{e.title ?? t('без названия')}</a> : <span>{e.title ?? t('без названия')}</span>}
                {durationText(e.start, e.end) && <span className="font-mono text-[11px] text-mute">{durationText(e.start, e.end)}</span>}
                {e.location && <span className="text-xs text-dim">· {e.location}</span>}
              </div>
            ))}
            {calendar.total > calendar.events.length && <div className="font-mono text-[11px] text-mute">{t('Показаны последние {n}.', { n: calendar.events.length })}</div>}
          </div>
        )}
      </Row>
    </div>
  );
}
