import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ClipboardPaste, ImagePlus, Plus, Star, User, Users } from 'lucide-react';
import { newId, type DossierItem } from '@ft/shared';
import { Button, ConfirmDeleteBtn, Dialog, Empty, FilePicker, Input } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';
import { PHOTO_ALBUM } from './labels.ts';

// Фото персоны (группы): медиа-элементы досье в альбоме PHOTO_ALBUM. Основное фото — обложка досье
// (coverMediaUrl), оно показывается в боксе слева от названия, в списках досье и в связях.

type Media = Extract<DossierItem, { type: 'media' }>;

/** Бокс слева от названия: основное фото или значок с «+»; клик открывает окно фото. */
export function CoverBox({
  dossierId, kind, coverUrl, photos, editable,
}: {
  dossierId: string;
  kind: 'person' | 'group';
  coverUrl: string | null;
  photos: Media[];
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const clickable = editable || photos.length > 0;
  const Icon = kind === 'group' ? Users : User;
  return (
    <>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => setOpen(true)}
        title={editable ? (photos.length ? 'Фото: добавить, удалить, выбрать основное' : 'Добавить фото') : 'Фото'}
        className={clsx(
          'group relative size-32 shrink-0 overflow-hidden rounded-2xl border border-line bg-bg-soft shadow-glow-sm transition',
          clickable && 'cursor-pointer hover:border-mint/60',
        )}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="relative grid size-full place-items-center text-mint/30 transition group-hover:text-mint/60">
            <Icon size={48} />
            {/* Фото нет — к значку добавлен «+». */}
            {editable && (
              <span className="absolute bottom-7 right-8 grid size-6 place-items-center rounded-full border border-mint/50 bg-bg text-mint">
                <Plus size={14} strokeWidth={3} />
              </span>
            )}
          </span>
        )}
        {photos.length > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 font-mono text-[10px] text-dim">
            {photos.length} фото
          </span>
        )}
      </button>
      <PhotosDialog open={open} onOpenChange={setOpen} dossierId={dossierId} coverUrl={coverUrl} photos={photos} editable={editable} />
    </>
  );
}

