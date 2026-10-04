import { useState } from 'react';
import clsx from 'clsx';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Hypothesis, HypothesisStatus } from '@ft/shared';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { Button, Dialog, Empty, Field, Input, Select, Tag } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';

type Inv = RouterOutputs['investigations']['get'];

const STATUS: Record<HypothesisStatus, { label: string; tone: 'dim' | 'warn' | 'mint' | 'danger' }> = {
  open: { label: 'открыта', tone: 'dim' },
  supported: { label: 'подкреплена', tone: 'warn' },
  confirmed: { label: 'подтверждена', tone: 'mint' },
  refuted: { label: 'опровергнута', tone: 'danger' },
};

/**
 * Гипотезы с доказательной базой: каждый факт расследования помечается как
 * «за» или «против» (упрощённый анализ конкурирующих гипотез, ACH).
 */
export function HypothesesPanel({ inv, editable }: { inv: Inv; editable: boolean }) {
  const utils = trpc.useUtils();
  const opts = {
    onSuccess: (next: Inv) => utils.investigations.get.setData({ id: inv.id }, next),
    onError: (e: unknown) => toast(errorText(e), 'error'),
  };
  const upsert = trpc.investigations.upsertHypothesis.useMutation(opts);
  const remove = trpc.investigations.removeHypothesis.useMutation(opts);
  const [editing, setEditing] = useState<Hypothesis | 'new' | null>(null);
  const factById = new Map(inv.facts.map((f) => [f.id, f]));

  const setStance = (h: Hypothesis, factId: string, stance: 'supports' | 'contradicts' | null) => {
    const evidence = h.evidence.filter((e) => e.factId !== factId);
    if (stance) evidence.push({ factId, stance });
    upsert.mutate({ id: inv.id, hypothesis: { ...h, evidence } });
  };

  return (
    <div className="h-full overflow-auto">
      <div className="space-y-5 py-6 pl-6 pr-[30px]">
        <div className="flex items-center justify-between">
          <p className="text-sm text-dim">Отметьте для каждого факта, подкрепляет он гипотезу или противоречит ей.</p>
          {editable && <Button variant="primary" size="sm" onClick={() => setEditing('new')}><Plus size={14} /> Гипотеза</Button>}
        </div>
        {inv.hypotheses.length === 0 && <Empty>Гипотез нет</Empty>}

        <div className="grid gap-5 lg:grid-cols-2">
          {inv.hypotheses.map((h) => {
            const pro = h.evidence.filter((e) => e.stance === 'supports').length;
            const con = h.evidence.filter((e) => e.stance === 'contradicts').length;
            const total = Math.max(1, pro + con);
            return (
              <article key={h.id} className="group animate-fade-up rounded-2xl border border-line bg-panel p-5">
                <header className="mb-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Tag tone={STATUS[h.status].tone}>{STATUS[h.status].label}</Tag>
                    <h3 className="mt-2 text-lg font-bold leading-snug">{h.title}</h3>
                  </div>
                  {editable && (
                    <span className="flex gap-2 text-mute opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => setEditing(h)} className="cursor-pointer hover:text-mint"><Pencil size={14} /></button>
                      <button onClick={() => remove.mutate({ id: inv.id, hypothesisId: h.id })} className="cursor-pointer hover:text-danger"><Trash2 size={14} /></button>
                    </span>
                  )}
                </header>
                <MarkdownView source={h.textMd} />

                <div className="my-4">
                  <div className="mb-1 flex justify-between font-mono text-[10px]">
                    <span className="text-mint">за: {pro}</span>
                    <span className="text-danger">против: {con}</span>
                  </div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div className="bg-mint" style={{ width: `${(pro / total) * 100}%` }} />
                    <div className="bg-danger" style={{ width: `${(con / total) * 100}%` }} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  {inv.facts.map((f) => {
                    const stance = h.evidence.find((e) => e.factId === f.id)?.stance ?? null;
                    if (!editable && !stance) return null;
                    return (
                      <div key={f.id} className={clsx('flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs', stance === 'supports' ? 'border-mint/30 bg-mint/5' : stance === 'contradicts' ? 'border-danger/30 bg-danger/5' : 'border-line-soft')}>
                        <span className="line-clamp-2 flex-1 text-dim">{factById.get(f.id)?.textMd}</span>
                        {editable && (
                          <span className="flex shrink-0 gap-1">
                            <button title="Подкрепляет" onClick={() => setStance(h, f.id, stance === 'supports' ? null : 'supports')} className={clsx('grid size-6 cursor-pointer place-items-center rounded border', stance === 'supports' ? 'border-mint bg-mint text-mint-ink' : 'border-line-soft text-mute hover:text-mint')}>
                              <Plus size={12} />
                            </button>
                            <button title="Противоречит" onClick={() => setStance(h, f.id, stance === 'contradicts' ? null : 'contradicts')} className={clsx('grid size-6 cursor-pointer place-items-center rounded border', stance === 'contradicts' ? 'border-danger bg-danger text-black' : 'border-line-soft text-mute hover:text-danger')}>
                              <Minus size={12} />
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} title={editing === 'new' ? 'Новая гипотеза' : 'Гипотеза'} wide>
        {editing && (
          <HypothesisForm
            key={editing === 'new' ? 'new' : editing.id}
            h={editing === 'new' ? null : editing}
            onSave={async (hypothesis) => {
              await upsert.mutateAsync({ id: inv.id, hypothesis });
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function HypothesisForm({ h, onSave }: { h: Hypothesis | null; onSave: (h: Omit<Hypothesis, 'id' | 'createdAt'> & { id?: string }) => Promise<void> }) {
  const [title, setTitle] = useState(h?.title ?? '');
  const [text, setText] = useState(h?.textMd ?? '');
  const [status, setStatus] = useState<HypothesisStatus>(h?.status ?? 'open');
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void onSave({ id: h?.id, title, textMd: text, status, evidence: h?.evidence ?? [] }); }}>
      <Field label="Формулировка"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Обоснование"><MarkdownEditor value={text} onChange={setText} /></Field>
      <Field label="Статус">
        <Select value={status} onChange={(e) => setStatus(e.target.value as HypothesisStatus)}>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </Field>
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!title.trim()}>Сохранить</Button></div>
    </form>
  );
}
