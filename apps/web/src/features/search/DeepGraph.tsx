import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, Panel, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { LayoutGrid, Move, Trash2, X } from 'lucide-react';
import { LEAK_FIELDS, attrCopyValue, type DeepRow, type LeakField } from '@ft/shared';
import { ConfirmDeleteBtn, CopyButton } from '../../components/ui.tsx';
import { useStore } from '../../lib/store.ts';
import { theme } from '../../lib/theme.ts';
import { t } from '../../lib/i18n.ts';
import { CARD_W, COLLAPSED_ROWS, COLLAPSE_FROM, buildDeepGraph, layoutDeepGraph, tupleOf, withDescendants, type GraphCard } from './deepGraph.ts';

// Сохранённый результат глубокого поиска в виде графа — как /graph-view/ старого веб-интерфейса: карточки значений,
// найденных через одно значение, и линии от строки-родителя к её карточке. Внутри карточки значения сгруппированы
// по записям утечек (tuple_id), между записями — черта с номером. Карточки перетаскиваются за шапку,
// длинные сворачиваются, значения и целые карточки удаляются из сохранённых данных. Расстановка не сохраняется.

type CardNode = Node<{ card: GraphCard }, 'card'>;

interface GraphCtx {
  /** Все строки ответа — чтобы удалить карточку вместе со всем, что найдено через её значения. */
  all: readonly DeepRow[];
  links: Set<number>;
  /** Кнопки удаления показаны (переключатель в углу). */
  deleting: boolean;
  onRemove?: (rows: DeepRow[]) => void;
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
}
const Ctx = createContext<GraphCtx>({ all: [], links: new Set(), deleting: false, collapsed: new Set(), toggleCollapsed: () => {} });

const label = (prm: string) => t(LEAK_FIELDS[prm as LeakField] ?? prm);
const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);

/** Точка связи: линии только показывают связи, соединять мышью нечего. */
const dot = '!size-2 !min-h-0 !min-w-0 !border-0 !bg-mint';

function CardView({ data }: NodeProps<CardNode>) {
  const { card } = data;
  const g = useContext(Ctx);
  // Удаление карточки — вторым щелчком: вместе с ней уходит всё, что найдено через её значения.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (card.root) {
    const r = card.rows[0]!;
    return (
      <div
        className={clsx('ft-card-drag cursor-move rounded-xl border border-mint bg-panel px-4 py-3 text-center shadow-glow-sm', r.removed && 'opacity-60')}
        style={{ width: CARD_W }}
      >
        <div className="font-mono text-[11px] uppercase tracking-wide text-mint">{label(r.prm)}:</div>
        <div className={clsx('mt-1 break-words font-mono text-base font-bold', r.removed && 'line-through')}>{r.val}</div>
        <Handle type="source" position={Position.Right} id={`r${r.val_id}`} isConnectable={false} className={dot} />
      </div>
    );
  }

  const canDelete = g.deleting && !!g.onRemove;
  const branch = withDescendants(g.all, card.rows).filter((r) => !r.removed);
  const long = card.rows.length > COLLAPSE_FROM;
  const folded = long && g.collapsed.has(card.id);
  // В свёрнутой карточке остаются первые строки и все строки со связями — линии не теряют начало.
  const shown = folded ? card.rows.filter((r, i) => i < COLLAPSED_ROWS || g.links.has(r.val_id)) : card.rows;
  // Номера записей утечек в карточке — по порядку появления (сам tuple_id — внутренний номер базы).
  const tupleNo = new Map<number, number>();
  for (const r of card.rows) if (!tupleNo.has(tupleOf(r))) tupleNo.set(tupleOf(r), tupleNo.size + 1);

  return (
    <div className="rounded-xl border border-warn/60 bg-panel shadow-glow-sm" style={{ width: CARD_W }}>
      <Handle type="target" position={Position.Left} id="in" isConnectable={false} className={dot} style={{ top: 15 }} />
      <div className="ft-card-drag flex h-[30px] cursor-move items-center justify-between rounded-t-xl bg-mint/15 px-2.5 text-mint" title={t('Перетащить карточку')}>
        <Move size={12} />
        {canDelete && branch.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (!armed) return setArmed(true);
              g.onRemove!(branch);
            }}
            title={t('Удалить карточку и всё, что найдено через её значения')}
            className={clsx(
              'nodrag flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-mono text-[10px] transition',
              armed ? 'bg-danger/20 text-danger' : 'text-mute hover:text-danger',
            )}
          >
            {armed && t('удалить значений: {n}?', { n: branch.length })} <X size={13} />
          </button>
        )}
      </div>
      <div className="space-y-0.5 p-1.5">
        {shown.map((r, i) => {
          const linked = g.links.has(r.val_id);
          // Первое значение записи утечки — перед ним черта с её номером (если записей в карточке несколько).
          const head = card.tuples > 1 && (i === 0 || tupleOf(shown[i - 1]!) !== tupleOf(r));
          return (
            <Fragment key={r.val_id}>
            {head && (
              <div
                className={clsx('flex items-center gap-2 px-1.5 pb-0.5 font-mono text-[9px] uppercase tracking-wide text-warn/80', i > 0 && 'mt-1 border-t border-dashed border-warn/40 pt-1.5')}
                title={t('Значения ниже — из одной записи утечки (tuple {id})', { id: tupleOf(r) })}
              >
                {tupleOf(r) ? t('запись {n} из {total}', { n: tupleNo.get(tupleOf(r))!, total: card.tuples }) : t('запись не указана')}
              </div>
            )}
            <div className={clsx('relative flex items-start gap-2 rounded-md px-1.5 py-1', linked && 'bg-mint/10', r.removed && 'opacity-50')}>
              <span className="w-[4.75rem] shrink-0 break-words pt-px font-mono text-[10px] uppercase tracking-wide text-mute">{label(r.prm)}:</span>
              <span className={clsx('nodrag nopan min-w-0 flex-1 cursor-text select-text break-words font-mono text-xs', linked && 'font-bold', r.removed && 'line-through')}>
                {isUrl(r.val) ? <a href={r.val} target="_blank" rel="noopener noreferrer" className="text-mint hover:underline">{r.val}</a> : r.val}
              </span>
              <CopyButton value={attrCopyValue(r.prm, r.val)} title={t('Скопировать: {label}', { label: label(r.prm) })} className="mt-0.5 [&>svg]:size-3" />
              {/* Удаление в два нажатия, как у атрибутов досье. */}
              {canDelete && !r.removed && (
                <ConfirmDeleteBtn onConfirm={() => g.onRemove!([r])} title={t('Удалить значение из сохранённых данных')} className="mt-0.5 !ml-0 !opacity-100" />
              )}
              {linked && <Handle type="source" position={Position.Right} id={`r${r.val_id}`} isConnectable={false} className={dot} style={{ right: -10 }} />}
            </div>
            </Fragment>
          );
        })}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => g.toggleCollapsed(card.id)}
          className="block w-full cursor-pointer rounded-b-xl border-t border-line-soft py-1 font-mono text-[10px] text-mute transition hover:bg-mint/10 hover:text-mint"
        >
          {folded ? t('Показать все ({n})', { n: card.rows.length }) : t('Свернуть')}
        </button>
      )}
    </div>
  );
}

