import { Building2, CalendarClock, FileText, MapPin, Package, User, type LucideIcon } from 'lucide-react';
import type { NodeType } from '@ft/shared';

export const NODE_STYLE: Record<NodeType, { icon: LucideIcon; color: string }> = {
  person: { icon: User, color: '#2EE0AC' },
  organization: { icon: Building2, color: '#6CB8FF' },
  event: { icon: CalendarClock, color: '#FFC85C' },
  location: { icon: MapPin, color: '#FF8A5C' },
  asset: { icon: Package, color: '#C792EA' },
  document: { icon: FileText, color: '#A8B3B0' },
};

/** Частые типы связей — подсказки в редакторе, можно ввести свой. */
export const RELATIONS = [
  'знакомы', 'родственники', 'супруги', 'коллеги', 'руководит', 'работает', 'работал', 'учредитель', 'владеет',
  'пользуется', 'участник', 'заказчик', 'победитель', 'платил', 'звонил', 'проживает', 'был в',
];

/** Достоверность связи → стиль линии: подтверждено — сплошная, сомнительно — пунктир. */
export function edgeStyle(credibility: string, selected?: boolean) {
  const c = Number(credibility);
  const stroke = selected ? '#2EE0AC' : c <= 2 ? 'rgba(46,224,172,.7)' : c <= 4 ? 'rgba(255,200,92,.6)' : 'rgba(168,179,176,.45)';
  return {
    stroke,
    strokeWidth: selected ? 2.5 : 1.6,
    strokeDasharray: c <= 2 ? undefined : c <= 4 ? '6 4' : '2 4',
  };
}
