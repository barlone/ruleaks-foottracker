import { LayoutGrid, List } from 'lucide-react';
import { Segmented } from './ui.tsx';
import type { ListView } from '../lib/listView.ts';
import { t } from '../lib/i18n.ts';

// Переключатель вида списков досье и расследований (состояние — useListView в lib/listView.ts).

export function ViewToggle({ value, onChange }: { value: ListView; onChange: (v: ListView) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: 'grid', label: <span className="flex items-center gap-1.5" title={t('Вид: миниатюры')}><LayoutGrid size={13} /> {t('миниатюры')}</span> },
        { value: 'table', label: <span className="flex items-center gap-1.5" title={t('Вид: список')}><List size={13} /> {t('список')}</span> },
      ]}
    />
  );
}
