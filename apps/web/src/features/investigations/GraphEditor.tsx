import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider,
  addEdge, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Link, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { FolderOpen, LayoutGrid, Maximize, Plus, Trash2, X } from 'lucide-react';
import {
  CREDIBILITY_LABELS, NODE_TYPE_LABELS, newId, type Fact, type GraphEdge, type GraphNode, type NodeType,
} from '@ft/shared';
import { Button, Field, Input, Select, Spinner, Tag } from '../../components/ui.tsx';
import { MarkdownView } from '../../components/Markdown.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorCode, errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';
import { NODE_STYLE, RELATIONS, edgeStyle } from './nodeStyle.ts';

// Визуальный редактор связей. Состояние графа живёт локально (React Flow),
// на сервер уходит целиком с задержкой (автосохранение) и версией для
// оптимистичной блокировки. Персона ссылается на досье — двойной клик открывает его.

type EntityData = { label: string; type: NodeType; dossierId: string | null; props: Record<string, string>; factCount: number };
type EntityNode = Node<EntityData, 'entity'>;
type RelEdge = Edge<{ relation: string; credibility: GraphEdge['credibility']; factIds: string[]; note?: string }>;

const toFlowNodes = (nodes: GraphNode[], facts: Fact[]): EntityNode[] =>
  nodes.map((n) => ({
    id: n.id,
    type: 'entity',
    position: n.position,
    data: { label: n.label, type: n.type, dossierId: n.dossierId, props: n.props, factCount: facts.filter((f) => f.nodeIds.includes(n.id)).length },
  }));

const toFlowEdges = (edges: GraphEdge[]): RelEdge[] =>
  edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label ? `${e.relation} · ${e.label}` : e.relation,
    data: { relation: e.relation, credibility: e.credibility, factIds: e.factIds, note: e.label },
    style: edgeStyle(e.credibility),
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: edgeStyle(e.credibility).stroke },
  }));

const fromFlow = (nodes: EntityNode[], edges: RelEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } => ({
  nodes: nodes.map((n) => ({
    id: n.id, type: n.data.type, label: n.data.label, dossierId: n.data.dossierId, props: n.data.props,
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
  })),
  edges: edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, relation: e.data?.relation ?? 'связь', label: e.data?.note,
    credibility: e.data?.credibility ?? '6', factIds: e.data?.factIds ?? [],
  })),
});

