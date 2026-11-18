import { isArchiveActive, type ArchiveFormat, type ArchiveJobView } from '@ft/shared';
import { trpc } from '../../lib/trpc.ts';

// Архивы страниц ссылок досье (служба RuLeaks.ArchiveBox, routers/siteArchive.ts): настройки и задания.
// Компоненты — SiteArchive.tsx.

/** null — службы нет: кнопок архивации не показывать. */
export function useArchiveConfig() {
  return trpc.siteArchive.config.useQuery(undefined, { staleTime: Infinity }).data ?? null;
}

/** Задания пользователя по досье; пока хоть одно идёт — опрос каждые 2 с (и в фоновой вкладке: задание ведёт сервер). */
export function useDossierArchives(dossierId: string, enabled: boolean) {
  return trpc.siteArchive.list.useQuery({ dossierId }, {
    enabled,
    refetchInterval: (q) => (q.state.data?.some((j) => isArchiveActive(j.state)) ? 2000 : false),
    refetchIntervalInBackground: true,
  }).data ?? [];
}

/**
 * Задание для строки ссылки (список отсортирован сервером: новые первыми): идущее, иначе последнее готовое —
 * отменённый или неудавшийся повторный захват не прячет уже снятый архив, — иначе последнее любое.
 */
export function latestFor(jobs: ArchiveJobView[], itemId: string): ArchiveJobView | null {
  const mine = jobs.filter((j) => j.itemId === itemId);
  return mine.find((j) => isArchiveActive(j.state)) ?? mine.find((j) => j.state === 'done') ?? mine[0] ?? null;
}

export const archiveFileUrl = (jobId: string, format: ArchiveFormat, inline = false) =>
  `/site-archive/${encodeURIComponent(jobId)}/${format}${inline ? '?inline=1' : ''}`;

/** Доля выполненного для шкалы: null — служба ещё не взяла страницу (длительность неизвестна). */
export function archiveProgress(j: ArchiveJobView): number | null {
  if (j.state === 'queued') return null;
  if (!isArchiveActive(j.state)) return 1;
  const n = j.parts.length;
  const finished = j.parts.filter((p) => p.status !== 'pending' && p.status !== 'running').length;
  const running = j.parts.filter((p) => p.status === 'running').length;
  // Последняя доля — проверка файлов после захвата.
  return j.state === 'finishing' ? n / (n + 1) : (finished + running * 0.4) / (n + 1);
}
