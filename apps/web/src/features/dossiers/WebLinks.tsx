import { useEffect, useState } from 'react';
import { Archive, Camera, ExternalLink, Globe, Pencil, Plus, Trash2, X } from 'lucide-react';
import { DOSSIER_MEDIA_MAX_BYTES, MEDIA_FILE_MAX_BYTES, dossierMediaBytes, fmtBytes, isArchiveActive, type DossierItem } from '@ft/shared';
import { Button, Card, DELETE_GAP, Dialog, Empty, Field, FilePicker, Input, Spinner } from '../../components/ui.tsx';
import { errorText } from '../../lib/errors.ts';
import { t } from '../../lib/i18n.ts';
import { fitShot, shotDate, todayIso } from '../../lib/shotImage.ts';
import { toast } from '../../lib/toast.ts';
import { trpc } from '../../lib/trpc.ts';
import { ArchiveChip, ArchiveProgress, ArchiveResultDialog, ArchiveStartDialog, type ArchiveCfg } from './SiteArchive.tsx';
import { latestFor, useDossierArchives } from './siteArchive.ts';

// Раздел «Ссылки» досье: ссылки на внешние сайты (статьи, реестры, упоминания) — в отличие от «Соцсетей», где
// страницы самой персоны. Это тот же элемент link с kind = 'web'. К ссылке прикладываются снимки страницы
// (link.shots: картинка из буфера обмена или файла + дата «по состоянию на») — страница может измениться или пропасть.

type LinkItem = Extract<DossierItem, { type: 'link' }>;
type Shot = NonNullable<LinkItem['shots']>[number];

