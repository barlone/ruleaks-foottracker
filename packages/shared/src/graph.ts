import { NODE_TYPE_LABELS, type GraphEdge, type GraphNode } from './domain.ts';

// Два уровня графа расследования: у узла верхнего уровня (parentId = null) может быть внутренний граф — узлы с
// parentId = его id. Глубже нельзя: родитель сам обязан быть верхнего уровня. Связь соединяет узлы одного уровня.

type NodeRef = Pick<GraphNode, 'id' | 'parentId'>;

/** Узлы, у которых родитель не существует или сам вложен (третий уровень). */
export function badParentNodes<T extends NodeRef>(nodes: T[]): T[] {
  const top = new Set(nodes.filter((n) => !n.parentId).map((n) => n.id));
  return nodes.filter((n) => n.parentId && !top.has(n.parentId));
}

/** Связи между существующими узлами одного уровня; остальные отбрасываются. */
export function sameLevelEdges<E extends Pick<GraphEdge, 'source' | 'target'>>(nodes: NodeRef[], edges: E[]): E[] {
  const level = new Map(nodes.map((n) => [n.id, n.parentId ?? null]));
  return edges.filter((e) => level.has(e.source) && level.has(e.target) && level.get(e.source) === level.get(e.target));
}

/** Стороны боковой связи — только парой: одна без другой отбрасывается, связь становится обычной. */
export function withEdgeSides<E extends Pick<GraphEdge, 'sourceSide' | 'targetSide'>>(e: E): E {
  if (e.sourceSide && e.targetSide) return e;
  const { sourceSide: _s, targetSide: _t, ...rest } = e;
  return rest as E;
}

/** Название узла для списков вне графа: вложенный — «Контейнер › Узел». */
export function nodeTitles(nodes: Pick<GraphNode, 'id' | 'parentId' | 'label' | 'type'>[]): Map<string, string> {
  const own = new Map(nodes.map((n) => [n.id, n.label || NODE_TYPE_LABELS[n.type]]));
  return new Map(nodes.map((n) => [n.id, n.parentId && own.has(n.parentId) ? `${own.get(n.parentId)} › ${own.get(n.id)}` : own.get(n.id)!]));
}
