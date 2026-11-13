import { AppWindow, FileText, FolderOpen, MessageSquare, Users } from 'lucide-react';
import type { GoogleDriveApp, GoogleDriveComments, GoogleDriveFile, GoogleDriveReport, GoogleDriveUser } from '@ft/shared';
import { Card, CopyButton, Empty, Tag } from '../../components/ui.tsx';
import { fmtUtc } from '../../lib/format.ts';
import { t, tx } from '../../lib/i18n.ts';
import { Ext, Mono, None, Photo, Row, Searchable, SectionCard } from './GoogleParts.tsx';
import { minutesText, sizeText } from './googleSearch.ts';

// Отчёт поиска по файлу Google Drive (modules/drive.py): свойства файла, участники (из разрешений), автор последней
// правки, приложение-источник, содержимое папки, авторы комментариев.

const ROLE: Record<string, string> = {
  owner: 'Владелец', organizer: 'Организатор', fileOrganizer: 'Организатор файлов', writer: 'Редактор',
  commenter: 'Комментатор', reader: 'Читатель', none: 'Без прав',
};
const roleLabel = (r: string) => (ROLE[r] ? t(ROLE[r]) : r);

/** Права сверх стандартных — по-русски для частых, иначе как в API без префикса can. */
const CAPS: Record<string, string> = {
  canEdit: 'редактировать', canComment: 'комментировать', canShare: 'делиться', canAddChildren: 'добавлять в папку',
  canRename: 'переименовывать', canDelete: 'удалять', canTrash: 'удалять в корзину', canModifyContent: 'менять содержимое',
  canReadRevisions: 'видеть версии', canListChildren: 'видеть содержимое', canCopy: 'копировать', canDownload: 'скачивать',
  canReadAllPermissions: 'видеть все разрешения', canChangeCopyRequiresWriterPermission: 'менять запрет копирования',
};
const capLabel = (c: string) => (CAPS[c] ? t(CAPS[c]) : c.replace(/^can/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());

export function GoogleDriveResult({ report }: { report: GoogleDriveReport }) {
  if (!report.found || !report.file) {
    return <Empty>{t('Файл {id} не найден: его нет или он не открыт «всем, у кого есть ссылка».', { id: report.fileId })}</Empty>;
  }
  const file = report.file;
  return (
    <>
      <FileCard file={file} />
      <UsersCard users={file.users} last={file.lastModifyingUser} />
      <div className="grid items-start gap-6 2xl:grid-cols-2">
        <SectionCard title={t('Приложение-источник')} icon={<AppWindow size={13} />} section={report.sourceApp}>{(a) => <AppView app={a} />}</SectionCard>
        <SectionCard title={t('Содержимое папки')} icon={<FolderOpen size={13} />} section={report.children}>
          {(n) => (n ? <span className="text-sm">{n >= 1000 ? t('1000 и больше элементов') : t('элементов: {n}', { n })}</span> : <None>{t('папка пуста или содержимое не видно')}</None>)}
        </SectionCard>
        <SectionCard title={t('Комментарии')} icon={<MessageSquare size={13} />} section={report.comments}>{(c) => <CommentsView comments={c} />}</SectionCard>
      </div>
    </>
  );
}

function FileCard({ file }: { file: GoogleDriveFile }) {
  return (
    <Card title={<><FileText size={13} /> {t(file.isFolder ? 'Папка Google Drive' : 'Файл Google Drive')}</>}>
      <div className="divide-y divide-line-soft">
        <Row label={t('Название')}><span className="font-semibold">{file.title || '—'}</span></Row>
        <Row label="ID"><span className="inline-flex items-center gap-2"><Mono>{file.id}</Mono><CopyButton value={file.id} title={t('Скопировать ID')} /></span></Row>
        <Row label={t('Тип')}>{file.typeLabel ? tx(file.typeLabel) : file.mimeType}{file.typeLabel && <span className="ml-2 font-mono text-[11px] text-mute">{file.mimeType}</span>}</Row>
        {file.size !== null && <Row label={t('Размер')}>{sizeText(file.size)}</Row>}
        {file.md5 && <Row label="MD5"><span className="font-mono text-xs">{file.md5}</span></Row>}
        <Row label={t('Создан')}>{file.createdAt ? <>{fmtUtc(file.createdAt)} <span className="text-xs text-mute">UTC</span></> : <None />}</Row>
        <Row label={t('Изменён')}>{file.modifiedAt ? <>{fmtUtc(file.modifiedAt)} <span className="text-xs text-mute">UTC</span></> : <None />}</Row>
        {file.link && <Row label={file.isFolder ? t('Ссылка на папку') : t('Ссылка')}><Ext href={file.link}>{file.link}</Ext></Row>}
        {file.description && <Row label={t('Описание')}><span className="whitespace-pre-wrap">{file.description}</span></Row>}
        <Row label={t('Доступ по ссылке')}>
          {file.linkRoles ? (
            <div className="flex flex-wrap gap-1.5">{file.linkRoles.map((r) => <Tag key={r} tone="warn">{roleLabel(r).toLowerCase()}</Tag>)}</div>
          ) : <None>{t('не открыт по ссылке')}</None>}
        </Row>
        {!file.sourceAppId && <Row label={t('Приложение-источник')}><None>{t('нет')}</None></Row>}
        {file.image && <Row label={t('Изображение')}>{file.image.width}×{file.image.height}{file.image.rotation ? `, ${t('поворот {deg}°', { deg: file.image.rotation * 90 })}` : ''}</Row>}
        {file.video && (
          <Row label={t('Видео')}>
            {file.video.width}×{file.video.height}
            {file.video.durationMs ? `, ${minutesText(Math.round(file.video.durationMs / 60_000)) || t('{s} с', { s: Math.round(file.video.durationMs / 1000) })}` : ''}
          </Row>
        )}
        <Row label={t('Родительские папки')}>
          {file.parents.length ? (
            <div className="space-y-0.5">
              {file.parents.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="font-mono text-xs">{p.id}</span>
                  {p.isRoot && <Tag tone="dim">{t('корень «Моего диска»')}</Tag>}
                </div>
              ))}
            </div>
          ) : <None>{t('не видны')}</None>}
        </Row>
        <Row label={t('Права служебного аккаунта')}>
          {file.extraCapabilities.length ? (
            <div className="flex flex-wrap gap-1.5">{file.extraCapabilities.map((c) => <Tag key={c} tone="info"><span title={c}>{capLabel(c)}</span></Tag>)}</div>
          ) : <None>{t('стандартные для открытого по ссылке')}</None>}
        </Row>
      </div>
    </Card>
  );
}

