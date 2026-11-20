import type { DeepRow } from '@ft/shared';

// Граф результата глубокого поиска — как /graph-view/ старого веб-интерфейса (dsstalker-webgui): значения,
// найденные через одно и то же значение, собраны в карточку; карточка связана линией со строкой-родителем
// в карточке слева. Корень — запрошенное значение (link4_id = 0). Внутри карточки значения сгруппированы по записям
// утечек (tuple_id): значения одной записи стоят вместе. Здесь — только разбор строк и расстановка,
// отрисовка — DeepGraph.tsx.

export interface GraphCard {
  /** root:<val_id> — запрошенное значение; c:<val_id> — найденное через строку val_id. */
  id: string;
  root: boolean;
  /** val_id строки, через которую найдены значения карточки; null — корень. */
  parentRow: number | null;
  /** Карточка, в которой лежит строка-родитель. */
  parentCard: string | null;
  /** Строки по записям утечек: значения одной записи (tuple_id) идут подряд, записи — в порядке появления. */
  rows: DeepRow[];
  /** Сколько в карточке записей утечек; 1 — делить нечем (в том числе снимки без tuple_id). */
  tuples: number;
  depth: number;
}

export interface DeepGraphModel {
  cards: GraphCard[];
  /** val_id строк, от которых идёт линия к своей карточке. */
  links: Set<number>;
}

export const cardId = (valId: number) => `c:${valId}`;

/** Запись утечки, из которой значение; 0 — неизвестна (снимок старше tuple_id в ответе шлюза). */
export const tupleOf = (r: DeepRow): number => r.tuple_id ?? 0;

/** Значения одной записи утечки — подряд; записи — в порядке первого значения, внутри записи порядок ответа. */
function byTuple(rows: DeepRow[]): { rows: DeepRow[]; tuples: number } {
  const groups = new Map<number, DeepRow[]>();
  for (const r of rows) groups.set(tupleOf(r), [...(groups.get(tupleOf(r)) ?? []), r]);
  return { rows: [...groups.values()].flat(), tuples: groups.size };
}

/**
 * Карточки графа из строк ответа. Удалённая из сохранённых данных строка (removed) остаётся в графе, только пока
 * через неё найдены живые значения: иначе их карточка повисла бы без связи.
 */
export function buildDeepGraph(rows: readonly DeepRow[]): DeepGraphModel {
  const byId = new Map(rows.map((r) => [r.val_id, r] as const));
  const children = new Map<number, DeepRow[]>();
  for (const r of rows) {
    if (r.link4_id && r.link4_id !== r.val_id && byId.has(r.link4_id)) children.set(r.link4_id, [...(children.get(r.link4_id) ?? []), r]);
  }

  // Строка видна, если жива сама или жив кто-то из найденных через неё (visiting — от циклов в данных).
  const seen = new Map<number, boolean>();
  const visiting = new Set<number>();
  const visible = (r: DeepRow): boolean => {
    const known = seen.get(r.val_id);
    if (known !== undefined) return known;
    if (visiting.has(r.val_id)) return false;
    visiting.add(r.val_id);
    const v = !r.removed || (children.get(r.val_id) ?? []).some(visible);
    visiting.delete(r.val_id);
    seen.set(r.val_id, v);
    return v;
  };

  const cards: GraphCard[] = [];
  const links = new Set<number>();
  const placed = new Set<number>();
  // В ширину: карточка строки появляется после карточки, в которой эта строка лежит.
  const queue: { row: DeepRow; card: GraphCard }[] = [];
  const addRoot = (r: DeepRow) => {
    const card: GraphCard = { id: `root:${r.val_id}`, root: true, parentRow: null, parentCard: null, rows: [r], tuples: 1, depth: 0 };
    cards.push(card);
    placed.add(r.val_id);
    queue.push({ row: r, card });
  };
  const drain = () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const found = (children.get(item.row.val_id) ?? []).filter((k) => !placed.has(k.val_id) && visible(k));
      if (!found.length) continue;
      const { rows: kids, tuples } = byTuple(found);
      const card: GraphCard = { id: cardId(item.row.val_id), root: false, parentRow: item.row.val_id, parentCard: item.card.id, rows: kids, tuples, depth: item.card.depth + 1 };
      cards.push(card);
      links.add(item.row.val_id);
      for (const k of kids) {
        placed.add(k.val_id);
        queue.push({ row: k, card });
      }
    }
  };
  for (const r of rows) if (visible(r) && (!r.link4_id || r.link4_id === r.val_id || !byId.has(r.link4_id))) addRoot(r);
  drain();
  // Строки, до которых от корней не дойти (цикл в ссылках), — тоже корни, чтобы ничего не пропало.
  for (const r of rows) {
    if (placed.has(r.val_id) || !visible(r)) continue;
    addRoot(r);
    drain();
  }
  return { cards, links };
}

