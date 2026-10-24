import { useCallback, useRef, useState, type ReactNode } from 'react';

// Процесс в браузере для окна длительного процесса (ProcessDialog в ProgressDialog.tsx): run() показывает окно
// на время промиса, p.set() двигает шкалу, cancel() прерывает через AbortSignal.

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
