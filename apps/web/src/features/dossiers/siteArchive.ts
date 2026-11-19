import { isArchiveActive, type ArchiveFormat, type ArchiveJobView } from '@ft/shared';
import { trpc } from '../../lib/trpc.ts';

// Архивы страниц ссылок досье (служба RuLeaks.ArchiveBox, routers/siteArchive.ts): настройки, задания, Google Диск.
// Компоненты — SiteArchive.tsx.

/** null — службы нет: кнопок архивации не показывать. */
export function useArchiveConfig() {
  return trpc.siteArchive.config.useQuery(undefined, { staleTime: Infinity }).data ?? null;
}

/** Google Диск пользователя: перечитывается при возврате на вкладку (подключали в соседней). */
export function useDriveStatus(enabled: boolean) {
  return trpc.siteArchive.drive.useQuery(undefined, { enabled, refetchOnWindowFocus: true, staleTime: 30_000 }).data ?? null;
}

const busy = (j: ArchiveJobView) => isArchiveActive(j.state) || j.drive.status === 'uploading';

/** Задания пользователя по досье; пока хоть одно идёт (или сохраняется на Диск) — опрос каждые 2 с. */
export function useDossierArchives(dossierId: string, enabled: boolean) {
  return trpc.siteArchive.list.useQuery({ dossierId }, {
    enabled,
    refetchInterval: (q) => (q.state.data?.some(busy) ? 2000 : false),
    refetchIntervalInBackground: true,
  }).data ?? [];
}

/**
 * Задание для строки ссылки (список отсортирован сервером: новые первыми): идущее, иначе последнее готовое —
 * отменённый или неудавшийся повторный захват не прячет уже снятый архив, — иначе последнее любое.
 */
export function latestFor(jobs: ArchiveJobView[], itemId: string): ArchiveJobView | null {
  const mine = jobs.filter((j) => j.itemId === itemId);
  return mine.find(busy) ?? mine.find((j) => j.state === 'done') ?? mine[0] ?? null;
}

export const archiveFileUrl = (jobId: string, format: ArchiveFormat, inline = false) =>
  `/site-archive/${encodeURIComponent(jobId)}/${format}${inline ? '?inline=1' : ''}`;

/** Архив, сохранённый на Google Диск (LinkArchive): сервер отдаёт его с Диска того, кто снял. */
export const savedFileUrl = (dossierId: string, itemId: string, archiveId: string, format: ArchiveFormat, inline = false) =>
  `/site-archive/saved/${[dossierId, itemId, archiveId].map(encodeURIComponent).join('/')}/${format}${inline ? '?inline=1' : ''}`;

/** Подключить Google Диск: уход на Google и возврат на эту же страницу. */
export const driveConnectUrl = () => `/site-archive/google/connect?back=${encodeURIComponent(location.pathname + location.search)}`;

/** Доля выполненного для шкалы: null — служба ещё не взяла страницу (длительность неизвестна). */
export function archiveProgress(j: ArchiveJobView): number | null {
  if (j.state === 'queued') return null;
  if (!isArchiveActive(j.state)) return 1;
  const n = j.parts.length;
  if (j.state === 'uploading') return (n + 1) / (n + 2);
  const finished = j.parts.filter((p) => p.status !== 'pending' && p.status !== 'running').length;
  const running = j.parts.filter((p) => p.status === 'running').length;
  // Последние доли — проверка файлов и сохранение на Диск.
  return j.state === 'finishing' ? n / (n + 2) : (finished + running * 0.4) / (n + 2);
}
