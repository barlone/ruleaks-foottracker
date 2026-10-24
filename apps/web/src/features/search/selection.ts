import { useState } from 'react';
import type { PendingValue } from './AddToDossierDialog.tsx';

/** Отметка значений для переноса в досье: ключ `${поле}:${значение}`. */
export function useSelection() {
  const [selected, setSelected] = useState<Map<string, PendingValue>>(new Map());
  const toggle = (key: string, label: string, value: string) => {
    const id = `${key}:${value}`;
    const next = new Map(selected);
    if (next.has(id)) next.delete(id);
    else next.set(id, { key, label, value });
    setSelected(next);
  };
  return { selected, toggle, reset: () => setSelected(new Map()) };
}
