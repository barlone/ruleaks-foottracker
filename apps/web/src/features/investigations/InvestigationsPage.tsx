import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Network, Plus } from 'lucide-react';
import { VisibilityTag } from '../../components/Sharing.tsx';
import { TagFilter, TagList } from '../../components/Tags.tsx';
import { Button, Dialog, Empty, Field, Input, Segmented, Spinner, Tag } from '../../components/ui.tsx';
import { MarkdownEditor } from '../../components/Markdown.tsx';
import { trpc } from '../../lib/trpc.ts';
import { ago } from '../../lib/format.ts';
import { errorText } from '../../lib/errors.ts';
import { investigationsRoute } from '../../router.tsx';

export function InvestigationsPage() {
  const { scope = 'mine' } = investigationsRoute.useSearch();
  const navigate = useNavigate({ from: '/investigations' });
  const [title, setTitle] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const list = trpc.investigations.list.useQuery(
    { scope, title: title.trim() || undefined, tagIds: tagIds.length ? tagIds : undefined },
    { placeholderData: (p) => p },
  );
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6 py-6 pl-6 pr-[30px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Расследования</h1>
          <p className="mt-1 text-sm text-dim">Граф связей между персонами, организациями и событиями, база фактов и проверка гипотез.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Новое расследование</Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={scope}
          onChange={(s) => void navigate({ search: { scope: s } })}
          options={[{ value: 'all', label: 'Все' }, { value: 'mine', label: 'Мои' }, { value: 'shared', label: 'Доступные мне' }, { value: 'public', label: 'Публичные' }]}
        />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название содержит…" className="max-w-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-dim">Теги содержат:</span>
          <TagFilter value={tagIds} onChange={setTagIds} />
        </div>
        {list.isFetching && <Spinner />}
      </div>

      {list.data?.length === 0 && <Empty>Нет расследований</Empty>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {list.data?.map((inv, i) => (
          <Link
            key={inv.id}
            to="/investigations/$id"
            params={{ id: inv.id }}
            className="group animate-fade-up rounded-2xl border border-line bg-gradient-to-b from-mint/[0.04] to-transparent p-5 transition hover:-translate-y-0.5 hover:border-mint/50 hover:shadow-glow-sm"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="mb-3 flex items-center justify-between">
              <Network size={20} className="text-mint" />
              <span className="flex gap-1.5">
                {inv.role !== 'owner' && <Tag>{inv.role === 'editor' ? 'правка' : 'чтение'}</Tag>}
                <VisibilityTag v={inv.visibility} />
              </span>
            </div>
            <div className="text-lg font-bold leading-snug group-hover:text-mint">{inv.title}</div>
            <TagList tags={inv.tags} className="mt-2" />
            <div className="mt-4 flex gap-4 font-mono text-[11px] text-mute">
              <span><b className="text-dim">{inv.nodeCount}</b> объектов</span>
              <span><b className="text-dim">{inv.factCount}</b> фактов</span>
              <span className="ml-auto">{ago(inv.updatedAt)}</span>
            </div>
          </Link>
        ))}
      </div>

      <CreateDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const create = trpc.investigations.create.useMutation({
    onSuccess: (inv) => {
      onOpenChange(false);
      void navigate({ to: '/investigations/$id', params: { id: inv.id } });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Новое расследование" wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ title, descriptionMd: desc }); }}>
        <Field label="Название"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Описание"><MarkdownEditor value={desc} onChange={setDesc} placeholder="Цель, гипотеза, рамки…" /></Field>
        {create.error && <div className="font-mono text-xs text-danger">{errorText(create.error)}</div>}
        <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!title.trim()}>Создать</Button></div>
      </form>
    </Dialog>
  );
}
