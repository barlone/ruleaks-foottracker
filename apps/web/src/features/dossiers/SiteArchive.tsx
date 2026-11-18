import { useState, type ReactNode } from 'react';
import { Archive, Download, ExternalLink } from 'lucide-react';
import {
  ARCHIVE_FORMATS, ARCHIVE_FORMAT_LABELS, isArchiveActive, type ArchiveFormat, type ArchiveJobView, type ArchivePartStatus,
} from '@ft/shared';
import { ProgressDialog } from '../../components/ProgressDialog.tsx';
import { Button, CopyButton, Dialog, Field, Spinner, Tag, WarnNote } from '../../components/ui.tsx';
import { codeText } from '../../lib/errors.ts';
import { fmtBytes, fmtDate } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { archiveFileUrl, archiveProgress } from './siteArchive.ts';

// Архив страницы ссылки досье: выбор форматов (в окне добавления ссылки и из строки ссылки), окно ожидания
// (задание идёт на сервере — окно можно свернуть), итог с файлами и строка состояния у ссылки.

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

const PHASE: Record<'queued' | 'capturing' | 'finishing', string> = {
  queued: 'Страница в очереди службы архивации…',
  capturing: 'Браузер службы открыл страницу и снимает её…',
  finishing: 'Проверка файлов…',
};

const FORMAT_HINT: Record<ArchiveFormat, string> = {
  pdf: 'страница целиком, как при печати',
  wacz: 'полная запись страницы со всеми ресурсами — для просмотра «как в браузере»',
};

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-[var(--color-mint)]" />
      <span>{children}</span>
    </label>
  );
}

/** Форматы архива: пустой выбор — архив не снимается. */
export function ArchiveFormatsField({ cfg, value, onChange, label }: { cfg: ArchiveCfg; value: ArchiveFormat[]; onChange: (v: ArchiveFormat[]) => void; label?: string }) {
  const toggle = (f: ArchiveFormat, on: boolean) => onChange(cfg.formats.filter((x) => (x === f ? on : value.includes(x))));
  return (
    <Field
      label={label ?? t('Архив страницы')}
      hint={t('Страницу откроет браузер службы архивации — с адреса сервера, не вашего. Файлы можно скачать в течение {min} мин.', { min: cfg.keepMin })}
    >
      <div className="space-y-1.5">
        {cfg.formats.map((f) => (
          <Check key={f} checked={value.includes(f)} onChange={(on) => toggle(f, on)}>
            {t(ARCHIVE_FORMAT_LABELS[f])} <span className="text-xs text-mute">— {t(FORMAT_HINT[f])}</span>
          </Check>
        ))}
      </div>
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

/** Итог: по каждому формату — файл (скачать, открыть PDF, sha256) или почему не получился. */
export function ArchiveResultDialog({ job, cfg, onClose, onDismiss }: { job: ArchiveJobView | null; cfg: ArchiveCfg; onClose: () => void; onDismiss: (id: string) => void }) {
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
              {job.expiresAt && job.state === 'done' && <> · {t('файлы доступны до {time}', { time: fmtDate(job.expiresAt, true) })}</>}
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
                      {p.format === 'pdf' && (
                        <a href={archiveFileUrl(job.id, p.format, true)} target="_blank" rel="noopener" title={t('Открыть в новой вкладке')} className="text-mute hover:text-mint">
                          <ExternalLink size={13} />
                        </a>
                      )}
                      <a href={archiveFileUrl(job.id, p.format)} download className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-mint hover:bg-mint/10">
                        <Download size={12} /> {t('Скачать')}
                      </a>
                    </>
                  ) : (
                    <Tag tone={p.status === 'failed' ? 'danger' : 'dim'}>{t(PART_STATUS[p.status])}</Tag>
                  )}
                </div>
                {p.sha256 && (
                  <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-mute">
                    <span className="truncate" title={p.sha256}>sha256 {p.sha256}</span>
                    <CopyButton value={p.sha256} title={t('Копировать sha256')} />
                  </div>
                )}
                {p.error && p.status !== 'ok' && <div className="mt-1 truncate font-mono text-[10px] text-mute" title={p.error}>{p.error}</div>}
              </div>
            ))}
          </div>
          {job.state === 'done' && (
            <div className="text-xs text-mute">{t('Скачайте нужные файлы: через {min} мин они удаляются со службы. Сохранение на Google Диск появится позже.', { min: cfg.keepMin })}</div>
          )}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => onDismiss(job.id)}>{t('Удалить сейчас')}</Button>
            <Button variant="primary" size="sm" onClick={onClose}>{t('Готово')}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Строка состояния у ссылки: идёт — с крутилкой (открывает окно ожидания), готов / не получился — открывает итог. */
export function ArchiveChip({ job, onOpen }: { job: ArchiveJobView; onOpen: () => void }) {
  const active = isArchiveActive(job.state);
  const ok = job.parts.filter((p) => p.status === 'ok');
  const text = active
    ? t('архив снимается…')
    : job.state === 'done'
      ? t('архив: {formats}', { formats: ok.map((p) => (p.format === 'pdf' ? 'PDF' : 'WACZ')).join(' + ') })
      : job.state === 'cancelled' ? t('архивация отменена') : t('архив не получился');
  return (
    <button type="button" onClick={onOpen} className="mt-1.5 cursor-pointer" title={active ? t('Показать ход архивации') : t('Открыть архив страницы')}>
      <Tag tone={active ? 'mint' : job.state === 'done' ? (ok.length < job.parts.length ? 'warn' : 'mint') : 'dim'}>
        {active ? <Spinner className="size-3" /> : <Archive size={11} />} {text}
      </Tag>
    </button>
  );
}

/** Снять архив уже сохранённой ссылки (из строки раздела «Ссылки»). */
export function ArchiveStartDialog({ url, cfg, onClose, onStart }: { url: string | null; cfg: ArchiveCfg; onClose: () => void; onStart: (formats: ArchiveFormat[]) => Promise<void> }) {
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
          <ArchiveFormatsField cfg={cfg} value={formats} onChange={setFormats} label={t('Что снять')} />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={busy || !formats.length}><Archive size={13} /> {t('Снять архив')}</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
