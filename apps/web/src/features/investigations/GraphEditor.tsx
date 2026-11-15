import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider,
  ConnectionMode, SelectionMode, addEdge, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps, type OnBeforeDelete,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { ArrowLeft, Expand, FolderOpen, ImageOff, ImagePlus, LayoutGrid, LogIn, Maximize, MoreHorizontal, Network, Plus, SquareDashedMousePointer, Trash2, X } from 'lucide-react';
import {
  CREDIBILITY_LABELS, NODE_DOSSIER_KIND, NODE_TYPE_LABELS, newId, type Fact, type GraphEdge, type GraphNode, type NodeType,
} from '@ft/shared';
import { Button, Field, Input, Select, Spinner, Tag, Textarea } from '../../components/ui.tsx';
import { SquareCropDialog } from '../../components/SquareCropDialog.tsx';
import { centerSquare, isSquare, loadImage } from '../../lib/squareImage.ts';
import { MarkdownView } from '../../components/Markdown.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorCode, errorText } from '../../lib/errors.ts';
import { useStore } from '../../lib/store.ts';
import { theme } from '../../lib/theme.ts';
import { toast } from '../../lib/toast.ts';
import { t, tc, tn } from '../../lib/i18n.ts';
import { NODE_STYLE, RELATIONS, edgeStyle, withAlpha } from './nodeStyle.ts';

// Визуальный редактор связей. Состояние графа живёт локально (React Flow),
// на сервер уходит целиком с задержкой (автосохранение) и версией для
// оптимистичной блокировки. Персона ссылается на досье — двойной клик открывает его.
//
// Два уровня: у узла верхнего уровня может быть внутренний граф (узлы с parentId = его id). В состоянии лежат все
// узлы и связи сразу; показан один уровень — остальные помечены hidden (React Flow их не рисует и не учитывает в
// fitView). Сохраняется по-прежнему весь граф целиком.

type EntityData = { label: string; type: NodeType; dossierId: string | null; parentId: string | null; props: Record<string, string>; factCount: number };
type EntityNode = Node<EntityData, 'entity'>;
type RelEdge = Edge<{ relation: string; credibility: GraphEdge['credibility']; factIds: string[]; note?: string }>;

/**
 * Подпись связи в графе: тип и первые три слова пояснения, дальше многоточие. Целиком — во всплывающем окне.
 * Тип по умолчанию «связь» при пояснении опускается: он ничего не добавляет.
 */
function edgeLabel(relation: string, note?: string): string {
  const isDefault = isDefaultRelation(relation);
  if (!note?.trim()) return isDefault ? t('связь') : relation;
  const words = note.trim().split(/\s+/);
  const short = `${words.slice(0, 3).join(' ')}${words.length > 3 ? '…' : ''}`;
  return isDefault ? short : `${relation} · ${short}`;
}

/**
 * Тип связи по умолчанию: новая связь получает его на языке интерфейса, в старых данных он по-русски —
 * узнаём оба.
 */
/** Название узла: оставленное по умолчанию русское название типа («Персона») показывается на языке интерфейса. */
function shownLabel(label: string): string {
  return (Object.values(NODE_TYPE_LABELS) as string[]).includes(label) ? t(label) : label;
}

function isDefaultRelation(relation: string): boolean {
  const r = relation.trim().toLowerCase();
  // i18n-ignore: сравнение с сохранённым значением
  return r === 'связь' || r === t('связь').toLowerCase();
}

/** level — id узла, внутри которого сейчас находимся; null — верхний уровень. */
const toFlowNodes = (nodes: GraphNode[], facts: Fact[], level: string | null): EntityNode[] =>
  nodes.map((n) => ({
    id: n.id,
    type: 'entity',
    position: n.position,
    hidden: (n.parentId ?? null) !== level,
    data: { label: n.label, type: n.type, dossierId: n.dossierId, parentId: n.parentId ?? null, props: n.props, factCount: facts.filter((f) => f.nodeIds.includes(n.id)).length },
  }));

/** Связь лежит на уровне своих узлов. */
const toFlowEdges = (edges: GraphEdge[], nodes: GraphNode[], level: string | null): RelEdge[] => {
  const parent = new Map(nodes.map((n) => [n.id, n.parentId ?? null]));
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    // Точки соединения: у боковой связи — левая/правая, у обычной — нижняя у источника и верхняя у цели.
    sourceHandle: e.sourceSide && e.targetSide ? e.sourceSide : 'bottom',
    targetHandle: e.sourceSide && e.targetSide ? e.targetSide : 'top',
    hidden: parent.get(e.source) !== level,
    label: edgeLabel(e.relation, e.label),
    data: { relation: e.relation, credibility: e.credibility, factIds: e.factIds, note: e.label },
    style: edgeStyle(e.credibility),
    ...edgeMarkers(e.credibility, !!(e.sourceSide && e.targetSide)),
  }));
};

