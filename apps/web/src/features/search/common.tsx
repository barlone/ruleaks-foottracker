import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { FolderPlus, History, Trash2 } from 'lucide-react';
import { FUZZY_MODES, GEO_MODES, SEARCH_KINDS, TG_MODES, type SearchSection } from '@ft/shared';
import { Button, Card, Empty, Spinner } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { ago } from '../../lib/format.ts';
import { toast } from '../../lib/toast.ts';

// Общее для разделов поиска: раскладка «поиск + история», опрос задачи, панель действий.

export function kindLabel(section: SearchSection, kind: string): string {
  const list: readonly { id: string; label: string }[] =
    section === 'attr' ? SEARCH_KINDS : section === 'tg' ? TG_MODES : section === 'geo' ? GEO_MODES : FUZZY_MODES;
  return list.find((k) => k.id === kind)?.label ?? kind;
}

export function SearchLayout({
  section, title, titleExtra, subtitle, activeId, onOpen, history, children,
}: {
  /** Раздел истории поиска (search.recent); разделы со своей историей передают history. */
  section?: SearchSection;
  title: string;
  /** Что показать в строке заголовка после названия (мелкая подпись, ссылки). */
  titleExtra?: ReactNode;
  subtitle: string;
  activeId?: string | null;
  onOpen?: (id: string) => void;
  /** Свой блок истории вместо стандартного. */
  history?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-6 py-6 pl-6 pr-[30px] xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-6">
        <header className="animate-fade-up">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-2xl font-extrabold">{title}</h1>
            {titleExtra}
          </div>
          <p className="mt-1 text-sm text-dim">{subtitle}</p>
        </header>
        {children}
      </div>
      <aside className="space-y-4">
        {history ?? (section && onOpen ? <HistoryCard section={section} activeId={activeId ?? null} onOpen={onOpen} /> : null)}
      </aside>
    </div>
  );
}

function HistoryCard({ section, activeId, onOpen }: { section: SearchSection; activeId: string | null; onOpen: (id: string) => void }) {
  const utils = trpc.useUtils();
  const recent = trpc.search.recent.useQuery({ section });
  const [confirming, setConfirming] = useState(false);
  const clear = trpc.search.clearHistory.useMutation({
    onSuccess: (n) => {
      void utils.search.recent.invalidate({ section });
      toast(`История очищена: ${n}`);
      setConfirming(false);
    },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const items = recent.data ?? [];

  return (
    <Card title={<><History size={13} /> История</>}>
      {!items.length && <div className="font-mono text-xs text-mute">Пока пусто</div>}
      <div className="max-h-[60vh] space-y-1 overflow-auto">
        {items.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            className={clsx('block w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition hover:bg-mint/5', s.id === activeId && 'bg-mint/10')}
          >
            <div className="truncate font-mono text-sm">{s.query}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-mute">
              <span className="truncate">{kindLabel(section, s.kind)}</span>
              {s.deep && <span className="text-mint">deep</span>}
              {s.state === 'failed' && <span className="text-danger">ошибка</span>}
              <span className="shrink-0">· {ago(s.startedAt)}</span>
              {s.state === 'running' && <Spinner className="size-2.5" />}
            </div>
          </button>
        ))}
      </div>
      {items.length > 0 && (
        <div className="mt-3 border-t border-line-soft pt-3">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 font-mono text-[11px] text-dim">Удалить {items.length} запр.?</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Нет</Button>
              <Button size="sm" variant="danger" onClick={() => clear.mutate({ section })} disabled={clear.isPending}>Да</Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="w-full" onClick={() => setConfirming(true)}>
              <Trash2 size={13} /> Очистить историю
            </Button>
          )}
        </div>
      )}
    </Card>
  );
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

/** Состояния «выполняется / ошибка». error — ошибка запроса задачи (сервер её не нашёл). Возвращает null, когда пора рисовать результат. */
export function JobStatus({ job, loading, error }: { job: RouterOutputs['search']['job'] | undefined; loading: boolean; error?: string | null }) {
  if (error) return <Card><div className="text-danger">{error}</div></Card>;
  if (loading || !job) return <Empty><Spinner /></Empty>;
  if (job.state === 'running') {
    return (
      <Card>
        <div className="flex items-center gap-3 font-mono text-sm text-mint">
          <Spinner /> Запрос выполняется в базе… шлюз вернул задачу, опрашиваю результат
        </div>
      </Card>
    );
  }
  if (job.state === 'failed') return <Card><div className="text-danger">{job.error}</div></Card>;
  return null;
}

export function ResultBar({
  summary, selected, onAdd, label, extra,
}: {
  summary: string;
  selected: number;
  onAdd: () => void;
  label?: string;
  /** Кнопки справа от «Снимок в досье» (PDF в поиске по Telegram). */
  extra?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 px-4 py-2.5 backdrop-blur">
      <div className="font-mono text-xs text-dim">
        <span className="text-mint">{summary}</span> · отмечено: {selected}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onAdd}>
          <FolderPlus size={15} /> {label ?? (selected ? 'Отмеченное в досье' : 'Снимок в досье')}
        </Button>
        {extra}
      </div>
    </div>
  );
}

/**
 * Однократный запуск поиска из параметров ссылки (?q=…) при открытии страницы.
 * Ref защищает от двойного вызова эффекта в StrictMode — иначе в истории два одинаковых запроса.
 */
export function useRunOnMount(fn: () => void, enabled: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
