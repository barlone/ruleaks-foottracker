import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { DEFAULT_TAG_COLOR, TAG_COLORS, normalizeTagText, type Tag } from '@ft/shared';
import { trpc } from '../lib/trpc.ts';
import { errorText } from '../lib/errors.ts';
import { toast } from '../lib/toast.ts';
import { Button, ConfirmDeleteBtn, Dialog, Empty, Input, Spinner } from './ui.tsx';

// Теги досье и расследований. Ставятся только из словаря пользователя (тексты общие для всех,
// словарь у каждого свой: текст + цвет фона). Текст тега — всегда заглавными.

/** Тёмный или светлый текст — по яркости фона. */
function inkFor(bg: string): string {
  const n = Number.parseInt(bg.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#001a13' : '#ffffff';
}

/**
 * Тег: «#ТЕКСТ» в рамке на выбранном фоне. Кнопки (правка, удаление) пристраиваются к рамке справа
 * при наведении; пока удаление ждёт подтверждения, они видны и без наведения.
 */
export function TagChip({
  tag, onClick, selected, onEdit, onRemove, removeTitle, onDismiss, size = 'md',
}: {
  tag: Pick<Tag, 'text' | 'color'>;
  onClick?: () => void;
  selected?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  removeTitle?: string;
  /** Крестик без подтверждения, виден всегда (фильтры). */
  onDismiss?: () => void;
  size?: 'sm' | 'md';
}) {
  const label = (
    <span className={clsx('flex items-center gap-1 whitespace-nowrap', size === 'sm' ? 'px-1.5' : 'px-2')}>
      {selected && <Check size={11} strokeWidth={3} />}#{tag.text}
    </span>
  );
  return (
    <span
      className={clsx(
        'group inline-flex items-stretch overflow-hidden rounded-md border border-white/30 font-mono font-bold tracking-wide',
        size === 'sm' ? 'h-5 text-[10px]' : 'h-6 text-[11px]',
        selected && 'ring-2 ring-mint ring-offset-1 ring-offset-bg',
      )}
      style={{ background: tag.color, color: inkFor(tag.color) }}
    >
      {onClick ? (
        <button type="button" onClick={onClick} className="flex cursor-pointer items-center hover:brightness-110">{label}</button>
      ) : (
        label
      )}
      {(onEdit || onRemove) && (
        <span className="hidden items-center gap-2 border-l border-white/30 bg-black/85 px-1.5 group-hover:inline-flex has-[[data-armed]]:inline-flex">
          {onEdit && (
            <button type="button" onClick={onEdit} title="Изменить тег" className="cursor-pointer text-mute hover:text-mint">
              <Pencil size={12} />
            </button>
          )}
          {onRemove && <ConfirmDeleteBtn onConfirm={onRemove} title={removeTitle} />}
        </span>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} title="Убрать" className="flex cursor-pointer items-center border-l border-white/30 bg-black/85 px-1 text-mute hover:text-danger">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/** Только показ (карточки списков). */
export function TagList({ tags, size = 'sm', className }: { tags: Tag[]; size?: 'sm' | 'md'; className?: string }) {
  if (!tags.length) return null;
  return <div className={clsx('flex flex-wrap gap-1', className)}>{tags.map((t) => <TagChip key={t.id} tag={t} size={size} />)}</div>;
}

/**
 * Теги объекта под заголовком: «+ тег» открывает словарь. Наведение на тег — кнопки правки
 * (только для тегов своего словаря) и снятия с объекта.
 */
export function TagsBar({
  tags, editable, busy, onChange,
}: {
  tags: Tag[];
  editable: boolean;
  /** Идёт сохранение — новые переключения подождут (иначе конфликт версий). */
  busy?: boolean;
  onChange: (tagIds: string[]) => void;
}) {
  const me = trpc.auth.me.useQuery();
  const [dict, setDict] = useState<{ editId?: string } | null>(null);
  const ids = tags.map((t) => t.id);
  if (!editable && !tags.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <TagChip
          key={t.id}
          tag={t}
          onEdit={editable && t.ownerId === me.data?.id ? () => setDict({ editId: t.id }) : undefined}
          onRemove={editable ? () => onChange(ids.filter((x) => x !== t.id)) : undefined}
          removeTitle="Снять тег"
        />
      ))}
      {editable && (
        <button
          type="button"
          onClick={() => setDict({})}
          className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-dashed border-line px-2 font-mono text-[11px] text-mute transition hover:border-mint/60 hover:text-mint"
        >
          <Plus size={12} /> тег
        </button>
      )}
      <TagDictionaryDialog
        open={!!dict}
        editId={dict?.editId}
        onOpenChange={(v) => !v && setDict(null)}
        selectedIds={ids}
        busy={busy}
        onToggle={(id) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])}
      />
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          className={clsx('size-6 cursor-pointer rounded-md border border-white/25 transition hover:scale-110', value === c && 'ring-2 ring-mint ring-offset-2 ring-offset-panel')}
          style={{ background: c }}
        />
      ))}
      {/* Свой цвет. */}
      <label
        title="Свой цвет"
        className={clsx(
          'relative grid size-6 cursor-pointer place-items-center rounded-md border border-dashed border-white/40 text-[10px] text-dim',
          !TAG_COLORS.includes(value as (typeof TAG_COLORS)[number]) && 'ring-2 ring-mint ring-offset-2 ring-offset-panel',
        )}
        style={TAG_COLORS.includes(value as (typeof TAG_COLORS)[number]) ? undefined : { background: value }}
      >
        <Plus size={12} />
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

