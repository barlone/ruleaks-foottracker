import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { markDuplicates } from '@ft/shared';
import { Button, Dialog, Field, Input, Select, Segmented, WarnNote } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { t, tc } from '../../lib/i18n.ts';
import { guessPlatform } from '../../lib/platform.ts';
import { toast } from '../../lib/toast.ts';
import { useTargetItems } from './dossierTarget.ts';

// Найденные страницы пользователя → элементы «Соцсети и ссылки» досье (существующего или нового).
// Источник — сама ссылка (kind url) с пометкой, что её нашёл поиск личных страниц; оценка C-3, как у снимков
// поиска: вердикт эвристический, страницу стоит проверить глазами. Ссылка, уже имеющаяся в досье, сервером пропускается,
// а окно показывает такие заранее.

export interface PendingPage {
  site: string;
  url: string;
  /** Как найдена страница — попадёт в примечание источника. */
  by?: 'username' | 'email';
}

export function AddPagesDialog({
  open, onOpenChange, pages, username, note,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pages: PendingPage[];
  username: string;
  /** Примечание источника вместо стандартного «Поиск личных страниц…» (ссылки из других разделов поиска). */
  note?: string;
}) {
  const options = trpc.dossiers.options.useQuery(undefined, { enabled: open });
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [dossierId, setDossierId] = useState('');
  const [title, setTitle] = useState('');
  const create = trpc.dossiers.create.useMutation();
  const addItems = trpc.dossiers.addItems.useMutation();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setTitle('');
  }, [open]);

  const editable = (options.data ?? []).filter((d) => d.role !== 'viewer');

  const target = useTargetItems(open && mode === 'existing' && dossierId ? dossierId : null);
  const duplicates = markDuplicates(target.items, pages.map((p) => ({ type: 'link' as const, url: p.url })));
  const duplicateCount = duplicates.filter(Boolean).length;
  const nothingNew = pages.length > 0 && duplicateCount === pages.length;

  /** Примечание источника по умолчанию — на языке интерфейса: это текст пользователя, с ним ничего не сравнивается. */
  function pagesNote(by: PendingPage['by']) {
    if (by === 'email') return t('Поиск личных страниц по e-mail: {username}', { username });
    if (by === 'username') return t('Поиск личных страниц по нику: {username}', { username });
    return t('Поиск личных страниц: {username}', { username });
  }

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
      // Все ссылки одним запросом; уже имеющиеся в досье сервер пропускает.
      const { skipped } = await addItems.mutateAsync({
        id,
        items: pages.map((p) => ({
          type: 'link' as const,
          url: p.url,
          title: p.site,
          platform: guessPlatform(p.url),
          source: { kind: 'url' as const, ref: p.url, note: note ?? pagesNote(p.by), reliability: 'C' as const, credibility: '3' as const, capturedAt },
        })),
      });
      await utils.dossiers.invalidate();
      toast(skipped
        ? t('Добавлено в досье: ссылок {added} из {total}, дубликаты пропущены', { added: pages.length - skipped, total: pages.length })
        : t('Добавлено в досье: ссылок {added}', { added: pages.length }));
      onOpenChange(false);
      void navigate({ to: '/dossiers/$id', params: { id } });
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('Добавить в досье')}>
      <div className="space-y-5">
        <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-line-soft bg-bg-soft p-3 font-mono text-xs">
          {pages.map((p, i) => (
            <div key={p.url} className="flex gap-2">
              <span className="w-32 shrink-0 truncate text-mute">{p.site}</span>
              <span className={duplicates[i] ? 'truncate text-mute line-through' : 'truncate text-text'}>{p.url}</span>
              {duplicates[i] && <span className="ml-auto shrink-0 text-warn">{t('дубликат')}</span>}
            </div>
          ))}
        </div>
        {duplicateCount > 0 && (
          <WarnNote>
            {nothingNew
              ? t('Все эти ссылки уже есть в досье — добавлять нечего.')
              : t('Дубликаты: {n} из {total} — повторно добавлены не будут.', { n: duplicateCount, total: pages.length })}
          </WarnNote>
        )}
        <Segmented value={mode} onChange={setMode} options={[{ value: 'existing', label: t('В существующее') }, { value: 'new', label: t('Новое досье') }]} />
        {mode === 'existing' ? (
          <Field label={tc('поле', 'Досье')}>
            <Select value={dossierId} onChange={(e) => setDossierId(e.target.value)} className="w-full">
              <option value="">{t('— выберите —')}</option>
              {editable.map((d) => (
                <option key={d.id} value={d.id}>{d.title}{d.role === 'editor' ? ` (${t('общее')})` : ''}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={t('Название (персона)')}>
            <Input value={title} placeholder={username} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <p className="text-xs text-mute">{t('Ссылки попадут в раздел «Соцсети и ссылки».')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Отмена')}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || target.loading || nothingNew || !pages.length || (mode === 'existing' && !dossierId)}>{t('Добавить')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
