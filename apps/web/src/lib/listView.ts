import { useState } from 'react';

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

/** Общие классы таблиц списков. */
export const tableCls = {
  wrap: 'overflow-x-auto rounded-2xl border border-line bg-panel',
  table: 'w-full border-collapse text-sm',
  th: 'whitespace-nowrap border-b border-line px-3 py-2.5 text-left font-mono text-[11px] font-normal uppercase tracking-wider text-mute',
  tr: 'cursor-pointer border-b border-line-soft transition last:border-0 hover:bg-mint/5',
  td: 'px-3 py-2 align-middle',
};

/**
 * Фильтр списка («Все / Мои / Доступные мне»): живёт в адресе (?scope=), а последний выбор запоминается в браузере.
 * Если в адресе фильтра нет (пункт меню, «все досье» со страницы объекта), берётся запомненный — выбор не слетает
 * при возврате в список. Неизвестное сохранённое значение игнорируется.
 */
export function rememberedScope<S extends string>(key: string, fromUrl: S | undefined, allowed: readonly S[], fallback: S): S {
  const storageKey = `ft:scope:${key}`;
  if (fromUrl !== undefined) {
    try {
      localStorage.setItem(storageKey, fromUrl);
    } catch {
      /* приватный режим — выбор живёт только в адресе */
    }
    return fromUrl;
  }
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && (allowed as readonly string[]).includes(saved)) return saved as S;
  } catch {
    /* нет localStorage */
  }
  return fallback;
}