/**
 * Словарь тегов пользователя. Поле сверху и фильтрует словарь, и создаёт новый тег;
 * клик по тегу ставит его на объект или снимает. Наведение — правка и удаление из словаря.
 */
/** Фильтр списка по тегам своего словаря: показ выбранных, «+ тег» открывает словарь. */
export function TagFilter({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const list = trpc.tags.list.useQuery();
  const [open, setOpen] = useState(false);
  // Удалённые из словаря теги из фильтра пропадают.
  const chosen = (list.data ?? []).filter((t) => value.includes(t.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chosen.map((t) => (
        <TagChip key={t.id} tag={t} onDismiss={() => onChange(value.filter((x) => x !== t.id))} />
      ))}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-dashed border-line px-2 font-mono text-[11px] text-mute transition hover:border-mint/60 hover:text-mint"
      >
        <Plus size={12} /> тег
      </button>
      {chosen.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="cursor-pointer font-mono text-[11px] text-mute hover:text-mint">
          сбросить
        </button>
      )}
      <TagDictionaryDialog
        open={open}
        onOpenChange={setOpen}
        selectedIds={value}
        onToggle={(id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])}
        title="Фильтр по тегам"
        hint="Клик — добавить тег в фильтр или убрать. Показываются объекты, у которых есть все выбранные теги."
      />
    </div>
  );
}