/** Изображение → data URL, уменьшенное до 1600 px по большей стороне (JPEG): пока нет S3, фото хранятся в БД. */
async function toDataUrl(f: File): Promise<string> {
  const raw = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
  if (f.type === 'image/svg+xml' || f.type === 'image/gif') return raw;
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = raw;
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  if (scale === 1 && f.size < 600_000) return raw;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

function PhotosDialog({
  open, onOpenChange, dossierId, coverUrl, photos, editable,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dossierId: string;
  coverUrl: string | null;
  photos: Media[];
  editable: boolean;
}) {
  const utils = trpc.useUtils();
  const addItems = trpc.dossiers.addItems.useMutation();
  const removeItem = trpc.dossiers.removeItem.useMutation();
  const update = trpc.dossiers.update.useMutation();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => utils.dossiers.invalidate();
  /** Последовательные правки: версия досье берётся из ответа предыдущей. */
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  /** Добавить фото; если основного ещё нет — первое добавленное становится основным. */
  const addPhotos = (urls: { url: string; caption?: string }[]) =>
    run(async () => {
      if (!urls.length) return;
      const d = await addItems.mutateAsync({
        id: dossierId,
        items: urls.map((p) => ({ type: 'media' as const, mediaId: newId(), url: p.url, caption: p.caption, album: PHOTO_ALBUM })),
      });
      if (!coverUrl && urls[0]) await update.mutateAsync({ id: dossierId, version: d.version, patch: { coverMediaUrl: urls[0].url } });
      setUrl('');
    });

  /** Файлы-изображения (выбранные, вставленные из буфера) → фото досье. */
  async function addFiles(files: File[], caption?: (f: File) => string | undefined) {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    try {
      await addPhotos(await Promise.all(images.map(async (f) => ({ url: await toDataUrl(f), caption: caption ? caption(f) : f.name }))));
    } catch {
      toast('Не удалось прочитать изображение', 'error');
    }
  }
  // Скриншот или скопированная картинка не имеют осмысленного имени файла («image.png») — подписи нет.
  const fromClipboard = (files: File[]) => addFiles(files, () => undefined);

  // Ctrl+V при открытом окне: изображение из буфера сразу добавляется. Текст (ссылка в поле) вставляется как обычно.
  useEffect(() => {
    if (!open || !editable) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length || busy) return;
      e.preventDefault();
      void fromClipboard(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }); // каждый рендер — чтобы обработчик видел актуальные busy/coverUrl

  /** Кнопка «Вставить из буфера»: Clipboard API (браузер может спросить разрешение). */
  async function pasteButton() {
    try {
      const files: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) files.push(new File([await item.getType(type)], 'clipboard', { type }));
      }
      if (files.length) await fromClipboard(files);
      else toast('В буфере обмена нет изображения', 'error');
    } catch {
      toast('Браузер не дал прочитать буфер обмена — нажмите Ctrl+V в этом окне', 'error');
    }
  }

  const setMain = (u: string) =>
    run(async () => {
      const d = await utils.dossiers.get.fetch({ id: dossierId });
      await update.mutateAsync({ id: dossierId, version: d.version, patch: { coverMediaUrl: u } });
    });

  /** Удалить фото; если оно было основным — основным становится следующее. */
  const remove = (p: Media) =>
    run(async () => {
      const d = await removeItem.mutateAsync({ id: dossierId, itemId: p.id });
      if (p.url === coverUrl) {
        const next = photos.find((x) => x.id !== p.id);
        await update.mutateAsync({ id: dossierId, version: d.version, patch: { coverMediaUrl: next?.url ?? null } });
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Фото" width="max-w-[55rem]">
      <div className="space-y-4">
        {photos.length === 0 ? (
          <Empty>Фото нет</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => {
              const main = p.url === coverUrl;
              return (
                <figure
                  key={p.id}
                  className={clsx('group relative aspect-square overflow-hidden rounded-xl border bg-bg-soft', main ? 'border-mint shadow-glow-sm' : 'border-line-soft')}
                >
                  <img src={p.url} alt={p.caption ?? ''} className="size-full object-cover" />
                  {main && <span className="absolute left-1.5 top-1.5 rounded-md bg-mint px-1.5 font-mono text-[10px] font-bold text-mint-ink">основное</span>}
                  {editable && (
                    <span className="absolute right-1.5 top-1.5 flex items-center gap-2 rounded-md bg-black/80 px-1.5 py-1 opacity-0 transition group-hover:opacity-100 has-[[data-armed]]:opacity-100">
                      {!main && (
                        <button type="button" disabled={busy} onClick={() => setMain(p.url)} title="Сделать основным" className="cursor-pointer text-mute hover:text-mint">
                          <Star size={14} />
                        </button>
                      )}
                      <ConfirmDeleteBtn onConfirm={() => remove(p)} title="Удалить фото" />
                    </span>
                  )}
                  {p.caption && <figcaption className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-2 py-1 text-[11px] text-dim">{p.caption}</figcaption>}
                </figure>
              );
            })}
          </div>
        )}

        {editable && (
          <div className="space-y-3 rounded-xl border border-line-soft p-3">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-dim">
              <ImagePlus size={13} className="text-mint" /> Добавить фото
            </div>
            {/* Файлы и буфер обмена — в одну строку. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <FilePicker
                accept="image/*"
                multiple
                disabled={busy}
                onFiles={(files) => void addFiles(files)}
              />
              <div className="flex items-center gap-3">
                <Button type="button" size="sm" disabled={busy} onClick={() => void pasteButton()}>
                  <ClipboardPaste size={13} /> Вставить из буфера
                </Button>
                <span className="text-sm text-dim">или <kbd className="rounded border border-line px-1 font-mono text-xs text-text">Ctrl+V</kbd> в этом окне</span>
              </div>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) void addPhotos([{ url: url.trim() }]);
              }}
            >
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…или ссылка на изображение" className="h-8 text-sm" />
              <Button type="submit" size="sm" disabled={!url.trim() || busy}><Plus size={13} /> Добавить</Button>
            </form>
            <p className="font-mono text-[10px] text-mute">
              Можно выбрать несколько файлов сразу или вставить скриншот / скопированную картинку из буфера обмена;
              большие изображения уменьшаются до 1600 px. Первое фото становится основным.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
