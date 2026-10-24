import { LayoutGrid, List } from 'lucide-react';
import { Segmented } from './ui.tsx';
import type { ListView } from '../lib/listView.ts';

// Переключатель вида списков досье и расследований (состояние — useListView в lib/listView.ts).

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
