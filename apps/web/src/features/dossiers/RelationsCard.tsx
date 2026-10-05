import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, Pencil, Plus, User, Waypoints } from 'lucide-react';
import { normalizeRelationText } from '@ft/shared';
import { Button, Card, ConfirmDeleteBtn, Dialog, Empty, Field, Input, Select, Spinner } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';

// «Связи» досье персоны: связи с другими персонами из словаря типов (предопределённые + свои),
// между двумя персонами — несколько связей, у каждой необязательное пояснение («возможно сын»).

type Rel = RouterOutputs['relations']['list'][number];

export function RelationsCard({ dossierId, editable }: { dossierId: string; editable: boolean }) {
  const list = trpc.relations.list.useQuery({ dossierId });
  const [adding, setAdding] = useState(false);
  const utils = trpc.useUtils();
  const onError = (e: unknown) => toast(errorText(e), 'error');
  // Связь видна в обоих досье — обновляем все списки.
  const refresh = () => utils.relations.list.invalidate();
  const setNote = trpc.relations.setNote.useMutation({ onSuccess: refresh, onError });
  const remove = trpc.relations.remove.useMutation({ onSuccess: refresh, onError });

  // По одной строке на персону, внутри — её связи.
  const groups = useMemo(() => {
    const m = new Map<string, { other: Rel['other']; rels: Rel[] }>();
    for (const r of list.data ?? []) {
      const g = m.get(r.other.id) ?? { other: r.other, rels: [] };
      g.rels.push(r);
      m.set(r.other.id, g);
    }
    return [...m.values()].sort((a, b) => a.other.title.localeCompare(b.other.title));
  }, [list.data]);

  return (
    <Card
      compact
      title={<><Waypoints size={13} /> Связи</>}
      actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus size={13} /> Добавить</Button>}
    >
      {list.isLoading ? (
        <div className="grid h-16 place-items-center"><Spinner /></div>
      ) : groups.length === 0 ? (
        <Empty>Связей нет</Empty>
      ) : (
        <div className="divide-y divide-line-soft">
          {groups.map(({ other, rels }) => (
            <div key={other.id} className="flex gap-2.5 py-2 first:pt-0 last:pb-0">
              <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-bg-soft text-mint/40">
                {other.coverMediaUrl ? <img src={other.coverMediaUrl} alt="" className="size-full object-cover" /> : <User size={15} />}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <Link to="/dossiers/$id" params={{ id: other.id }} className="block truncate text-sm font-semibold hover:text-mint">{other.title}</Link>
                <div className="flex flex-wrap gap-1.5">
                  {rels.map((r) => (
                    <RelationChip
                      key={r.id}
                      rel={r}
                      editable={editable && r.canEdit}
                      onNote={(note) => setNote.mutate({ id: r.id, note })}
                      onRemove={() => remove.mutate({ id: r.id })}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editable && <AddRelationDialog open={adding} onOpenChange={setAdding} dossierId={dossierId} onDone={refresh} />}
    </Card>
  );
}

/** Тип связи и пояснение; при наведении — правка пояснения и удаление (как у атрибутов). */
function RelationChip({ rel, editable, onNote, onRemove }: { rel: Rel; editable: boolean; onNote: (note: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onNote(draft.trim());
          setDraft(null);
        }}
      >
        <span className="font-mono text-[11px] text-mint">{rel.typeText}</span>
        <Input
          autoFocus
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
          placeholder="пояснение"
          className="h-6 w-40 px-1.5 text-xs"
        />
      </form>
    );
  }
  return (
    <span className="group inline-flex items-center gap-1.5 rounded-md border border-line bg-mint/5 px-2 py-0.5 font-mono text-[11px] leading-5">
      {rel.direction === 'in' && (
        <span title="Связь указана в досье другой персоны"><ArrowLeftRight size={10} className="text-mute" /></span>
      )}
      <span className="text-mint">{rel.typeText}</span>
      {rel.note && <span className="text-dim">· {rel.note}</span>}
      {editable && (
        <span className="hidden items-center gap-1.5 group-hover:inline-flex has-[[data-armed]]:inline-flex">
          <button type="button" onClick={() => setDraft(rel.note ?? '')} title="Изменить пояснение" className="cursor-pointer text-mute hover:text-mint">
            <Pencil size={11} />
          </button>
          <ConfirmDeleteBtn onConfirm={onRemove} title="Удалить связь" />
        </span>
      )}
    </span>
  );
}

/**
 * Новая связь: персона + один или несколько типов из словаря, у каждого своё пояснение.
 * Свой тип создаётся тут же (в нижнем регистре); свои типы можно удалить из словаря.
 */
function AddRelationDialog({ open, onOpenChange, dossierId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; dossierId: string; onDone: () => void }) {
  const utils = trpc.useUtils();
  const options = trpc.dossiers.options.useQuery(undefined, { enabled: open });
  const types = trpc.relations.types.useQuery(undefined, { enabled: open });
  const [otherId, setOtherId] = useState('');
  const [picked, setPicked] = useState<Map<string, string>>(new Map()); // typeId → пояснение
  const [newType, setNewType] = useState('');
  const onError = (e: unknown) => toast(errorText(e), 'error');

  const reset = () => {
    setOtherId('');
    setPicked(new Map());
    setNewType('');
  };
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, '');
      return next;
    });

  const createType = trpc.relations.createType.useMutation({
    onSuccess: (t) => {
      setNewType('');
      void utils.relations.types.invalidate();
      toggle(t.id);
    },
    onError,
  });
  const removeType = trpc.relations.removeType.useMutation({
    onSuccess: () => {
      void utils.relations.types.invalidate();
      onDone();
    },
    onError,
  });
  const add = trpc.relations.add.useMutation({
    onSuccess: () => {
      onDone();
      reset();
      onOpenChange(false);
    },
    onError,
  });

  const persons = (options.data ?? []).filter((d) => d.kind === 'person' && d.id !== dossierId);
  const list = types.data ?? [];
  const norm = normalizeRelationText(newType);
  const exists = list.some((t) => t.text === norm);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }} title="Новая связь">
      <div className="space-y-4">
        <Field label="Персона">
          <Select value={otherId} onChange={(e) => setOtherId(e.target.value)} className="w-full">
            <option value="">— выберите досье —</option>
            {persons.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </Select>
        </Field>

        <Field label="Тип связи (можно несколько)">
          <div className="flex flex-wrap gap-1.5">
            {list.map((t) => {
              const on = picked.has(t.id);
              return (
                <span
                  key={t.id}
                  className={clsx('group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition', on ? 'border-mint bg-mint/15 text-mint' : 'border-line-soft text-dim hover:border-line hover:text-text')}
                >
                  <button type="button" onClick={() => toggle(t.id)} className="cursor-pointer">{t.text}</button>
                  {t.ownerId !== null && (
                    <ConfirmDeleteBtn onConfirm={() => removeType.mutate({ id: t.id })} title="Удалить из словаря (удалит и связи этого типа)" />
                  )}
                </span>
              );
            })}
          </div>
        </Field>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (norm && !exists) createType.mutate({ text: norm });
          }}
        >
          <Input value={newType} maxLength={64} onChange={(e) => setNewType(e.target.value)} placeholder="свой тип связи…" className="h-8 lowercase" />
          <Button type="submit" size="sm" disabled={!norm || exists || createType.isPending} title={exists ? 'Такой тип уже есть' : undefined}>
            <Plus size={13} /> Тип
          </Button>
        </form>

        {picked.size > 0 && (
          <div className="space-y-2 rounded-xl border border-line-soft p-3">
            {[...picked].map(([id, note]) => (
              <label key={id} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate font-mono text-[11px] text-mint">{list.find((t) => t.id === id)?.text}</span>
                <Input
                  value={note}
                  maxLength={500}
                  onChange={(e) => setPicked((prev) => new Map(prev).set(id, e.target.value))}
                  placeholder="пояснение, например «возможно сын»"
                  className="h-8 text-xs"
                />
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!otherId || picked.size === 0 || add.isPending}
            onClick={() => add.mutate({ dossierId, otherId, links: [...picked].map(([typeId, note]) => ({ typeId, note: note.trim() || undefined })) })}
          >
            Добавить
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