function TagDictionaryDialog({
  open, onOpenChange, selectedIds, onToggle, busy, editId, title = 'Словарь тегов', hint = 'Клик — поставить или снять тег.',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedIds: string[];
  onToggle: (id: string) => void;
  busy?: boolean;
  /** Открыть сразу в режиме правки этого тега. */
  editId?: string;
  title?: string;
  hint?: string;
}) {
  const utils = trpc.useUtils();
  const list = trpc.tags.list.useQuery(undefined, { enabled: open });
  const [text, setText] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_TAG_COLOR);
  const [editing, setEditing] = useState<Tag | null>(null);

  const refresh = () => Promise.all([utils.tags.invalidate(), utils.dossiers.invalidate(), utils.investigations.invalidate()]);
  const onError = (e: unknown) => toast(errorText(e), 'error');
  const create = trpc.tags.create.useMutation({
    onSuccess: (t) => {
      setText('');
      void utils.tags.invalidate();
      onToggle(t.id);
    },
    onError,
  });
  const update = trpc.tags.update.useMutation({ onSuccess: () => { stopEdit(); void refresh(); }, onError });
  const remove = trpc.tags.remove.useMutation({ onSuccess: () => void refresh(), onError });

  function startEdit(t: Tag) {
    setEditing(t);
    setText(t.text);
    setColor(t.color);
  }
  function stopEdit() {
    setEditing(null);
    setText('');
    setColor(DEFAULT_TAG_COLOR);
  }

  // Открыли с кнопки «изменить» на теге объекта — сразу режим правки (один раз за открытие).
  const editApplied = useRef(false);
  useEffect(() => {
    if (!open) {
      editApplied.current = false;
      return stopEdit();
    }
    const t = !editApplied.current && editId && list.data?.find((x) => x.id === editId);
    if (t) {
      editApplied.current = true;
      startEdit(t);
    }
  }, [open, editId, list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const norm = normalizeTagText(text);
  const tags = list.data ?? [];
  const shown = editing ? tags : tags.filter((t) => !norm || t.text.includes(norm));
  const exists = tags.some((t) => t.text === norm && t.id !== editing?.id);
  const pending = create.isPending || update.isPending;

  function submit() {
    if (!norm || exists || pending) return;
    if (editing) update.mutate({ id: editing.id, text: norm, color });
    else create.mutate({ text: norm, color });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-4">
        <form
          className="space-y-3 rounded-xl border border-line-soft p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex gap-2">
            <Input
              autoFocus
              value={text}
              maxLength={64}
              onChange={(e) => setText(e.target.value)}
              placeholder={editing ? 'Текст тега' : 'Найти или создать тег…'}
              className="font-mono uppercase"
            />
            {editing ? (
              <>
                <Button type="button" variant="ghost" onClick={stopEdit}>Отмена</Button>
                <Button type="submit" variant="primary" disabled={!norm || exists || pending}>Сохранить</Button>
              </>
            ) : (
              <Button type="submit" variant="primary" disabled={!norm || exists || pending} title={exists ? 'Такой тег уже есть' : undefined}>
                <Plus size={15} /> Создать
              </Button>
            )}
          </div>
          <ColorPicker value={color} onChange={setColor} />
          {norm && <TagPreview label={editing ? 'Будет так:' : exists ? 'Уже есть в словаре:' : 'Новый тег:'}><TagChip tag={{ text: norm, color }} /></TagPreview>}
        </form>

        {list.isLoading ? (
          <div className="grid h-20 place-items-center"><Spinner /></div>
        ) : tags.length === 0 ? (
          <Empty>Словарь пуст — создайте первый тег</Empty>
        ) : shown.length === 0 ? (
          <div className="py-3 text-center font-mono text-xs text-mute">Ничего не найдено — нажмите «Создать»</div>
        ) : (
          <div className="flex max-h-72 flex-wrap content-start gap-2 overflow-auto p-1">
            {shown.map((t) => (
              <TagChip
                key={t.id}
                tag={editing?.id === t.id ? { text: norm || t.text, color } : t}
                selected={selectedIds.includes(t.id)}
                onClick={editing || busy ? undefined : () => onToggle(t.id)}
                onEdit={() => startEdit(t)}
                onRemove={() => {
                  if (editing?.id === t.id) stopEdit();
                  remove.mutate({ id: t.id });
                }}
                removeTitle="Удалить из словаря (снимется со всех досье и расследований)"
              />
            ))}
          </div>
        )}
        <p className="font-mono text-[10px] text-mute">
          {hint} Словарь виден только вам.
        </p>
      </div>
    </Dialog>
  );
}

function TagPreview({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-mute">
      {label} {children}
    </div>
  );
}
