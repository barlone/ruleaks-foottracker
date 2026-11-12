import { isPagesQuery, type EmailReport } from '@ft/shared';
import type { PendingPage } from './AddPagesDialog.tsx';

// Помощники страницы «Поиск по Email» (без разметки — правило Fast Refresh: .tsx экспортирует только компоненты).

/** Ручной поиск адреса точной фразой: Google без JavaScript выдачу серверу не отдаёт, а браузеру пользователя — да. */
export function manualSearchLinks(email: string): { label: string; url: string }[] {
  const q = encodeURIComponent(`"${email}"`);
  return [
    { label: 'Google', url: `https://www.google.com/search?q=${q}` },
    { label: 'Яндекс', url: `https://yandex.ru/search/?text=${q}` },
    { label: 'Bing', url: `https://www.bing.com/search?q=${q}` },
    { label: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${q}` },
  ];
}

/** Ник из имени до @ (без +метки) — для поиска личных страниц; null — не годится в ник. */
export function nickOf(local: string): string | null {
  const nick = local.split('+')[0] ?? '';
  return nick.length >= 2 && isPagesQuery(nick) ? nick : null;
}

/** Ссылки из отчёта для «Соцсети и ссылки» досье: Карты и календарь Google, сайты с регистрацией, точные упоминания. */
export function reportLinks(r: EmailReport): PendingPage[] {
  const links: PendingPage[] = [];
  if (r.google.status === 'ok' && !r.google.data.demo) {
    const g = r.google.data;
    if (g.maps.status === 'ok' && g.maps.data.state === 'ok') links.push({ site: 'Google Карты', url: g.maps.data.profileUrl });
    if (g.calendar.status === 'ok' && g.calendar.data.icsUrl) links.push({ site: 'Google Календарь', url: g.calendar.data.icsUrl });
  }
  if (r.sites.status === 'ok') {
    for (const c of r.sites.data.checks) if (c.status === 'claimed') links.push({ site: c.site, url: c.url, by: 'email' });
  }
  if (r.web.status === 'ok') {
    for (const h of r.web.data.hits) if (h.exact) links.push({ site: h.title.length > 60 ? `${h.title.slice(0, 60)}…` : h.title, url: h.url });
  }
  return links;
}
