import { useState } from 'react';
import clsx from 'clsx';
import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { hypothesisScore, newId, type Hypothesis, type HypothesisStatus } from '@ft/shared';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { Button, ConfirmDeleteBtn, DELETE_GAP, Dialog, Empty, Field, Input, Select, Tag } from '../../components/ui.tsx';
import { trpc, type RouterInputs, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { fmtDate } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';
import { t } from '../../lib/i18n.ts';

type Inv = RouterOutputs['investigations']['get'];
type Stance = 'supports' | 'contradicts';
type HypothesisInput = RouterInputs['investigations']['upsertHypothesis']['hypothesis'];

const STATUS: Record<HypothesisStatus, { label: string; tone: 'dim' | 'warn' | 'mint' | 'danger' }> = {
  open: { label: 'открыта', tone: 'dim' },
  supported: { label: 'подкреплена', tone: 'warn' },
  confirmed: { label: 'подтверждена', tone: 'mint' },
  refuted: { label: 'опровергнута', tone: 'danger' },
};

/** Два столбца доводов: слева «за», справа «против». */
const SIDES: { stance: Stance; title: string; tone: string; border: string }[] = [
  { stance: 'supports', title: 'За', tone: 'text-mint', border: 'border-mint/30' },
  { stance: 'contradicts', title: 'Против', tone: 'text-danger', border: 'border-danger/30' },
];

/**
 * Гипотезы с доказательной базой (упрощённый анализ конкурирующих гипотез, ACH). У гипотезы два списка доводов —
 * «за» и «против» (записи с текстом, как заметки досье); кроме того, каждый факт расследования можно отметить как
 * подкрепляющий или противоречащий. Счётчики считают и то и другое (hypothesisScore).
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

  const setStance = (h: Hypothesis, factId: string, stance: Stance | null) => {
    const evidence = h.evidence.filter((e) => e.factId !== factId);
    if (stance) evidence.push({ factId, stance });
    upsert.mutate({ id: inv.id, hypothesis: { ...h, evidence } });
  };

  return (
    <div className="h-full overflow-auto">
      <div className="space-y-[1rem] py-[1.2rem] pl-6 pr-[30px]">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-dim">{t('У гипотезы два списка доводов — «за» и «против». Факты расследования тоже можно отметить как подкрепляющие или противоречащие.')}</p>
          {editable && <Button variant="primary" size="sm" className="shrink-0" onClick={() => setEditing('new')}><Plus size={14} /> {t('Гипотеза')}</Button>}
        </div>
        {inv.hypotheses.length === 0 && <Empty>{t('Гипотез нет')}</Empty>}

        <div className="grid gap-[1rem] lg:grid-cols-2">
          {inv.hypotheses.map((h) => {
            const { pro, con } = hypothesisScore(h);
            const total = Math.max(1, pro + con);
            return (
              <article key={h.id} className="group animate-fade-up rounded-2xl border border-line bg-panel p-4">
                <header className="mb-[0.6rem] flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Tag tone={STATUS[h.status].tone}>{t(STATUS[h.status].label)}</Tag>
                    <h3 className="mt-2 text-lg font-bold leading-snug">{h.title}</h3>
                  </div>
                  {editable && (
                    <span className="flex gap-2 text-mute opacity-0 transition group-hover:opacity-100">
                      <button onClick={() => setEditing(h)} title={t('Править')} className="cursor-pointer hover:text-mint"><Pencil size={14} /></button>
                      <button onClick={() => remove.mutate({ id: inv.id, hypothesisId: h.id })} title={t('Удалить')} className={`${DELETE_GAP} cursor-pointer hover:text-danger`}><Trash2 size={14} /></button>
                    </span>
                  )}
                </header>
                {h.textMd.trim() && <MarkdownView source={h.textMd} />}

                <div className="my-4">
                  <div className="mb-1 flex justify-between font-mono text-[10px]">
                    <span className="text-mint">{t('за: {n}', { n: pro })}</span>
                    <span className="text-danger">{t('против: {n}', { n: con })}</span>
                  </div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-text/5">
                    <div className="bg-mint" style={{ width: `${(pro / total) * 100}%` }} />
                    <div className="bg-danger" style={{ width: `${(con / total) * 100}%` }} />
                  </div>
                </div>

                {/* Доводы: слева «за», справа «против». Правятся в окне гипотезы. */}
                {h.args.length > 0 && (
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    {SIDES.map((side) => (
                      <div key={side.stance} className="min-w-0 space-y-1.5">
                        {h.args.filter((a) => a.stance === side.stance).map((a) => (
                          <div key={a.id} className={clsx('rounded-lg border px-2.5 py-2 text-xs', side.border)}>
                            <MarkdownView source={a.textMd} />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  {inv.facts.map((f) => {
                    const stance = h.evidence.find((e) => e.factId === f.id)?.stance ?? null;
                    if (!editable && !stance) return null;
                    return (
                      <div key={f.id} className={clsx('flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs', stance === 'supports' ? 'border-mint/30 bg-mint/5' : stance === 'contradicts' ? 'border-danger/30 bg-danger/5' : 'border-line-soft')}>
                        <span className="line-clamp-2 flex-1 text-dim">{factById.get(f.id)?.textMd}</span>
                        {editable && (
                          <span className="flex shrink-0 gap-1">
                            <button title={t('Подкрепляет')} onClick={() => setStance(h, f.id, stance === 'supports' ? null : 'supports')} className={clsx('grid size-6 cursor-pointer place-items-center rounded border', stance === 'supports' ? 'border-mint bg-mint text-mint-ink' : 'border-line-soft text-mute hover:text-mint')}>
                              <Plus size={12} />
                            </button>
                            <button title={t('Противоречит')} onClick={() => setStance(h, f.id, stance === 'contradicts' ? null : 'contradicts')} className={clsx('grid size-6 cursor-pointer place-items-center rounded border', stance === 'contradicts' ? 'border-danger bg-danger text-bg' : 'border-line-soft text-mute hover:text-danger')}>
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

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} title={editing === 'new' ? t('Новая гипотеза') : t('Гипотеза')} width="max-w-[80vw]">
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

/** Довод в окне гипотезы: key — местный (новый довод ещё без id сервера), text пуст — довод при сохранении отбрасывается. */
interface Draft { key: string; id?: string; stance: Stance; text: string; createdAt?: string }

function HypothesisForm({ h, onSave }: { h: Hypothesis | null; onSave: (h: HypothesisInput) => Promise<void> }) {
  const [title, setTitle] = useState(h?.title ?? '');
  const [text, setText] = useState(h?.textMd ?? '');
  const [status, setStatus] = useState<HypothesisStatus>(h?.status ?? 'open');
  const [args, setArgs] = useState<Draft[]>(() => (h?.args ?? []).map((a) => ({ key: a.id, id: a.id, stance: a.stance, text: a.textMd, createdAt: a.createdAt })));
  // Какой довод сейчас правится (редактор один на окно — так список остаётся обозримым).
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (stance: Stance) => {
    const key = newId();
    setArgs((list) => [...list.filter((a) => a.text.trim() || a.key === open), { key, stance, text: '' }]);
    setOpen(key);
  };
  const patch = (key: string, value: string) => setArgs((list) => list.map((a) => (a.key === key ? { ...a, text: value } : a)));

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: h?.id, title, textMd: text, status, evidence: h?.evidence ?? [],
        args: args.filter((a) => a.text.trim()).map((a) => ({ id: a.id, stance: a.stance, textMd: a.text.trim() })),
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
        <Field label={t('Формулировка')}><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={t('Статус')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as HypothesisStatus)} className="w-full">
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SIDES.map((side) => {
          const list = args.filter((a) => a.stance === side.stance);
          return (
            <section key={side.stance} className={clsx('min-w-0 rounded-xl border p-3', side.border)}>
              <div className="mb-2 flex items-center justify-between">
                <span className={clsx('font-mono text-[11px] uppercase tracking-widest', side.tone)}>
                  {t(side.title)} <span className="text-mute">{list.filter((a) => a.text.trim()).length}</span>
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => add(side.stance)}><Plus size={13} /> {t('Довод')}</Button>
              </div>
              {list.length === 0 && <div className="py-4 text-center font-mono text-xs text-mute">{t('Доводов нет')}</div>}
              <div className="space-y-2">
                {list.map((a) => (
                  <article key={a.key} className="group rounded-xl border border-line-soft p-[0.6rem]">
                    <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[11px] text-mute">
                      <span>{a.createdAt ? fmtDate(a.createdAt, true) : t('новый довод')}</span>
                      <span className="flex items-center gap-1">
                        {open !== a.key && (
                          <button type="button" onClick={() => setOpen(a.key)} title={t('Править')} className="cursor-pointer opacity-0 transition hover:text-mint group-hover:opacity-100"><Pencil size={13} /></button>
                        )}
                        <ConfirmDeleteBtn onConfirm={() => { setArgs((l) => l.filter((x) => x.key !== a.key)); if (open === a.key) setOpen(null); }} />
                      </span>
                    </div>
                    {open === a.key ? (
                      <div className="space-y-2">
                        <MarkdownEditor value={a.text} onChange={(v) => patch(a.key, v)} autoFocus placeholder={t('Текст довода…')} />
                        <div className="flex justify-end">
                          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(null)}>{t('Готово')}</Button>
                        </div>
                      </div>
                    ) : (
                      <MarkdownView source={a.text} className="text-sm" />
                    )}
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Общее обоснование осталось от прежнего редактора: показываем, только если оно уже написано. */}
      {h?.textMd.trim() && <Field label={t('Общее обоснование')}><MarkdownEditor value={text} onChange={setText} /></Field>}

      {error && <div className="font-mono text-xs text-danger">{error}</div>}
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!title.trim() || saving}>{t('Сохранить')}</Button></div>
    </form>
  );
}
