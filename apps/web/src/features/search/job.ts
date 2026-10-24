import { useEffect, useRef } from 'react';
import { FUZZY_MODES, GEO_MODES, SEARCH_KINDS, TG_MODES, type SearchSection } from '@ft/shared';
import { trpc } from '../../lib/trpc.ts';

// Общее для разделов поиска без разметки: подпись вида поиска, опрос задачи, запуск поиска из адреса.

export function kindLabel(section: SearchSection, kind: string): string {
  const list: readonly { id: string; label: string }[] =
    section === 'attr' ? SEARCH_KINDS : section === 'tg' ? TG_MODES : section === 'geo' ? GEO_MODES : FUZZY_MODES;
  return list.find((k) => k.id === kind)?.label ?? kind;
}

/** Опрос задачи, пока шлюз её считает. */
export function useSearchJob(jobId: string | null) {
  const utils = trpc.useUtils();
  const q = trpc.search.job.useQuery(
    { id: jobId ?? '' },
    // И в фоне: тяжёлый поиск идёт минутами, пользователь тем временем на другой вкладке.
    // После ошибки (задача пропала, сервер перезапущен) прежние данные остаются в кэше — опрос по ним не продолжаем.
    { enabled: !!jobId, refetchInterval: (q) => (!q.state.error && q.state.data?.state === 'running' ? 1500 : false), refetchIntervalInBackground: true },
  );
  // Задача завершилась — обновить историю, чтобы там не осталось индикатора «выполняется».
  const state = q.data?.state;
  const section = q.data?.section;
  useEffect(() => {
    if (section && state && state !== 'running') void utils.search.recent.invalidate({ section });
  }, [state, section, utils]);
  return q;
}

/**
 * Однократный запуск поиска из параметров ссылки (?q=…) при открытии страницы.
 * Ref защищает от двойного вызова эффекта в StrictMode — иначе в истории два одинаковых запроса.
 * requested берётся только с первого рендера: обычный поиск со страницы сам пишет параметры в адрес, и без этого
 * следом уходил бы второй, такой же запрос. ready — можно запускать (загружен доступ пользователя).
 */
export function useRunOnMount(fn: () => void, requested: boolean, ready: boolean) {
  const atMount = useRef(requested);
  const done = useRef(false);
  useEffect(() => {
    if (!atMount.current || !ready || done.current) return;
    done.current = true;
    fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
