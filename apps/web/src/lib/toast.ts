import { create } from './store.ts';

// Минимальные уведомления без зависимостей.
export interface Toast { id: number; text: string; tone: 'ok' | 'error' }
export const toasts = create<Toast[]>([]);
let seq = 0;

export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const id = ++seq;
  toasts.set([...toasts.get(), { id, text, tone }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), 4000);
}
