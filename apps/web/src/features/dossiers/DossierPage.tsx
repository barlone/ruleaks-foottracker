import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  ArrowLeft, Camera, ChevronDown, ChevronUp, ExternalLink, FileSearch, Link2, MailSearch, Maximize2, NotebookPen, Pencil, Plus, Trash2, X, ClipboardPaste,
} from 'lucide-react';
import {
  ATTR_PAIRS, ATTR_TYPES, DOSSIER_MEDIA_MAX_BYTES, pairAllowed, LEAK_FIELDS, MEDIA_FILE_MAX_BYTES, attrCopyValue, attrDisplayValue, attrTypeLabel, dossierMediaBytes, FIELD_TO_KIND,
  POST_KIND_LABELS, findDuplicate, newId, type DossierItem, type LeakField, type SearchSection,
  parseEmail, stripHighlight,
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
import { DriveHelpButton } from '../../components/DriveHelp.tsx';
import { WebLinksCard } from './WebLinks.tsx';
import { clipboardImage, imageDataUrl, pastedImage } from '../../lib/shotImage.ts';
import { trpc, type RouterInputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { fmtDate, fmtBytes } from '../../lib/format.ts';
import { guessPlatform } from '../../lib/platform.ts';
import { t, tx } from '../../lib/i18n.ts';
import { toast } from '../../lib/toast.ts';
import { MediaGallery } from './MediaGallery.tsx';
import { CoverBox } from './PhotosDialog.tsx';
import { PostsCard } from './PostsCard.tsx';
import { PHOTO_ALBUM, PLATFORM_LABELS, attrLabelOf, platformLabel } from './labels.ts';
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

/** Подчинённый ли атрибут: родитель должен быть в списке (у удалённого родителя связь снята сервером, но на всякий случай). */
const parentOf = (a: Of<'attribute'>, byId: Map<string, Of<'attribute'>>) => (a.parentId && byId.has(a.parentId) ? a.parentId : undefined);

/** Связанные пары: подчинённые атрибуты идут сразу под родителем, в своём порядке. */
function groupAttributes(ids: string[], byId: Map<string, Of<'attribute'>>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (parentOf(byId.get(id)!, byId)) continue;
    out.push(id, ...ids.filter((x) => parentOf(byId.get(x)!, byId) === id));
  }
  return out;
}

export function DossierPage() {
  const { id } = useParams({ from: '/dossiers/$id' });
  const { from: fromGroup } = useSearch({ from: '/dossiers/$id' });
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
  const createDossier = trpc.dossiers.create.useMutation();
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
  // weblink — ссылка на внешний сайт (раздел «Ссылки»): тот же элемент link, но kind = 'web'.
  const [adding, setAdding] = useState<null | 'attribute' | 'link' | 'weblink' | 'media' | 'note' | 'post'>(null);
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
          <ArrowLeft size={13} /> {t('все досье')}
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
                <Tag tone="dim">{d.kind === 'group' ? t('группа лиц') : t('персона')}</Tag>
                <VisibilityTag v={d.visibility} />
                {d.role !== 'owner' && <Tag>{d.role === 'editor' ? t('вы можете править') : t('только чтение')}</Tag>}
                <span className="font-mono text-[11px] text-mute">v{d.version} · {t('изменено {date}', { date: fmtDate(d.updatedAt, true) })}</span>
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
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h1 className="group flex items-center gap-2 text-3xl font-extrabold tracking-tight">
                    {d.title}
                    {editable && (
                      <button onClick={() => setEditTitle(d.title)} className="cursor-pointer text-mute opacity-0 transition hover:text-mint group-hover:opacity-100">
                        <Pencil size={16} />
                      </button>
                    )}
                  </h1>
                  {fromGroup && fromGroup !== d.id && <BackToGroup id={fromGroup} />}
                </div>
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
            title={t('Сводка')}
            actions={editable && editSummary === null && (
              <Button size="sm" variant="ghost" onClick={() => setEditSummary(d.summaryMd)}><Pencil size={13} /> {t('Править')}</Button>
            )}
          >
            {editSummary !== null ? (
              <div className="space-y-3">
                <MarkdownEditor value={editSummary} onChange={setEditSummary} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditSummary(null)}>{t('Отмена')}</Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      update.mutate({ id, version: d.version, patch: { summaryMd: editSummary } });
                      setEditSummary(null);
                    }}
                  >
                    {t('Сохранить')}
                  </Button>
                </div>
              </div>
            ) : (
              <MarkdownView source={d.summaryMd} />
            )}
          </Card>

          {d.kind === 'group' && (
            <Card compact title={t('Участники группы')}>
              <MembersEditor
                memberIds={d.memberIds}
                members={d.members}
                editable={editable}
                selfId={d.id}
                onChange={(memberIds) => update.mutate({ id, version: d.version, patch: { memberIds } })}
                onCreate={async (title) => {
                  // Новая персона сразу включается в группу; переход в неё — с возвратом в эту группу.
                  const created = await createDossier.mutateAsync({ kind: 'person', title, summaryMd: '' });
                  await update.mutateAsync({ id, version: d.version, patch: { memberIds: [...d.memberIds, created.id] } });
                  void navigate({ to: '/dossiers/$id', params: { id: created.id }, search: { from: id } });
                }}
              />
            </Card>
          )}

          <Card compact
            title={<><Camera size={13} /> {t('Медиа')}</>}
            actions={(
              <span className="flex items-center gap-2">
                {media.length > 0 && (
                  <span className="font-mono text-[10px] text-mute" title={t('Объём встроенных медиафайлов досье')}>{fmtBytes(dossierMediaBytes(media))} / {fmtBytes(DOSSIER_MEDIA_MAX_BYTES)}</span>
                )}
                {editable && <Button size="sm" variant="ghost" onClick={() => setAdding('media')}><Plus size={13} /> {t('Добавить')}</Button>}
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
              <Empty>{t('Медиафайлов нет')}</Empty>
            )}
          </Card>

          <WebLinksCard
            links={items('link').filter((l) => l.kind === 'web')}
            items={d.items}
            editable={editable}
            onAdd={() => setAdding('weblink')}
            onEdit={setEditingLink}
            onRemove={(itemId) => removeItem.mutate({ id, itemId })}
            onUpdate={(item) => updateItem.mutateAsync({ id, item }).then(() => undefined)}
          />

          {d.kind === 'person' && (
            <PostsCard
              posts={items('post')}
              editable={editable}
              onAdd={() => setAdding('post')}
              onRemove={(itemId) => removeItem.mutate({ id, itemId })}
            />
          )}

          <Card compact
            title={<><NotebookPen size={13} /> {t('Заметки')}</>}
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('note')}><Plus size={13} /> {t('Заметка')}</Button>}
          >
            <div className="space-y-[0.8rem]">
              {items('note').length === 0 && <Empty>{t('Заметок нет')}</Empty>}
              <NotesList
                notes={items('note')}
                editable={editable}
                onReorder={(ids) => reorder.mutate({ id, orderedIds: ids })}
                onSave={(n, markdown) => updateItem.mutateAsync({ id, item: { ...n, markdown } }).then(() => undefined)}
                onRemove={(itemId) => removeItem.mutate({ id, itemId })}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-[1.2rem]">
          <Card compact
            title={t('Атрибуты')}
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('attribute')}><Plus size={13} /> {t('Добавить')}</Button>}
          >
            {items('attribute').length === 0 && <Empty>{t('Пусто')}</Empty>}
            <AttributesList
              items={items('attribute')}
              editable={editable}
              onReorder={(ids) => reorder.mutate({ id, orderedIds: ids })}
              onEdit={setEditingAttr}
              onRemove={(itemId) => removeItem.mutate({ id, itemId })}
              onColor={(a, color) => updateItem.mutate({ id, item: { ...a, color } })}
              onLink={(a, parentId) => updateItem.mutate({ id, item: { ...a, parentId } })}
            />
          </Card>

          {d.kind === 'person' && <RelationsCard dossierId={d.id} editable={editable} />}

          <Card compact
            title={<><Link2 size={13} /> {t('Соцсети')}</>}
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('link')}><Plus size={13} /> {t('Добавить')}</Button>}
          >
            {/* Только страницы самой персоны; ссылки на внешние сайты (kind = web) — в разделе «Ссылки». */}
            {items('link').filter((l) => l.kind !== 'web').length === 0 && <Empty>{t('Пусто')}</Empty>}
            <div className="space-y-1.5">
              {items('link').filter((l) => l.kind !== 'web').map((l) => (
                <div key={l.id} className="group flex items-center gap-2.5 rounded-lg border border-line-soft px-3 py-2">
                  <Tag tone="dim" className="w-20 justify-center">{platformLabel(l.platform)}</Tag>
                  <div className="min-w-0 flex-1">
                    <a href={l.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm hover:text-mint">
                      {l.title || l.url}
                    </a>
                    {l.source?.ref && <div className="truncate font-mono text-[10px] text-mute" title={l.source.ref}>{l.source.ref}</div>}
                  </div>
                  <a href={l.url} target="_blank" rel="noreferrer noopener" title={t('Открыть в новой вкладке')} className="text-mute hover:text-mint">
                    <ExternalLink size={12} />
                  </a>
                  {editable && (
                    <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button type="button" onClick={() => setEditingLink(l)} title={t('Править')} className="cursor-pointer text-mute hover:text-mint"><Pencil size={12} /></button>
                      <DeleteBtn onClick={() => removeItem.mutate({ id, itemId: l.id })} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card compact title={<><FileSearch size={13} /> {t('Снимки поиска')}</>}>
            {items('snapshot').length === 0 && <Empty>{t('Добавляются со страницы «Поиск»')}</Empty>}
            <div className="space-y-1.5">
              {items('snapshot').map((s) => (
                <div key={s.id} className="group flex items-center gap-2 rounded-lg border border-line-soft px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm">{s.query}</div>
                    <div className="font-mono text-[10px] text-mute">
                      {t(kindLabel(s.section, s.kind))} {s.deep && '· deep'} · {tx(s.summary)} · {fmtDate(s.createdAt)}
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
        onSave={async (item) => {
          const before = d.items.find((i) => i.id === item.id);
          const saved = await updateItem.mutateAsync({ id, item });
          // Заменили картинку, которая была обложкой: обложка привязана к прежнему файлу — переносим её на новый.
          if (before?.type === 'media' && before.url !== item.url && d.coverMediaUrl === before.url) {
            await update.mutateAsync({ id, version: saved.version, patch: { coverMediaUrl: item.url } });
          }
          setEditingMedia(null);
        }}
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
function AttributesList({ items, editable, onReorder, onEdit, onRemove, onColor, onLink }: {
  items: Of<'attribute'>[];
  editable: boolean;
  onReorder: (orderedIds: string[]) => void;
  onEdit: (a: Of<'attribute'>) => void;
  onRemove: (itemId: string) => void;
  onColor: (a: Of<'attribute'>, color: string | undefined) => void;
  /** Связать с родителем (parentId) или отвязать (undefined). */
  onLink: (a: Of<'attribute'>, parentId: string | undefined) => void;
}) {
  // Порядок после перетаскивания показывается сразу, не дожидаясь ответа сервера (как в галерее медиа).
  const [order, setOrder] = useState<string[] | null>(null);
  // Режим связывания: id атрибута, которому выбирают родителя. Остальные строки становятся кнопками; Esc отменяет.
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byId = new Map(items.map((a) => [a.id, a]));
  const base = order?.filter((x) => byId.has(x)) ?? orderAttributes(items).map((a) => a.id);
  // Атрибут, добавленный после перестановки, в локальном порядке ещё не значится — в конец.
  for (const a of items) if (!base.includes(a.id)) base.push(a.id);
  const ids = groupAttributes(base, byId);
  const linking = linkingId && byId.has(linkingId) ? byId.get(linkingId)! : null;

  useEffect(() => {
    if (!linking) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLinkingId(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [linking]);

  /** Годится ли строка в родители выбранному: допустимая пара типов, не он сам, не подчинённый, не нынешний родитель. */
  const canBeParent = (a: Of<'attribute'>) =>
    !!linking && a.id !== linking.id && pairAllowed(a.key, linking.key) && !parentOf(a, byId) && parentOf(linking, byId) !== a.id;
  // Связывать можно только подчинённый тип допустимой пары, и только если у него нет своих подчинённых.
  const canStartLink = (a: Of<'attribute'>) => ATTR_PAIRS.some((p) => p.child === a.key) && !items.some((x) => parentOf(x, byId) === a.id);

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setOrder(next);
    onReorder(next);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={clsx(linking ? 'space-y-1' : 'divide-y divide-line-soft')}>
          {ids.map((x) => {
            const a = byId.get(x)!;
            const mode: RowMode = !linking ? 'normal' : a.id === linking.id ? 'source' : canBeParent(a) ? 'target' : 'muted';
            const parentId = parentOf(a, byId);
            return (
              <AttrRow
                key={a.id}
                a={a}
                child={!!parentId}
                pair={parentId ? byId.get(parentId) : undefined}
                mode={mode}
                editable={editable}
                linkable={canStartLink(a)}
                onEdit={() => onEdit(a)}
                onRemove={() => onRemove(a.id)}
                onColor={(c) => onColor(a, c)}
                onUnlink={() => onLink(a, undefined)}
                onStartLink={() => setLinkingId(a.id)}
                onCancelLink={() => setLinkingId(null)}
                onPickParent={() => {
                  if (linking) onLink(linking, a.id);
                  setLinkingId(null);
                }}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** normal — обычная строка; source — ей выбирают родителя; target — кнопка-кандидат; muted — в родители не годится. */
type RowMode = 'normal' | 'source' | 'target' | 'muted';

function AttrRow({ a, child, pair, mode, editable, linkable, onEdit, onRemove, onColor, onUnlink, onStartLink, onCancelLink, onPickParent }: {
  a: Of<'attribute'>;
  /** Подчинённый атрибут связанной пары: сдвиг вправо и звено цепи перед названием. */
  child: boolean;
  /** Родитель подчинённого — для строки пары (копирование «родитель подчинённый», поиск по ФИО и дате рождения). */
  pair?: Of<'attribute'>;
  mode: RowMode;
  editable: boolean;
  /** Можно ли этому атрибуту выбирать родителя (у него нет своих подчинённых). */
  linkable: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onColor: (color: string | undefined) => void;
  onUnlink: () => void;
  onStartLink: () => void;
  onCancelLink: () => void;
  onPickParent: () => void;
}) {
  const kind = FIELD_TO_KIND[a.key as LeakField];
  const { id: dossierId } = useParams({ from: '/dossiers/$id' });
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: a.id, disabled: !editable || mode !== 'normal' });
  const target = mode === 'target';
  return (
    // Сетка 2×2: подпись | значение, под ними оценка источника и ручка перетаскивания | кнопки действий.
    // В режиме связывания строка-кандидат — одна большая кнопка с рамкой.
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      role={target ? 'button' : undefined}
      tabIndex={target ? 0 : undefined}
      onClick={target ? onPickParent : undefined}
      onKeyDown={target ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPickParent()) : undefined}
      title={target ? t('Сделать родительским атрибутом') : undefined}
      className={clsx(
        'group grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 py-2',
        isDragging && 'relative z-10 bg-panel',
        child && 'pl-[1.125rem]',
        mode !== 'normal' && 'rounded-lg border px-2.5 transition',
        target && 'cursor-pointer border-mint/50 hover:border-mint hover:bg-mint/10 hover:shadow-glow-sm',
        mode === 'source' && 'border-line',
        mode === 'muted' && 'border-transparent opacity-40',
      )}
    >
      <span className="flex items-center gap-1 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-mute">
        {child && (
          editable && mode === 'normal' ? (
            <button type="button" onClick={onUnlink} title={t('Отвязать от родительского атрибута')} className="-ml-[1.125rem] inline-flex cursor-pointer items-center text-mint/70 transition hover:text-danger">
              <Link2 size={12} />
            </button>
          ) : (
            <Link2 size={12} className="-ml-[1.125rem] text-mint/70" />
          )
        )}
        <span className="truncate">{attrLabelOf(a)}</span>
      </span>
      <div className="whitespace-pre-line break-words font-mono text-sm">{attrDisplayValue(a.key, a.value)}</div>
      <div className="flex items-center gap-1.5">
        {editable && mode === 'normal' && (
          <span ref={setActivatorNodeRef} {...attributes} {...listeners} title={t('Перетащить')} className="inline-flex cursor-grab items-center text-mute transition hover:text-mint active:cursor-grabbing">
            <DragDots />
          </span>
        )}
        <SourceBadge source={a.source} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'source' ? (
          <span className="flex items-center gap-2 font-mono text-[11px] text-mint">
            {t('Выберите родительский атрибут')}
            <button type="button" onClick={onCancelLink} title={t('Отменить связывание (Esc)')} className="inline-flex cursor-pointer items-center text-mute transition hover:text-danger"><X size={14} /></button>
          </span>
        ) : (
          <>
            {a.key === 'emails' && <ResearchEmailLink value={a.value} dossierId={dossierId} />}
            <ValueActions field={a.key} value={a.value} />
            <CopyButton value={attrCopyValue(a.key, a.value)} title={t('Скопировать: {name}', { name: attrLabelOf(a) })} />
            {kind && (
              <Link to="/search" search={{ kind, q: a.value, from: dossierId }} title={t('Искать')} className="text-mute opacity-0 transition hover:text-mint group-hover:opacity-100">
                <FileSearch size={14} />
              </Link>
            )}
            {editable && mode === 'normal' && (
              <>
                {linkable && (
                  <button type="button" onClick={onStartLink} title={child ? t('Привязать к другому атрибуту') : t('Привязать к родительскому атрибуту')} className="cursor-pointer text-mute opacity-0 transition hover:text-mint group-hover:opacity-100"><Link2 size={14} /></button>
                )}
                <button type="button" onClick={onEdit} title={t('Править')} className="cursor-pointer text-mute opacity-0 transition hover:text-mint group-hover:opacity-100"><Pencil size={14} /></button>
                <ConfirmDeleteBtn onConfirm={onRemove} />
              </>
            )}
          </>
        )}
        {/* Цветная метка — у правой границы бокса, вне ряда действий. */}
        <ColorMark value={a.color} editable={editable && mode === 'normal'} onChange={onColor} className="ml-auto" />
      </div>
      {pair && <PairActions parent={pair} child={a} />}
    </div>
  );
}

/**
 * Строка пары под подчинённым атрибутом: копирование объединённого значения «родитель подчинённый» и, для
 * ФИО + дата рождения, поиск по ним. Иконки стоят на уровне иконок родителя (сдвиг подчинённого компенсируется).
 */
function PairActions({ parent, child }: { parent: Of<'attribute'>; child: Of<'attribute'> }) {
  const { id: dossierId } = useParams({ from: '/dossiers/$id' });
  const combined = `${attrCopyValue(parent.key, parent.value)} ${attrCopyValue(child.key, child.value)}`;
  const searchable = parent.key === 'names' && child.key === 'bdays';
  return (
    <div className="col-start-2 -ml-[1.125rem] flex items-center gap-2 pt-1">
      <CopyButton value={combined} title={t('Скопировать: {name}', { name: `${attrLabelOf(parent)} + ${attrLabelOf(child)}` })} />
      {searchable && (
        <Link to="/search" search={{ kind: 'name', q: combined, from: dossierId }} title={t('Искать по ФИО и дате рождения')} className="text-mute transition hover:text-mint">
          <FileSearch size={14} />
        </Link>
      )}
      <span className="font-mono text-[10px] uppercase tracking-wider text-mute">{attrLabelOf(parent)} + {attrLabelOf(child)}</span>
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
  const { id: dossierId } = useParams({ from: '/dossiers/$id' });
  const cls = 'text-mute hover:text-mint';
  const icon = <FileSearch size={14} />;
  const title = t('Повторить поиск');
  if (section === 'tg') return <Link to="/search/telegram" search={{ mode: kind, q: query }} title={title} className={cls}>{icon}</Link>;
  if (section === 'fuzzy') return <Link to="/search/fuzzy" search={{ mode: kind, q: query }} title={title} className={cls}>{icon}</Link>;
  if (section === 'geo') return <Link to="/search/geo" search={{ q: query }} title={title} className={cls}>{icon}</Link>;
  return <Link to="/search" search={{ kind, q: query, deep, from: dossierId }} title={title} className={cls}>{icon}</Link>;
}

/** Заметка: свёрнутой остаётся строка с датой и началом текста; карандаш открывает редактор на месте. */
/**
 * Заметки с перестановкой мышью: ручка с четырьмя точками есть только у свёрнутой заметки. Пока одну тянут,
 * остальные временно свёрнуты (иначе целиться между длинными текстами невозможно); после сброса возвращаются.
 */
function NotesList({ notes, editable, onReorder, onSave, onRemove }: {
  notes: Of<'note'>[];
  editable: boolean;
  onReorder: (orderedIds: string[]) => void;
  onSave: (note: Of<'note'>, markdown: string) => Promise<void>;
  onRemove: (itemId: string) => void;
}) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const byId = new Map(notes.map((n) => [n.id, n]));
  const ids = order?.filter((x) => byId.has(x)) ?? notes.map((n) => n.id);
  for (const n of notes) if (!ids.includes(n.id)) ids.push(n.id);

  function onDragEnd(e: DragEndEvent) {
    setDragging(false);
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setOrder(next);
    onReorder(next);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDragging(true)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(false)}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map((x) => {
          const n = byId.get(x)!;
          return <NoteCard key={n.id} note={n} editable={editable} forceCollapsed={dragging} onSave={(md) => onSave(n, md)} onRemove={() => onRemove(n.id)} />;
        })}
      </SortableContext>
    </DndContext>
  );
}

function NoteCard({ note, editable, forceCollapsed, onSave, onRemove }: {
  note: Of<'note'>;
  editable: boolean;
  /** Временно свёрнута, пока переставляют другую заметку; своё состояние сохраняется. */
  forceCollapsed: boolean;
  onSave: (markdown: string) => Promise<void>;
  onRemove: () => void;
}) {
  const [ownCollapsed, setCollapsed] = useState(false);
  const collapsed = ownCollapsed || forceCollapsed;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: note.id, disabled: !editable || !ownCollapsed });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstLine = stripHighlight(note.markdown).split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? '';

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
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={clsx('rounded-xl border border-line-soft p-[0.8rem]', isDragging && 'relative z-10 border-mint bg-panel shadow-glow')}>
      <div className={clsx('flex items-center justify-between gap-2 font-mono text-[11px] text-mute', !collapsed && 'mb-2')}>
        {/* В узкой колонке места мало: дата и превью усекаются, значки справа — нет. */}
        <span className="flex min-w-0 items-center gap-3">
          {editable && ownCollapsed && (
            <span ref={setActivatorNodeRef} {...attributes} {...listeners} title={t('Перетащить')} className="inline-flex cursor-grab items-center text-mute transition hover:text-mint active:cursor-grabbing">
              <DragDots />
            </span>
          )}
          <span className="truncate">{fmtDate(note.createdAt, true)}</span>
          {collapsed && <span className="hidden truncate text-dim sm:inline">{firstLine}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <SourceBadge source={note.source} />
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            title={ownCollapsed ? t('Развернуть') : t('Свернуть')}
            className="cursor-pointer text-mute hover:text-mint"
          >
            {ownCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          {editable && draft === null && (
            <button
              type="button"
              onClick={() => {
                setCollapsed(false);
                setDraft(note.markdown);
              }}
              title={t('Править')}
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
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>{t('Отмена')}</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={saving || draft === note.markdown}>{t('Сохранить')}</Button>
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
    <button onClick={onClick} title={t('Удалить')} className={`${DELETE_GAP} cursor-pointer text-mute hover:text-danger`}>
      <Trash2 size={13} />
    </button>
  );
}

/**
 * «Исследовать» у атрибута-адреса: раздел «Исследовать Email» с этим адресом и возвратом в досье (?from=).
 * Нет раздела ([config] email-search) или значение не адрес — иконки нет.
 */
function ResearchEmailLink({ value, dossierId }: { value: string; dossierId: string }) {
  const cfg = trpc.email.config.useQuery(undefined, { staleTime: Infinity });
  const email = parseEmail(value)?.email;
  if (!cfg.data || !email) return null;
  return (
    <Link to="/search/email" search={{ q: email, from: dossierId }} title={t('Исследовать email')} aria-label={t('Исследовать email')} className="shrink-0 text-mute transition hover:text-mint">
      <MailSearch size={14} />
    </Link>
  );
}

/** Возврат в группу, из которой открыли или создали досье (?from=): текст-кнопка справа от названия. */
function BackToGroup({ id }: { id: string }) {
  const g = trpc.dossiers.get.useQuery({ id }, { select: (x) => x.title, staleTime: 60_000 });
  return (
    <Link to="/dossiers/$id" params={{ id }} className="inline-flex items-center gap-1.5 font-mono text-xs text-mute transition hover:text-mint">
      <ArrowLeft size={13} /> {g.data ? t('в группу «{title}»', { title: g.data }) : t('в группу')}
    </Link>
  );
}

function MembersEditor({
  memberIds, members, editable, selfId, onChange, onCreate,
}: {
  memberIds: string[];
  members: { id: string; title: string; coverMediaUrl: string | null }[];
  editable: boolean;
  selfId: string;
  onChange: (ids: string[]) => void;
  /** Создать досье персоны, включить в группу и перейти в него. */
  onCreate: (title: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = trpc.dossiers.options.useQuery(undefined, { enabled: editable });
  const candidates = (options.data ?? []).filter((o) => o.kind === 'person' && o.id !== selfId && !memberIds.includes(o.id));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {members.length === 0 && <span className="font-mono text-xs text-mute">{t('Участников нет')}</span>}
        {members.map((m) => (
          <div key={m.id} className="group flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3">
            <span className="size-7 overflow-hidden rounded-full bg-bg-soft">{m.coverMediaUrl && <img src={m.coverMediaUrl} alt="" className="size-full object-cover" />}</span>
            <Link to="/dossiers/$id" params={{ id: m.id }} search={{ from: selfId }} className="text-sm hover:text-mint">{m.title}</Link>
            {editable && <button onClick={() => onChange(memberIds.filter((x) => x !== m.id))} className="cursor-pointer text-mute hover:text-danger">×</button>}
          </div>
        ))}
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {candidates.length > 0 && (
            <Select value="" onChange={(e) => e.target.value && onChange([...memberIds, e.target.value])}>
              <option value="">{t('+ добавить участника…')}</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          )}
          <Button size="sm" variant="ghost" onClick={() => { setTitle(''); setError(null); setCreating(true); }} title={t('Создать досье персоны и включить его в группу')}>
            <Plus size={13} /> {t('Новое досье')}
          </Button>
        </div>
      )}
      <Dialog open={creating} onOpenChange={(v) => !busy && setCreating(v)} title={t('Новое досье в группе')}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || busy) return;
            setBusy(true);
            setError(null);
            onCreate(title.trim())
              .then(() => setCreating(false))
              .catch((err) => setError(errorText(err)))
              .finally(() => setBusy(false));
          }}
        >
          <Field label={t('Название')} hint={t('Досье персоны будет создано, включено в эту группу и сразу открыто.')}>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Фамилия Имя Отчество')} />
          </Field>
          {error && <div className="font-mono text-xs text-danger">{error}</div>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!title.trim() || busy}>{t('Создать')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Правка медиа: подпись, альбом, источник и само изображение — новым файлом или ссылкой (в том числе Гугл-диска). */
function EditMediaDialog({ media, onClose, onSave }: { media: Of<'media'> | null; onClose: () => void; onSave: (item: Of<'media'>) => Promise<void> }) {
  return (
    <Dialog open={!!media} onOpenChange={(v) => !v && onClose()} title={t('Медиафайл')}>
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
  // Замена изображения: пусто — остаётся прежнее; data URL (выбран файл) или введённая ссылка.
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState('');
  const [mediaKind, setMediaKind] = useState<'image' | 'video'>(media.embedUrl ? 'video' : 'image');
  const next = value.trim();
  const driveId = next && !next.startsWith('data:') ? googleDriveId(next) : null;
  const preview = !next ? media.url : driveId ? driveImageUrl(driveId) : next;

  function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MEDIA_FILE_MAX_BYTES) {
      setError(t('Файл {size} — больше {max}. Большие файлы держите на своём Гугл-диске и вставьте ссылку', { size: fmtBytes(f.size), max: fmtBytes(MEDIA_FILE_MAX_BYTES) }));
      return;
    }
    setError(null);
    const r = new FileReader();
    r.onload = () => setValue(String(r.result));
    r.readAsDataURL(f);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      // Время фиксации источника остаётся прежним: правится описание, а не сами сведения.
      const src = finishSource(source);
      // Новое изображение: ссылка Диска — миниатюра и, для видео, адрес плеера; у остального плеера нет.
      const image = next
        ? { url: preview, embedUrl: driveId && mediaKind === 'video' ? drivePreviewUrl(driveId) : undefined }
        : {};
      await onSave({ ...media, ...image, caption: caption.trim() || undefined, album: album.trim() || undefined, source: capturedAt ? { ...src, capturedAt } : src });
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
      <div className="flex items-end gap-3">
        <img src={preview} alt="" className="max-h-48 min-w-0 rounded-lg border border-line" />
        {!replacing && (
          <button type="button" onClick={() => setReplacing(true)} className="shrink-0 cursor-pointer font-mono text-xs text-mute transition hover:text-mint">
            {t('заменить изображение')}
          </button>
        )}
      </div>
      {replacing && (
        <div className="space-y-3 rounded-xl border border-line-soft p-3">
          <Field label={t('Новый файл')} hint={t('До {max}. Что больше — на свой Гугл-диск, сюда ссылку.', { max: fmtBytes(MEDIA_FILE_MAX_BYTES) })}>
            <FilePicker accept="image/*" onFiles={(fs) => onFile(fs[0])} />
          </Field>
          <Field
            label={t('…или URL изображения')}
            hint={(
              <>
                {driveId ? t('Ссылка Гугл-диска: файл должен быть открыт «всем, у кого есть ссылка»') : t('Подойдёт и ссылка «Поделиться» с Гугл-диска (картинка или видео)')}
                {' '}
                <DriveHelpButton />
              </>
            )}
          >
            <Input value={value.startsWith('data:') ? '' : value} onChange={(e) => setValue(e.target.value)} placeholder={t('https://… или https://drive.google.com/file/d/…')} />
          </Field>
          {driveId && (
            <Segmented value={mediaKind} onChange={setMediaKind} options={[{ value: 'image', label: t('Изображение') }, { value: 'video', label: t('Видео') }]} />
          )}
          <button
            type="button"
            onClick={() => { setValue(''); setReplacing(false); setError(null); }}
            className="cursor-pointer font-mono text-xs text-mute transition hover:text-mint"
          >
            {t('оставить прежнее')}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Подпись')}><Input autoFocus value={caption} onChange={(e) => setCaption(e.target.value)} /></Field>
        <Field label={t('Альбом')}><Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder={t('Соцсети, Наблюдение…')} /></Field>
      </div>
      <SourceFields value={source} onChange={setSource} />
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving}>{t('Сохранить')}</Button>
      </div>
    </form>
  );
}

/** Список типов атрибута; keep — ключ правящегося элемента: поле шлюза вне списка ручного ввода остаётся выбираемым. */
function AttrTypeSelect({ value, onChange, keep }: { value: string; onChange: (key: string) => void; keep?: string }) {
  const extra = keep && !ATTR_TYPES.some((x) => x.key === keep) ? attrTypeLabel(keep) : undefined;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
      {ATTR_TYPES.map((x) => <option key={x.key} value={x.key}>{t(x.label)}</option>)}
      {extra && <option value={keep}>{t(extra)}</option>}
      <option value="custom">{t('Свой…')}</option>
    </Select>
  );
}

/** Поле «Значение» с кнопкой мини-редактора на 10 строк для длинных атрибутов (адрес, место работы…). */
function AttrValueField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Field label={t('Значение')}>
      <div className="flex items-center gap-2">
        <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" />
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} title={t('Редактор для длинного значения')}><Maximize2 size={14} /></Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={t('Значение')} stacked>
        <Textarea autoFocus rows={10} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" />
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="primary" onClick={() => setOpen(false)}>{t('Готово')}</Button>
        </div>
      </Dialog>
    </Field>
  );
}

function EditAttrDialog({ attr, existing, onClose, onSave }: { attr: Of<'attribute'> | null; existing: DossierItem[]; onClose: () => void; onSave: (item: Of<'attribute'>) => Promise<void> }) {
  return (
    <Dialog open={!!attr} onOpenChange={(v) => !v && onClose()} title={t('Атрибут')}>
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
        <Field label={t('Тип')}>
          <AttrTypeSelect value={key} onChange={setKey} keep={attr.key} />
        </Field>
        {key === 'custom' && <Field label={t('Название')}><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>}
      </div>
      <AttrValueField value={value} onChange={setValue} />
      <SourceFields value={source} onChange={setSource} />
      {duplicate && <WarnNote>{t('Уже есть в досье: {item}', { item: duplicate.type === 'attribute' ? `${attrLabelOf(duplicate)} — ${attrDisplayValue(duplicate.key, duplicate.value)}` : '' })}</WarnNote>}
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving || !ready || !!duplicate}>{t('Сохранить')}</Button>
      </div>
    </form>
  );
}

function EditLinkDialog({ link, existing, onClose, onSave }: { link: Of<'link'> | null; existing: DossierItem[]; onClose: () => void; onSave: (item: Of<'link'>) => Promise<void> }) {
  return (
    <Dialog open={!!link} onOpenChange={(v) => !v && onClose()} title={link?.kind === 'web' ? t('Ссылка') : t('Ссылка на профиль')}>
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
      // У ссылки на внешний сайт платформы нет; снимки страницы и раздел остаются как были ({ ...link }).
      await onSave({ ...link, url, title: title.trim() || undefined, platform: link.kind === 'web' ? 'web' : guessPlatform(url), source: capturedAt ? { ...src, capturedAt } : src });
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
      {link.kind === 'web' ? (
        <Field label={t('Адрес страницы')}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…" />
        </Field>
      ) : (
        <Field label={t('URL профиля')} hint={url ? t('Платформа: {name}', { name: platformLabel(guessPlatform(url)) }) : undefined}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://vk.com/id…" />
        </Field>
      )}
      <Field label={link.kind === 'web' ? t('Название') : t('Подпись')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <SourceFields value={source} onChange={setSource} />
      {duplicate && <WarnNote>{t('Уже есть в досье: {item}', { item: duplicate.type === 'link' ? duplicate.url : '' })}</WarnNote>}
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={saving || !url || !!duplicate}>{t('Сохранить')}</Button>
      </div>
    </form>
  );
}

function AddItemDialog({ kind, existing, onClose, onAdd }: { kind: null | 'attribute' | 'link' | 'weblink' | 'media' | 'note' | 'post'; existing: DossierItem[]; onClose: () => void; onAdd: (i: NewItem) => Promise<void> }) {
  const titles = { attribute: t('Новый атрибут'), link: t('Ссылка на профиль'), weblink: t('Ссылка'), media: t('Медиафайл'), note: t('Заметка'), post: t('Пост или реакция') };
  return (
    <Dialog open={!!kind} onOpenChange={(v) => !v && onClose()} title={kind ? titles[kind] : ''} wide={kind === 'note'}>
      {kind && <AddItemForm key={kind} kind={kind} existing={existing} onAdd={onAdd} />}
    </Dialog>
  );
}

function AddItemForm({ kind, existing, onAdd }: { kind: 'attribute' | 'link' | 'weblink' | 'media' | 'note' | 'post'; existing: DossierItem[]; onAdd: (i: NewItem) => Promise<void> }) {
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
    : (kind === 'link' || kind === 'weblink') && value.trim() ? findDuplicate(existing, { type: 'link', url: value }) : undefined;

  async function submit() {
    setError(null);
    const src = finishSource(source);
    try {
      if (kind === 'attribute') {
        await onAdd({ type: 'attribute', key, label: attrLabel, value, source: src });
      } else if (kind === 'link') {
        const url = /^https?:\/\//.test(value) ? value : `https://${value}`;
        await onAdd({ type: 'link', url, title: title || undefined, platform: guessPlatform(url), source: src });
      } else if (kind === 'weblink') {
        const url = /^https?:\/\//.test(value) ? value : `https://${value}`;
        await onAdd({ type: 'link', kind: 'web', url, title: title || undefined, platform: 'web', source: src });
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
      setError(t('Файл {size} — больше {max}. Большие файлы держите на своём Гугл-диске и добавьте в досье ссылку (раздел «Ссылки»)', { size: fmtBytes(f.size), max: fmtBytes(MEDIA_FILE_MAX_BYTES) }));
      return;
    }
    setError(null);
    const r = new FileReader();
    r.onload = () => setValue(String(r.result));
    r.readAsDataURL(f);
    if (!title) setTitle(f.name);
  }

  // Изображение из буфера обмена (снимок экрана): кнопкой или Ctrl+V. Большое ужимается до лимита, а не отвергается —
  // у снимка экрана нет файла, который можно было бы положить на Гугл-диск.
  async function fromClipboard(blob: Blob | null) {
    if (!blob) return setError(t('В буфере обмена нет изображения'));
    setError(null);
    try {
      setValue(await imageDataUrl(blob, MEDIA_FILE_MAX_BYTES));
    } catch (e) {
      setError(errorText(e));
    }
  }
  useEffect(() => {
    if (kind !== 'media') return;
    const onPaste = (e: ClipboardEvent) => {
      const file = pastedImage(e);
      if (!file) return; // текст (ссылка) вставляется в поле как обычно
      e.preventDefault();
      void fromClipboard(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  let body: ReactNode;
  if (kind === 'attribute') {
    body = (
      <>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Тип')}>
            <AttrTypeSelect value={key} onChange={setKey} />
          </Field>
          {key === 'custom' && <Field label={t('Название')}><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>}
        </div>
        <AttrValueField value={value} onChange={setValue} />
      </>
    );
  } else if (kind === 'link') {
    body = (
      <>
        <Field label={t('URL профиля')} hint={value ? t('Платформа: {name}', { name: platformLabel(guessPlatform(value)) }) : undefined}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://vk.com/id…" />
        </Field>
        <Field label={t('Подпись')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      </>
    );
  } else if (kind === 'weblink') {
    body = (
      <>
        <Field label={t('Адрес страницы')} hint={t('Внешний сайт: статья, реестр, упоминание. Снимок страницы добавляется к ссылке после сохранения.')}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label={t('Название')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      </>
    );
  } else if (kind === 'media') {
    body = (
      <>
        <Field
          label={t('Файл')}
          hint={t('До {file} на файл и {total} на досье (занято {used}). Что больше — на свой Гугл-диск, в досье ссылку.', {
            file: fmtBytes(MEDIA_FILE_MAX_BYTES), total: fmtBytes(DOSSIER_MEDIA_MAX_BYTES), used: fmtBytes(dossierMediaBytes(existing)),
          })}
        >
          <div className="flex flex-wrap items-center gap-2">
            <FilePicker accept="image/*" onFiles={(fs) => onFile(fs[0])} />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title={t('Вставить изображение из буфера обмена (или Ctrl+V в этом окне)')}
              onClick={() => void clipboardImage().then(fromClipboard, () => setError(t('Браузер не дал прочитать буфер обмена — нажмите Ctrl+V в этом окне')))}
            >
              <ClipboardPaste size={13} /> {t('Из буфера обмена')}
            </Button>
          </div>
        </Field>
        <Field
          label={t('…или URL изображения')}
          hint={(
            <>
              {driveId ? t('Ссылка Гугл-диска: файл должен быть открыт «всем, у кого есть ссылка»') : t('Подойдёт и ссылка «Поделиться» с Гугл-диска (картинка или видео)')}
              {' '}
              <DriveHelpButton />
            </>
          )}
        >
          <Input value={value.startsWith('data:') ? '' : value} onChange={(e) => setValue(e.target.value)} placeholder={t('https://… или https://drive.google.com/file/d/…')} />
        </Field>
        {driveId && (
          <Segmented value={mediaKind} onChange={setMediaKind} options={[{ value: 'image', label: t('Изображение') }, { value: 'video', label: t('Видео') }]} />
        )}
        {value && <img src={driveId ? driveImageUrl(driveId) : value} alt="" className="max-h-48 rounded-lg border border-line" />}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Подпись')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label={t('Альбом')}><Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder={t('Соцсети, Наблюдение…')} /></Field>
        </div>
      </>
    );
  } else if (kind === 'post') {
    body = (
      <>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Вид')}>
            <Select value={postKind} onChange={(e) => setPostKind(e.target.value as typeof postKind)} className="w-full">
              {Object.entries(POST_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </Select>
          </Field>
          <Field label={t('Площадка')}>
            <Select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} className="w-full">
              {Object.keys(PLATFORM_LABELS).map((k) => <option key={k} value={k}>{platformLabel(k)}</option>)}
            </Select>
          </Field>
          <Field label={t('Где (группа, канал, страница)')}><Input value={place} onChange={(e) => setPlace(e.target.value)} /></Field>
          <Field label={t('Время (UTC)')}><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        </div>
        <Field label={t('Ссылка на сообщение')}><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="https://t.me/…" /></Field>
        {postKind === 'reaction' && <Field label={t('Реакция (эмодзи)')}><Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-32" /></Field>}
        {postKind === 'reply' && <Field label={t('В ответ на')}><Textarea rows={2} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} /></Field>}
        <Field label={postKind === 'reaction' ? t('Текст сообщения, на которое реагировали') : t('Текст')}>
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
          {t('Уже есть в досье: {item}', {
            item: duplicate.type === 'attribute' ? `${attrLabelOf(duplicate)} — ${attrDisplayValue(duplicate.key, duplicate.value)}` : duplicate.type === 'link' ? duplicate.url : '',
          })}
        </WarnNote>
      )}
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!value.trim() || !!duplicate}>{t('Добавить')}</Button>
      </div>
    </form>
  );
}