/**
 * Стрелки связи: у обычной — одна, к цели; у боковой (горизонтальной) — на обоих концах: такая связь взаимная,
 * у неё нет «откуда» и «куда».
 */
function edgeMarkers(credibility: string, side: boolean) {
  const marker = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: edgeStyle(credibility).stroke };
  return { markerEnd: marker, markerStart: side ? marker : undefined };
}

/** Боковая точка блока (id точки соединения). */
const isSide = (h: string | null | undefined): h is 'left' | 'right' => h === 'left' || h === 'right';

/**
 * Какие точки можно соединить: боковую — только с боковой (горизонтальная связь), нижнюю — только с верхней
 * (обычная связь; тянуть можно и от верхней к нижней). Бок с верхом или низом не соединяется.
 */
function validConnection(c: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null }): boolean {
  if (!c.source || !c.target || c.source === c.target) return false;
  if (isSide(c.sourceHandle) || isSide(c.targetHandle)) return isSide(c.sourceHandle) && isSide(c.targetHandle);
  return (c.sourceHandle === 'bottom' && c.targetHandle === 'top') || (c.sourceHandle === 'top' && c.targetHandle === 'bottom');
}

const fromFlow = (nodes: EntityNode[], edges: RelEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } => ({
  nodes: nodes.map((n) => ({
    id: n.id, type: n.data.type, label: n.data.label, dossierId: n.data.dossierId, parentId: n.data.parentId, props: n.data.props,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
  })),
  edges: edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, relation: e.data?.relation ?? t('связь'), label: e.data?.note,
    ...(isSide(e.sourceHandle) && isSide(e.targetHandle) ? { sourceSide: e.sourceHandle, targetSide: e.targetHandle } : {}),
    credibility: e.data?.credibility ?? '6', factIds: e.data?.factIds ?? [],
  })),
});

/**
 * Общее для всех узлов: обложки привязанных досье (id → URL; в граф не сохраняются), число узлов во внутреннем
 * графе, право правки и действия. Значение меняется редко — перетаскивание узлов его не трогает.
 */
interface GraphCtx {
  covers: Record<string, string>;
  childCount: Record<string, number>;
  editable: boolean;
  /** Открыть меню блока под его кнопкой. */
  openMenu: (id: string, button: HTMLElement) => void;
  /** Войти во внутренний граф узла. */
  enter: (id: string) => void;
}
const GraphContext = createContext<GraphCtx>({ covers: {}, childCount: {}, editable: false, openMenu: () => {}, enter: () => {} });

/** Картинка узла: обложка привязанного досье, иначе своя (props.image). */
const nodeImage = (data: EntityData, covers: Record<string, string>) => (data.dossierId && covers[data.dossierId]) || data.props.image || undefined;

function EntityNodeView({ id, data, selected }: NodeProps<EntityNode>) {
  const { icon: Icon, color } = NODE_STYLE[data.type];
  const g = useContext(GraphContext);
  const image = nodeImage(data, g.covers);
  // Внутренний граф есть только у узлов верхнего уровня.
  const inner = data.parentId === null ? g.childCount[id] ?? 0 : 0;
  const hasMenu = g.editable || !!data.dossierId || inner > 0;
  return (
    <div
      className={clsx('relative min-w-40 max-w-60 rounded-xl border bg-panel/95 px-3 py-2.5 backdrop-blur transition', selected ? 'shadow-glow' : 'shadow-[0_0_18px_var(--ft-shadow)]')}
      style={{ borderColor: selected ? color : withAlpha(color, 33) }}
    >
      <Handle id="top" type="target" position={Position.Top} className="!size-2.5" />
      {hasMenu && (
        <button
          type="button"
          data-node-menu-btn
          title={t('Действия с блоком')}
          // nodrag/nopan: нажатие не начинает перетаскивание; stopPropagation — не выделяет узел и не открывает досье.
          onClick={(e) => { e.stopPropagation(); g.openMenu(id, e.currentTarget); }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="nodrag nopan absolute right-1 top-1 grid h-4 w-5 cursor-pointer place-items-center rounded text-mute transition hover:bg-mint/10 hover:text-mint"
        >
          <MoreHorizontal size={14} />
        </button>
      )}
      <div className={clsx('flex items-center gap-2', hasMenu && 'pr-4')}>
        {image ? (
          <img src={image} alt="" draggable={false} className="size-10 shrink-0 rounded-lg border object-cover" style={{ borderColor: withAlpha(color, 33) }} />
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: withAlpha(color, 12), color }}>
            <Icon size={15} />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight">{shownLabel(data.label)}</div>
          <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: withAlpha(color, 80) }}>
            {t(NODE_TYPE_LABELS[data.type])}
            {data.props.date && ` · ${data.props.date}`}
          </div>
        </div>
      </div>
      {(data.dossierId || data.factCount > 0 || inner > 0) && (
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] text-mute">
          {data.dossierId && <span className="text-mint">{t('● досье')}</span>}
          {data.factCount > 0 && <span>{tn(data.factCount, '{n} факт|{n} факта|{n} фактов')}</span>}
          {inner > 0 && (
            <button
              type="button"
              title={t('Войти внутрь')}
              onClick={(e) => { e.stopPropagation(); g.enter(id); }}
              onDoubleClick={(e) => e.stopPropagation()}
              className="nodrag nopan inline-flex cursor-pointer items-center gap-1 text-dim transition hover:text-mint"
            >
              <Network size={9} /> {t('внутри: {n}', { n: inner })}
            </button>
          )}
        </div>
      )}
      <Handle id="bottom" type="source" position={Position.Bottom} className="!size-2.5" />
      {/* Боковые точки — для горизонтальных связей; соединяются только друг с другом (validConnection). */}
      <Handle id="left" type="source" position={Position.Left} className="!size-2.5" />
      <Handle id="right" type="source" position={Position.Right} className="!size-2.5" />
    </div>
  );
}

