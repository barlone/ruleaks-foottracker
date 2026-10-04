import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button, Dialog, Field, Input, Select, Segmented } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';
import type { SearchSection } from '@ft/shared';

export interface PendingValue {
  key: string;
  label: string;
  value: string;
}

/** Цитата (комментарий Telegram и т.п.) — станет заметкой досье с источником-ссылкой. */
export interface PendingNote {
  markdown: string;
  url?: string;
}

/**
 * Перенос найденного в досье: выбранные значения становятся атрибутами,
 * а сам поиск — снимком (источник для всех атрибутов).
 */
export function AddToDossierDialog({
  open, onOpenChange, values, notes = [], search,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  values: PendingValue[];
  notes?: PendingNote[];
  search: { id: string; section: SearchSection; kind: string; query: string; deep: boolean; summary: string };
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

  const editable = (options.data ?? []).filter((d) => d.role !== 'viewer');
  const nameGuess = values.find((v) => v.key === 'names')?.value ?? '';

  async function submit() {
    setBusy(true);
    try {
      let id = dossierId;
      if (mode === 'new') {
        const d = await create.mutateAsync({ kind: 'person', title: title || nameGuess || search.query, summaryMd: '', tags: [] });
        id = d.id;
      }
      if (!id) return;
      const capturedAt = new Date().toISOString();
      const source = { kind: 'search' as const, ref: search.id, reliability: 'C' as const, credibility: '3' as const, capturedAt };
      await addItem.mutateAsync({ id, item: { type: 'snapshot', searchId: search.id, section: search.section, kind: search.kind, query: search.query, deep: search.deep, summary: search.summary } });
      for (const v of values) {
        await addItem.mutateAsync({ id, item: { type: 'attribute', key: v.key, label: v.label, value: v.value, source } });
      }
      for (const n of notes) {
        const src = n.url ? { ...source, kind: 'url' as const, ref: n.url } : source;
        await addItem.mutateAsync({ id, item: { type: 'note', markdown: n.markdown, source: src } });
      }
      await utils.dossiers.invalidate();
      toast(`Добавлено в досье: ${values.length} знач.${notes.length ? `, ${notes.length} цит.` : ''} + снимок поиска`);
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
          {values.length === 0 && notes.length === 0 && <div className="text-mute">Только снимок поиска</div>}
          {notes.map((n, i) => (
            <div key={`n${i}`} className="line-clamp-2 border-l-2 border-mint/40 pl-2 text-dim">{n.markdown}</div>
          ))}
          {values.map((v, i) => (
            <div key={i} className="flex gap-2">
              <span className="w-32 shrink-0 text-mute">{v.label}</span>
              <span className="text-text">{v.value}</span>
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
            <Input value={title} placeholder={nameGuess || 'Фамилия Имя Отчество'} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={busy || (mode === 'existing' && !dossierId)}>Добавить</Button>
        </div>
      </div>
    </Dialog>
  );
}
