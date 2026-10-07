import { NODE_TYPE_LABELS, type GraphEdge, type GraphNode, type NodeType } from '@ft/shared';

// Граф расследования для PDF — SVG по сохранённым координатам узлов (как расставил пользователь в редакторе).
// Узел — карточка с типом и названием, связь — линия со стрелкой и подписью; стиль линии — по достоверности,
// как в редакторе: подтверждено — сплошная, сомнительно — пунктир, остальное — точки.

const W = 180;
const H = 46;

/** Цвета типов как в редакторе (nodeStyle.ts), чуть темнее для белой бумаги. */
const COLOR: Record<NodeType, string> = {
  person: '#14b386', organization: '#3b8fd9', event: '#d99a1e', location: '#e0703c', asset: '#a66ad6', document: '#7d8a87',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function edgeStyle(credibility: string) {
  const c = Number(credibility);
  if (c <= 2) return { stroke: '#14946f', dash: '' };
  if (c <= 4) return { stroke: '#c98a12', dash: '6 4' };
  return { stroke: '#9aa5a2', dash: '2 3' };
}

/** Точка на границе прямоугольника узла по направлению к (tx, ty). */
function border(cx: number, cy: number, tx: number, ty: number) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const k = Math.min(Math.abs((W / 2 + 4) / (dx || 1e-9)), Math.abs((H / 2 + 4) / (dy || 1e-9)));
  return { x: cx + dx * k, y: cy + dy * k };
}

export function graphSvg(nodes: GraphNode[], edges: GraphEdge[]): { svg: string; width: number; height: number } | null {
  if (!nodes.length) return null;
  const pad = 24;
  const minX = Math.min(...nodes.map((n) => n.position.x)) - pad;
  const minY = Math.min(...nodes.map((n) => n.position.y)) - pad;
  const width = Math.max(...nodes.map((n) => n.position.x)) + W + pad - minX;
  const height = Math.max(...nodes.map((n) => n.position.y)) + H + pad - minY;
  const center = new Map(nodes.map((n) => [n.id, { x: n.position.x - minX + W / 2, y: n.position.y - minY + H / 2 }]));
  const parts: string[] = [];

  for (const e of edges) {
    const a = center.get(e.source);
    const b = center.get(e.target);
    if (!a || !b) continue;
    const s = edgeStyle(e.credibility);
    const p = border(a.x, a.y, b.x, b.y);
    const q = border(b.x, b.y, a.x, a.y);
    parts.push(`<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${s.stroke}" stroke-width="1.4"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
    // Стрелка к цели.
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const tip = (d: number, da: number) => `${q.x - d * Math.cos(ang + da)},${q.y - d * Math.sin(ang + da)}`;
    parts.push(`<polygon points="${q.x},${q.y} ${tip(9, 0.4)} ${tip(9, -0.4)}" fill="${s.stroke}"/>`);
    const label = cut([e.relation, e.label].filter(Boolean).join(' · '), 34);
    if (label) {
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const lw = label.length * 5.2 + 8;
      parts.push(`<rect x="${mx - lw / 2}" y="${my - 7}" width="${lw}" height="14" rx="3" fill="#ffffff" fill-opacity="0.9"/>`);
      parts.push(`<text x="${mx}" y="${my + 3}" font-family="Roboto" font-size="9" fill="#444" text-anchor="middle">${esc(label)}</text>`);
    }
  }

  for (const n of nodes) {
    const x = n.position.x - minX;
    const y = n.position.y - minY;
    const c = COLOR[n.type];
    parts.push(`<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="7" fill="#ffffff" stroke="${c}" stroke-width="1.4"/>`);
    parts.push(`<rect x="${x}" y="${y + 8}" width="3" height="${H - 16}" fill="${c}"/>`);
    parts.push(`<text x="${x + 12}" y="${y + 17}" font-family="Roboto" font-size="8" fill="${c}">${esc(NODE_TYPE_LABELS[n.type].toUpperCase())}</text>`);
    parts.push(`<text x="${x + 12}" y="${y + 33}" font-family="Roboto" font-weight="bold" font-size="11" fill="#111">${esc(cut(n.label || '—', 27))}</text>`);
  }

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`,
    width,
    height,
  };
}