export function WebLinksCard({ dossierId, links, items, editable, archive, watching, onWatch, onAdd, onEdit, onRemove, onUpdate }: {
  dossierId: string;
  links: LinkItem[];
  /** Все элементы досье — для подсказки, сколько места под встроенные изображения занято. */
  items: DossierItem[];
  editable: boolean;
  /** Служба архивации страниц ([config] site-archive); null — её нет, кнопок нет. */
  archive: ArchiveCfg | null;
  /** Задание архивации, чьё окно ожидания открыто (ставится и окном добавления ссылки). */
  watching: string | null;
  onWatch: (jobId: string | null) => void;
  onAdd: () => void;
  onEdit: (link: LinkItem) => void;
  onRemove: (itemId: string) => void;
  /** Сохранить ссылку с изменённым списком снимков. */
  onUpdate: (link: LinkItem) => Promise<void>;
}) {
  const [shotFor, setShotFor] = useState<LinkItem | null>(null);
  const [viewing, setViewing] = useState<{ link: LinkItem; shot: Shot } | null>(null);
  const [archiveFor, setArchiveFor] = useState<LinkItem | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const jobs = useDossierArchives(dossierId, !!archive);
  const refresh = () => utils.siteArchive.list.invalidate({ dossierId });
  const start = trpc.siteArchive.start.useMutation({ onSuccess: refresh });
  const cancel = trpc.siteArchive.cancel.useMutation({ onSettled: refresh });
  const dismiss = trpc.siteArchive.dismiss.useMutation({ onSettled: refresh });
  const watched = watching ? jobs.find((j) => j.id === watching) ?? null : null;

  // Наблюдаемое задание закончилось — окно ожидания сменяется итогом.
  useEffect(() => {
    if (watched && !isArchiveActive(watched.state)) {
      onWatch(null);
      setResultId(watched.id);
    }
  }, [watched, onWatch]);

  return (
    <Card
      title={<><Globe size={13} /> {t('Ссылки')}</>}
      actions={editable && <Button size="sm" variant="ghost" onClick={onAdd}><Plus size={13} /> {t('Добавить')}</Button>}
    >
      {links.length === 0 && <Empty>{t('Ссылки на внешние сайты: статьи, реестры, упоминания. К ссылке можно приложить снимок страницы.')}</Empty>}
      <div className="space-y-1.5">
        {links.map((l) => (
          <div key={l.id} className="group rounded-lg border border-line-soft px-3 py-2">
            <div className="flex items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <a href={l.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm hover:text-mint">{l.title || l.url}</a>
                {l.title && <div className="truncate font-mono text-[10px] text-mute" title={l.url}>{l.url}</div>}
                {l.source?.ref && <div className="truncate font-mono text-[10px] text-mute" title={l.source.ref}>{l.source.ref}</div>}
              </div>
              <a href={l.url} target="_blank" rel="noreferrer noopener" title={t('Открыть в новой вкладке')} className="text-mute hover:text-mint">
                <ExternalLink size={12} />
              </a>
              {editable && (
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  {archive && (
                    <button type="button" onClick={() => setArchiveFor(l)} title={t('Снять архив страницы (PDF, веб-архив)')} className="cursor-pointer text-mute hover:text-mint"><Archive size={12} /></button>
                  )}
                  <button type="button" onClick={() => setShotFor(l)} title={t('Добавить снимок страницы')} className="cursor-pointer text-mute hover:text-mint"><Camera size={12} /></button>
                  <button type="button" onClick={() => onEdit(l)} title={t('Править')} className="cursor-pointer text-mute hover:text-mint"><Pencil size={12} /></button>
                  <button type="button" onClick={() => onRemove(l.id)} title={t('Удалить')} className={`${DELETE_GAP} cursor-pointer text-mute hover:text-danger`}><Trash2 size={12} /></button>
                </span>
              )}
            </div>
            {archive && (() => {
              const job = latestFor(jobs, l.id);
              return job && <ArchiveChip job={job} onOpen={() => (isArchiveActive(job.state) ? onWatch(job.id) : setResultId(job.id))} />;
            })()}
            {!!l.shots?.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {l.shots.map((s, i) => (
                  <figure key={i} className="group/shot relative">
                    <button type="button" onClick={() => setViewing({ link: l, shot: s })} title={t('Открыть снимок')} className="block cursor-pointer overflow-hidden rounded-md border border-line-soft transition hover:border-line">
                      <img src={s.url} alt="" className="h-24 w-40 object-cover object-top" />
                    </button>
                    <figcaption className="mt-0.5 font-mono text-[10px] text-mute">{t('по состоянию на {date}', { date: shotDate(s.at) })}</figcaption>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => void onUpdate({ ...l, shots: l.shots!.filter((_, j) => j !== i) })}
                        title={t('Удалить снимок')}
                        className="absolute right-1 top-1 grid size-5 cursor-pointer place-items-center rounded border border-line bg-panel/90 text-mute opacity-0 transition hover:text-danger group-hover/shot:opacity-100"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </figure>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!shotFor} onOpenChange={(v) => !v && setShotFor(null)} title={t('Снимок страницы')}>
        {shotFor && (
          <ShotForm
            key={shotFor.id}
            used={dossierMediaBytes(items)}
            onSave={async (shot) => {
              await onUpdate({ ...shotFor, shots: [...(shotFor.shots ?? []), shot] });
              setShotFor(null);
            }}
          />
        )}
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)} title={viewing ? t('по состоянию на {date}', { date: shotDate(viewing.shot.at) }) : ''} wide>
        {viewing && (
          <div className="space-y-2">
            <a href={viewing.link.url} target="_blank" rel="noreferrer noopener" className="block truncate font-mono text-xs text-mint hover:underline">{viewing.link.url}</a>
            <img src={viewing.shot.url} alt="" className="max-h-[70vh] w-full rounded-lg border border-line object-contain" />
          </div>
        )}
      </Dialog>

      {archive && (
        <>
          <ArchiveStartDialog
            key={archiveFor?.id ?? ''}
            url={archiveFor?.url ?? null}
            cfg={archive}
            onClose={() => setArchiveFor(null)}
            onStart={async (formats) => {
              try {
                const job = await start.mutateAsync({ dossierId, itemId: archiveFor!.id, formats });
                setArchiveFor(null);
                onWatch(job.id);
              } catch (e) {
                toast(errorText(e), 'error');
              }
            }}
          />
          <ArchiveProgress
            job={watched}
            onHide={() => {
              onWatch(null);
              toast(t('Архив снимается дальше — состояние видно у ссылки'));
            }}
            onCancel={() => watched && cancel.mutate({ id: watched.id })}
            cancelling={cancel.isPending}
          />
          <ArchiveResultDialog
            job={resultId ? jobs.find((j) => j.id === resultId) ?? null : null}
            cfg={archive}
            onClose={() => setResultId(null)}
            onDismiss={(id) => {
              dismiss.mutate({ id });
              setResultId(null);
            }}
          />
        </>
      )}
    </Card>
  );
}

/** Новый снимок: картинка из буфера обмена (Ctrl+V в открытом окне) или из файла и дата, на которую он сделан. */
function ShotForm({ used, onSave }: { used: number; onSave: (shot: Shot) => Promise<void> }) {
  const [image, setImage] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function take(blob: Blob | null | undefined) {
    if (!blob) return;
    setBusy(true);
    setError(null);
    try {
      setImage(await fitShot(blob, MEDIA_FILE_MAX_BYTES));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // Пока окно открыто, вставка из буфера обмена в любом его месте — это снимок.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void take(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // take не зависит от состояния формы
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!image || !date) return;
        setBusy(true);
        setError(null);
        onSave({ url: image, at: date }).catch((err) => setError(errorText(err))).finally(() => setBusy(false));
      }}
    >
      {image ? (
        <img src={image} alt="" className="max-h-64 w-full rounded-lg border border-line object-contain" />
      ) : (
        <div className="grid h-32 place-items-center rounded-lg border border-dashed border-line px-4 text-center text-sm text-dim">
          {busy ? <Spinner /> : t('Скопируйте снимок экрана и нажмите Ctrl+V в этом окне')}
        </div>
      )}
      <Field
        label={t('…или файл изображения')}
        hint={t('Снимок ужимается до {max}; на все изображения досье — {total} (занято {used}).', { max: fmtBytes(MEDIA_FILE_MAX_BYTES), total: fmtBytes(DOSSIER_MEDIA_MAX_BYTES), used: fmtBytes(used) })}
      >
        <FilePicker accept="image/*" onFiles={(fs) => void take(fs[0])} />
      </Field>
      <Field label={t('По состоянию на')}>
        <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className="w-48" />
      </Field>
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!image || !date || busy}>{t('Сохранить')}</Button>
      </div>
    </form>
  );
}