const nodeTypes = { card: CardView };

/** Узлы из карточек: уже расставленные (и передвинутые мышью) остаются на местах. */
function toNodes(cards: readonly GraphCard[], prev: readonly CardNode[]): CardNode[] {
  const old = new Map(prev.map((n) => [n.id, n] as const));
  const pos = cards.some((c) => !old.has(c.id)) ? layoutDeepGraph(cards) : null;
  return cards.map((card) => {
    const was = old.get(card.id);
    return was
      ? { ...was, data: { card } }
      : { id: card.id, type: 'card' as const, position: pos!.get(card.id) ?? { x: 0, y: 0 }, data: { card }, dragHandle: '.ft-card-drag' };
  });
}

export function DeepGraph(props: { rows: readonly DeepRow[]; onRemove?: (rows: DeepRow[]) => void; className?: string }) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}

function Graph({ rows, onRemove, className }: Parameters<typeof DeepGraph>[0]) {
  const model = useMemo(() => buildDeepGraph(rows), [rows]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(useState(() => toNodes(model.cards, []))[0]);
  useEffect(() => {
    setNodes((prev) => toNodes(model.cards, prev));
  }, [model, setNodes]);
  const edges = useMemo<Edge[]>(
    () => model.cards.filter((c) => c.parentCard).map((c) => ({
      id: `e:${c.id}`, source: c.parentCard!, sourceHandle: `r${c.parentRow}`, target: c.id, targetHandle: 'in', focusable: false, selectable: false,
    })),
    [model],
  );
  const [deleting, setDeleting] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ctx = useMemo<GraphCtx>(() => ({
    all: rows,
    links: model.links,
    deleting,
    onRemove,
    collapsed,
    toggleCollapsed: (id) => setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    }),
  }), [rows, model, deleting, onRemove, collapsed]);
  const rf = useReactFlow();
  const colorMode = useStore(theme);

  // Первый показ графа — весь в окне. Свойство fitView срабатывает до того, как карточки измерены (их высота
  // зависит от текста), поэтому подгоняем сами, когда React Flow узнал настоящие размеры.
  const measured = useNodesInitialized();
  const fitted = useRef(false);
  useEffect(() => {
    if (!measured || fitted.current || !nodes.length) return;
    fitted.current = true;
    void rf.fitView({ padding: 0.15, maxZoom: 1 });
  }, [measured, nodes.length, rf]);

  function relayout() {
    const pos = layoutDeepGraph(model.cards);
    setCollapsed(new Set());
    setNodes((prev) => prev.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    setTimeout(() => void rf.fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), 50);
  }

  const panel = 'flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-panel/90 px-3 font-mono text-xs text-dim backdrop-blur transition hover:bg-mint/10 hover:text-text';
  return (
    <div className={clsx('isolate overflow-hidden rounded-2xl border border-warn/70', className)}>
      <Ctx.Provider value={ctx}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
          colorMode={colorMode}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--ft-mint-rgb) / .18)" />
          <Controls showInteractive={false} position="bottom-left" />
          <Panel position="top-left">
            <button type="button" onClick={relayout} className={panel} title={t('Вернуть карточки на места и развернуть свёрнутые')}>
              <LayoutGrid size={14} /> {t('Расставить заново')}
            </button>
          </Panel>
          {onRemove && (
            <Panel position="top-right">
              <label className={panel} title={t('Показывать кнопки удаления значений и карточек')}>
                <input type="checkbox" checked={deleting} onChange={(e) => setDeleting(e.target.checked)} className="accent-[var(--color-mint)]" />
                <Trash2 size={13} className="text-danger" /> {t('Удаление')}
              </label>
            </Panel>
          )}
          {!model.cards.length && <Panel position="top-center"><span className="font-mono text-xs text-mute">{t('Ничего не найдено')}</span></Panel>}
        </ReactFlow>
      </Ctx.Provider>
    </div>
  );
}
