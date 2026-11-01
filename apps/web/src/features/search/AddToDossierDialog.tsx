import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Dialog, Field, Input, Select, Segmented, WarnNote } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';
import { POST_KIND_LABELS, findDuplicate, markDuplicates, type DossierItem, type SearchSection } from '@ft/shared';
import { useTargetItems } from './dossierTarget.ts';

export interface PendingValue {
  key: string;
  label: string;
  value: string;
}

/** Пост/комментарий/реакция (из поиска в Telegram) — станет элементом «Посты и реакции» с источником-ссылкой. */
export type PendingPost = Omit<Extract<DossierItem, { type: 'post' }>, 'id' | 'type' | 'position' | 'createdAt' | 'source'>;

/**
 * Перенос найденного в досье: выбранные значения становятся атрибутами, сообщения — постами,
 * а сам поиск — снимком (источник для всех атрибутов).
 */
export function AddToDossierDialog({
  open, onOpenChange, values, posts = [], search,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  values: PendingValue[];
  posts?: PendingPost[];
  search: { id: string; section: SearchSection; kind: string; query: string; deep: boolean; summary: string };
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

  const editable = (options.data ?? []).filter((d) => d.role !== 'viewer');
  const nameGuess = values.find((v) => v.key === 'names')?.value ?? '';

  const target = useTargetItems(open && mode === 'existing' && dossierId ? dossierId : null);
  const pending = [...posts.map((p) => ({ ...p, type: 'post' as const })), ...values.map((v) => ({ ...v, type: 'attribute' as const }))];
  const duplicates = markDuplicates(target.items, pending);
  const postDuplicates = duplicates.slice(0, posts.length);
  const valueDuplicates = duplicates.slice(posts.length);
  const duplicateCount = duplicates.filter(Boolean).length;
  const hasSnapshot = !!findDuplicate(target.items, { type: 'snapshot', searchId: search.id });
  // Снимок того же поиска уже в досье и новых значений нет — добавлять нечего.
  const nothingNew = hasSnapshot && duplicateCount === pending.length;

  async function submit() {
    setBusy(true);
    try {
      let id = dossierId;
      if (mode === 'new') {
        const d = await create.mutateAsync({ kind: 'person', title: title || nameGuess || search.query, summaryMd: '' });
        id = d.id;
      }
      if (!id) return;
      const capturedAt = new Date().toISOString();
      const source = { kind: 'search' as const, ref: search.id, reliability: 'C' as const, credibility: '3' as const, capturedAt };
      // Всё одним запросом: снимок, значения, посты (в хронологическом порядке). Дубликаты сервер пропускает сам:
      // за время, пока открыто окно, досье мог изменить коллега.
      const { skipped } = await addItems.mutateAsync({
        id,
        items: [
          { type: 'snapshot', searchId: search.id, section: search.section, kind: search.kind, query: search.query, deep: search.deep, summary: search.summary },
          ...values.map((v) => ({ type: 'attribute' as const, key: v.key, label: v.label, value: v.value, source })),
          ...[...posts]
            .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
            .map((p) => ({ type: 'post' as const, ...p, source: p.url ? { ...source, kind: 'url' as const, ref: p.url } : source })),
        ],
      });
      await utils.dossiers.invalidate();
      toast(skipped
        ? `Добавлено в досье: ${pending.length - skipped} из ${pending.length}, дубликаты пропущены`
        : `Добавлено в досье: ${values.length} знач.${posts.length ? `, ${posts.length} пост.` : ''}${hasSnapshot ? '' : ' + снимок поиска'}`);
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
          {values.length === 0 && posts.length === 0 && <div className="text-mute">Только снимок поиска</div>}
          {posts.map((p, i) => (
            <div key={`p${i}`} className="line-clamp-2 border-l-2 border-mint/40 pl-2 text-dim">
              {postDuplicates[i] && <span className="text-warn">дубликат · </span>}
              <span className="text-mint">{POST_KIND_LABELS[p.kind]}{p.emoji ? ` ${p.emoji}` : ''}</span> · {p.text}
            </div>
          ))}
          {values.map((v, i) => (
            <div key={i} className="flex gap-2">
              <span className="w-32 shrink-0 text-mute">{v.label}</span>
              <span className={valueDuplicates[i] ? 'text-mute line-through' : 'text-text'}>{v.value}</span>
              {valueDuplicates[i] && <span className="ml-auto shrink-0 text-warn">дубликат</span>}
            </div>
          ))}
        </div>
        {(duplicateCount > 0 || nothingNew) && (
          <WarnNote>
            {nothingNew
              ? 'Всё это уже есть в досье — добавлять нечего.'
              : duplicateCount === pending.length
              ? 'Всё это уже есть в досье — добавится только снимок поиска.'
              : `Дубликаты: ${duplicateCount} из ${pending.length} — повторно добавлены не будут.`}
          </WarnNote>
        )}
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
            <Input value={title} placeholder={nameGuess || 'Фамилия Имя Отчество'} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={busy || target.loading || nothingNew || (mode === 'existing' && !dossierId)}>Добавить</Button>
        </div>
      </div>
    </Dialog>
  );
}
