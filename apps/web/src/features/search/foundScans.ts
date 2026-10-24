import { useMemo } from 'react';
import type { LeakCard } from '@ft/shared';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';

// Сканы документов из результатов поиска: группы по записям утечек без повторов (бокс — ScansBox.tsx).

export type Meta = NonNullable<RouterOutputs['scans']['meta'][string]>;

/** Сканы одной записи утечки (одна папка документов одного человека). */
export interface ScanGroup {
  key: string;
  person: string | null;
  leak: string;
  ids: string[];
}

/** uuid сканов из записей утечек; скан, уже показанный в другой записи, не повторяется. */
function scanGroups(leaks: LeakCard[]): ScanGroup[] {
  const seen = new Set<string>();
  const out: ScanGroup[] = [];
  for (const card of leaks) for (const t of card.tuples ?? []) {
    const ids = (t.scans ?? []).map((s) => s.toLowerCase()).filter((s) => !seen.has(s) && seen.add(s));
    if (ids.length) out.push({ key: `${card.leak}:${t.tuple}`, person: t.names?.[0] ?? null, leak: card.leak, ids });
  }
  return out;
}

/**
 * Один и тот же файл бывает загружен в хранилище несколько раз (разные uuid, один sha256) и привязан к разным
 * записям утечки — показывается только первая копия; запись, у которой не осталось сканов, не показывается.
 */
function dropDuplicates(groups: ScanGroup[], meta: Record<string, Meta | null> | undefined): ScanGroup[] {
  if (!meta) return groups;
  const seen = new Set<string>();
  const out: ScanGroup[] = [];
  for (const g of groups) {
    const ids = g.ids.filter((id) => {
      const sha = meta[id]?.sha256;
      return !sha || (!seen.has(sha) && !!seen.add(sha));
    });
    if (ids.length) out.push(ids.length === g.ids.length ? g : { ...g, ids });
  }
  return out;
}

export interface FoundScans {
  /** Путь картинок (/scans); null — хранилище сканов выключено. */
  path: string | null;
  groups: ScanGroup[];
  count: number;
  meta: Record<string, Meta | null> | undefined;
  metaError: boolean;
}

/**
 * Сканы из результатов простого поиска (leaks = null — их нет). Хук, а не часть бокса: число сканов без дублей
 * нужно ещё и фильтру атрибутов, поэтому метаданные (там sha256) запрашиваются здесь.
 */
export function useFoundScans(leaks: LeakCard[] | null): FoundScans {
  const cfg = trpc.scans.config.useQuery(undefined, { staleTime: Infinity });
  const path = cfg.data?.imagePath ?? null;
  const raw = useMemo(() => (path && leaks ? scanGroups(leaks) : []), [path, leaks]);
  const ids = useMemo(() => raw.flatMap((g) => g.ids), [raw]);
  const meta = trpc.scans.meta.useQuery({ ids }, { enabled: ids.length > 0, staleTime: Infinity, retry: 1 });
  const groups = useMemo(() => dropDuplicates(raw, meta.data), [raw, meta.data]);
  return { path, groups, count: groups.reduce((n, g) => n + g.ids.length, 0), meta: meta.data, metaError: meta.isError };
}
