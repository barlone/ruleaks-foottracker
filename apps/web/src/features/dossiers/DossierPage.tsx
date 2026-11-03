import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  ArrowLeft, Camera, ChevronDown, ChevronUp, ExternalLink, FileSearch, Link2, Maximize2, NotebookPen, Pencil, Plus, Trash2,
} from 'lucide-react';
import {
  ATTR_TYPES, DOSSIER_MEDIA_MAX_BYTES, LEAK_FIELDS, MEDIA_FILE_MAX_BYTES, attrCopyValue, attrDisplayValue, attrTypeLabel, dossierMediaBytes, FIELD_TO_KIND, fmtBytes,
  POST_KIND_LABELS, findDuplicate, newId, type DossierItem, type LeakField, type SearchSection,
} from '@ft/shared';
import { kindLabel } from '../search/job.ts';
import { ValueActions } from '../search/ValueActions.tsx';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { ExportDialog } from '../../components/ExportDialog.tsx';
import { ColorMark } from '../../components/ColorMark.tsx';
import { ObjectActions } from '../../components/ObjectActions.tsx';
import { ShareDialog, VisibilityTag } from '../../components/Sharing.tsx';
import { SourceBadge } from '../../components/SourceBadge.tsx';
import { SourceFields } from '../../components/SourceFields.tsx';
import { emptySource, finishSource, type SourceDraft } from '../../components/source.ts';
import { TagsBar } from '../../components/Tags.tsx';
import { Button, Card, ConfirmDeleteBtn, CopyButton, DELETE_GAP, Dialog, Empty, Field, FilePicker, Input, Segmented, Select, Spinner, Tag, Textarea, WarnNote } from '../../components/ui.tsx';
import { driveImageUrl, drivePreviewUrl, googleDriveId } from '../../lib/driveLinks.ts';
import { trpc, type RouterInputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { fmtDate } from '../../lib/format.ts';
import { guessPlatform } from '../../lib/platform.ts';
import { toast } from '../../lib/toast.ts';
import { MediaGallery } from './MediaGallery.tsx';
import { CoverBox } from './PhotosDialog.tsx';
import { PostsCard } from './PostsCard.tsx';
import { PHOTO_ALBUM, PLATFORM_LABELS } from './labels.ts';
import { RelationsCard } from './RelationsCard.tsx';

type Of<T extends DossierItem['type']> = Extract<DossierItem, { type: T }>;
type NewItem = RouterInputs['dossiers']['addItem']['item'];

/** Порядок атрибутов по важности; остальные поля — после ссылок в порядке LEAK_FIELDS, свои — перед «Прочим». */
const ATTR_ORDER: string[] = ['names', 'bdays', 'inns', 'pasps', 'forpasps', 'snilss', 'phones', 'emails', 'addrs', 'weblinks'];
const attrRank = (key: string) => {
  if (key === 'infos') return 1000;
  const i = ATTR_ORDER.indexOf(key);
  if (i >= 0) return i;
  const j = Object.keys(LEAK_FIELDS).indexOf(key);
  return j >= 0 ? 100 + j : 900;
};
/** Стабильная сортировка: внутри одного типа атрибуты остаются в порядке добавления. */
const sortAttributes = (list: Of<'attribute'>[]) => list.map((a, i) => ({ a, i })).sort((x, y) => attrRank(x.a.key) - attrRank(y.a.key) || x.i - y.i).map((x) => x.a);
/**
 * Порядок показа атрибутов. Сервер отдаёт элементы по position; пока пользователь ничего не переставлял, позиции
 * атрибутов идут в порядке их создания — тогда действует порядок по важности. Перестановка мышкой записывает в
 * position новый порядок (reorderItems), и с этого момента он и показывается; новый атрибут встаёт в конец.
 */
function orderAttributes(list: Of<'attribute'>[]): Of<'attribute'>[] {
  const byCreated = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.position - b.position);
  const custom = list.some((a, i) => a.id !== byCreated[i]!.id);
  return custom ? list : sortAttributes(list);
}

