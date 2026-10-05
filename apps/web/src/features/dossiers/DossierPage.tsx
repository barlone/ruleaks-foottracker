import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft, Camera, ExternalLink, FileSearch, Link2, NotebookPen, Pencil, Plus, Share2, Trash2, User, Users,
} from 'lucide-react';
import { LEAK_FIELDS, FIELD_TO_KIND, newId, type DossierItem, type LeakField, type SearchSection } from '@ft/shared';
import { kindLabel } from '../search/common.tsx';
import { ValueActions } from '../search/ValueActions.tsx';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { ShareDialog, VisibilityTag } from '../../components/Sharing.tsx';
import { SourceBadge } from '../../components/SourceBadge.tsx';
import { SourceFields, emptySource, finishSource, type SourceDraft } from '../../components/SourceFields.tsx';
import { Button, Card, CopyButton, Dialog, Empty, Field, Input, Select, Spinner, Tag } from '../../components/ui.tsx';
import { trpc, type RouterInputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { fmtDate } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';
import { dossierRoute } from '../../router.tsx';
import { MediaGallery } from './MediaGallery.tsx';

type Of<T extends DossierItem['type']> = Extract<DossierItem, { type: T }>;
type NewItem = RouterInputs['dossiers']['addItem']['item'];

const PLATFORM_LABELS: Record<string, string> = {
  vk: 'VK', telegram: 'Telegram', ok: 'OK', instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', web: 'Веб', other: 'Другое',
};

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
  const [adding, setAdding] = useState<null | 'attribute' | 'link' | 'media' | 'note'>(null);
  const [sharing, setSharing] = useState(false);

  if (q.isLoading) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  if (q.error || !q.data) return <div className="p-6"><Empty>{errorText(q.error)}</Empty></div>;
  const d = q.data;
  const editable = d.role !== 'viewer' && !!me.data?.access.active;
  const items = <T extends DossierItem['type']>(t: T) => d.items.filter((i): i is Of<T> => i.type === t);
  const add = (item: NewItem) => addItem.mutateAsync({ id, item }).then(() => setAdding(null));

  return (
    <div className="space-y-6 py-6 pl-6 pr-[30px]">
      <Link to="/dossiers" className="inline-flex items-center gap-1.5 font-mono text-xs text-mute hover:text-mint">
        <ArrowLeft size={13} /> все досье
      </Link>

      {/* Шапка */}
      <header className="flex flex-wrap items-start gap-6">
        <div className="size-32 shrink-0 overflow-hidden rounded-2xl border border-line bg-bg-soft shadow-glow-sm">
          {d.coverMediaUrl ? (
            <img src={d.coverMediaUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-mint/30">{d.kind === 'group' ? <Users size={48} /> : <User size={48} />}</div>
          )}
        </div>
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
          <TagsEditor
            tags={d.tags}
            editable={editable}
            onChange={(tags) => update.mutate({ id, version: d.version, patch: { tags } })}
          />
        </div>
        <div className="flex gap-2">
          {d.role === 'owner' && (
            <>
              <Button onClick={() => setSharing(true)}><Share2 size={15} /> Доступ</Button>
              <Button
                variant="danger"
                onClick={() => confirm(`Удалить досье «${d.title}»?`) && remove.mutate({ id })}
                title="Удалить"
              >
                <Trash2 size={15} />
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <Card
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
            <Card title="Участники группы">
              <MembersEditor
                memberIds={d.memberIds}
                members={d.members}
                editable={editable}
                selfId={d.id}
                onChange={(memberIds) => update.mutate({ id, version: d.version, patch: { memberIds } })}
              />
            </Card>
          )}

          <Card
            title={<><Camera size={13} /> Медиа</>}
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('media')}><Plus size={13} /> Добавить</Button>}
          >
            {items('media').length ? (
              <MediaGallery
                items={items('media')}
                editable={editable}
                coverUrl={d.coverMediaUrl}
                onReorder={(ids) => reorder.mutate({ id, orderedIds: ids })}
                onRemove={(itemId) => removeItem.mutate({ id, itemId })}
                onCover={(url) => update.mutate({ id, version: d.version, patch: { coverMediaUrl: url } })}
              />
            ) : (
              <Empty>Фотографий нет</Empty>
            )}
          </Card>

          <Card
            title={<><NotebookPen size={13} /> Заметки</>}
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('note')}><Plus size={13} /> Заметка</Button>}
          >
            <div className="space-y-4">
              {items('note').length === 0 && <Empty>Заметок нет</Empty>}
              {items('note').map((n) => (
                <article key={n.id} className="rounded-xl border border-line-soft p-4">
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

        <div className="space-y-6">
          <Card
            title="Атрибуты"
            actions={editable && <Button size="sm" variant="ghost" onClick={() => setAdding('attribute')}><Plus size={13} /> Добавить</Button>}
          >
            {items('attribute').length === 0 && <Empty>Пусто</Empty>}
            <div className="divide-y divide-line-soft">
              {items('attribute').map((a) => {
                const kind = FIELD_TO_KIND[a.key as LeakField];
                return (
                  <div key={a.id} className="group flex items-start gap-3 py-2">
                    <span className="w-28 shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-mute">{a.label}</span>
                    {/* Значение занимает всю ширину до правого края; оценка источника и кнопки — строкой под ним. */}
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-mono text-sm">{a.value}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <SourceBadge source={a.source} />
                        <ValueActions field={a.key} value={a.value} />
                        <CopyButton value={a.value} title={`Скопировать: ${a.label}`} />
                        <span className="flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
                          {kind && (
                            <Link to="/search" search={{ kind, q: a.value }} title="Искать" className="text-mute hover:text-mint">
                              <FileSearch size={14} />
                            </Link>
                          )}
                          {editable && <DeleteBtn onClick={() => removeItem.mutate({ id, itemId: a.id })} />}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card
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

          <Card title={<><FileSearch size={13} /> Снимки поиска</>}>
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
                  {editable && <span className="opacity-0 group-hover:opacity-100"><DeleteBtn onClick={() => removeItem.mutate({ id, itemId: s.id })} /></span>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <AddItemDialog kind={adding} onClose={() => setAdding(null)} onAdd={add} />

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

function TagsEditor({ tags, editable, onChange }: { tags: string[]; editable: boolean; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Tag key={t} tone="dim">
          #{t}
          {editable && <button onClick={() => onChange(tags.filter((x) => x !== t))} className="ml-0.5 cursor-pointer hover:text-danger">×</button>}
        </Tag>
      ))}
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim().replace(/^#/, '');
            if (v && !tags.includes(v)) onChange([...tags, v]);
            setDraft('');
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="+ тег"
            className="w-20 bg-transparent font-mono text-[11px] text-dim outline-none placeholder:text-mute focus:w-32"
          />
        </form>
      )}
    </div>
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

function AddItemDialog({ kind, onClose, onAdd }: { kind: null | 'attribute' | 'link' | 'media' | 'note'; onClose: () => void; onAdd: (i: NewItem) => Promise<void> }) {
  const titles = { attribute: 'Новый атрибут', link: 'Ссылка на профиль', media: 'Медиафайл', note: 'Заметка' };
  return (
    <Dialog open={!!kind} onOpenChange={(v) => !v && onClose()} title={kind ? titles[kind] : ''} wide={kind === 'note'}>
      {kind && <AddItemForm key={kind} kind={kind} onAdd={onAdd} />}
    </Dialog>
  );
}

function AddItemForm({ kind, onAdd }: { kind: 'attribute' | 'link' | 'media' | 'note'; onAdd: (i: NewItem) => Promise<void> }) {
  const [key, setKey] = useState<string>('phones');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
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
          <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm text-dim file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-mint/10 file:px-3 file:py-1.5 file:text-mint" />
        </Field>
        <Field label="…или URL изображения"><Input value={value.startsWith('data:') ? '' : value} onChange={(e) => setValue(e.target.value)} /></Field>
        {value && <img src={value} alt="" className="max-h-48 rounded-lg border border-line" />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Подпись"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Альбом"><Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Соцсети, Наблюдение…" /></Field>
        </div>
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
