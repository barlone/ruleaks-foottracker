import { Building2, CalendarClock, FileText, MapPin, Package, User, type LucideIcon } from 'lucide-react';
import type { NodeType } from '@ft/shared';

// Цвета — CSS-переменные темы, поэтому прозрачность задаётся через withAlpha, а не дописыванием к hex.
export const NODE_STYLE: Record<NodeType, { icon: LucideIcon; color: string }> = {
  person: { icon: User, color: 'var(--color-mint)' },
  organization: { icon: Building2, color: 'var(--color-info)' },
  event: { icon: CalendarClock, color: 'var(--color-warn)' },
  location: { icon: MapPin, color: 'var(--ft-node-location)' },
  asset: { icon: Package, color: 'var(--ft-node-asset)' },
  document: { icon: FileText, color: 'var(--color-dim)' },
};

export const withAlpha = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/** Частые типы связей — подсказки в редакторе, можно ввести свой. */
export const RELATIONS = [
  'знакомы', 'родственники', 'супруги', 'коллеги', 'руководит', 'работает', 'работал', 'учредитель', 'владеет',
  'пользуется', 'участник', 'заказчик', 'победитель', 'платил', 'звонил', 'проживает', 'был в',
];

/** Достоверность связи → стиль линии: подтверждено — сплошная, сомнительно — пунктир. */
export function edgeStyle(credibility: string, selected?: boolean) {
  const c = Number(credibility);
  const stroke = selected
    ? 'var(--color-mint)'
    : c <= 2 ? withAlpha('var(--color-mint)', 70) : c <= 4 ? withAlpha('var(--color-warn)', 60) : withAlpha('var(--color-dim)', 45);
  return {
    stroke,
    strokeWidth: selected ? 2.5 : 1.6,
    strokeDasharray: c <= 2 ? undefined : c <= 4 ? '6 4' : '2 4',
  };
}
