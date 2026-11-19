import { useState, type ReactNode } from 'react';
import { Archive, CloudUpload, Download, ExternalLink } from 'lucide-react';
import {
  ARCHIVE_FORMATS, ARCHIVE_FORMAT_LABELS, isArchiveActive, type ArchiveFormat, type ArchiveJobView, type ArchivePartStatus,
  type DriveStatusView, type LinkArchive,
} from '@ft/shared';
import { ProgressDialog } from '../../components/ProgressDialog.tsx';
import { Button, ConfirmDeleteBtn, CopyButton, Dialog, Field, Spinner, Tag, WarnNote } from '../../components/ui.tsx';
import { codeText } from '../../lib/errors.ts';
import { fmtBytes, fmtDate } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { archiveFileUrl, archiveProgress, driveConnectUrl, savedFileUrl } from './siteArchive.ts';

// Архив страницы ссылки досье: выбор форматов (в окне добавления ссылки и из строки ссылки), окно ожидания
// (задание идёт на сервере — окно можно свернуть), итог, сохранение на Google Диск и сохранённые архивы у ссылки.

export interface ArchiveCfg {
  formats: ArchiveFormat[];
  demo: boolean;
  keepMin: number;
}

const PART_STATUS: Record<ArchivePartStatus, string> = {
  pending: 'ожидает',
  running: 'снимается…',
  ok: 'готов',
  failed: 'не получился',
  skipped: 'пропущен',
};

const PHASE: Record<'queued' | 'capturing' | 'finishing' | 'uploading', string> = {
  queued: 'Страница в очереди службы архивации…',
  capturing: 'Браузер службы открыл страницу и снимает её…',
  finishing: 'Проверка файлов…',
  uploading: 'Сохранение на Google Диск…',
};

const FORMAT_HINT: Record<ArchiveFormat, string> = {
  pdf: 'страница целиком, как при печати',
  wacz: 'полная запись страницы со всеми ресурсами — для просмотра «как в браузере»',
};

const formatShort = (f: ArchiveFormat) => (f === 'pdf' ? 'PDF' : 'WACZ');

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-[var(--color-mint)]" />
      <span>{children}</span>
    </label>
  );
}

/** Подключение Google Диска одной строкой: куда сохранится архив или как подключить. */
export function DriveLine({ drive, onDisconnect }: { drive: DriveStatusView | null; onDisconnect?: () => void }) {
  if (!drive) return null;
  if (drive.connected) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-dim">
        <CloudUpload size={12} className="text-mint" />
        <span>{t('Сохранится на Google Диск {email}, папка «{folder}»', { email: drive.email ?? '', folder: drive.folderName })}</span>
        {drive.demo && <Tag tone="warn">{t('имитация')}</Tag>}
        {onDisconnect && <button type="button" onClick={onDisconnect} className="cursor-pointer text-mute underline hover:text-danger">{t('отключить')}</button>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-dim">
      <CloudUpload size={12} />
      <span>{t('Google Диск не подключён — файлы можно будет только скачать.')}</span>
      <a href={driveConnectUrl()} className="text-mint hover:underline">{t('Подключить Google Диск')}</a>
    </div>
  );
}

/** Форматы архива: пустой выбор — архив не снимается. */
export function ArchiveFormatsField({ cfg, drive, value, onChange, label, onDisconnect }: {
  cfg: ArchiveCfg; drive: DriveStatusView | null; value: ArchiveFormat[]; onChange: (v: ArchiveFormat[]) => void; label?: string;
  onDisconnect?: () => void;
}) {
  const toggle = (f: ArchiveFormat, on: boolean) => onChange(cfg.formats.filter((x) => (x === f ? on : value.includes(x))));
  return (
    <Field
      label={label ?? t('Архив страницы')}
      hint={t('Страницу откроет браузер службы архивации — с адреса сервера, не вашего.')}
    >
      <div className="space-y-1.5">
        {cfg.formats.map((f) => (
          <Check key={f} checked={value.includes(f)} onChange={(on) => toggle(f, on)}>
            {t(ARCHIVE_FORMAT_LABELS[f])} <span className="text-xs text-mute">— {t(FORMAT_HINT[f])}</span>
          </Check>
        ))}
      </div>
      {value.length > 0 && <div className="mt-2"><DriveLine drive={drive} onDisconnect={onDisconnect} /></div>}
      {cfg.demo && <div className="mt-2"><WarnNote>{t('Имитация: служба архивации не настроена, файлы будут вымышленными')}</WarnNote></div>}
    </Field>
  );
}

const partsLine = (j: ArchiveJobView) => j.parts.map((p) => `${t(ARCHIVE_FORMAT_LABELS[p.format])} — ${t(PART_STATUS[p.status])}`).join(' · ');