/** Пункт меню блока. */
function MenuItem({ icon, danger, onClick, children }: { icon: React.ReactNode; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx('flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs transition', danger ? 'text-dim hover:bg-danger/10 hover:text-danger' : 'text-dim hover:bg-mint/10 hover:text-text')}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

const nodeTypes = { entity: EntityNodeView };
const NO_COVERS: Record<string, string> = {};
const MENU_WIDTH = 224;

export function GraphEditor(props: {
  investigationId: string;
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  facts: Fact[];
  editable: boolean;
  focus?: string;
  /** Редактор во весь экран (без меню сайта, шапки расследования и вкладок). */
  fullscreen: boolean;
  onFullscreen: (on: boolean) => void;
}) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

function Editor({ investigationId, version, nodes: srcNodes, edges: srcEdges, facts, editable, focus, fullscreen, onFullscreen }: Parameters<typeof GraphEditor>[0]) {
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityNode>(toFlowNodes(srcNodes, facts, null));
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelEdge>(toFlowEdges(srcEdges, srcNodes, null));
  // Уровень: id узла, внутри которого находимся (null — верхний). В ref — для эффектов и отложенных вызовов.
  const [level, setLevel] = useState<string | null>(null);
  const levelRef = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const versionRef = useRef(version);
  // Счётчик правок и номер правки, ушедшей в последнем сохранении: правка во время запроса не теряется —
  // dirty снимается, только если с момента отправки ничего не менялось.
  const editSeq = useRef(0);
  const sentSeq = useRef(0);
  // Сервер отверг версию: местная копия устарела — при следующем ответе берём граф с сервера.
  const conflict = useRef(false);
  const rf = useReactFlow<EntityNode, RelEdge>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const dossiers = trpc.dossiers.options.useQuery(undefined, { enabled: editable });
  // Обложки привязанных досье — отдельным запросом (ключ — отсортированный список id, чтобы не дёргать на каждое движение).
  const dossierIds = useMemo(() => [...new Set(nodes.map((n) => n.data.dossierId).filter((x): x is string => !!x))].sort(), [nodes]);
  const coverKey = dossierIds.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const coverIds = useMemo(() => dossierIds, [coverKey]);
  const covers = trpc.dossiers.covers.useQuery({ ids: coverIds }, { enabled: coverIds.length > 0, staleTime: 60_000, retry: false, placeholderData: (p) => p });
  const coverMap = covers.data ?? NO_COVERS;
  // Своя картинка узла: неквадратная идёт через редактор обрезки.
  const [crop, setCrop] = useState<{ nodeId: string; image: HTMLImageElement } | null>(null);
  async function pickImage(nodeId: string, props: Record<string, string>, file: File | undefined) {
    if (!file) return;
    try {
      const img = await loadImage(file);
      if (isSquare(img)) patchNode(nodeId, { props: { ...props, image: centerSquare(img) } });
      else setCrop({ nodeId, image: img });
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const save = trpc.investigations.saveGraph.useMutation({
    onSuccess: (inv) => {
      versionRef.current = inv.version;
      utils.investigations.get.setData({ id: investigationId }, inv);
      if (sentSeq.current === editSeq.current) setDirty(false);
    },
    onError: (e) => {
      toast(errorText(e), 'error');
      if (errorCode(e) === 'VERSION_CONFLICT') {
        conflict.current = true;
        void utils.investigations.get.invalidate({ id: investigationId });
      }
    },
  });

  // Пришла новая версия с сервера (чужая правка, факты) — принимаем, если нет несохранённых изменений
  // или наша версия отвергнута (конфликт): тогда несохранённое заменяется серверным, как и говорит сообщение об ошибке.
  useEffect(() => {
    if (version !== versionRef.current && (!dirty || conflict.current)) {
      versionRef.current = version;
      conflict.current = false;
      // Узла, внутри которого мы были, в новой версии может не быть — тогда возвращаемся наверх.
      const lvl = srcNodes.some((n) => n.id === levelRef.current && !n.parentId) ? levelRef.current : null;
      levelRef.current = lvl;
      setLevel(lvl);
      setNodes(toFlowNodes(srcNodes, facts, lvl));
      setEdges(toFlowEdges(srcEdges, srcNodes, lvl));
      setDirty(false);
    } else {
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, factCount: facts.filter((f) => f.nodeIds.includes(n.id)).length } })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, facts]);

  // Автосохранение через 1.2 с после последней правки. Пока запрос в полёте, следующий не отправляется
  // (иначе он ушёл бы со старой версией и получил конфликт) — он уйдёт, когда ответ придёт и isPending сменится.
  const saving = save.isPending;
  const colorMode = useStore(theme);
  useEffect(() => {
    if (!dirty || !editable || saving) return;
    const timer = setTimeout(() => {
      sentSeq.current = editSeq.current;
      const g = fromFlow(rf.getNodes(), rf.getEdges());
      save.mutate({ id: investigationId, version: versionRef.current, ...g });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, nodes, edges, saving]);

  // Переход к узлу по ссылке (из фактов): сначала на его уровень, потом показать сам узел.
  useEffect(() => {
    if (!focus) return;
    const target = srcNodes.find((n) => n.id === focus);
    if (target && (target.parentId ?? null) !== levelRef.current) enter(target.parentId ?? null, false);
    const timer = setTimeout(() => rf.fitView({ nodes: [{ id: focus }], maxZoom: 1.2, duration: 400 }), 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, rf]);

  const touch = () => {
    if (!editable) return;
    editSeq.current++;
    setDirty(true);
  };

  const onConnect = useCallback(
    (raw: Connection) => {
      if (!validConnection(raw)) return;
      // Обычную связь могли протянуть от верхней точки к нижней — источник тот, у кого нижняя.
      const c = raw.sourceHandle === 'top'
        ? { source: raw.target, target: raw.source, sourceHandle: 'bottom', targetHandle: 'top' }
        : raw;
      const id = newId();
      // Тип по умолчанию — на языке интерфейса: это текст пользователя, он уходит в экспорт и PDF.
      const relation = t('связь');
      setEdges((es) => addEdge({ ...c, id, label: relation, data: { relation, credibility: '6', factIds: [] }, style: edgeStyle('6'), ...edgeMarkers('6', isSide(c.sourceHandle)) }, es));
      setSelected({ kind: 'edge', id });
      touch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges],
  );

  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  // Режим выделения рамкой: левая кнопка мыши на пустом месте рисует рамку, а не двигает граф (граф тогда двигают
  // средней или правой кнопкой и колесом). Вне режима рамка рисуется с зажатым Shift — это умеет сам React Flow.
  // Выделенные блоки тащатся все вместе за любой из них или за рамку.
  const [boxSelect, setBoxSelect] = useState(false);
  const selNode = selected?.kind === 'node' ? nodes.find((n) => n.id === selected.id) : undefined;
  const selEdge = selected?.kind === 'edge' ? edges.find((e) => e.id === selected.id) : undefined;

  /** Сменить уровень: показать узлы и связи нужного, остальное скрыть. Правкой графа это не считается. */
  function enter(next: string | null, fit = true) {
    const parent = new Map(rf.getNodes().map((n) => [n.id, n.data.parentId]));
    levelRef.current = next;
    setLevel(next);
    setNodes((ns) => ns.map((n) => ({ ...n, hidden: n.data.parentId !== next, selected: false })));
    setEdges((es) => es.map((e) => ({ ...e, hidden: parent.get(e.source) !== next, selected: false })));
    setSelected(null);
    setMenu(null);
    setHint(null);
    // Узлы нового уровня сначала должны отрисоваться и получить размеры.
    if (fit) setTimeout(() => rf.fitView({ padding: 0.25, maxZoom: 1.2, duration: 300 }), 120);
  }
  const enterRef = useRef(enter);
  enterRef.current = enter;
  const levelNode = level ? nodes.find((n) => n.id === level) : undefined;

  // Число узлов во внутренних графах. Ключ — строка, чтобы значение не менялось при перетаскивании.
  const childKey = nodes.map((n) => n.data.parentId).filter((x): x is string => !!x).sort().join(',');
  const childCount = useMemo(() => {
    const count: Record<string, number> = {};
    for (const id of childKey ? childKey.split(',') : []) count[id] = (count[id] ?? 0) + 1;
    return count;
  }, [childKey]);

  // Меню блока: открывается кнопкой в правом верхнем углу узла, рисуется в корне редактора (внутри узла его
  // перекрывали бы соседние узлы), закрывается нажатием мимо, Esc и движением графа.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; confirm: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageFor = useRef<string | null>(null);
  const openMenu = useCallback((id: string, button: HTMLElement) => {
    const r = rootRef.current?.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const x = Math.max(8, Math.min(b.left - (r?.left ?? 0), (r?.width ?? MENU_WIDTH + 16) - MENU_WIDTH - 8));
    setMenu((m) => (m?.id === id ? null : { id, x, y: b.bottom - (r?.top ?? 0) + 4, confirm: false }));
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element;
      if (!menuRef.current?.contains(el) && !el.closest?.('[data-node-menu-btn]')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  const menuNode = menu ? nodes.find((n) => n.id === menu.id) : undefined;
  const graphCtx = useMemo<GraphCtx>(
    () => ({ covers: coverMap, childCount, editable, openMenu, enter: (id) => enterRef.current(id) }),
    [coverMap, childCount, editable, openMenu],
  );

  /** Удалить узел вместе с его внутренним графом и всеми их связями. */
  function removeNode(id: string) {
    const gone = new Set([id, ...nodes.filter((n) => n.data.parentId === id).map((n) => n.id)]);
    setNodes((ns) => ns.filter((n) => !gone.has(n.id)));
    setEdges((es) => es.filter((e) => !gone.has(e.source) && !gone.has(e.target)));
    if (selected && (gone.has(selected.id) || edges.some((e) => e.id === selected.id && (gone.has(e.source) || gone.has(e.target))))) setSelected(null);
    setMenu(null);
    touch();
  }

  // Клавиша Delete не удаляет узел с внутренним графом: это делается из меню блока, с подтверждением.
  const onBeforeDelete: OnBeforeDelete<EntityNode, RelEdge> = async ({ nodes: doomed }) => {
    if (!doomed.some((n) => childCount[n.id])) return true;
    toast(t('У объекта есть внутренний граф — удалите его через меню блока'), 'error');
    return false;
  };

  function addNode(type: NodeType) {
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = newId();
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      { id, type: 'entity', position: { x: center.x - 80 + Math.random() * 40, y: center.y - 30 + Math.random() * 40 }, selected: true, data: { label: t(NODE_TYPE_LABELS[type]), type, dossierId: null, parentId: levelRef.current, props: {}, factCount: 0 } },
    ]);
    setSelected({ kind: 'node', id });
    touch();
  }

  function patchNode(id: string, patch: Partial<EntityData>) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    touch();
  }

  function patchEdge(id: string, patch: Partial<NonNullable<RelEdge['data']>>) {
    setEdges((es) =>
      es.map((e) => {
        if (e.id !== id) return e;
        const data = { ...e.data!, ...patch };
        return { ...e, data, label: edgeLabel(data.relation, data.note), style: edgeStyle(data.credibility, true), ...edgeMarkers(data.credibility, isSide(e.sourceHandle)) };
      }),
    );
    touch();
  }

  function removeSelectedEdge() {
    if (selected?.kind !== 'edge') return;
    setEdges((es) => es.filter((e) => e.id !== selected.id));
    setSelected(null);
    touch();
  }

  async function autoLayout() {
    // ELK (~1.4 МБ) подгружается только по кнопке.
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    const g = await new ELK().layout({
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '60', 'elk.layered.spacing.nodeNodeBetweenLayers': '90' },
      // Только текущий уровень: скрытые узлы и связи остаются на своих местах.
      children: nodes.filter((n) => !n.hidden).map((n) => ({ id: n.id, width: n.measured?.width ?? 180, height: n.measured?.height ?? 60 })),
      edges: edges.filter((e) => !e.hidden).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    });
    const pos = new Map(g.children?.map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    touch();
    setTimeout(() => rf.fitView({ duration: 400 }), 50);
  }

  // Всплывающее окно с полным пояснением узла или связи — у курсора, в координатах редактора.
  const [hint, setHint] = useState<{ text: string; x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  function showHint(ev: React.MouseEvent, text: string | undefined) {
    if (!text?.trim()) return setHint(null);
    const r = rootRef.current?.getBoundingClientRect();
    setHint({ text, x: ev.clientX - (r?.left ?? 0) + 14, y: ev.clientY - (r?.top ?? 0) + 16 });
  }

  const relatedFacts = useMemo(() => {
    if (selNode) return facts.filter((f) => f.nodeIds.includes(selNode.id));
    if (selEdge) return facts.filter((f) => selEdge.data?.factIds.includes(f.id));
    return [];
  }, [selNode, selEdge, facts]);

  return (
    <div ref={rootRef} className="relative h-full">
      <GraphContext.Provider value={graphCtx}>
      <ReactFlow
        nodes={nodes}
        edges={edges.map((e) => (e.id === selected?.id ? { ...e, style: edgeStyle(e.data?.credibility ?? '6', true) } : e))}
        nodeTypes={nodeTypes}
        onNodesChange={(ch) => {
          onNodesChange(ch);
          if (ch.some((c) => c.type === 'position' && !c.dragging) || ch.some((c) => c.type === 'remove')) touch();
        }}
        onEdgesChange={(ch) => {
          onEdgesChange(ch);
          if (ch.some((c) => c.type === 'remove')) touch();
        }}
        onConnect={editable ? onConnect : undefined}
        onNodeClick={(_, n) => setSelected({ kind: 'node', id: n.id })}
        onEdgeClick={(_, e) => setSelected({ kind: 'edge', id: e.id })}
        onPaneClick={() => setSelected(null)}
        onNodeMouseEnter={(ev, n) => showHint(ev, n.data.props.note)}
        onNodeMouseLeave={() => setHint(null)}
        onEdgeMouseEnter={(ev, e) => showHint(ev, e.data?.note)}
        onEdgeMouseLeave={() => setHint(null)}
        onNodeDragStart={() => { setHint(null); setMenu(null); }}
        onMoveStart={() => setMenu(null)}
        onBeforeDelete={onBeforeDelete}
        onNodeDoubleClick={(_, n) => n.data.dossierId && navigate({ to: '/dossiers/$id', params: { id: n.data.dossierId } })}
        // Loose: боковые точки одного вида (source) соединяются между собой; что с чем можно — validConnection.
        connectionMode={ConnectionMode.Loose}
        isValidConnection={validConnection}
        selectionOnDrag={boxSelect}
        panOnDrag={boxSelect ? [1, 2] : true}
        // В рамку достаточно попасть частью блока.
        selectionMode={SelectionMode.Partial}
        nodesDraggable={editable}
        nodesConnectable={editable}
        deleteKeyCode={editable ? ['Delete'] : null}
        fitView={!focus}
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
        colorMode={colorMode}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--ft-mint-rgb) / .18)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => NODE_STYLE[(n as EntityNode).data.type].color} maskColor={withAlpha('var(--color-bg)', 70)} />
      </ReactFlow>
      </GraphContext.Provider>
      <SquareCropDialog
        image={crop?.image ?? null}
        onCancel={() => setCrop(null)}
        onDone={(dataUrl) => {
          const n = crop && nodes.find((x) => x.id === crop.nodeId);
          if (n) patchNode(n.id, { props: { ...n.data.props, image: dataUrl } });
          setCrop(null);
        }}
      />

      {/* Меню блока */}
      {menu && menuNode && (() => {
        const n = menuNode;
        const inner = childCount[n.id] ?? 0;
        const fromDossier = !!(n.data.dossierId && coverMap[n.data.dossierId]);
        return (
          <div ref={menuRef} className="absolute z-30 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-glow-sm" style={{ left: menu.x, top: menu.y, width: MENU_WIDTH }}>
            {n.data.parentId === null && (editable || inner > 0) && (
              <MenuItem icon={<LogIn size={13} />} onClick={() => enter(n.id)}>
                {t('Войти внутрь')}{inner > 0 && <span className="ml-1.5 font-mono text-[10px] text-mute">{t('объектов: {n}', { n: inner })}</span>}
              </MenuItem>
            )}
            {n.data.dossierId && (
              <MenuItem icon={<FolderOpen size={13} />} onClick={() => void navigate({ to: '/dossiers/$id', params: { id: n.data.dossierId! } })}>{t('Открыть досье')}</MenuItem>
            )}
            {editable && !fromDossier && (
              <MenuItem
                icon={<ImagePlus size={13} />}
                onClick={() => {
                  imageFor.current = n.id;
                  setMenu(null);
                  fileRef.current?.click();
                }}
              >
                {n.data.props.image ? t('Заменить изображение…') : t('Добавить изображение…')}
              </MenuItem>
            )}
            {editable && !fromDossier && n.data.props.image && (
              <MenuItem
                icon={<ImageOff size={13} />}
                onClick={() => {
                  const { image: _old, ...rest } = n.data.props;
                  patchNode(n.id, { props: rest });
                  setMenu(null);
                }}
              >
                {t('Убрать изображение')}
              </MenuItem>
            )}
            {editable && fromDossier && <div className="px-3 py-1.5 text-[11px] text-mute">{t('Изображение — фото из привязанного досье')}</div>}
            {editable && (
              <>
                <div className="my-1 border-t border-line-soft" />
                {/* Блок с внутренним графом удаляется вторым нажатием. */}
                <MenuItem icon={<Trash2 size={13} />} danger onClick={() => (inner > 0 && !menu.confirm ? setMenu({ ...menu, confirm: true }) : removeNode(n.id))}>
                  {menu.confirm ? t('Точно удалить? Внутри объектов: {n}', { n: inner }) : t('Удалить блок')}
                </MenuItem>
              </>
            )}
          </div>
        );
      })()}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          const n = nodes.find((x) => x.id === imageFor.current);
          if (n) void pickImage(n.id, n.data.props, file);
        }}
      />

      {hint && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs whitespace-pre-line rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs leading-relaxed text-text shadow-glow-sm backdrop-blur"
          style={{ left: hint.x, top: hint.y }}
        >
          {hint.text}
        </div>
      )}

      {/* Панель инструментов */}
      {/* Обёртка не ловит мышь (под ней граф), ловят только панель и кнопка режима; справа — место под статус. */}
      <div className="pointer-events-none absolute left-3 right-44 top-3 flex flex-wrap items-start gap-2">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-panel/90 p-1.5 backdrop-blur">
        {/* Внутри объекта: возврат на верхний уровень и название объекта. */}
        {level && (
          <>
            <button onClick={() => enter(null)} title={t('Вернуться на верхний уровень')} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-mint transition hover:bg-mint/10">
              <ArrowLeft size={13} /> {t('Связи')}
            </button>
            {levelNode && (() => {
              const { icon: Icon, color } = NODE_STYLE[levelNode.data.type];
              return (
                <span className="flex h-8 max-w-56 items-center gap-1.5 px-1 text-xs font-semibold" title={t('Внутри: {name}', { name: shownLabel(levelNode.data.label) })}>
                  <Icon size={14} style={{ color }} className="shrink-0" />
                  <span className="truncate">{shownLabel(levelNode.data.label)}</span>
                </span>
              );
            })()}
            <span className="mx-1 h-5 w-px bg-line" />
          </>
        )}
        {editable &&
          (Object.keys(NODE_STYLE) as NodeType[]).map((type) => {
            const { icon: Icon, color } = NODE_STYLE[type];
            return (
              <button key={type} onClick={() => addNode(type)} title={t('Добавить: {type}', { type: t(NODE_TYPE_LABELS[type]) })} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-dim transition hover:bg-mint/10 hover:text-text">
                <Plus size={11} /><Icon size={14} style={{ color }} />
                <span className="max-xl:hidden">{t(NODE_TYPE_LABELS[type])}</span>
              </button>
            );
          })}
        {editable && <span className="mx-1 h-5 w-px bg-line" />}
        {editable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setBoxSelect((v) => !v)}
            aria-pressed={boxSelect}
            title={t('Выделение рамкой: обведите блоки мышью и тащите всю группу. Без этого режима — то же с зажатым Shift')}
            className={boxSelect ? '!border-line !bg-mint/15 !text-mint' : undefined}
          >
            <SquareDashedMousePointer size={14} />
          </Button>
        )}
        {editable && <Button size="sm" variant="ghost" onClick={autoLayout} title={t('Авторасстановка (ELK)')}><LayoutGrid size={14} /></Button>}
        <Button size="sm" variant="ghost" onClick={() => rf.fitView({ duration: 300 })} title={t('Показать всё')}><Maximize size={14} /></Button>
      </div>
        {/* Во весь экран и обратно: справа от панели инструментов. */}
        {fullscreen ? (
          <button onClick={() => onFullscreen(false)} className="pointer-events-auto flex h-[46px] cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-panel/90 px-3 font-mono text-xs text-mint backdrop-blur transition hover:bg-mint/10">
            <ArrowLeft size={13} /> {t('вернуться в расследование')}
          </button>
        ) : (
          <button onClick={() => onFullscreen(true)} title={t('Редактор связей во весь экран')} className="pointer-events-auto flex h-[46px] cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-panel/90 px-3 text-xs text-dim backdrop-blur transition hover:bg-mint/10 hover:text-text">
            <Expand size={14} /> {t('Во весь экран')}
          </button>
        )}
      </div>

      <div className="absolute right-3 top-3 font-mono text-[11px]">
        {!editable ? (
          <Tag tone="dim">{t('только просмотр')}</Tag>
        ) : save.isPending ? (
          <Tag tone="dim"><Spinner className="size-2.5" /> {t('сохраняю')}</Tag>
        ) : dirty ? (
          <Tag tone="warn">{t('изменено')}</Tag>
        ) : (
          <Tag>{t('✓ сохранено · v{v}', { v: versionRef.current })}</Tag>
        )}
      </div>

      {/* Свойства выделенного */}
      {(selNode || selEdge) && (
        <aside className="absolute bottom-3 right-3 top-12 z-10 w-80 overflow-auto rounded-xl border border-line bg-panel/95 p-4 backdrop-blur max-md:hidden">
          <div className="mb-4 flex items-center justify-between">
            <span className="label-mono">{selNode ? t(NODE_TYPE_LABELS[selNode.data.type]) : t('Связь')}</span>
            <button onClick={() => setSelected(null)} className="cursor-pointer text-mute hover:text-mint"><X size={15} /></button>
          </div>

          {selNode && (
            <div className="space-y-3">
              <Field label={t('Название')}>
                <Input value={selNode.data.label} disabled={!editable} onChange={(e) => patchNode(selNode.id, { label: e.target.value })} />
              </Field>
              <Field label={t('Пояснение')}>
                <Textarea
                  rows={3}
                  value={selNode.data.props.note ?? ''}
                  disabled={!editable}
                  onChange={(e) => {
                    const { note: _old, ...rest } = selNode.data.props;
                    patchNode(selNode.id, { props: e.target.value ? { ...rest, note: e.target.value } : rest });
                  }}
                />
              </Field>
              <Field label={t('Тип')}>
                <Select value={selNode.data.type} disabled={!editable} onChange={(e) => patchNode(selNode.id, { type: e.target.value as NodeType })} className="w-full">
                  {(Object.keys(NODE_TYPE_LABELS) as NodeType[]).map((type) => <option key={type} value={type}>{t(NODE_TYPE_LABELS[type])}</option>)}
                </Select>
              </Field>
              {(NODE_DOSSIER_KIND[selNode.data.type] || selNode.data.dossierId) && (
                <Field label={selNode.data.type === 'group' ? t('Досье группы') : tc('поле', 'Досье')}>
                  {editable ? (
                    <Select
                      value={selNode.data.dossierId ?? ''}
                      onChange={(e) => {
                        const d = dossiers.data?.find((x) => x.id === e.target.value);
                        // Узел с названием по умолчанию получает название досье.
                        // Название по умолчанию — подпись типа на любом языке (узел могли создать до смены языка).
                        const typeLabel = NODE_TYPE_LABELS[selNode.data.type];
                        const rename = d && (!selNode.data.label.trim() || selNode.data.label === typeLabel || selNode.data.label === t(typeLabel));
                        patchNode(selNode.id, { dossierId: e.target.value || null, ...(rename ? { label: d.title } : {}) });
                      }}
                      className="w-full"
                    >
                      <option value="">{t('— не привязано —')}</option>
                      {/* Персоне — досье персон, группе — групповые; уже привязанное остаётся в списке при любом виде. */}
                      {dossiers.data
                        ?.filter((d) => d.id === selNode.data.dossierId || !NODE_DOSSIER_KIND[selNode.data.type] || d.kind === NODE_DOSSIER_KIND[selNode.data.type])
                        .map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </Select>
                  ) : null}
                  {selNode.data.dossierId && (
                    <Link to="/dossiers/$id" params={{ id: selNode.data.dossierId }} className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-mint hover:underline">
                      <FolderOpen size={14} /> {t('открыть досье')}
                    </Link>
                  )}
                </Field>
              )}
              {selNode.data.type === 'event' && (
                <Field label={t('Дата')}>
                  <Input type="date" value={selNode.data.props.date ?? ''} disabled={!editable} onChange={(e) => patchNode(selNode.id, { props: { ...selNode.data.props, date: e.target.value } })} />
                </Field>
              )}
            </div>
          )}

          {selEdge && (
            <div className="space-y-3">
              <div className="font-mono text-xs text-dim">
                {shownLabel(nodes.find((n) => n.id === selEdge.source)?.data.label ?? '')} → {shownLabel(nodes.find((n) => n.id === selEdge.target)?.data.label ?? '')}
              </div>
              <Field label={t('Тип связи')}>
                <Input list="relations" value={selEdge.data?.relation ?? ''} disabled={!editable} onChange={(e) => patchEdge(selEdge.id, { relation: e.target.value })} />
                <datalist id="relations">{RELATIONS.map((r) => <option key={r} value={t(r)} />)}</datalist>
              </Field>
              <Field label={t('Пояснение')}>
                <Textarea rows={3} value={selEdge.data?.note ?? ''} disabled={!editable} onChange={(e) => patchEdge(selEdge.id, { note: e.target.value || undefined })} />
              </Field>
              <Field label={t('Достоверность')}>
                <Select value={selEdge.data?.credibility ?? '6'} disabled={!editable} onChange={(e) => patchEdge(selEdge.id, { credibility: e.target.value as GraphEdge['credibility'] })} className="w-full">
                  {Object.entries(CREDIBILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {t(v)}</option>)}
                </Select>
              </Field>
              {editable && (
                <Field label={t('Подтверждающие факты')}>
                  <div className="max-h-40 space-y-1 overflow-auto">
                    {facts.map((f) => (
                      <label key={f.id} className="flex cursor-pointer gap-2 text-xs text-dim">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[var(--color-mint)]"
                          checked={selEdge.data?.factIds.includes(f.id) ?? false}
                          onChange={(e) => {
                            const cur = selEdge.data?.factIds ?? [];
                            patchEdge(selEdge.id, { factIds: e.target.checked ? [...cur, f.id] : cur.filter((x) => x !== f.id) });
                          }}
                        />
                        <span className="line-clamp-2">{f.textMd}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              )}
            </div>
          )}

          {relatedFacts.length > 0 && (
            <div className="mt-5 space-y-2 border-t border-line-soft pt-4">
              <div className="label-mono">{t('Факты')}</div>
              {relatedFacts.map((f) => (
                <div key={f.id} className="rounded-lg border border-line-soft p-2.5 text-xs">
                  <MarkdownView source={f.textMd} />
                </div>
              ))}
            </div>
          )}

          {/* Узел удаляется из меню блока (кнопка в его правом верхнем углу). */}
          {editable && selEdge && (
            <Button variant="danger" size="sm" className="mt-5 w-full" onClick={removeSelectedEdge}>
              <Trash2 size={13} /> {t('Удалить связь')}
            </Button>
          )}
        </aside>
      )}
    </div>
  );
}
