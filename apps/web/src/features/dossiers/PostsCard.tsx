import { useState } from 'react';
import clsx from 'clsx';
import { CornerDownRight, ExternalLink, MessageSquareText, Plus } from 'lucide-react';
import { POST_KIND_LABELS, type DossierItem } from '@ft/shared';
import { SourceBadge } from '../../components/SourceBadge.tsx';
import { Button, Card, ConfirmDeleteBtn, Empty, Segmented, Tag } from '../../components/ui.tsx';
import { fmtUtc } from '../../lib/format.ts';
import { PLATFORM_LABELS } from './labels.ts';

// «Посты и реакции» досье персоны: посты, комментарии, ответы и реакции в соцсетях.
// Переносятся из «Поиска в Telegram» (отмеченные сообщения) или добавляются вручную.

type Post = Extract<DossierItem, { type: 'post' }>;
type Kind = Post['kind'];

const KIND_TONE: Record<Kind, 'mint' | 'info' | 'warn' | 'dim'> = { post: 'mint', comment: 'info', reply: 'dim', reaction: 'warn' };

export function PostsCard({
  posts, editable, onAdd, onRemove,
}: {
  posts: Post[];
  editable: boolean;
  onAdd: () => void;
  onRemove: (itemId: string) => void;
}) {
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const present = (Object.keys(POST_KIND_LABELS) as Kind[]).filter((k) => posts.some((p) => p.kind === k));
  const active = kind !== 'all' && present.includes(kind) ? kind : 'all';
  // Новые сверху; без даты — в конце.
  const shown = posts
    .filter((p) => active === 'all' || p.kind === active)
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));

  return (
    <Card
      compact
      title={<><MessageSquareText size={13} /> Посты и реакции</>}
      actions={editable && <Button size="sm" variant="ghost" onClick={onAdd}><Plus size={13} /> Добавить</Button>}
    >
      {posts.length === 0 ? (
        <Empty>Переносятся из «Поиска в Telegram» или добавляются вручную</Empty>
      ) : (
        <div className="space-y-[0.8rem]">
          {present.length > 1 && (
            <Segmented
              value={active}
              onChange={setKind}
              options={[
                { value: 'all', label: `все · ${posts.length}` },
                ...present.map((k) => ({ value: k, label: `${POST_KIND_LABELS[k]} · ${posts.filter((p) => p.kind === k).length}` })),
              ]}
            />
          )}
          {shown.map((p) => <PostRow key={p.id} post={p} editable={editable} onRemove={() => onRemove(p.id)} />)}
        </div>
      )}
    </Card>
  );
}

function PostRow({ post: p, editable, onRemove }: { post: Post; editable: boolean; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const long = p.text.length > 400 || p.text.split('\n').length > 6;
  return (
    <article className="group rounded-xl border border-line-soft p-[0.8rem] transition hover:border-line">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-mute">
        <Tag tone={KIND_TONE[p.kind]}>{POST_KIND_LABELS[p.kind]}{p.emoji && <span className="ml-1 text-sm leading-none">{p.emoji}</span>}</Tag>
        <Tag tone="dim">{PLATFORM_LABELS[p.platform] ?? p.platform}</Tag>
        {p.place && <span className="text-dim">{p.place}</span>}
        {p.author && <span>· автор: <span className="text-dim">{p.author}</span></span>}
        <span>{p.at ? <>{fmtUtc(p.at)} <span className="text-mute/70">(UTC)</span></> : 'дата неизвестна'}</span>
        <span className="ml-auto flex items-center gap-2">
          <SourceBadge source={p.source} />
          {p.url && (
            <a href={p.url} target="_blank" rel="noreferrer noopener" title="Открыть сообщение" className="hover:text-mint">
              <ExternalLink size={12} />
            </a>
          )}
          {editable && <ConfirmDeleteBtn onConfirm={onRemove} />}
        </span>
      </div>
      {p.replyTo && (
        <div className="mb-1.5 flex gap-1.5 border-l-2 border-line pl-2 text-xs text-mute">
          <CornerDownRight size={12} className="mt-0.5 shrink-0" /> <span className="line-clamp-2">{p.replyTo}</span>
        </div>
      )}
      {p.text && (
        <div className={clsx('whitespace-pre-wrap break-words text-sm', p.kind === 'reaction' && 'text-dim', !open && long && 'line-clamp-6')}>{p.text}</div>
      )}
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-1 cursor-pointer font-mono text-[11px] text-mute hover:text-mint">
          {open ? 'свернуть' : 'показать полностью'}
        </button>
      )}
    </article>
  );
}
