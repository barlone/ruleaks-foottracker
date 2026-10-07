import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileUp, Network, Plus } from 'lucide-react';
import { ImportDialog } from '../../components/ImportDialog.tsx';
import { VisibilityTag } from '../../components/Sharing.tsx';
import { ViewToggle, tableCls, useListView } from '../../components/ListView.tsx';
import { TagFilter, TagList } from '../../components/Tags.tsx';
import { Button, Dialog, Empty, Field, Input, Segmented, Spinner, Tag } from '../../components/ui.tsx';
import { MarkdownEditor } from '../../components/Markdown.tsx';
import { trpc } from '../../lib/trpc.ts';
import { ago, fmtDate } from '../../lib/format.ts';
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
  const [importing, setImporting] = useState(false);
  const [view, setView] = useListView('investigations');
  // Сервер отдаёт список по названию — в обоих видах порядок один.

  return (
    <div className="space-y-6 py-6 pl-6 pr-[30px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Расследования</h1>
          <p className="mt-1 text-sm text-dim">Граф связей между персонами, организациями и событиями, база фактов и проверка гипотез.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setImporting(true)} title="Расследование или досье из файла экспорта"><FileUp size={16} /> Импорт</Button>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Новое расследование</Button>
        </div>
      </header>
      <ImportDialog open={importing} onOpenChange={setImporting} />

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
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      {list.data?.length === 0 && <Empty>Нет расследований</Empty>}

      {view === 'table' && !!list.data?.length && (
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr>
                <th className={tableCls.th}>Название</th>
                <th className={tableCls.th}>Теги</th>
                <th className={`${tableCls.th} text-right`}>Объектов</th>
                <th className={`${tableCls.th} text-right`}>Фактов</th>
                <th className={tableCls.th}>Доступ</th>
                <th className={tableCls.th}>Изменено</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((inv) => (
                <tr key={inv.id} className={tableCls.tr} onClick={() => void navigate({ to: '/investigations/$id', params: { id: inv.id } })}>
                  <td className={tableCls.td}>
                    <div className="flex items-center gap-2.5">
                      <Network size={16} className="shrink-0 text-mint" />
                      <Link to="/investigations/$id" params={{ id: inv.id }} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-mint">{inv.title}</Link>
                    </div>
                  </td>
                  <td className={tableCls.td}><TagList tags={inv.tags} /></td>
                  <td className={`${tableCls.td} text-right font-mono text-xs text-dim`}>{inv.nodeCount}</td>
                  <td className={`${tableCls.td} text-right font-mono text-xs text-dim`}>{inv.factCount}</td>
                  <td className={tableCls.td}>
                    <span className="flex items-center gap-1.5">
                      <VisibilityTag v={inv.visibility} />
                      {inv.role !== 'owner' && <Tag>{inv.role === 'editor' ? 'правка' : 'чтение'}</Tag>}
                    </span>
                  </td>
                  <td className={`${tableCls.td} whitespace-nowrap font-mono text-xs text-mute`} title={fmtDate(inv.updatedAt, true)}>{ago(inv.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'grid' && (
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
      )}

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
