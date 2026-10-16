import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Dialog, Field, Input, Select, Segmented } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { guessPlatform } from '../../lib/platform.ts';
import { toast } from '../../lib/toast.ts';

// Найденные страницы пользователя → элементы «Соцсети и ссылки» досье (существующего или нового).
// Источник — сама ссылка (kind url) с пометкой, что её нашёл поиск личных страниц; оценка C-3, как у снимков
// поиска: вердикт эвристический, страницу стоит проверить глазами. Ссылка, уже имеющаяся в досье, сервером пропускается.

export interface PendingPage {
  site: string;
  url: string;
}

export function AddPagesDialog({
  open, onOpenChange, pages, username,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pages: PendingPage[];
  username: string;
}) {
  const options = trpc.dossiers.options.useQuery(undefined, { enabled: open });
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [dossierId, setDossierId] = useState('');
  const [title, setTitle] = useState('');
  const create = trpc.dossiers.create.useMutation();
  const addItem = trpc.dossiers.addItem.useMutation();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setTitle('');
  }, [open]);

  const editable = (options.data ?? []).filter((d) => d.role !== 'viewer');

  async function submit() {
    setBusy(true);
    try {
      let id = dossierId;
      if (mode === 'new') {
        const d = await create.mutateAsync({ kind: 'person', title: title || username, summaryMd: '' });
        id = d.id;
      }
      if (!id) return;
      const capturedAt = new Date().toISOString();
      for (const p of pages) {
        await addItem.mutateAsync({
          id,
          item: {
            type: 'link',
            url: p.url,
            title: p.site,
            platform: guessPlatform(p.url),
            source: { kind: 'url', ref: p.url, note: `Поиск личных страниц: ${username}`, reliability: 'C', credibility: '3', capturedAt },
          },
        });
      }
      await utils.dossiers.invalidate();
      toast(`Добавлено в досье: ссылок ${pages.length}`);
      onOpenChange(false);
      void navigate({ to: '/dossiers/$id', params: { id } });
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Добавить в досье">
      <div className="space-y-5">
        <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-line-soft bg-bg-soft p-3 font-mono text-xs">
          {pages.map((p) => (
            <div key={p.url} className="flex gap-2">
              <span className="w-32 shrink-0 truncate text-mute">{p.site}</span>
              <span className="truncate text-text">{p.url}</span>
            </div>
          ))}
        </div>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'existing', label: 'В существующее' }, { value: 'new', label: 'Новое досье' }]} />
        {mode === 'existing' ? (
          <Field label="Досье">
            <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)} className="w-full">
              <option value="">— выберите —</option>
              {editable.map((d) => (
                <option key={d.id} value={d.id}>{d.title}{d.role === 'editor' ? ' (общее)' : ''}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Название (персона)">
            <Input value={title} placeholder={username} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <p className="text-xs text-mute">Ссылки попадут в раздел «Соцсети и ссылки»; уже имеющиеся в досье не дублируются.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !pages.length || (mode === 'existing' && !dossierId)}>Добавить</Button>
        </div>
      </div>
    </Dialog>
  );
}
