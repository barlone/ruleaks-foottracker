import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileUp, Plus, User, Users } from 'lucide-react';
import { ImportDialog } from '../../components/ImportDialog.tsx';
import { VisibilityTag } from '../../components/Sharing.tsx';
import { ViewToggle, tableCls, useListView } from '../../components/ListView.tsx';
import { TagFilter, TagList } from '../../components/Tags.tsx';
import { Button, Dialog, Empty, Field, Input, Segmented, Spinner, Tag } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { ago, fmtDate } from '../../lib/format.ts';
import { errorText } from '../../lib/errors.ts';
import { dossiersRoute } from '../../router.tsx';

export function DossiersPage() {
  const { scope = 'mine' } = dossiersRoute.useSearch();
  const navigate = useNavigate({ from: '/dossiers' });
  const [title, setTitle] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const list = trpc.dossiers.list.useQuery(
    { scope, title: title.trim() || undefined, tagIds: tagIds.length ? tagIds : undefined },
    { placeholderData: (p) => p },
  );
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useListView('dossiers');
  // Сервер отдаёт список по названию — в обоих видах порядок один.

  return (
    <div className="space-y-6 pt-2.5 pb-6 pl-6 pr-[30px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Досье</h1>
          <p className="mt-1 text-sm text-dim">Личности и группы: атрибуты, ссылки на соцсети, медиа, заметки и снимки поиска.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setImporting(true)} title="Досье или расследование из файла экспорта"><FileUp size={16} /> Импорт</Button>
          <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Новое досье</Button>
        </div>
      </header>
      <ImportDialog open={importing} onOpenChange={setImporting} />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={scope}
          onChange={(s) => void navigate({ search: { scope: s } })}
          options={[{ value: 'all', label: 'Все' }, { value: 'mine', label: 'Мои' }, { value: 'shared', label: 'Доступные мне' }]}
        />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название содержит…" className="max-w-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-dim">Теги содержат:</span>
          <TagFilter value={tagIds} onChange={setTagIds} />
        </div>
        {list.isFetching && <Spinner />}
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      {list.data?.length === 0 && <Empty>{scope === 'shared' ? 'С вами ещё ничем не поделились' : 'Досье пока нет'}</Empty>}

      {view === 'table' && !!list.data?.length && (
        <div className={tableCls.wrap}>
          <table className={tableCls.table}>
            <thead>
              <tr>
                <th className={tableCls.th}>Название</th>
                <th className={tableCls.th}>Вид</th>
                <th className={tableCls.th}>Теги</th>
                <th className={`${tableCls.th} text-right`}>Элем.</th>
                <th className={tableCls.th}>Доступ</th>
                <th className={tableCls.th}>Изменено</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id} className={tableCls.tr} onClick={() => void navigate({ to: '/dossiers/$id', params: { id: d.id } })}>
                  <td className={tableCls.td}>
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-bg-soft text-mint/40">
                        {d.coverMediaUrl ? <img src={d.coverMediaUrl} alt="" className="size-full object-cover" /> : d.kind === 'group' ? <Users size={15} /> : <User size={15} />}
                      </span>
                      <Link to="/dossiers/$id" params={{ id: d.id }} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-mint">{d.title}</Link>
                    </div>
                  </td>
                  <td className={`${tableCls.td} whitespace-nowrap font-mono text-xs text-dim`}>{d.kind === 'group' ? 'группа' : 'персона'}</td>
                  <td className={tableCls.td}><TagList tags={d.tags} /></td>
                  <td className={`${tableCls.td} text-right font-mono text-xs text-dim`}>{d.itemCount}</td>
                  <td className={tableCls.td}>
                    <span className="flex items-center gap-1.5">
                      <VisibilityTag v={d.visibility} />
                      {d.role !== 'owner' && <Tag>{d.role === 'editor' ? 'правка' : 'чтение'}</Tag>}
                    </span>
                  </td>
                  <td className={`${tableCls.td} whitespace-nowrap font-mono text-xs text-mute`} title={fmtDate(d.updatedAt, true)}>{ago(d.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'grid' && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {list.data?.map((d, i) => (
          <Link
            key={d.id}
            to="/dossiers/$id"
            params={{ id: d.id }}
            className="group animate-fade-up overflow-hidden rounded-2xl border border-line bg-panel transition hover:-translate-y-0.5 hover:border-mint/50 hover:shadow-glow-sm"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="relative aspect-[4/3] bg-bg-soft">
              {d.coverMediaUrl ? (
                <img src={d.coverMediaUrl} alt="" className="size-full object-cover opacity-90 transition group-hover:opacity-100" />
              ) : (
                <div className="grid size-full place-items-center text-mint/30">
                  {d.kind === 'group' ? <Users size={56} /> : <User size={56} />}
                </div>
              )}
              <div className="absolute left-3 top-3 flex gap-1.5">
                <Tag tone="dim" className="bg-black/70">{d.kind === 'group' ? 'группа' : 'персона'}</Tag>
                {d.role !== 'owner' && <Tag className="bg-black/70">{d.role === 'editor' ? 'правка' : 'чтение'}</Tag>}
              </div>
            </div>
            <div className="space-y-2 p-4">
              <div className="font-bold leading-snug group-hover:text-mint">{d.title}</div>
              <TagList tags={d.tags} />
              <div className="flex items-center justify-between font-mono text-[11px] text-mute">
                <span>{d.itemCount} элем. · {ago(d.updatedAt)}</span>
                <VisibilityTag v={d.visibility} />
              </div>
            </div>
          </Link>
        ))}
      </div>
      )}

      <CreateDossierDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function CreateDossierDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<'person' | 'group'>('person');
  const [title, setTitle] = useState('');
  const create = trpc.dossiers.create.useMutation({
    onSuccess: (d) => {
      onOpenChange(false);
      void navigate({ to: '/dossiers/$id', params: { id: d.id } });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Новое досье">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ kind, title, summaryMd: '' });
        }}
      >
        <Segmented value={kind} onChange={setKind} options={[{ value: 'person', label: 'Персона' }, { value: 'group', label: 'Группа лиц' }]} />
        <Field label="Название">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'person' ? 'Фамилия Имя Отчество' : 'Название группы'} />
        </Field>
        {create.error && <div className="font-mono text-xs text-danger">{errorText(create.error)}</div>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!title.trim() || create.isPending}>Создать</Button>
        </div>
      </form>
    </Dialog>
  );
}
