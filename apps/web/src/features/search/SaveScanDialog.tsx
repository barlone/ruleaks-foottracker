import { useEffect, useState } from 'react';
import { newId } from '@ft/shared';
import { Button, Dialog, Field, Input, Segmented, Select } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';

/** Альбом раздела «Медиа» досье, куда по умолчанию попадают сканы. */
const SCANS_ALBUM = 'Сканы документов';

/**
 * Сохранение скана документа в раздел «Медиа» досье (существующего или нового досье персоны).
 * Файлового хранилища пока нет: картинка уходит в элемент media как data URL — так же, как фото, загруженные в досье.
 */
export function SaveScanDialog({
  open, onOpenChange, image, caption: defaultCaption, personGuess, scanId, leak, lastDossierId, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Картинка скана (с текущим поворотом) как data URL. */
  image: () => Promise<string>;
  caption: string;
  /** Название нового досье по умолчанию. */
  personGuess: string;
  scanId: string;
  leak: string;
  /** Досье, выбранное в прошлый раз: несколько сканов подряд обычно идут в одно досье. */
  lastDossierId: string;
  onSaved: (dossier: { id: string; title: string }) => void;
}) {
  const options = trpc.dossiers.options.useQuery(undefined, { enabled: open });
  const utils = trpc.useUtils();
  const create = trpc.dossiers.create.useMutation();
  const addItem = trpc.dossiers.addItem.useMutation();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [dossierId, setDossierId] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [album, setAlbum] = useState(SCANS_ALBUM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = (options.data ?? []).filter((d) => d.role !== 'viewer');
  useEffect(() => {
    if (!open) return;
    setDossierId(lastDossierId);
    setTitle('');
    setCaption(defaultCaption);
    setAlbum(SCANS_ALBUM);
    setError(null);
  }, [open, lastDossierId, defaultCaption]);
  // Сохранённое досье могли удалить или отозвать доступ — тогда выбор пустой.
  const selected = editable.some((d) => d.id === dossierId) ? dossierId : '';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const url = await image();
      let target = editable.find((d) => d.id === selected);
      if (mode === 'new') {
        const d = await create.mutateAsync({ kind: 'person', title: title.trim() || personGuess || 'Без названия', summaryMd: '' });
        target = { id: d.id, title: d.title, kind: d.kind, role: 'owner' };
      }
      if (!target) return;
      await addItem.mutateAsync({
        id: target.id,
        item: {
          type: 'media',
          mediaId: newId(),
          url,
          caption: caption.trim() || undefined,
          album: album.trim() || undefined,
          // Скан самого документа — первичный источник; ref — uuid в хранилище scanstore, note — утечка.
          source: { kind: 'document', ref: `scanstore:${scanId}`, note: leak, reliability: 'B', credibility: '2', capturedAt: new Date().toISOString() },
        },
      });
      await utils.dossiers.invalidate();
      onSaved({ id: target.id, title: target.title });
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Сохранить скан в досье" stacked>
      <div className="space-y-4">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'existing', label: 'В существующее' }, { value: 'new', label: 'Новое досье' }]} />
        {mode === 'existing' ? (
          <Field label="Досье">
            <Select value={selected} onChange={(e) => setDossierId(e.target.value)} className="w-full">
              <option value="">{options.isLoading ? 'загрузка…' : '— выберите —'}</option>
              {editable.map((d) => (
                <option key={d.id} value={d.id}>{d.title}{d.role === 'editor' ? ' (общее)' : ''}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Название (персона)">
            <Input value={title} placeholder={personGuess || 'Фамилия Имя Отчество'} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <Field label="Подпись">
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={1000} />
        </Field>
        <Field label="Альбом" hint="Раздел «Медиа» группирует файлы по альбомам">
          <Input value={album} onChange={(e) => setAlbum(e.target.value)} maxLength={128} />
        </Field>
        {error && <p className="font-mono text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={busy || (mode === 'existing' && !selected)}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