export function DossierPage() {
  const { id } = useParams({ from: '/dossiers/$id' });
  const navigate = useNavigate();
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const q = trpc.dossiers.get.useQuery({ id });

  const onDone = {
    onSuccess: () => utils.dossiers.invalidate(),
    onError: (e: unknown) => {
      toast(errorText(e), 'error');
      void utils.dossiers.get.invalidate({ id });
    },
  };
  const update = trpc.dossiers.update.useMutation(onDone);
  const addItem = trpc.dossiers.addItem.useMutation(onDone);
  const updateItem = trpc.dossiers.updateItem.useMutation(onDone);
  const removeItem = trpc.dossiers.removeItem.useMutation(onDone);
  const reorder = trpc.dossiers.reorderItems.useMutation(onDone);
  const setVisibility = trpc.dossiers.setVisibility.useMutation(onDone);
  const share = trpc.dossiers.share.useMutation(onDone);
  const unshare = trpc.dossiers.unshare.useMutation(onDone);
  const remove = trpc.dossiers.remove.useMutation({ onSuccess: () => navigate({ to: '/dossiers' }) });

  const [editSummary, setEditSummary] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | 'attribute' | 'link' | 'media' | 'note' | 'post'>(null);
  const [editingMedia, setEditingMedia] = useState<Of<'media'> | null>(null);
  const [editingLink, setEditingLink] = useState<Of<'link'> | null>(null);
  const [editingAttr, setEditingAttr] = useState<Of<'attribute'> | null>(null);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState<'file' | 'pdf' | null>(null);

  if (q.isLoading) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  if (q.error || !q.data) return <div className="p-6"><Empty>{errorText(q.error)}</Empty></div>;
  const d = q.data;
  const editable = d.role !== 'viewer' && !!me.data?.access.active;
  const items = <T extends DossierItem['type']>(t: T) => d.items.filter((i): i is Of<T> => i.type === t);
  const add = (item: NewItem) => addItem.mutateAsync({ id, item }).then(() => setAdding(null));
  // Фото персоны — отдельный альбом: правятся через бокс у названия и в «Медиа» не дублируются.
  const photos = items('media').filter((m) => m.album === PHOTO_ALBUM);
  const media = items('media').filter((m) => m.album !== PHOTO_ALBUM);

  return (
    <div className="text-plus-1 space-y-[1.2rem] pt-2.5 pb-[1.2rem] pl-6 pr-[30px]">
      {/* «Все досье» и кнопки (экспорт, доступ, удаление) — одной строкой над колонками. */}
      <div className="flex min-h-9 items-center justify-between gap-4">
        <Link to="/dossiers" className="inline-flex items-center gap-1.5 font-mono text-xs text-mute hover:text-mint">
          <ArrowLeft size={13} /> все досье
        </Link>
        <ObjectActions
          kind="dossier"
          title={d.title}
          isOwner={d.role === 'owner'}
          onShare={() => setSharing(true)}
          onDelete={() => remove.mutate({ id })}
          onExportFile={() => setExporting('file')}
          onExportPdf={() => setExporting('pdf')}
        />
      </div>

      {/* Две колонки на всю высоту: шапка — над основными боксами (поле названия не шире «Сводки»),
          правая колонка («Атрибуты» и ниже) начинается вровень с шапкой. */}
      <div className="grid gap-[1.2rem] lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-[1.2rem]">
          {/* Шапка */}
          <header className="flex flex-wrap items-start gap-[1.2rem]">
            <CoverBox dossierId={d.id} kind={d.kind} coverUrl={d.coverMediaUrl} photos={photos} editable={editable} />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone="dim">{d.kind === 'group' ? 'группа лиц' : 'персона'}</Tag>
                <VisibilityTag v={d.visibility} />
                {d.role !== 'owner' && <Tag>{d.role === 'editor' ? 'вы можете править' : 'только чтение'}</Tag>}
                <span className="font-mono text-[11px] text-mute">v{d.version} · изменено {fmtDate(d.updatedAt, true)}</span>
              </div>
              {editTitle !== null ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    update.mutate({ id, version: d.version, patch: { title: editTitle } });
                    setEditTitle(null);
                  }}
                >
                  <Input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={() => setEditTitle(null)} className="h-12 text-2xl! font-extrabold" />
                </form>
              ) : (
                <h1 className="group flex items-center gap-2 text-3xl font-extrabold tracking-tight">
                  {d.title}
                  {editable && (
                    <button onClick={() => setEditTitle(d.title)} className="cursor-pointer text-mute opacity-0 transition hover:text-mint group-hover:opacity-100">
                      <Pencil size={16} />
                    </button>
                  )}
                </h1>
              )}
              <TagsBar
                tags={d.tags}
                editable={editable}
                busy={update.isPending}
                onChange={(tagIds) => update.mutate({ id, version: d.version, patch: { tagIds } })}
              />
            </div>
          </header>

          <Card compact
            title="Сводка"
            actions={editable && editSummary === null && (
              <Button size="sm" variant="ghost" onClick={() => setEditSummary(d.summaryMd)}><Pencil size={13} /> Править</Button>
            )}
          >
            {editSummary !== null ? (
              <div className="space-y-3">
                <MarkdownEditor value={editSummary} onChange={setEditSummary} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditSummary(null)}>Отмена</Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      update.mutate({ id, version: d.version, patch: { summaryMd: editSummary } });
                      setEditSummary(null);
                    }}
                  >
                    Сохранить
                  </Button>
                </div>
              </div>
            ) : (
              <MarkdownView source={d.summaryMd} />
            )}
          </Card>

          {d.kind === 'group' && (
            <Card compact title="Участники группы">
              <MembersEditor
                memberIds={d.memberIds}
                members={d.members}
                editable={editable}
                selfId={d.id}
                onChange={(memberIds) => update.mutate({ id, version: d.version, patch: { memberIds } })}
              />
            </Card>
          )}

          <Card compact
            title={<><Camera size={13} /> Медиа</>}
            actions={(
              <span className="flex items-center gap-2">
                {media.length > 0 && (
                  <span className="font-mono text-[10px] text-mute" title="Объём встроенных медиафайлов досье">{fmtBytes(dossierMediaBytes(media))} / {fmtBytes(DOSSIER_MEDIA_MAX_BYTES)}</span>
                )}
                {editable && <Button size="sm" variant="ghost" onClick={() => setAdding('media')}><Plus size={13} /> Добавить</Button>}
              </span>
            )}
          >
            {media.length ? (
              <MediaGallery
                items={media}
                editable={editable}
                coverUrl={d.coverMediaUrl}
                onReorder={(ids) => reorder.mutate({ id, orderedIds: ids })}
                onRemove={(itemId) => removeItem.mutate({ id, itemId })}
                onCover={(url) => update.mutate({ id, version: d.version, patch: { coverMediaUrl: url } })}
                onEdit={setEditingMedia}
              />
            ) : (
              <Empty>Медиафайлов нет</Empty>
            )}
          </Card>

          {d.kind === 'person' && (
            <PostsCard
              posts={items('post')}
              editable={editable}
              onAdd={() => setAdding('post')}
              onRemove={(itemId) => removeItem.mutate({ id, itemId })}
            />
          )}

          <Card compact
            title={<><NotebookPen size={13} /> Заметки</>}
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('note')}><Plus size={13} /> Заметка</Button>}
          >
            <div className="space-y-[0.8rem]">
              {items('note').length === 0 && <Empty>Заметок нет</Empty>}
              {items('note').map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  editable={editable}
                  onSave={(markdown) => updateItem.mutateAsync({ id, item: { ...n, markdown } }).then(() => undefined)}
                  onRemove={() => removeItem.mutate({ id, itemId: n.id })}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-[1.2rem]">
          <Card compact
            title="Атрибуты"
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('attribute')}><Plus size={13} /> Добавить</Button>}
          >
            {items('attribute').length === 0 && <Empty>Пусто</Empty>}
            <AttributesList
              items={items('attribute')}
              editable={editable}
              onReorder={(ids) => reorder.mutate({ id, orderedIds: ids })}
              onEdit={setEditingAttr}
              onRemove={(itemId) => removeItem.mutate({ id, itemId })}
              onColor={(a, color) => updateItem.mutate({ id, item: { ...a, color } })}
            />
          </Card>

          {d.kind === 'person' && <RelationsCard dossierId={d.id} editable={editable} />}

          <Card compact
            title={<><Link2 size={13} /> Соцсети и ссылки</>}
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('link')}><Plus size={13} /> Добавить</Button>}
          >
            {items('link').length === 0 && <Empty>Пусто</Empty>}
            <div className="space-y-1.5">
              {items('link').map((l) => (
                <div key={l.id} className="group flex items-center gap-2.5 rounded-lg border border-line-soft px-3 py-2">
                  <Tag tone="dim" className="w-20 justify-center">{PLATFORM_LABELS[l.platform]}</Tag>
                  <div className="min-w-0 flex-1">
                    <a href={l.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm hover:text-mint">
                      {l.title || l.url}
                    </a>
                    {l.source?.ref && <div className="truncate font-mono text-[10px] text-mute" title={l.source.ref}>{l.source.ref}</div>}
                  </div>
                  <a href={l.url} target="_blank" rel="noreferrer noopener" title="Открыть в новой вкладке" className="text-mute hover:text-mint">
                    <ExternalLink size={12} />
                  </a>
                  {editable && (
                    <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button type="button" onClick={() => setEditingLink(l)} title="Править" className="cursor-pointer text-mute hover:text-mint"><Pencil size={12} /></button>
                      <DeleteBtn onClick={() => removeItem.mutate({ id, itemId: l.id })} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card compact title={<><FileSearch size={13} /> Снимки поиска</>}>
            {items('snapshot').length === 0 && <Empty>Добавляются со страницы «Поиск»</Empty>}
            <div className="space-y-1.5">
              {items('snapshot').map((s) => (
                <div key={s.id} className="group flex items-center gap-2 rounded-lg border border-line-soft px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm">{s.query}</div>
                    <div className="font-mono text-[10px] text-mute">
                      {kindLabel(s.section, s.kind)} {s.deep && '· deep'} · {s.summary} · {fmtDate(s.createdAt)}
                    </div>
                  </div>
                  <RepeatSearchLink section={s.section} kind={s.kind} query={s.query} deep={s.deep} />
                  {editable && <ConfirmDeleteBtn onConfirm={() => removeItem.mutate({ id, itemId: s.id })} />}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <EditMediaDialog
        media={editingMedia}
        onClose={() => setEditingMedia(null)}
        onSave={(item) => updateItem.mutateAsync({ id, item }).then(() => setEditingMedia(null))}
      />
      <EditAttrDialog
        attr={editingAttr}
        existing={d.items}
        onClose={() => setEditingAttr(null)}
        onSave={(item) => updateItem.mutateAsync({ id, item }).then(() => setEditingAttr(null))}
      />
      <EditLinkDialog
        link={editingLink}
        existing={d.items}
        onClose={() => setEditingLink(null)}
        onSave={(item) => updateItem.mutateAsync({ id, item }).then(() => setEditingLink(null))}
      />
      <AddItemDialog kind={adding} existing={d.items} onClose={() => setAdding(null)} onAdd={add} />

      <ExportDialog kind="dossier" format={exporting ?? 'file'} id={id} open={!!exporting} onOpenChange={(v) => !v && setExporting(null)} />

      <ShareDialog
        open={sharing}
        onOpenChange={setSharing}
        visibility={d.visibility}
        shares={d.shares}
        allowPublic={false}
        onVisibility={(v) => v !== 'public' && setVisibility.mutate({ id, version: d.version, visibility: v })}
        onShare={(username, role) => share.mutate({ id, username, role })}
        onUnshare={(userId) => unshare.mutate({ id, userId })}
        error={share.error ? errorText(share.error) : null}
      />
    </div>
  );
}

/** Повтор снимка в его разделе поиска. */
/** Атрибуты досье: перестановка мышкой за бейдж источника (или ручку, если источника нет). */
function AttributesList({ items, editable, onReorder, onEdit, onRemove, onColor }: {
  items: Of<'attribute'>[];
  editable: boolean;
  onReorder: (orderedIds: string[]) => void;
  onEdit: (a: Of<'attribute'>) => void;
  onRemove: (itemId: string) => void;
  onColor: (a: Of<'attribute'>, color: string | undefined) => void;
}) {
  // Порядок после перетаскивания показывается сразу, не дожидаясь ответа сервера (как в галерее медиа).
  const [order, setOrder] = useState<string[] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byId = new Map(items.map((a) => [a.id, a]));
  const ids = order?.filter((x) => byId.has(x)) ?? orderAttributes(items).map((a) => a.id);
  // Атрибут, добавленный после перестановки, в локальном порядке ещё не значится — в конец.
  for (const a of items) if (!ids.includes(a.id)) ids.push(a.id);

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setOrder(next);
    onReorder(next);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="divide-y divide-line-soft">
          {ids.map((x) => {
            const a = byId.get(x)!;
            return <AttrRow key={a.id} a={a} editable={editable} onEdit={() => onEdit(a)} onRemove={() => onRemove(a.id)} onColor={(c) => onColor(a, c)} />;
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function AttrRow({ a, editable, onEdit, onRemove, onColor }: {
  a: Of<'attribute'>;
  editable: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onColor: (color: string | undefined) => void;
}) {
  const kind = FIELD_TO_KIND[a.key as LeakField];
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: a.id, disabled: !editable });
  return (
    // Сетка 2×2: подпись | значение, под ними оценка источника (она же ручка перетаскивания) | кнопки действий.
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('group grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 py-2', isDragging && 'relative z-10 bg-panel')}
    >
      <span className="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-mute">{a.label}</span>
      <div className="whitespace-pre-line break-words font-mono text-sm">{attrDisplayValue(a.key, a.value)}</div>
      <div className="flex items-center gap-1.5">
        {editable && (
          <span ref={setActivatorNodeRef} {...attributes} {...listeners} title="Перетащить" className="inline-flex cursor-grab items-center text-mute transition hover:text-mint active:cursor-grabbing">
            <DragDots />
          </span>
        )}
        <SourceBadge source={a.source} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ValueActions field={a.key} value={a.value} />
        <CopyButton value={attrCopyValue(a.key, a.value)} title={`Скопировать: ${a.label}`} />
        {kind && (
          <Link to="/search" search={{ kind, q: a.value }} title="Искать" className="text-mute opacity-0 transition hover:text-mint group-hover:opacity-100">
            <FileSearch size={14} />
          </Link>
        )}
        {editable && (
          <>
            <button type="button" onClick={onEdit} title="Править" className="cursor-pointer text-mute opacity-0 transition hover:text-mint group-hover:opacity-100"><Pencil size={14} /></button>
            <ConfirmDeleteBtn onConfirm={onRemove} />
          </>
        )}
        {/* Цветная метка — у правой границы бокса, вне ряда действий. */}
        <ColorMark value={a.color} editable={editable} onChange={onColor} className="ml-auto" />
      </div>
    </div>
  );
}

/** Ручка перетаскивания: квадрат с четырьмя точками. */
function DragDots() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="0.5" y="0.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.5" />
      <circle cx="5" cy="5" r="1.2" fill="currentColor" />
      <circle cx="9" cy="5" r="1.2" fill="currentColor" />
      <circle cx="5" cy="9" r="1.2" fill="currentColor" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function RepeatSearchLink({ section, kind, query, deep }: { section: SearchSection; kind: string; query: string; deep: boolean }) {
  const cls = 'text-mute hover:text-mint';
  const icon = <FileSearch size={14} />;
  if (section === 'tg') return <Link to="/search/telegram" search={{ mode: kind, q: query }} title="Повторить поиск" className={cls}>{icon}</Link>;
  if (section === 'fuzzy') return <Link to="/search/fuzzy" search={{ mode: kind, q: query }} title="Повторить поиск" className={cls}>{icon}</Link>;
  if (section === 'geo') return <Link to="/search/geo" search={{ q: query }} title="Повторить поиск" className={cls}>{icon}</Link>;
  return <Link to="/search" search={{ kind, q: query, deep }} title="Повторить поиск" className={cls}>{icon}</Link>;
}

/** Заметка: свёрнутой остаётся строка с датой и началом текста; карандаш открывает редактор на месте. */
function NoteCard({ note, editable, onSave, onRemove }: { note: Of<'note'>; editable: boolean; onSave: (markdown: string) => Promise<void>; onRemove: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstLine = note.markdown.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? '';

  async function save() {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setDraft(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-xl border border-line-soft p-[0.8rem]">
      <div className={clsx('flex items-center justify-between gap-2 font-mono text-[11px] text-mute', !collapsed && 'mb-2')}>
        {/* В узкой колонке места мало: дата и превью усекаются, значки справа — нет. */}
        <span className="flex min-w-0 items-center gap-3">
          <span className="truncate">{fmtDate(note.createdAt, true)}</span>
          {collapsed && <span className="hidden truncate text-dim sm:inline">{firstLine}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <SourceBadge source={note.source} />
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? 'Развернуть' : 'Свернуть'}
            className="cursor-pointer text-mute hover:text-mint"
          >
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          {editable && draft === null && (
            <button
              type="button"
              onClick={() => {
                setCollapsed(false);
                setDraft(note.markdown);
              }}
              title="Править"
              className="cursor-pointer text-mute hover:text-mint"
            >
              <Pencil size={13} />
            </button>
          )}
          {editable && <DeleteBtn onClick={onRemove} />}
        </span>
      </div>
      {collapsed ? null : draft !== null ? (
        <div className="space-y-3">
          <MarkdownEditor value={draft} onChange={setDraft} autoFocus className="min-h-32" />
          {error && <WarnNote>{error}</WarnNote>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>Отмена</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={saving || draft === note.markdown}>Сохранить</Button>
          </div>
        </div>
      ) : (
        <MarkdownView source={note.markdown} />
      )}
    </article>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Удалить" className={`${DELETE_GAP} cursor-pointer text-mute hover:text-danger`}>
      <Trash2 size={13} />
    </button>
  );
}

function MembersEditor({
  memberIds, members, editable, selfId, onChange,
}: {
  memberIds: string[];
  members: { id: string; title: string; coverMediaUrl: string | null }[];
  editable: boolean;
  selfId: string;
  onChange: (ids: string[]) => void;
}) {
  const options = trpc.dossiers.options.useQuery(undefined, { enabled: editable });
  const candidates = (options.data ?? []).filter((o) => o.kind === 'person' && o.id !== selfId && !memberIds.includes(o.id));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {members.length === 0 && <span className="font-mono text-xs text-mute">Участников нет</span>}
        {members.map((m) => (
          <div key={m.id} className="group flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3">
            <span className="size-7 overflow-hidden rounded-full bg-bg-soft">{m.coverMediaUrl && <img src={m.coverMediaUrl} alt="" className="size-full object-cover" />}</span>
            <Link to="/dossiers/$id" params={{ id: m.id }} className="text-sm hover:text-mint">{m.title}</Link>
            {editable && <button onClick={() => onChange(memberIds.filter((x) => x !== m.id))} className="cursor-pointer text-mute hover:text-danger">×</button>}
          </div>
        ))}
      </div>
      {editable && candidates.length > 0 && (
        <Select value="" onChange={(e) => e.target.value && onChange([...memberIds, e.target.value])}>
          <option value="">+ добавить участника…</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Select>
      )}
    </div>
  );
}

/** Правка медиа: подпись, альбом, источник. Картинка остаётся — для другой проще добавить новый элемент. */
function EditMediaDialog({ media, onClose, onSave }: { media: Of<'media'> | null; onClose: () => void; onSave: (item: Of<'media'>) => Promise<void> }) {
  return (
    <Dialog open={!!media} onOpenChange={(v) => !v && onClose()} title="Медиафайл">
      {media && <EditMediaForm key={media.id} media={media} onSave={onSave} />}
    </Dialog>
  );
}

function EditMediaForm({ media, onSave }: { media: Of<'media'>; onSave: (item: Of<'media'>) => Promise<void> }) {
  const [caption, setCaption] = useState(media.caption ?? '');
  const [album, setAlbum] = useState(media.album ?? '');
  // У старых элементов источника может не быть — тогда черновик пустой, а время фиксации поставится при сохранении.
  const { capturedAt, ...rest } = media.source ?? { capturedAt: undefined, ...emptySource() };
  const [source, setSource] = useState<SourceDraft>({ ...rest, ref: rest.ref ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      // Время фиксации источника остаётся прежним: правится описание, а не сами сведения.
      const src = finishSource(source);
      await onSave({ ...media, caption: caption.trim() || undefined, album: album.trim() || undefined, source: capturedAt ? { ...src, capturedAt } : src });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <img src={media.url} alt="" className="max-h-48 rounded-lg border border-line" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Подпись"><Input autoFocus value={caption} onChange={(e) => setCaption(e.target.value)} /></Field>
        <Field label="Альбом"><Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Соцсети, Наблюдение…" /></Field>
      </div>
      <SourceFields value={source} onChange={setSource} />
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving}>Сохранить</Button>
      </div>
    </form>
  );
}

/** Список типов атрибута; keep — ключ правящегося элемента: поле шлюза вне списка ручного ввода остаётся выбираемым. */
function AttrTypeSelect({ value, onChange, keep }: { value: string; onChange: (key: string) => void; keep?: string }) {
  const extra = keep && !ATTR_TYPES.some((t) => t.key === keep) ? attrTypeLabel(keep) : undefined;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
      {ATTR_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      {extra && <option value={keep}>{extra}</option>}
      <option value="custom">Свой…</option>
    </Select>
  );
}

/** Поле «Значение» с кнопкой мини-редактора на 10 строк для длинных атрибутов (адрес, место работы…). */
function AttrValueField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Field label="Значение">
      <div className="flex items-center gap-2">
        <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" />
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} title="Редактор для длинного значения"><Maximize2 size={14} /></Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title="Значение" stacked>
        <Textarea autoFocus rows={10} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" />
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="primary" onClick={() => setOpen(false)}>Готово</Button>
        </div>
      </Dialog>
    </Field>
  );
}

function EditAttrDialog({ attr, existing, onClose, onSave }: { attr: Of<'attribute'> | null; existing: DossierItem[]; onClose: () => void; onSave: (item: Of<'attribute'>) => Promise<void> }) {
  return (
    <Dialog open={!!attr} onOpenChange={(v) => !v && onClose()} title="Атрибут">
      {attr && <EditAttrForm key={attr.id} attr={attr} existing={existing} onSave={onSave} />}
    </Dialog>
  );
}

function EditAttrForm({ attr, existing, onSave }: { attr: Of<'attribute'>; existing: DossierItem[]; onSave: (item: Of<'attribute'>) => Promise<void> }) {
  // Ключ не из каталога — «свой» атрибут с собственным названием.
  const known = attrTypeLabel(attr.key) !== undefined;
  const [key, setKey] = useState<string>(known ? attr.key : 'custom');
  const [label, setLabel] = useState(known ? '' : attr.label);
  const [value, setValue] = useState(attr.value);
  const { capturedAt, ...rest } = attr.source ?? { capturedAt: undefined, ...emptySource() };
  const [source, setSource] = useState<SourceDraft>({ ...rest, ref: rest.ref ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const attrLabel = key === 'custom' ? label.trim() : attrTypeLabel(key) ?? '';
  // «Свой» атрибут хранится с ключом custom, как и при добавлении.
  const attrKey = key;
  const ready = !!value.trim() && !!attrLabel;
  // Сам правящийся элемент дубликатом не считается.
  const duplicate = ready ? findDuplicate(existing.filter((i) => i.id !== attr.id), { type: 'attribute', key: attrKey, label: attrLabel, value }) : undefined;

  async function submit() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const src = finishSource(source);
      await onSave({ ...attr, key: attrKey, label: attrLabel, value: value.trim(), source: capturedAt ? { ...src, capturedAt } : src });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Тип">
          <AttrTypeSelect value={key} onChange={setKey} keep={attr.key} />
        </Field>
        {key === 'custom' && <Field label="Название"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>}
      </div>
      <AttrValueField value={value} onChange={setValue} />
      <SourceFields value={source} onChange={setSource} />
      {duplicate && <WarnNote>Уже есть в досье: {duplicate.type === 'attribute' ? `${duplicate.label} — ${attrDisplayValue(duplicate.key, duplicate.value)}` : ''}</WarnNote>}
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving || !ready || !!duplicate}>Сохранить</Button>
      </div>
    </form>
  );
}

function EditLinkDialog({ link, existing, onClose, onSave }: { link: Of<'link'> | null; existing: DossierItem[]; onClose: () => void; onSave: (item: Of<'link'>) => Promise<void> }) {
  return (
    <Dialog open={!!link} onOpenChange={(v) => !v && onClose()} title="Ссылка на профиль">
      {link && <EditLinkForm key={link.id} link={link} existing={existing} onSave={onSave} />}
    </Dialog>
  );
}

function EditLinkForm({ link, existing, onSave }: { link: Of<'link'>; existing: DossierItem[]; onSave: (item: Of<'link'>) => Promise<void> }) {
  const [value, setValue] = useState(link.url);
  const [title, setTitle] = useState(link.title ?? '');
  const { capturedAt, ...rest } = link.source ?? { capturedAt: undefined, ...emptySource() };
  const [source, setSource] = useState<SourceDraft>({ ...rest, ref: rest.ref ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const url = value.trim() ? (/^https?:\/\//.test(value.trim()) ? value.trim() : `https://${value.trim()}`) : '';
  // Сам правящийся элемент дубликатом не считается — иначе любая правка подписи упёрлась бы в предупреждение.
  const duplicate = url ? findDuplicate(existing.filter((i) => i.id !== link.id), { type: 'link', url }) : undefined;

  async function submit() {
    if (!url) return;
    setSaving(true);
    setError(null);
    try {
      const src = finishSource(source);
      await onSave({ ...link, url, title: title.trim() || undefined, platform: guessPlatform(url), source: capturedAt ? { ...src, capturedAt } : src });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="URL профиля" hint={url ? `Платформа: ${PLATFORM_LABELS[guessPlatform(url)]}` : undefined}>
        <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://vk.com/id…" />
      </Field>
      <Field label="Подпись"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <SourceFields value={source} onChange={setSource} />
      {duplicate && <WarnNote>Уже есть в досье: {duplicate.type === 'link' ? duplicate.url : ''}</WarnNote>}
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving || !url || !!duplicate}>Сохранить</Button>
      </div>
    </form>
  );
}

function AddItemDialog({ kind, existing, onClose, onAdd }: { kind: null | 'attribute' | 'link' | 'media' | 'note' | 'post'; existing: DossierItem[]; onClose: () => void; onAdd: (i: NewItem) => Promise<void> }) {
  const titles = { attribute: 'Новый атрибут', link: 'Ссылка на профиль', media: 'Медиафайл', note: 'Заметка', post: 'Пост или реакция' };
  return (
    <Dialog open={!!kind} onOpenChange={(v) => !v && onClose()} title={kind ? titles[kind] : ''} wide={kind === 'note'}>
      {kind && <AddItemForm key={kind} kind={kind} existing={existing} onAdd={onAdd} />}
    </Dialog>
  );
}

function AddItemForm({ kind, existing, onAdd }: { kind: 'attribute' | 'link' | 'media' | 'note' | 'post'; existing: DossierItem[]; onAdd: (i: NewItem) => Promise<void> }) {
  const [key, setKey] = useState<string>('phones');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  // Для ссылки Гугл-диска: по самой ссылке не понять, картинка это или видео — спрашиваем.
  const [mediaKind, setMediaKind] = useState<'image' | 'video'>('image');
  const driveId = kind === 'media' && !value.startsWith('data:') ? googleDriveId(value) : null;
  // Пост: вид, площадка, где опубликовано, ссылка, время (UTC), эмодзи реакции, на что ответ.
  const [postKind, setPostKind] = useState<Of<'post'>['kind']>('comment');
  const [platform, setPlatform] = useState<Of<'post'>['platform']>('telegram');
  const [place, setPlace] = useState('');
  const [at, setAt] = useState('');
  const [emoji, setEmoji] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [source, setSource] = useState<SourceDraft>(emptySource());
  const [error, setError] = useState<string | null>(null);
  const attrLabel = key === 'custom' ? label : attrTypeLabel(key) ?? '';
  // Предупреждение сразу при вводе; окончательно дубликат не пропустит сервер (досье мог изменить другой пользователь).
  const duplicate = kind === 'attribute'
    ? findDuplicate(existing, { type: 'attribute', key, label: attrLabel, value })
    : kind === 'link' && value.trim() ? findDuplicate(existing, { type: 'link', url: value }) : undefined;

  async function submit() {
    setError(null);
    const src = finishSource(source);
    try {
      if (kind === 'attribute') {
        await onAdd({ type: 'attribute', key, label: attrLabel, value, source: src });
      } else if (kind === 'link') {
        const url = /^https?:\/\//.test(value) ? value : `https://${value}`;
        await onAdd({ type: 'link', url, title: title || undefined, platform: guessPlatform(url), source: src });
      } else if (kind === 'media') {
        // Ссылка Диска хранится как миниатюра (картинка, кадр видео) и, для видео, адрес плеера.
        const url = driveId ? driveImageUrl(driveId) : value;
        const embedUrl = driveId && mediaKind === 'video' ? drivePreviewUrl(driveId) : undefined;
        await onAdd({ type: 'media', mediaId: newId(), url, embedUrl, caption: title || undefined, album: album || undefined, source: src });
      } else if (kind === 'post') {
        await onAdd({
          type: 'post', kind: postKind, platform, text: value, place: place.trim() || undefined, url: title.trim() || undefined,
          // Время вводится и показывается в UTC — как во всех сообщениях из поиска.
          at: at ? `${at}:00.000Z` : null,
          emoji: postKind === 'reaction' ? emoji.trim() || undefined : undefined,
          replyTo: postKind === 'reply' ? replyTo.trim() || undefined : undefined,
          source: src,
        });
      } else {
        await onAdd({ type: 'note', markdown: value, source: src });
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  // Пока нет S3: локальный файл превращается в data URL (только для макета).
  function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MEDIA_FILE_MAX_BYTES) {
      setError(`Файл ${fmtBytes(f.size)} — больше ${fmtBytes(MEDIA_FILE_MAX_BYTES)}. Большие файлы держите на своём Гугл-диске и добавьте в досье ссылку («Соцсети и ссылки»)`);
      return;
    }
    setError(null);
    const r = new FileReader();
    r.onload = () => setValue(String(r.result));
    r.readAsDataURL(f);
    if (!title) setTitle(f.name);
  }

  let body: ReactNode;
  if (kind === 'attribute') {
    body = (
      <>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Тип">
            <AttrTypeSelect value={key} onChange={setKey} />
          </Field>
          {key === 'custom' && <Field label="Название"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>}
        </div>
        <AttrValueField value={value} onChange={setValue} />
      </>
    );
  } else if (kind === 'link') {
    body = (
      <>
        <Field label="URL профиля" hint={value ? `Платформа: ${PLATFORM_LABELS[guessPlatform(value)]}` : undefined}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://vk.com/id…" />
        </Field>
        <Field label="Подпись"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      </>
    );
  } else if (kind === 'media') {
    body = (
      <>
        <Field label="Файл" hint={`До ${fmtBytes(MEDIA_FILE_MAX_BYTES)} на файл и ${fmtBytes(DOSSIER_MEDIA_MAX_BYTES)} на досье (занято ${fmtBytes(dossierMediaBytes(existing))}). Что больше — на свой Гугл-диск, в досье ссылку.`}>
          <FilePicker accept="image/*" onFiles={(fs) => onFile(fs[0])} />
        </Field>
        <Field
          label="…или URL изображения"
          hint={driveId ? 'Ссылка Гугл-диска: файл должен быть открыт «всем, у кого есть ссылка»' : 'Подойдёт и ссылка «Поделиться» с Гугл-диска (картинка или видео)'}
        >
          <Input value={value.startsWith('data:') ? '' : value} onChange={(e) => setValue(e.target.value)} placeholder="https://… или https://drive.google.com/file/d/…" />
        </Field>
        {driveId && (
          <Segmented value={mediaKind} onChange={setMediaKind} options={[{ value: 'image', label: 'Изображение' }, { value: 'video', label: 'Видео' }]} />
        )}
        {value && <img src={driveId ? driveImageUrl(driveId) : value} alt="" className="max-h-48 rounded-lg border border-line" />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Подпись"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Альбом"><Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Соцсети, Наблюдение…" /></Field>
        </div>
      </>
    );
  } else if (kind === 'post') {
    body = (
      <>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Вид">
            <Select value={postKind} onChange={(e) => setPostKind(e.target.value as typeof postKind)} className="w-full">
              {Object.entries(POST_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Площадка">
            <Select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} className="w-full">
              {Object.entries(PLATFORM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Где (группа, канал, страница)"><Input value={place} onChange={(e) => setPlace(e.target.value)} /></Field>
          <Field label="Время (UTC)"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        </div>
        <Field label="Ссылка на сообщение"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="https://t.me/…" /></Field>
        {postKind === 'reaction' && <Field label="Реакция (эмодзи)"><Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-32" /></Field>}
        {postKind === 'reply' && <Field label="В ответ на"><Textarea rows={2} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} /></Field>}
        <Field label={postKind === 'reaction' ? 'Текст сообщения, на которое реагировали' : 'Текст'}>
          <Textarea autoFocus rows={5} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </>
    );
  } else {
    body = <MarkdownEditor value={value} onChange={setValue} autoFocus className="min-h-48" />;
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {body}
      <SourceFields value={source} onChange={setSource} />
      {duplicate && (
        <WarnNote>
          Уже есть в досье: {duplicate.type === 'attribute' ? `${duplicate.label} — ${attrDisplayValue(duplicate.key, duplicate.value)}` : duplicate.type === 'link' ? duplicate.url : ''}
        </WarnNote>
      )}
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!value.trim() || !!duplicate}>Добавить</Button>
      </div>
    </form>
  );
}
