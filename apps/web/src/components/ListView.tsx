import { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { Segmented } from './ui.tsx';

// Вид списков досье и расследований: миниатюры или таблица. Выбор запоминается в браузере
// (отдельно для каждого списка); без localStorage — просто миниатюры.

export type ListView = 'grid' | 'table';

export function useListView(key: string): [ListView, (v: ListView) => void] {
  const storageKey = `ft:view:${key}`;
  const [view, setView] = useState<ListView>(() => {
    try {
      return localStorage.getItem(storageKey) === 'table' ? 'table' : 'grid';
    } catch {
      return 'grid';
    }
  });
  return [
    view,
    (v) => {
      setView(v);
      try {
        localStorage.setItem(storageKey, v);
      } catch {
        /* приватный режим — выбор живёт до перезагрузки */
      }
    },
  ];
}

export function ViewToggle({ value, onChange }: { value: ListView; onChange: (v: ListView) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: 'grid', label: <span className="flex items-center gap-1.5" title="Миниатюры"><LayoutGrid size={13} /> миниатюры</span> },
        { value: 'table', label: <span className="flex items-center gap-1.5" title="Список"><List size={13} /> список</span> },
      ]}
    />
  );
}

/** Общие классы таблиц списков. */
export const tableCls = {
  wrap: 'overflow-x-auto rounded-2xl border border-line bg-panel',
  table: 'w-full border-collapse text-sm',
  th: 'whitespace-nowrap border-b border-line px-3 py-2.5 text-left font-mono text-[11px] font-normal uppercase tracking-wider text-mute',
  tr: 'cursor-pointer border-b border-line-soft transition last:border-0 hover:bg-mint/5',
  td: 'px-3 py-2 align-middle',
};
