import type { Theme } from '@ft/shared';
import { create } from './store.ts';

// Тема — атрибут data-theme на <html>: цвета переключаются CSS-переменными (styles.css), тёмная — без атрибута.
// Источник правды — настройки пользователя в БД (Root в AppShell). localStorage — лишь копия для первой отрисовки:
// её читает скрипт в index.html (ответа сервера ещё нет, и страница мигнула бы тёмной), и по ней же открывается
// страница входа. Ключ тот же, что в index.html.

const STORAGE_KEY = 'ft-theme';

/** Текущая тема: для того, что CSS-переменными не красится (карта, React Flow). */
export const theme = create<Theme>(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function applyTheme(next: Theme) {
  const root = document.documentElement;
  if (next === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
  try {
    if (next === 'light') localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Хранилище недоступно (приватный режим): тема всё равно придёт с сервера, только чуть позже.
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cssColor('--color-bg'));
  theme.set(next);
}

/** Значение цвета из styles.css — для MapLibre, который рисует в canvas и var() не понимает. */
export const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