/** Окно ожидания: задание ведёт сервер, «Свернуть» только прячет окно — архив продолжает сниматься. */
export function ArchiveProgress({ job, onHide, onCancel, cancelling }: { job: ArchiveJobView | null; onHide: () => void; onCancel: () => void; cancelling: boolean }) {
  const active = !!job && isArchiveActive(job.state);
  return (
    <ProgressDialog
      open={active}
      title={t('Архив страницы')}
      value={job ? archiveProgress(job) : null}
      status={job && active ? t(PHASE[job.state as keyof typeof PHASE]) : undefined}
      detail={job ? <><div className="truncate" title={job.url}>{job.url}</div><div>{partsLine(job)}</div></> : undefined}
      startedAt={job ? Date.parse(job.startedAt) : null}
      onHide={onHide}
      onCancel={onCancel}
      cancelling={cancelling}
    />
  );
}

/** Ссылки «открыть» (PDF) и «скачать» одного файла. */
function FileLinks({ format, href, inlineHref }: { format: ArchiveFormat; href: string; inlineHref: string }) {
  return (
    <>
      {format === 'pdf' && (
        <a href={inlineHref} target="_blank" rel="noopener" title={t('Открыть в новой вкладке')} className="text-mute hover:text-mint">
          <ExternalLink size={13} />
        </a>
      )}
      <a href={href} download className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-mint hover:bg-mint/10">
        <Download size={12} /> {t('Скачать')}
      </a>
    </>
  );
}

function Sha({ value }: { value: string }) {
  return (
    <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-mute">
      <span className="truncate" title={value}>sha256 {value}</span>
      <CopyButton value={value} title={t('Копировать sha256')} />
    </div>
  );
}