function EntityNodeView({ data, selected }: NodeProps<EntityNode>) {
  const { icon: Icon, color } = NODE_STYLE[data.type];
  return (
    <div
      className={clsx('min-w-40 max-w-60 rounded-xl border bg-panel/95 px-3 py-2.5 backdrop-blur transition', selected ? 'shadow-glow' : 'shadow-[0_0_18px_rgba(0,0,0,.6)]')}
      style={{ borderColor: selected ? color : `${color}55` }}
    >
      <Handle type="target" position={Position.Top} className="!size-2.5" />
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `${color}1f`, color }}>
          <Icon size={15} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight">{data.label}</div>
          <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: `${color}cc` }}>
            {NODE_TYPE_LABELS[data.type]}
            {data.props.date && ` · ${data.props.date}`}
          </div>
        </div>
      </div>
      {(data.dossierId || data.factCount > 0) && (
        <div className="mt-1.5 flex gap-1.5 font-mono text-[9px] text-mute">
          {data.dossierId && <span className="text-mint">● досье</span>}
          {data.factCount > 0 && <span>{data.factCount} факт.</span>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!size-2.5" />
    </div>
  );
}

const nodeTypes = { entity: EntityNodeView };

export function GraphEditor(props: {
  investigationId: string;
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  facts: Fact[];
  editable: boolean;
  focus?: string;
}) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

function Editor({ investigationId, version, nodes: srcNodes, edges: srcEdges, facts, editable, focus }: Parameters<typeof GraphEditor>[0]) {
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityNode>(toFlowNodes(srcNodes, facts));
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelEdge>(toFlowEdges(srcEdges));
  const [dirty, setDirty] = useState(false);
  const versionRef = useRef(version);
  const rf = useReactFlow<EntityNode, RelEdge>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const dossiers = trpc.dossiers.options.useQuery(undefined, { enabled: editable });

  const save = trpc.investigations.saveGraph.useMutation({
    onSuccess: (inv) => {
      versionRef.current = inv.version;
      utils.investigations.get.setData({ id: investigationId }, inv);
      setDirty(false);
    },
    onError: (e) => {
      toast(errorText(e), 'error');
      if (errorCode(e) === 'VERSION_CONFLICT') void utils.investigations.get.invalidate({ id: investigationId });
    },
  });

  // Пришла новая версия с сервера (чужая правка, факты) — принимаем, если нет несохранённых изменений.
  useEffect(() => {
    if (version !== versionRef.current && !dirty) {
      versionRef.current = version;
      setNodes(toFlowNodes(srcNodes, facts));
      setEdges(toFlowEdges(srcEdges));
    } else {
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, factCount: facts.filter((f) => f.nodeIds.includes(n.id)).length } })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, facts]);

  // Автосохранение через 1.2 с после последней правки.
  useEffect(() => {
    if (!dirty || !editable) return;
    const t = setTimeout(() => {
      const g = fromFlow(rf.getNodes(), rf.getEdges());
      save.mutate({ id: investigationId, version: versionRef.current, ...g });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, nodes, edges]);

  useEffect(() => {
    if (focus) setTimeout(() => rf.fitView({ nodes: [{ id: focus }], maxZoom: 1.2, duration: 400 }), 50);
  }, [focus, rf]);

  const touch = () => editable && setDirty(true);

  const onConnect = useCallback(
    (c: Connection) => {
      const id = newId();
      setEdges((es) => addEdge({ ...c, id, label: 'связь', data: { relation: 'связь', credibility: '6', factIds: [] }, style: edgeStyle('6'), markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle('6').stroke } }, es));
      setSelected({ kind: 'edge', id });
      touch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges],
  );

  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const selNode = selected?.kind === 'node' ? nodes.find((n) => n.id === selected.id) : undefined;
  const selEdge = selected?.kind === 'edge' ? edges.find((e) => e.id === selected.id) : undefined;

  function addNode(type: NodeType) {
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = newId();
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      { id, type: 'entity', position: { x: center.x - 80 + Math.random() * 40, y: center.y - 30 + Math.random() * 40 }, selected: true, data: { label: NODE_TYPE_LABELS[type], type, dossierId: null, props: {}, factCount: 0 } },
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
        return { ...e, data, label: data.note ? `${data.relation} · ${data.note}` : data.relation, style: edgeStyle(data.credibility, true), markerEnd: { type: MarkerType.ArrowClosed, color: edgeStyle(data.credibility).stroke } };
      }),
    );
    touch();
  }

  function removeSelected() {
    if (!selected) return;
    if (selected.kind === 'node') {
      setNodes((ns) => ns.filter((n) => n.id !== selected.id));
      setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
    } else {
      setEdges((es) => es.filter((e) => e.id !== selected.id));
    }
    setSelected(null);
    touch();
  }

  async function autoLayout() {
    // ELK (~1.4 МБ) подгружается только по кнопке.
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    const g = await new ELK().layout({
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.spacing.nodeNode': '60', 'elk.layered.spacing.nodeNodeBetweenLayers': '90' },
      children: nodes.map((n) => ({ id: n.id, width: n.measured?.width ?? 180, height: n.measured?.height ?? 60 })),
      edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    });
    const pos = new Map(g.children?.map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    touch();
    setTimeout(() => rf.fitView({ duration: 400 }), 50);
  }

  const relatedFacts = useMemo(() => {
    if (selNode) return facts.filter((f) => f.nodeIds.includes(selNode.id));
    if (selEdge) return facts.filter((f) => selEdge.data?.factIds.includes(f.id));
    return [];
  }, [selNode, selEdge, facts]);

  return (
    <div className="relative h-full">
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
        onNodeDoubleClick={(_, n) => n.data.dossierId && navigate({ to: '/dossiers/$id', params: { id: n.data.dossierId } })}
        nodesDraggable={editable}
        nodesConnectable={editable}
        deleteKeyCode={editable ? ['Delete'] : null}
        fitView={!focus}
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(46,224,172,.18)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => NODE_STYLE[(n as EntityNode).data.type].color} maskColor="rgba(0,0,0,.7)" />
      </ReactFlow>

      {/* Панель инструментов */}
      <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-panel/90 p-1.5 backdrop-blur">
        {editable &&
          (Object.keys(NODE_STYLE) as NodeType[]).map((t) => {
            const { icon: Icon, color } = NODE_STYLE[t];
            return (
              <button key={t} onClick={() => addNode(t)} title={`Добавить: ${NODE_TYPE_LABELS[t]}`} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-dim transition hover:bg-mint/10 hover:text-text">
                <Plus size={11} /><Icon size={14} style={{ color }} />
                <span className="max-xl:hidden">{NODE_TYPE_LABELS[t]}</span>
              </button>
            );
          })}
        {editable && <span className="mx-1 h-5 w-px bg-line" />}
        {editable && <Button size="sm" variant="ghost" onClick={autoLayout} title="Авторасстановка (ELK)"><LayoutGrid size={14} /></Button>}
        <Button size="sm" variant="ghost" onClick={() => rf.fitView({ duration: 300 })} title="Показать всё"><Maximize size={14} /></Button>
      </div>

      <div className="absolute right-3 top-3 font-mono text-[11px]">
        {!editable ? (
          <Tag tone="dim">только просмотр</Tag>
        ) : save.isPending ? (
          <Tag tone="dim"><Spinner className="size-2.5" /> сохраняю</Tag>
        ) : dirty ? (
          <Tag tone="warn">изменено</Tag>
        ) : (
          <Tag>✓ сохранено · v{versionRef.current}</Tag>
        )}
      </div>

      {/* Свойства выделенного */}
      {(selNode || selEdge) && (
        <aside className="absolute bottom-3 right-3 top-12 z-10 w-80 overflow-auto rounded-xl border border-line bg-panel/95 p-4 backdrop-blur max-md:hidden">
          <div className="mb-4 flex items-center justify-between">
            <span className="label-mono">{selNode ? NODE_TYPE_LABELS[selNode.data.type] : 'Связь'}</span>
            <button onClick={() => setSelected(null)} className="cursor-pointer text-mute hover:text-mint"><X size={15} /></button>
          </div>

          {selNode && (
            <div className="space-y-3">
              <Field label="Название">
                <Input value={selNode.data.label} disabled={!editable} onChange={(e) => patchNode(selNode.id, { label: e.target.value })} />
              </Field>
              <Field label="Тип">
                <Select value={selNode.data.type} disabled={!editable} onChange={(e) => patchNode(selNode.id, { type: e.target.value as NodeType })} className="w-full">
                  {(Object.keys(NODE_TYPE_LABELS) as NodeType[]).map((t) => <option key={t} value={t}>{NODE_TYPE_LABELS[t]}</option>)}
                </Select>
              </Field>
              {(selNode.data.type === 'person' || selNode.data.dossierId) && (
                <Field label="Досье">
                  {editable ? (
                    <Select value={selNode.data.dossierId ?? ''} onChange={(e) => patchNode(selNode.id, { dossierId: e.target.value || null })} className="w-full">
                      <option value="">— не привязано —</option>
                      {dossiers.data?.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </Select>
                  ) : null}
                  {selNode.data.dossierId && (
                    <Link to="/dossiers/$id" params={{ id: selNode.data.dossierId }} className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-mint hover:underline">
                      <FolderOpen size={14} /> открыть досье
                    </Link>
                  )}
                </Field>
              )}
              {selNode.data.type === 'event' && (
                <Field label="Дата">
                  <Input type="date" value={selNode.data.props.date ?? ''} disabled={!editable} onChange={(e) => patchNode(selNode.id, { props: { ...selNode.data.props, date: e.target.value } })} />
                </Field>
              )}
            </div>
          )}

          {selEdge && (
            <div className="space-y-3">
              <div className="font-mono text-xs text-dim">
                {nodes.find((n) => n.id === selEdge.source)?.data.label} → {nodes.find((n) => n.id === selEdge.target)?.data.label}
              </div>
              <Field label="Тип связи">
                <Input list="relations" value={selEdge.data?.relation ?? ''} disabled={!editable} onChange={(e) => patchEdge(selEdge.id, { relation: e.target.value })} />
                <datalist id="relations">{RELATIONS.map((r) => <option key={r} value={r} />)}</datalist>
              </Field>
              <Field label="Пояснение">
                <Input value={selEdge.data?.note ?? ''} disabled={!editable} onChange={(e) => patchEdge(selEdge.id, { note: e.target.value || undefined })} />
              </Field>
              <Field label="Достоверность">
                <Select value={selEdge.data?.credibility ?? '6'} disabled={!editable} onChange={(e) => patchEdge(selEdge.id, { credibility: e.target.value as GraphEdge['credibility'] })} className="w-full">
                  {Object.entries(CREDIBILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
                </Select>
              </Field>
              {editable && (
                <Field label="Подтверждающие факты">
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
              <div className="label-mono">Факты</div>
              {relatedFacts.map((f) => (
                <div key={f.id} className="rounded-lg border border-line-soft p-2.5 text-xs">
                  <MarkdownView source={f.textMd} />
                </div>
              ))}
            </div>
          )}

          {editable && (
            <Button variant="danger" size="sm" className="mt-5 w-full" onClick={removeSelected}>
              <Trash2 size={13} /> Удалить {selNode ? 'узел' : 'связь'}
            </Button>
          )}
        </aside>
      )}
    </div>
  );
}
