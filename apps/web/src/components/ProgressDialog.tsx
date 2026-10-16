import * as RDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui.tsx';

// Окно длительного процесса: шкала выполнения (gauge), что происходит, сколько прошло времени, «Отмена».
// Пока процесс идёт, окно не закрыть щелчком мимо или Esc — только отменить (если можно).
// Два способа использования:
//   <ProgressDialog …/>        — состояние ведёт вызывающая сторона (опрос задания на сервере);
//   useProcess() + <ProcessDialog process={…}/> — для асинхронного кода в браузере: run() показывает окно
//                                на время промиса, p.set() двигает шкалу, cancel() прерывает через AbortSignal.

export interface ProgressProps {
  open: boolean;
  title: ReactNode;
  /** 0…1 — доля выполненного; null — длительность неизвестна (бегущая полоса). */
  value: number | null;
  /** Что происходит сейчас («Проверено 120 из 481»). */
  status?: ReactNode;
  /** Вторая строка, мелко («найдено 7 · без ответа 3»). */
  detail?: ReactNode;
  /** Начало процесса (Date.now()) — отсчёт прошедшего времени. */
  startedAt?: number | null;
  /** Без onCancel кнопки «Отмена» нет и окно нельзя закрыть, пока процесс идёт. */
  onCancel?: () => void;
  cancelling?: boolean;
}

function elapsedText(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Текущее время, обновляется раз в секунду, пока active. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function ProgressDialog({ open, title, value, status, detail, startedAt, onCancel, cancelling }: ProgressProps) {
  const now = useNow(open && !!startedAt);
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <RDialog.Root open={open}>
      <RDialog.Portal>
        {/* Поверх любых других окон (экспорт открывает прогресс из своего диалога). */}
        <RDialog.Overlay className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
          <RDialog.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              onCancel?.();
            }}
            className="relative w-full max-w-md animate-fade-up rounded-2xl border border-line bg-panel p-6 shadow-glow"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <RDialog.Title className="label-mono flex items-center gap-2.5">
                <span className="size-1.5 animate-blink rounded-full bg-mint shadow-[0_0_10px_var(--color-mint)]" />
                {title}
              </RDialog.Title>
              <span className="font-mono text-2xl font-bold tabular-nums text-mint">{pct === null ? '' : `${pct}%`}</span>
            </div>
            <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Выполнение'}</RDialog.Description>

            {/* Шкала: заполненная часть светится; при неизвестной длительности по ней бежит блик. */}
            <div className="h-2.5 overflow-hidden rounded-full border border-line bg-mint/5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
              <div
                className={clsx('h-full rounded-full bg-mint shadow-[0_0_12px_var(--color-mint)] transition-[width] duration-500 ease-out', pct === null && 'progress-indeterminate')}
                style={{ width: pct === null ? '100%' : `${pct}%` }}
              />
            </div>

            <div className="mt-3 flex items-baseline justify-between gap-4 font-mono text-xs">
              <span className="min-w-0 truncate text-dim">{status ?? (pct === null ? 'Выполняется…' : '')}</span>
              {startedAt ? <span className="shrink-0 tabular-nums text-mute">{elapsedText(startedAt, now)}</span> : null}
            </div>
            {detail && <div className="mt-1 font-mono text-[11px] text-mute">{detail}</div>}

            {onCancel && (
              <div className="mt-5 flex justify-end">
                <Button variant="ghost" size="sm" onClick={onCancel} disabled={cancelling}>
                  {cancelling ? 'Останавливаю…' : 'Отмена'}
                </Button>
              </div>
            )}
          </RDialog.Content>
        </RDialog.Overlay>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------- Процесс в браузере ----------

export interface ProcessHandle {
  /** Срабатывает по «Отмена» — передавать в запросы (tRPC: client.x.mutate(input, { signal })). */
  signal: AbortSignal;
  /** Обновить шкалу и подписи; value: null — неизвестная длительность. */
  set(p: { value?: number | null; status?: ReactNode; detail?: ReactNode }): void;
}

interface ProcessState {
  title: ReactNode;
  value: number | null;
  status: ReactNode;
  detail: ReactNode;
  startedAt: number;
  cancellable: boolean;
}

/** Промис run() отклоняется этой ошибкой после «Отмена». */
export class ProcessCancelled extends Error {
  constructor() {
    super('Отменено');
  }
}

export const isCancelled = (e: unknown) => e instanceof ProcessCancelled;

export function useProcess() {
  const [state, setState] = useState<ProcessState | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  /** Показывает окно на время fn; cancellable — с кнопкой «Отмена» (fn получает signal). */
  const run = useCallback(async <T,>(title: ReactNode, fn: (p: ProcessHandle) => Promise<T>, opts: { cancellable?: boolean } = {}): Promise<T> => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ title, value: null, status: null, detail: null, startedAt: Date.now(), cancellable: !!opts.cancellable });
    const handle: ProcessHandle = {
      signal: c.signal,
      set: (p) => setState((s) => (s ? { ...s, ...p } : s)),
    };
    try {
      return await fn(handle);
    } catch (e) {
      throw c.signal.aborted ? new ProcessCancelled() : e;
    } finally {
      if (ctrl.current === c) {
        ctrl.current = null;
        setState(null);
      }
    }
  }, []);

  const cancel = useCallback(() => ctrl.current?.abort(), []);
  return { state, run, cancel };
}

export type Process = ReturnType<typeof useProcess>;

export function ProcessDialog({ process }: { process: Process }) {
  const s = process.state;
  return (
    <ProgressDialog
      open={!!s}
      title={s?.title ?? ''}
      value={s?.value ?? null}
      status={s?.status}
      detail={s?.detail}
      startedAt={s?.startedAt}
      onCancel={s?.cancellable ? process.cancel : undefined}
    />
  );
}
