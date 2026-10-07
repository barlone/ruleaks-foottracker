import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft, Camera, ExternalLink, FileSearch, Link2, NotebookPen, Pencil, Plus, Trash2,
} from 'lucide-react';
import { LEAK_FIELDS, FIELD_TO_KIND, POST_KIND_LABELS, newId, type DossierItem, type LeakField, type SearchSection } from '@ft/shared';
import { kindLabel } from '../search/common.tsx';
import { ValueActions } from '../search/ValueActions.tsx';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { ExportDialog } from '../../components/ExportDialog.tsx';
import { ObjectActions } from '../../components/ObjectActions.tsx';
import { ShareDialog, VisibilityTag } from '../../components/Sharing.tsx';
import { SourceBadge } from '../../components/SourceBadge.tsx';
import { SourceFields, emptySource, finishSource, type SourceDraft } from '../../components/SourceFields.tsx';
import { TagsBar } from '../../components/Tags.tsx';
import { Button, Card, ConfirmDeleteBtn, CopyButton, Dialog, Empty, Field, FilePicker, Input, Select, Spinner, Tag, Textarea } from '../../components/ui.tsx';
import { trpc, type RouterInputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { fmtDate } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';
import { dossierRoute } from '../../router.tsx';
import { MediaGallery } from './MediaGallery.tsx';
import { CoverBox, PHOTO_ALBUM } from './PhotosDialog.tsx';
import { PLATFORM_LABELS, PostsCard } from './PostsCard.tsx';
import { RelationsCard } from './RelationsCard.tsx';

type Of<T extends DossierItem['type']> = Extract<DossierItem, { type: T }>;
type NewItem = RouterInputs['dossiers']['addItem']['item'];

function guessPlatform(url: string): Of<'link'>['platform'] {
  if (/vk\.com/.test(url)) return 'vk';
  if (/t\.me|telegram/.test(url)) return 'telegram';
  if (/ok\.ru/.test(url)) return 'ok';
  if (/instagram/.test(url)) return 'instagram';
  if (/facebook|fb\.com/.test(url)) return 'facebook';
  if (/x\.com|twitter/.test(url)) return 'x';
  if (/youtu/.test(url)) return 'youtube';
  return 'web';
}

/** Порядок атрибутов по важности; остальные поля — после ссылок в порядке LEAK_FIELDS, свои — перед «Прочим». */
const ATTR_ORDER: string[] = ['names', 'bdays', 'inns', 'pasps', 'snilss', 'phones', 'emails', 'addrs', 'weblinks'];
const attrRank = (key: string) => {
  if (key === 'infos') return 1000;
  const i = ATTR_ORDER.indexOf(key);
  if (i >= 0) return i;
  const j = Object.keys(LEAK_FIELDS).indexOf(key);
  return j >= 0 ? 100 + j : 900;
};
/** Стабильная сортировка: внутри одного типа атрибуты остаются в порядке добавления. */
const sortAttributes = (list: Of<'attribute'>[]) => list.map((a, i) => ({ a, i })).sort((x, y) => attrRank(x.a.key) - attrRank(y.a.key) || x.i - y.i).map((x) => x.a);

/** Телефон показывается с «+», как в отчётах бота; копируется значение как есть. */
const attrDisplay = (key: string, value: string) => (key === 'phones' && /^\d/.test(value.trim()) ? `+${value.trim()}` : value);

export function DossierPage() {
  const { id } = dossierRoute.useParams();
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
  const removeItem = trpc.dossiers.removeItem.useMutation(onDone);
  const reorder = trpc.dossiers.reorderItems.useMutation(onDone);
  const setVisibility = trpc.dossiers.setVisibility.useMutation(onDone);
  const share = trpc.dossiers.share.useMutation(onDone);
  const unshare = trpc.dossiers.unshare.useMutation(onDone);
  const remove = trpc.dossiers.remove.useMutation({ onSuccess: () => navigate({ to: '/dossiers' }) });

  const [editSummary, setEditSummary] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | 'attribute' | 'link' | 'media' | 'note' | 'post'>(null);
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
    <div className="text-plus-1 space-y-[1.2rem] py-[1.2rem] pl-6 pr-[30px]">
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
                  <Input autoFocus value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onBlur={() => setEditTitle(null)} className="h-12 text-2xl font-extrabold" />
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
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('media')}><Plus size={13} /> Добавить</Button>}
          >
            {media.length ? (
              <MediaGallery
                items={media}
                editable={editable}
                coverUrl={d.coverMediaUrl}
                onReorder={(ids) => reorder.mutate({ id, orderedIds: ids })}
                onRemove={(itemId) => removeItem.mutate({ id, itemId })}
                onCover={(url) => update.mutate({ id, version: d.version, patch: { coverMediaUrl: url } })}
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
                <article key={n.id} className="rounded-xl border border-line-soft p-[0.8rem]">
                  <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[11px] text-mute">
                    <span>{fmtDate(n.createdAt, true)}</span>
                    <span className="flex items-center gap-2">
                      <SourceBadge source={n.source} />
                      {editable && <DeleteBtn onClick={() => removeItem.mutate({ id, itemId: n.id })} />}
                    </span>
                  </div>
                  <MarkdownView source={n.markdown} />
                </article>
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
            <div className="divide-y divide-line-soft">
              {sortAttributes(items('attribute')).map((a) => {
                const kind = FIELD_TO_KIND[a.key as LeakField];
                return (
                  // Сетка 2×2: подпись | значение, под ними оценка источника | кнопки действий.
                  <div key={a.id} className="group grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 py-2">
                    <span className="pt-0.5 font-mono text-[10px] uppercase tracking-wider text-mute">{a.label}</span>
                    <div className="break-words font-mono text-sm">{attrDisplay(a.key, a.value)}</div>
                    <div className="flex items-center"><SourceBadge source={a.source} /></div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ValueActions field={a.key} value={a.value} />
                      <CopyButton value={a.value} title={`Скопировать: ${a.label}`} />
                      {kind && (
                        <Link to="/search" search={{ kind, q: a.value }} title="Искать" className="text-mute opacity-0 transition hover:text-mint group-hover:opacity-100">
                          <FileSearch size={14} />
                        </Link>
                      )}
                      {/* Отступ в ширину кнопки — чтобы не попасть в «удалить» вместо соседней. */}
                      {editable && <ConfirmDeleteBtn className="ml-3.5" onConfirm={() => removeItem.mutate({ id, itemId: a.id })} />}
                    </div>
                  </div>
                );
              })}
            </div>
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
                  <a href={l.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-sm hover:text-mint">
                    {l.title || l.url}
                  </a>
                  <ExternalLink size={12} className="text-mute" />
                  {editable && <span className="opacity-0 group-hover:opacity-100"><DeleteBtn onClick={() => removeItem.mutate({ id, itemId: l.id })} /></span>}
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

      <AddItemDialog kind={adding} onClose={() => setAdding(null)} onAdd={add} />

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
function RepeatSearchLink({ section, kind, query, deep }: { section: SearchSection; kind: string; query: string; deep: boolean }) {
  const cls = 'text-mute hover:text-mint';
  const icon = <FileSearch size={14} />;
  if (section === 'tg') return <Link to="/search/telegram" search={{ mode: kind, q: query }} title="Повторить поиск" className={cls}>{icon}</Link>;
  if (section === 'fuzzy') return <Link to="/search/fuzzy" search={{ mode: kind, q: query }} title="Повторить поиск" className={cls}>{icon}</Link>;
  return <Link to="/search" search={{ kind, q: query, deep }} title="Повторить поиск" className={cls}>{icon}</Link>;
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Удалить" className="cursor-pointer text-mute hover:text-danger">
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

function AddItemDialog({ kind, onClose, onAdd }: { kind: null | 'attribute' | 'link' | 'media' | 'note' | 'post'; onClose: () => void; onAdd: (i: NewItem) => Promise<void> }) {
  const titles = { attribute: 'Новый атрибут', link: 'Ссылка на профиль', media: 'Медиафайл', note: 'Заметка', post: 'Пост или реакция' };
  return (
    <Dialog open={!!kind} onOpenChange={(v) => !v && onClose()} title={kind ? titles[kind] : ''} wide={kind === 'note'}>
      {kind && <AddItemForm key={kind} kind={kind} onAdd={onAdd} />}
    </Dialog>
  );
}

function AddItemForm({ kind, onAdd }: { kind: 'attribute' | 'link' | 'media' | 'note' | 'post'; onAdd: (i: NewItem) => Promise<void> }) {
  const [key, setKey] = useState<string>('phones');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  // Пост: вид, площадка, где опубликовано, ссылка, время (UTC), эмодзи реакции, на что ответ.
  const [postKind, setPostKind] = useState<Of<'post'>['kind']>('comment');
  const [platform, setPlatform] = useState<Of<'post'>['platform']>('telegram');
  const [place, setPlace] = useState('');
  const [at, setAt] = useState('');
  const [emoji, setEmoji] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [source, setSource] = useState<SourceDraft>(emptySource());
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const src = finishSource(source);
    try {
      if (kind === 'attribute') {
        await onAdd({ type: 'attribute', key, label: key === 'custom' ? label : LEAK_FIELDS[key as LeakField], value, source: src });
      } else if (kind === 'link') {
        const url = /^https?:\/\//.test(value) ? value : `https://${value}`;
        await onAdd({ type: 'link', url, title: title || undefined, platform: guessPlatform(url), source: src });
      } else if (kind === 'media') {
        await onAdd({ type: 'media', mediaId: newId(), url: value, caption: title || undefined, album: album || undefined, source: src });
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
            <Select value={key} onChange={(e) => setKey(e.target.value)} className="w-full">
              {Object.entries(LEAK_FIELDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              <option value="custom">Свой…</option>
            </Select>
          </Field>
          {key === 'custom' && <Field label="Название"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>}
        </div>
        <Field label="Значение"><Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="font-mono" /></Field>
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
        <Field label="Файл" hint="В прототипе файл встраивается как data URL; в проде — presigned-загрузка в S3, превью, EXIF.">
          <FilePicker accept="image/*" onFiles={(fs) => onFile(fs[0])} />
        </Field>
        <Field label="…или URL изображения"><Input value={value.startsWith('data:') ? '' : value} onChange={(e) => setValue(e.target.value)} /></Field>
        {value && <img src={value} alt="" className="max-h-48 rounded-lg border border-line" />}
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
      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!value.trim()}>Добавить</Button>
      </div>
    </form>
  );
}
