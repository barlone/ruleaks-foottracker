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
export const None = ({ children = 'нет данных' }: { children?: ReactNode }) => <span className="text-mute">{children}</span>;

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
      <CopyButton value={value} title="Скопировать" />
      {onClick && (
        <button type="button" onClick={onClick} title={RUN_TITLE[mode]} aria-label={RUN_TITLE[mode]} className="shrink-0 cursor-pointer text-mute transition hover:text-mint">
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
      {section.status === 'error' ? <div className="text-sm text-danger">{section.error}</div> : children(section.data)}
    </Card>
  );
}

/** Профиль аккаунта Google (People API). asked — запрошенный адрес; у поиска по Gaia ID его нет. */
export function ProfileCard({ profile, asked }: { profile: GoogleProfile; asked: string | null }) {
  const email = profile.email ?? asked;
  return (
    <Card title={<><IdCard size={13} /> Аккаунт Google</>}>
      <div className="flex gap-5 max-md:flex-col">
        {profile.photo && (
          <a href={bigPhoto(profile.photo.url)} target="_blank" rel="noreferrer" title="Открыть фото" className="shrink-0 self-start">
            <Photo url={profile.photo.url} alt="Фото профиля" className="size-28" />
          </a>
        )}
        <div className="min-w-0 flex-1 divide-y divide-line-soft">
          <Row label="Gaia ID"><Searchable value={profile.gaiaId} mode="gaia" /></Row>
          <Row label="E-mail">
            {email ? <Searchable value={email} mode="email" mono={false} /> : <None>не известен</None>}
            {asked && profile.email && profile.email.toLowerCase() !== asked.toLowerCase() && <span className="ml-2 text-xs text-mute">запрошен {asked}</span>}
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

/** Отчёт по аккаунту: по адресу (профиль, Play Игры, Карты, календарь) или по Gaia ID (профиль, Карты). */
export function AccountResult({ report }: { report: GoogleEmailReport | GoogleGaiaReport }) {
  const what = report.mode === 'email' ? `на адрес ${report.email}` : `с Gaia ID ${report.gaiaId}`;
  if (!report.found) return <Card><div className="text-sm text-dim">Аккаунт Google {what} не найден.</div></Card>;
  if (!report.profile) {
    return (
      <Card>
        <div className="text-sm text-warn">
          Публичного аккаунта Google {what} нет: он встречается только в данных служебного аккаунта
          {report.containers.length > 0 && <> (контейнеры: {report.containers.join(', ')})</>}.
        </div>
      </Card>
    );
  }
  return (
    <>
      <ProfileCard profile={report.profile} asked={report.mode === 'email' ? report.email : null} />
      <div className="grid items-start gap-6 2xl:grid-cols-2">
        {report.mode === 'email' && <SectionCard title="Play Игры" icon={<Gamepad2 size={13} />} section={report.playGames}>{(p) => <PlayerView player={p} />}</SectionCard>}
        <SectionCard title="Карты Google" icon={<MapPinned size={13} />} section={report.maps}>{(m) => <MapsView maps={m} />}</SectionCard>
      </div>
      {report.mode === 'email' && <SectionCard title="Календарь" icon={<CalendarDays size={13} />} section={report.calendar}>{(c) => <CalendarView calendar={c} />}</SectionCard>}
      {report.mode === 'gaia' && (
        <p className="font-mono text-[11px] text-mute">Play Игры и календарь ищутся по адресу почты: если он есть в профиле выше, нажмите на значок поиска рядом с ним — откроется поиск по Email.</p>
      )}
    </>
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
                      <span className="font-mono text-[11px] text-mute">{g.lastPlayed ? fmtUtc(g.lastPlayed) : ''}{g.achievements ? ` · достижений ${g.achievements}` : ''}</span>
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
                {durationText(e.start, e.end) && <span className="font-mono text-[11px] text-mute">{durationText(e.start, e.end)}</span>}
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