/** Все значения, найденные через эти строки (на любую глубину), вместе с ними самими. */
export function withDescendants(all: readonly DeepRow[], start: readonly DeepRow[]): DeepRow[] {
  const children = new Map<number, DeepRow[]>();
  for (const r of all) if (r.link4_id && r.link4_id !== r.val_id) children.set(r.link4_id, [...(children.get(r.link4_id) ?? []), r]);
  const out = new Map<number, DeepRow>();
  const stack = [...start];
  for (let r = stack.pop(); r; r = stack.pop()) {
    if (out.has(r.val_id)) continue;
    out.set(r.val_id, r);
    stack.push(...(children.get(r.val_id) ?? []));
  }
  return [...out.values()];
}

// ---------- Расстановка ----------

export const CARD_W = 320;
const GAP_X = 150;
const GAP_Y = 36;
/** Сколько строк карточки видно в свёрнутом виде (плюс все строки со связями). */
export const COLLAPSED_ROWS = 3;
/** Карточки длиннее сворачиваются кнопкой внизу. */
export const COLLAPSE_FROM = 6;

/** Примерная высота карточки до отрисовки: шапка, строки (длинные значения переносятся) и кнопка «свернуть». */
function cardHeight(card: GraphCard): number {
  if (card.root) return 96;
  let h = 34;
  for (const r of card.rows) h += 13 + Math.max(1, Math.ceil(r.val.length / 24)) * 18;
  if (card.tuples > 1) h += card.tuples * 26;
  return h + (card.rows.length > COLLAPSE_FROM ? 26 : 0) + 8;
}

/**
 * Дерево слева направо: карточка — напротив середины своих потомков, потомки — столбцом в порядке строк-родителей.
 * Высоты оцениваются по тексту, поэтому между карточками оставлен запас.
 */
export function layoutDeepGraph(cards: readonly GraphCard[]): Map<string, { x: number; y: number }> {
  const kids = new Map<string, GraphCard[]>();
  for (const c of cards) if (c.parentCard) kids.set(c.parentCard, [...(kids.get(c.parentCard) ?? []), c]);
  const byCard = new Map(cards.map((c) => [c.id, c] as const));
  // Потомки — в порядке строк родительской карточки, как идут линии.
  for (const [id, list] of kids) {
    const order = new Map(byCard.get(id)!.rows.map((r, i) => [r.val_id, i] as const));
    list.sort((a, b) => (order.get(a.parentRow!) ?? 0) - (order.get(b.parentRow!) ?? 0));
  }
  const height = new Map(cards.map((c) => [c.id, cardHeight(c)] as const));
  const span = new Map<string, number>();
  const spanOf = (c: GraphCard): number => {
    const list = kids.get(c.id) ?? [];
    const below = list.reduce((s, k) => s + spanOf(k), 0) + GAP_Y * Math.max(0, list.length - 1);
    const v = Math.max(height.get(c.id)!, below);
    span.set(c.id, v);
    return v;
  };
  const pos = new Map<string, { x: number; y: number }>();
  const place = (c: GraphCard, top: number) => {
    const total = span.get(c.id)!;
    pos.set(c.id, { x: c.depth * (CARD_W + GAP_X), y: top + (total - height.get(c.id)!) / 2 });
    const list = kids.get(c.id) ?? [];
    const below = list.reduce((s, k) => s + span.get(k.id)!, 0) + GAP_Y * Math.max(0, list.length - 1);
    let y = top + (total - below) / 2;
    for (const k of list) {
      place(k, y);
      y += span.get(k.id)! + GAP_Y;
    }
  };
  let top = 0;
  for (const c of cards) {
    if (!c.root) continue;
    spanOf(c);
    place(c, top);
    top += span.get(c.id)! + GAP_Y * 2;
  }
  return pos;
}
