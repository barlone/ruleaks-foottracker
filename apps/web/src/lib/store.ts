import { useSyncExternalStore } from 'react';

/** Крошечный глобальный стор (вместо zustand, пока хватает). */
export function create<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(v: T) {
      value = v;
      subs.forEach((s) => s());
    },
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

export function useStore<T>(s: ReturnType<typeof create<T>>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