/** Итог: по каждому формату — файл или почему не получился; сохранение на Google Диск. */
export function ArchiveResultDialog({ job, cfg, drive, onClose, onDismiss, onSave, saving }: {
  job: ArchiveJobView | null; cfg: ArchiveCfg; drive: DriveStatusView | null; onClose: () => void; onDismiss: (id: string) => void;
  onSave: (id: string) => void; saving: boolean;
}) {
  const saved = job?.drive.status === 'saved' ? job.drive.archiveId : null;
  const url = (p: ArchiveFormat, inline = false) => (saved ? savedFileUrl(job!.dossierId, job!.itemId, saved, p, inline) : archiveFileUrl(job!.id, p, inline));
  return (
    <Dialog open={!!job && !isArchiveActive(job.state)} onOpenChange={(v) => !v && onClose()} title={t('Архив страницы')}>
      {job && (
        <div className="space-y-4">
          <div className="min-w-0">
            <a href={job.url} target="_blank" rel="noreferrer noopener" className="block truncate font-mono text-xs text-mint hover:underline">{job.url}</a>
            <div className="mt-0.5 font-mono text-[10px] text-mute">
              {job.state === 'done'
                ? t('снят {date}', { date: fmtDate(job.finishedAt ?? job.startedAt, true) })
                : t('завершено {date}', { date: fmtDate(job.finishedAt ?? job.startedAt, true) })}
              {job.expiresAt && job.state === 'done' && !saved && <> · {t('файлы доступны до {time}', { time: fmtDate(job.expiresAt, true) })}</>}
            </div>
          </div>
          {cfg.demo && <WarnNote>{t('Имитация: служба архивации не настроена, файлы вымышленные')}</WarnNote>}
          {job.state === 'cancelled' && <div className="text-sm text-dim">{t('Архивация отменена')}</div>}
          {job.error && <div className="font-mono text-xs text-danger">{codeText(job.error)}</div>}
          <div className="space-y-2">
            {job.parts.map((p) => (
              <div key={p.format} className="rounded-lg border border-line-soft px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{t(ARCHIVE_FORMAT_LABELS[p.format])}</span>
                  {p.status === 'ok' ? (
                    <>
                      {p.size !== null && <span className="font-mono text-[10px] text-mute">{fmtBytes(p.size)}</span>}
                      <FileLinks format={p.format} href={url(p.format)} inlineHref={url(p.format, true)} />
                    </>
                  ) : (
                    <Tag tone={p.status === 'failed' ? 'danger' : 'dim'}>{t(PART_STATUS[p.status])}</Tag>
                  )}
                </div>
                {p.sha256 && <Sha value={p.sha256} />}
                {p.error && p.status !== 'ok' && <div className="mt-1 truncate font-mono text-[10px] text-mute" title={p.error}>{p.error}</div>}
              </div>
            ))}
          </div>

          {job.state === 'done' && (
            <div className="rounded-lg border border-line-soft px-3 py-2 text-xs">
              {job.drive.status === 'saved' && (
                <div className="flex items-center gap-2 text-mint"><CloudUpload size={13} /> {t('Сохранено на Google Диск и записано в досье')}</div>
              )}
              {job.drive.status === 'uploading' && <div className="flex items-center gap-2 text-dim"><Spinner className="size-3" /> {t('Сохранение на Google Диск…')}</div>}
              {(job.drive.status === 'none' || job.drive.status === 'failed') && (
                <div className="space-y-2">
                  {job.drive.error && <div className="font-mono text-danger">{codeText(job.drive.error)}</div>}
                  {drive?.connected ? (
                    <Button size="sm" variant="ghost" onClick={() => onSave(job.id)} disabled={saving}>
                      <CloudUpload size={13} /> {job.drive.status === 'failed' ? t('Повторить сохранение на Google Диск') : t('Сохранить на Google Диск')}
                    </Button>
                  ) : <DriveLine drive={drive} />}
                  <div className="text-mute">{t('Пока архив не сохранён, файлы удаляются со службы через {min} мин.', { min: cfg.keepMin })}</div>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-between gap-2">
            {!saved ? <Button variant="ghost" size="sm" onClick={() => onDismiss(job.id)}>{t('Удалить сейчас')}</Button> : <span />}
            <Button variant="primary" size="sm" onClick={onClose}>{t('Готово')}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * Строка состояния у ссылки: идёт — с крутилкой (открывает окно ожидания), снят и не сохранён / не получился —
 * открывает итог. Сохранённый на Диск архив показывает список SavedArchives, а не эта строка.
 */
export function ArchiveChip({ job, onOpen }: { job: ArchiveJobView; onOpen: () => void }) {
  const active = isArchiveActive(job.state) || job.drive.status === 'uploading';
  if (!active && job.drive.status === 'saved') return null;
  const ok = job.parts.filter((p) => p.status === 'ok');
  const text = active
    ? job.drive.status === 'uploading' ? t('архив сохраняется на Диск…') : t('архив снимается…')
    : job.state === 'done'
      ? job.drive.status === 'failed'
        ? t('архив не сохранён на Диск')
        : t('архив: {formats} — не сохранён', { formats: ok.map((p) => formatShort(p.format)).join(' + ') })
      : job.state === 'cancelled' ? t('архивация отменена') : t('архив не получился');
  const tone = active ? 'mint' : job.state === 'done' ? 'warn' : 'dim';
  return (
    <button type="button" onClick={onOpen} className="mt-1.5 cursor-pointer" title={active ? t('Показать ход архивации') : t('Открыть архив страницы')}>
      <Tag tone={tone}>{active ? <Spinner className="size-3" /> : <Archive size={11} />} {text}</Tag>
    </button>
  );
}

/** Сохранённые на Google Диск архивы ссылки (LinkArchive): новые сверху, файлы — с Диска того, кто снял. */
export function SavedArchives({ dossierId, itemId, archives, editable, meId, onRemove }: {
  dossierId: string; itemId: string; archives: LinkArchive[]; editable: boolean; meId: string | null; onRemove: (archiveId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const list = [...archives].reverse();
  const shown = all ? list : list.slice(0, 2);
  return (
    <div className="mt-2 space-y-1.5">
      {shown.map((a) => (
        <div key={a.id} className="group/arch rounded-md border border-line-soft px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Archive size={12} className="text-mint" />
            <span className="font-mono text-[11px] text-dim">{t('архив {date}', { date: fmtDate(a.at, true) })}</span>
            {a.byName && a.by !== meId && <span className="font-mono text-[10px] text-mute">{t('снял {name}', { name: a.byName })}</span>}
            <span className="flex-1" />
            {a.files.map((f) => (
              <span key={f.format} className="inline-flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-mute">{formatShort(f.format)} · {fmtBytes(f.size)}</span>
                <FileLinks format={f.format} href={savedFileUrl(dossierId, itemId, a.id, f.format)} inlineHref={savedFileUrl(dossierId, itemId, a.id, f.format, true)} />
              </span>
            ))}
            {editable && (
              <span className="opacity-0 group-hover/arch:opacity-100">
                <ConfirmDeleteBtn
                  onConfirm={() => onRemove(a.id)}
                  title={a.by === meId ? t('Удалить архив (файлы — в корзину вашего Google Диска)') : t('Убрать архив из досье (файлы останутся на Диске владельца)')}
                />
              </span>
            )}
          </div>
          {a.files.map((f) => <Sha key={f.format} value={f.sha256} />)}
        </div>
      ))}
      {list.length > 2 && (
        <button type="button" onClick={() => setAll(!all)} className="cursor-pointer font-mono text-[10px] text-mute hover:text-mint">
          {all ? t('свернуть') : t('ещё архивов: {n}', { n: list.length - 2 })}
        </button>
      )}
    </div>
  );
}

/** Снять архив уже сохранённой ссылки (из строки раздела «Ссылки»). */
export function ArchiveStartDialog({ url, cfg, drive, onClose, onStart, onDisconnect }: {
  url: string | null; cfg: ArchiveCfg; drive: DriveStatusView | null; onClose: () => void; onStart: (formats: ArchiveFormat[]) => Promise<void>;
  onDisconnect: () => void;
}) {
  const [formats, setFormats] = useState<ArchiveFormat[]>([...ARCHIVE_FORMATS]);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={!!url} onOpenChange={(v) => !v && onClose()} title={t('Архив страницы')}>
      {url && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            onStart(formats).finally(() => setBusy(false));
          }}
        >
          <div className="truncate font-mono text-xs text-mint" title={url}>{url}</div>
          <ArchiveFormatsField cfg={cfg} drive={drive} value={formats} onChange={setFormats} label={t('Что снять')} onDisconnect={onDisconnect} />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={busy || !formats.length}><Archive size={13} /> {t('Снять архив')}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
