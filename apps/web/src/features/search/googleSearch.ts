import { createContext, useContext } from 'react';
import type { GoogleModeId } from '@ft/shared';

// «Искать дальше»: из результата (участник файла Drive, профиль аккаунта) запускается следующий поиск — по Gaia ID
// в «Поиске по Google», по адресу в «Поиске по Email». Страница раздела кладёт в контекст свою функцию запуска:
// тогда поиск идёт прямо на ней; без контекста (undefined) кнопка ведёт на страницу раздела. null — раздел есть,
// но искать нельзя (нет подписки): кнопки нет.

export type GoogleRun = (mode: GoogleModeId, query: string) => void;
export type EmailRun = (email: string) => void;

export const GoogleRunContext = createContext<GoogleRun | null | undefined>(undefined);
export const EmailRunContext = createContext<EmailRun | null | undefined>(undefined);

export const useGoogleRun = () => useContext(GoogleRunContext);
export const useEmailRun = () => useContext(EmailRunContext);

/** Адрес картинки Google покрупнее: суффикс размера =s100 → =s1024. Адрес data: (имитация) не трогаем. */
export const bigPhoto = (url: string) => (url.startsWith('https://') ? url.replace(/=s\d+[^=/]*$/, '=s1024') : url);

/** «1 ч 30 мин» между двумя моментами; пусто — нет времени или длительность нулевая. */
export function durationText(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  return minutesText(Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
}

/** «2 дн 3 ч 5 мин»; пусто — не больше нуля. */
export function minutesText(min: number): string {
  if (!(min > 0)) return '';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  return [d && `${d} дн`, h && `${h} ч`, m && `${m} мин`].filter(Boolean).join(' ');
}

/** Размер файла: «12,4 МБ». */
export function sizeText(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i ? v.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : v} ${units[i]}`;
}
