import { trpc } from '../../lib/trpc.ts';

/**
 * Элементы досье, куда переносятся результаты поиска: окно заранее показывает, что там уже есть.
 * Без кэша: досье мог изменить коллега. null — досье ещё не выбрано или создаётся новое, сравнивать не с чем.
 */
export function useTargetItems(dossierId: string | null) {
  const q = trpc.dossiers.get.useQuery({ id: dossierId ?? '' }, { enabled: !!dossierId, staleTime: 0 });
  return { items: dossierId ? (q.data?.items ?? []) : [], loading: !!dossierId && q.isLoading };
}
