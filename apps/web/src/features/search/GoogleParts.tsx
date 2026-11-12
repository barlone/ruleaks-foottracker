import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ExternalLink, IdCard, Mail, Search } from 'lucide-react';
import { GOOGLE_USER_TYPES, type GoogleMaps, type GoogleModeId, type GoogleProfile, type GoogleSection } from '@ft/shared';
import { Card, CopyButton, Tag } from '../../components/ui.tsx';
import { fmtUtc } from '../../lib/format.ts';
import { bigPhoto, useGoogleRun } from './googleSearch.ts';

// Общие части отчётов поиска по Google: строки «подпись — значение», ссылки, картинки, часть отчёта с ошибкой,
// карточка профиля аккаунта (e-mail и Gaia ID) и статистика Карт.

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

const RUN_ICON = { email: Mail, gaia: IdCard } as Partial<Record<GoogleModeId, typeof Mail>>;
const RUN_TITLE: Partial<Record<GoogleModeId, string>> = { email: 'Искать по этому e-mail', gaia: 'Искать по этому Gaia ID' };

/** Значение (e-mail, Gaia ID) с копированием и кнопкой «искать дальше» — поиском другого вида на этой странице. */
export function Searchable({ value, mode, mono = true }: { value: string; mode: GoogleModeId; mono?: boolean }) {
  const run = useGoogleRun();
  const Icon = RUN_ICON[mode] ?? Search;
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span className={clsx('truncate', mono && 'font-mono text-mint')}>{value}</span>
      <CopyButton value={value} title="Скопировать" />
      {run && (
        <button type="button" onClick={() => run(mode, value)} title={RUN_TITLE[mode]} aria-label={RUN_TITLE[mode]} className="shrink-0 cursor-pointer text-mute transition hover:text-mint">
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
