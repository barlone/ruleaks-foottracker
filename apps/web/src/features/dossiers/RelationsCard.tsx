import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, Pencil, Plus, User, Waypoints } from 'lucide-react';
import { normalizeRelationText } from '@ft/shared';
import { Button, Card, ConfirmDeleteBtn, Dialog, Empty, Field, Input, Select, Spinner } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';

// «Связи» досье персоны: связи с другими персонами из словаря типов (предопределённые + свои),
// между двумя персонами — несколько связей. Тип общий для обеих сторон, пояснение у каждой своё:
// в одном досье «родственник · сын», в другом «родственник · отец» (или без пояснения).

type Rel = RouterOutputs['relations']['list'][number];
type Group = { other: Rel['other']; rels: Rel[] };

export function RelationsCard({ dossierId, editable }: { dossierId: string; editable: boolean }) {
  const list = trpc.relations.list.useQuery({ dossierId });
  // null — окно закрыто; { } — новая связь; { group } — правка связей с персоной.
  const [dialog, setDialog] = useState<{ group?: Group } | null>(null);
  const utils = trpc.useUtils();
  // Связь видна в обоих досье — обновляем все списки.
  const refresh = () => utils.relations.list.invalidate();
  const remove = trpc.relations.remove.useMutation({ onSuccess: refresh, onError: (e) => toast(errorText(e), 'error') });

  // По одной строке на персону, внутри — её связи.
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
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
      actions={editable && <Button size="sm" variant="ghost" onClick={() => setDialog({})}><Plus size={13} /> Добавить</Button>}
    >
      {list.isLoading ? (
        <div className="grid h-16 place-items-center"><Spinner /></div>
      ) : groups.length === 0 ? (
        <Empty>Связей нет</Empty>
      ) : (
        <div className="divide-y divide-line-soft">
          {groups.map((g) => (
            <div key={g.other.id} className="flex gap-2.5 py-2 first:pt-0 last:pb-0">
              <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-bg-soft text-mint/40">
                {g.other.coverMediaUrl ? <img src={g.other.coverMediaUrl} alt="" className="size-full object-cover" /> : <User size={15} />}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <Link to="/dossiers/$id" params={{ id: g.other.id }} className="block truncate text-sm font-semibold hover:text-mint">{g.other.title}</Link>
                <div className="flex flex-wrap gap-1.5">
                  {g.rels.map((r) => (
                    <RelationChip
                      key={r.id}
                      rel={r}
                      otherTitle={g.other.title}
                      onEdit={editable && r.canEdit ? () => setDialog({ group: g }) : undefined}
                      onRemove={editable && r.canRemove ? () => remove.mutate({ id: r.id }) : undefined}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {editable && (
        <RelationDialog
          open={!!dialog}
          onOpenChange={(v) => !v && setDialog(null)}
          dossierId={dossierId}
          group={dialog?.group}
          onDone={refresh}
        />
      )}
    </Card>
  );
}

/**
 * Тип связи и пояснение этого досье; при наведении — правка (окно со связями с этой персоной)
 * и удаление (как у атрибутов). Пояснение другой стороны — во всплывающей подсказке.
 */
function RelationChip({ rel, otherTitle, onEdit, onRemove }: { rel: Rel; otherTitle: string; onEdit?: () => void; onRemove?: () => void }) {
  return (
    <span
      title={`В досье «${otherTitle}»: ${rel.typeText}${rel.otherNote ? ` · ${rel.otherNote}` : ''}`}
      className="group inline-flex items-center gap-1.5 rounded-md border border-line bg-mint/5 px-2 py-0.5 font-mono text-[11px] leading-5"
    >
      {rel.direction === 'in' && <ArrowLeftRight size={10} className="text-mute" />}
      <span className="text-mint">{rel.typeText}</span>
      {rel.note && <span className="text-dim">· {rel.note}</span>}
      {(onEdit || onRemove) && (
        <span className="hidden items-center gap-1.5 group-hover:inline-flex has-[[data-armed]]:inline-flex">
          {onEdit && (
            <button type="button" onClick={onEdit} title="Изменить связи с этой персоной" className="cursor-pointer text-mute hover:text-mint">
              <Pencil size={11} />
            </button>
          )}
          {onRemove && <ConfirmDeleteBtn onConfirm={onRemove} title="Удалить связь (из обоих досье)" />}
        </span>
      )}
    </span>
  );
}

type Picked = Map<string, { note: string; otherNote: string }>;

/**
 * Окно связей с персоной. Новая связь: выбор персоны, один или несколько типов, у каждого пояснения
 * для обеих сторон. Правка (group): персона зафиксирована, отмечены текущие типы с пояснениями;
 * снятый тип удаляет связь этого типа. Свой тип создаётся тут же (в нижнем регистре); свои типы
 * можно удалить из словаря.
 */
function RelationDialog({
  open, onOpenChange, dossierId, group, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dossierId: string;
  group?: Group;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const options = trpc.dossiers.options.useQuery(undefined, { enabled: open });
  const types = trpc.relations.types.useQuery(undefined, { enabled: open });
  const [otherId, setOtherId] = useState('');
  const [picked, setPicked] = useState<Picked>(new Map());
  const [newType, setNewType] = useState('');
  const onError = (e: unknown) => toast(errorText(e), 'error');
  const editing = !!group;

  // При открытии: новая связь — пусто; правка — персона и текущие связи с пояснениями обеих сторон.
  useEffect(() => {
    if (!open) return;
    setNewType('');
    setOtherId(group?.other.id ?? '');
    setPicked(new Map(group?.rels.map((r) => [r.typeId, { note: r.note ?? '', otherNote: r.otherNote ?? '' }]) ?? []));
  }, [open, group]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { note: '', otherNote: '' });
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
  const save = trpc.relations.save.useMutation({
    onSuccess: () => {
      onDone();
      onOpenChange(false);
    },
    onError,
  });

  const persons = (options.data ?? []).filter((d) => d.kind === 'person' && d.id !== dossierId);
  const other = persons.find((d) => d.id === otherId);
  // Пояснение в чужом досье можно задать, только если его можно править.
  const otherEditable = !!other && other.role !== 'viewer';
  const otherTitle = group?.other.title ?? other?.title;
  // Словарь + типы, уже стоящие на связи (тип соавтора в нашем словаре может не быть).
  const list = [
    ...(types.data ?? []),
    ...(group?.rels ?? []).filter((r) => !types.data?.some((t) => t.id === r.typeId)).map((r) => ({ id: r.typeId, ownerId: '', text: r.typeText })),
  ];
  const norm = normalizeRelationText(newType);
  const exists = list.some((t) => t.text === norm);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? 'Связи с персоной' : 'Новая связь'}>
      <div className="space-y-4">
        <Field label="Персона">
          {editing ? (
            // Персона зафиксирована — меняются только связи с ней.
            <Input value={group.other.title} disabled className="w-full disabled:opacity-100 disabled:text-text" />
          ) : (
            <Select value={otherId} onChange={(e) => setOtherId(e.target.value)} className="w-full">
              <option value="">— выберите досье —</option>
              {persons.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
          )}
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
                  {t.ownerId !== null && t.ownerId !== '' && (
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
            <div className="grid grid-cols-[8rem_1fr_1fr] gap-2 font-mono text-[10px] uppercase tracking-wider text-mute">
              <span />
              <span>пояснение здесь</span>
              <span className="truncate">{otherTitle ? `в досье «${otherTitle}»` : 'в досье другой персоны'}</span>
            </div>
            {[...picked].map(([id, n]) => (
              <div key={id} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-2">
                <span className="truncate font-mono text-[11px] text-mint">{list.find((t) => t.id === id)?.text}</span>
                <Input
                  value={n.note}
                  maxLength={500}
                  onChange={(e) => setPicked((prev) => new Map(prev).set(id, { ...n, note: e.target.value }))}
                  placeholder="например «сын»"
                  className="h-8 text-xs"
                />
                <Input
                  value={n.otherNote}
                  maxLength={500}
                  disabled={!!other && !otherEditable}
                  title={other && !otherEditable ? 'Досье только для чтения — пояснение допишет его владелец' : undefined}
                  onChange={(e) => setPicked((prev) => new Map(prev).set(id, { ...n, otherNote: e.target.value }))}
                  placeholder="например «отец»"
                  className="h-8 text-xs"
                />
              </div>
            ))}
          </div>
        )}
        {editing && picked.size === 0 && (
          <div className="font-mono text-[11px] text-warn">Ни одного типа не отмечено — все связи с этой персоной будут удалены.</div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!otherId || (!editing && picked.size === 0) || save.isPending}
            onClick={() =>
              save.mutate({
                dossierId,
                otherId,
                replace: editing,
                // Правка: пустое поле очищает пояснение. Новая связь: пустое поле не трогает пояснение
                // уже существующей связи того же типа (её мог завести кто-то из другого досье).
                links: [...picked].map(([typeId, n]) => ({
                  typeId,
                  note: editing ? n.note.trim() : n.note.trim() || undefined,
                  otherNote: !otherEditable ? undefined : editing ? n.otherNote.trim() : n.otherNote.trim() || undefined,
                })),
              })
            }
          >
            {editing ? 'Сохранить' : 'Добавить'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