function UserLine({ u }: { u: GoogleDriveUser }) {
  return (
    <div className="flex items-start gap-3 py-2">
      {u.photoUrl ? <Photo url={u.photoUrl} alt="" className="size-9 rounded-full" /> : <span className="size-9 shrink-0 rounded-full border border-line bg-bg-soft" />}
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{u.name ?? <None>{t('имя не указано')}</None>}</span>
          <Tag tone="dim">{roleLabel(u.role)}</Tag>
          {u.lastModifying && <Tag tone="info">{t('последняя правка')}</Tag>}
        </div>
        {u.email && <div><Searchable value={u.email} mode="email" mono={false} /></div>}
        {u.gaiaId && <div className="text-xs"><span className="mr-2 font-mono text-mute">Gaia ID</span><Searchable value={u.gaiaId} mode="gaia" /></div>}
      </div>
    </div>
  );
}

function UsersCard({ users, last }: { users: GoogleDriveUser[]; last: GoogleDriveFile['lastModifyingUser'] }) {
  // Автор последней правки, которого нет среди участников (разрешения у файла скрыты), — отдельной строкой.
  const lastApart = last && !users.some((u) => u.lastModifying);
  return (
    <Card title={<><Users size={13} /> {t('Участники')}</>}>
      {!users.length && !lastApart && <None>{t('участники не видны: файл открыт по ссылке без списка разрешений')}</None>}
      <div className="divide-y divide-line-soft">
        {users.map((u) => <UserLine key={u.email ?? u.gaiaId ?? u.name} u={u} />)}
        {lastApart && <UserLine u={{ name: last.name, email: last.email, gaiaId: null, role: 'none', photoUrl: last.photoUrl, lastModifying: true }} />}
      </div>
    </Card>
  );
}

function AppView({ app }: { app: GoogleDriveApp | null }) {
  if (!app) return <None>{t('приложение не найдено')}</None>;
  return (
    <div className="flex gap-4">
      {app.iconUrl && <Photo url={app.iconUrl} alt="" className="size-12" />}
      <div className="min-w-0 flex-1 divide-y divide-line-soft">
        <Row label={t('Название')}>{app.name ?? <None />}</Row>
        <Row label={t('Номер проекта')}><span className="font-mono text-xs">{app.id}</span></Row>
        <Row label={t('Сайт')}>{app.homePage ? <Ext href={app.homePage}>{app.homePage}</Ext> : <None />}</Row>
        {app.supportEmail && <Row label={t('Почта поддержки')}><Searchable value={app.supportEmail} mode="email" mono={false} /></Row>}
      </div>
    </div>
  );
}

function CommentsView({ comments }: { comments: GoogleDriveComments }) {
  if (!comments.total) return <None>{t('комментариев нет')}</None>;
  return (
    <div className="space-y-2">
      <div className="font-mono text-xs text-dim">{t('сообщений: {total}, авторов: {authors}', { total: comments.total, authors: comments.authors.length })}{comments.authors.length >= 20 ? ` (${t('первые 20')})` : ''}</div>
      {comments.authors.map((a) => (
        <div key={`${a.name}$${a.photoUrl ?? ''}`} className="flex items-center gap-2.5 text-sm">
          {a.photoUrl ? <Photo url={a.photoUrl} alt="" className="size-7 rounded-full" /> : <span className="size-7 shrink-0 rounded-full border border-line bg-bg-soft" />}
          <span className="min-w-0 flex-1 truncate">{a.name}</span>
          <span className="font-mono text-xs text-mute">{a.count}</span>
        </div>
      ))}
    </div>
  );
}
