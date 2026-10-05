import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Fact } from '@ft/shared';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { SourceBadge } from '../../components/SourceBadge.tsx';
import { SourceFields, emptySource, finishSource, type SourceDraft } from '../../components/SourceFields.tsx';
import { Button, Dialog, Empty, Field, Input } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { fmtDate } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';
import { NODE_STYLE } from './nodeStyle.ts';

type Inv = RouterOutputs['investigations']['get'];

/** Факты — хронология: каждый с источниками, оценкой и привязкой к объектам графа. */
export function FactsPanel({ inv, editable }: { inv: Inv; editable: boolean }) {
  const utils = trpc.useUtils();
  const opts = {
    onSuccess: (next: Inv) => utils.investigations.get.setData({ id: inv.id }, next),
    onError: (e: unknown) => toast(errorText(e), 'error'),
  };
  const upsert = trpc.investigations.upsertFact.useMutation(opts);
  const remove = trpc.investigations.removeFact.useMutation(opts);
  const [editing, setEditing] = useState<Fact | 'new' | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const facts = useMemo(
    () =>
      [...inv.facts]
        .filter((f) => !filter || f.nodeIds.includes(filter))
        .sort((a, b) => (a.occurredAt ?? '9999').localeCompare(b.occurredAt ?? '9999')),
    [inv.facts, filter],
  );
  const nodeById = new Map(inv.nodes.map((n) => [n.id, n]));

  return (
    <div className="h-full overflow-auto">
      <div className="space-y-[1rem] py-[1.2rem] pl-6 pr-[30px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-mute">Объект:</span>
          <button onClick={() => setFilter(null)} className={`cursor-pointer rounded-md px-2 py-1 font-mono text-xs ${!filter ? 'bg-mint/15 text-mint' : 'text-dim hover:text-mint'}`}>все</button>
          {inv.nodes.map((n) => (
            <button key={n.id} onClick={() => setFilter(n.id)} className={`cursor-pointer rounded-md px-2 py-1 font-mono text-xs ${filter === n.id ? 'bg-mint/15 text-mint' : 'text-dim hover:text-mint'}`}>
              {n.label}
            </button>
          ))}
          {editable && <Button variant="primary" size="sm" className="ml-auto" onClick={() => setEditing('new')}><Plus size={14} /> Факт</Button>}
        </div>

        {facts.length === 0 && <Empty>Фактов нет</Empty>}

        <ol className="relative space-y-[0.8rem] border-l border-line pl-6">
          {facts.map((f) => (
            <li key={f.id} className="relative animate-fade-up">
              <span className="absolute -left-[29px] top-[0.8rem] size-2.5 rounded-full bg-mint shadow-[0_0_10px_var(--color-mint)]" />
              <article className="group rounded-xl border border-line-soft bg-panel p-[0.8rem] transition hover:border-line">
                <div className="mb-2 flex items-center gap-2 font-mono text-[11px] text-mute">
                  <CalendarDays size={12} /> {f.occurredAt ? fmtDate(f.occurredAt) : 'дата неизвестна'}
                  <span className="ml-auto flex gap-1.5">{f.sources.map((s, i) => <SourceBadge key={i} source={s} />)}</span>
                  {editable && (
                    <span className="flex gap-1.5 opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => setEditing(f)} className="cursor-pointer hover:text-mint"><Pencil size={13} /></button>
                      <button onClick={() => remove.mutate({ id: inv.id, factId: f.id })} className="cursor-pointer hover:text-danger"><Trash2 size={13} /></button>
                    </span>
                  )}
                </div>
                <MarkdownView source={f.textMd} />
                {f.nodeIds.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {f.nodeIds.map((nid) => {
                      const n = nodeById.get(nid);
                      if (!n) return null;
                      const { icon: Icon, color } = NODE_STYLE[n.type];
                      return (
                        <Link key={nid} to="/investigations/$id" params={{ id: inv.id }} search={{ tab: 'graph', focus: nid }} className="inline-flex items-center gap-1 rounded-md border border-line-soft px-1.5 py-0.5 text-xs text-dim hover:border-line hover:text-text">
                          <Icon size={11} style={{ color }} /> {n.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </article>
            </li>
          ))}
        </ol>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} title={editing === 'new' ? 'Новый факт' : 'Факт'} wide>
        {editing && (
          <FactForm
            key={editing === 'new' ? 'new' : editing.id}
            fact={editing === 'new' ? null : editing}
            nodes={inv.nodes}
            onSave={async (fact) => {
              await upsert.mutateAsync({ id: inv.id, fact });
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function FactForm({
  fact, nodes, onSave,
}: {
  fact: Fact | null;
  nodes: Inv['nodes'];
  onSave: (f: { id?: string; textMd: string; occurredAt: string | null; sources: Fact['sources']; nodeIds: string[] }) => Promise<void>;
}) {
  const [text, setText] = useState(fact?.textMd ?? '');
  const [date, setDate] = useState(fact?.occurredAt?.slice(0, 10) ?? '');
  const [nodeIds, setNodeIds] = useState<string[]>(fact?.nodeIds ?? []);
  const [source, setSource] = useState<SourceDraft>(fact?.sources[0] ?? emptySource());

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          id: fact?.id,
          textMd: text,
          occurredAt: date ? new Date(date).toISOString() : null,
          sources: [fact?.sources[0] && source === fact.sources[0] ? fact.sources[0] : finishSource(source), ...(fact?.sources.slice(1) ?? [])],
          nodeIds,
        });
      }}
    >
      <MarkdownEditor value={text} onChange={setText} autoFocus placeholder="Что установлено. Одно утверждение — один факт." />
      <Field label="Дата события"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" /></Field>
      <Field label="Объекты графа">
        <div className="flex flex-wrap gap-1.5">
          {nodes.map((n) => {
            const on = nodeIds.includes(n.id);
            return (
              <button
                type="button"
                key={n.id}
                onClick={() => setNodeIds(on ? nodeIds.filter((x) => x !== n.id) : [...nodeIds, n.id])}
                className={`cursor-pointer rounded-md border px-2 py-1 text-xs ${on ? 'border-mint bg-mint/15 text-mint' : 'border-line-soft text-dim hover:border-line'}`}
              >
                {n.label}
              </button>
            );
          })}
        </div>
      </Field>
      <SourceFields value={source} onChange={setSource} />
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!text.trim()}>Сохранить</Button></div>
    </form>
  );
}
