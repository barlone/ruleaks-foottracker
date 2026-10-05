import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { ArrowLeft, Lightbulb, ListChecks, Network, Pencil, Share2, Trash2 } from 'lucide-react';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { ShareDialog, VisibilityTag } from '../../components/Sharing.tsx';
import { TagsBar } from '../../components/Tags.tsx';
import { Button, Empty, Spinner, Tag } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';
import { investigationRoute } from '../../router.tsx';
import { FactsPanel } from './FactsPanel.tsx';
import { HypothesesPanel } from './HypothesesPanel.tsx';

const GraphEditor = lazy(() => import('./GraphEditor.tsx').then((m) => ({ default: m.GraphEditor })));

const TABS = [
  { id: 'graph', label: 'Связи', icon: Network },
  { id: 'facts', label: 'Факты', icon: ListChecks },
  { id: 'hypotheses', label: 'Гипотезы', icon: Lightbulb },
] as const;

export function InvestigationPage() {
  const { id } = investigationRoute.useParams();
  const { tab = 'graph', focus } = investigationRoute.useSearch();
  const navigate = useNavigate({ from: '/investigations/$id' });
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const q = trpc.investigations.get.useQuery({ id });

  const onDone = {
    onSuccess: (inv: NonNullable<typeof q.data>) => utils.investigations.get.setData({ id }, inv),
    onError: (e: unknown) => {
      toast(errorText(e), 'error');
      void utils.investigations.get.invalidate({ id });
    },
  };
  const update = trpc.investigations.update.useMutation(onDone);
  const setVisibility = trpc.investigations.setVisibility.useMutation(onDone);
  const share = trpc.investigations.share.useMutation(onDone);
  const unshare = trpc.investigations.unshare.useMutation(onDone);
  const remove = trpc.investigations.remove.useMutation({ onSuccess: () => navigate({ to: '/investigations' }) });
  const [sharing, setSharing] = useState(false);
  const [editDesc, setEditDesc] = useState<string | null>(null);
  const [showDesc, setShowDesc] = useState(false);

  if (q.isLoading) return <div className="grid h-64 place-items-center"><Spinner /></div>;
  if (q.error || !q.data) return <div className="p-6"><Empty>{errorText(q.error)}</Empty></div>;
  const inv = q.data;
  const editable = inv.role !== 'viewer' && !!me.data?.access.active;

  return (
    <div className="text-plus-1 flex h-full flex-col">
      <header className="border-b border-line bg-panel/60 pb-0 pl-6 pr-[30px] pt-4 backdrop-blur">
        {/* «Все расследования» и кнопки владельца — одной строкой над заголовком. */}
        {(me.data || inv.role === 'owner') && (
          <div className="mb-2 flex items-center justify-between gap-4">
            {me.data ? (
              <Link to="/investigations" className="inline-flex items-center gap-1.5 font-mono text-xs text-mute hover:text-mint">
                <ArrowLeft size={13} /> все расследования
              </Link>
            ) : <span />}
            {inv.role === 'owner' && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setSharing(true)}><Share2 size={14} /> Доступ</Button>
                <Button size="sm" variant="danger" onClick={() => confirm(`Удалить «${inv.title}»?`) && remove.mutate({ id })}><Trash2 size={14} /></Button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight">{inv.title}</h1>
              <VisibilityTag v={inv.visibility} />
              {inv.role !== 'owner' && <Tag>{inv.role === 'editor' ? 'правка' : 'чтение'}</Tag>}
              <button onClick={() => setShowDesc((v) => !v)} className="cursor-pointer font-mono text-[11px] text-mute hover:text-mint">
                {showDesc ? 'скрыть описание' : 'описание'}
              </button>
            </div>
            <div className="mt-2">
              <TagsBar
                tags={inv.tags}
                editable={editable}
                busy={update.isPending}
                onChange={(tagIds) => update.mutate({ id, version: inv.version, patch: { tagIds } })}
              />
            </div>
          </div>
        </div>

        {showDesc && (
          <div className="mt-[0.6rem] rounded-xl border border-line-soft p-[0.8rem]">
            {editDesc !== null ? (
              <div className="space-y-2">
                <MarkdownEditor value={editDesc} onChange={setEditDesc} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditDesc(null)}>Отмена</Button>
                  <Button size="sm" variant="primary" onClick={() => { update.mutate({ id, version: inv.version, patch: { descriptionMd: editDesc } }); setEditDesc(null); }}>Сохранить</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <MarkdownView source={inv.descriptionMd} className="flex-1" />
                {editable && <button onClick={() => setEditDesc(inv.descriptionMd)} className="cursor-pointer self-start text-mute hover:text-mint"><Pencil size={14} /></button>}
              </div>
            )}
          </div>
        )}

        <nav className="mt-3 flex gap-1">
          {TABS.map(({ id: t, label, icon: Icon }) => {
            const count = t === 'graph' ? inv.nodes.length : t === 'facts' ? inv.facts.length : inv.hypotheses.length;
            return (
              <button
                key={t}
                onClick={() => void navigate({ search: { tab: t } })}
                className={clsx(
                  'flex cursor-pointer items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition',
                  tab === t ? 'border-mint text-mint' : 'border-transparent text-dim hover:text-text',
                )}
              >
                <Icon size={15} /> {label}
                <span className="font-mono text-[10px] text-mute">{count}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1">
        {tab === 'graph' && (
          <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}>
            <GraphEditor investigationId={id} version={inv.version} nodes={inv.nodes} edges={inv.edges} facts={inv.facts} editable={editable} focus={focus} />
          </Suspense>
        )}
        {tab === 'facts' && <FactsPanel inv={inv} editable={editable} />}
        {tab === 'hypotheses' && <HypothesesPanel inv={inv} editable={editable} />}
      </div>

      <ShareDialog
        open={sharing}
        onOpenChange={setSharing}
        visibility={inv.visibility}
        shares={inv.shares}
        allowPublic
        onVisibility={(v) => setVisibility.mutate({ id, version: inv.version, visibility: v })}
        onShare={(username, role) => share.mutate({ id, username, role })}
        onUnshare={(userId) => unshare.mutate({ id, userId })}
        error={share.error ? errorText(share.error) : null}
      />
    </div>
  );
}
