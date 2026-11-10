import type { GoogleCalendar, GoogleCalendarEvent } from '@ft/shared';
import { bodyJson, GoogleError, query, type Ctx } from './net.ts';
import type { GoogleSession } from './session.ts';

// apis/calendar.py + helpers/calendar.py: если основной календарь адреса открыт для всех, внутренний Calendar API
// (clients6.google.com) отдаёт его описание и события любой вошедшей сессии.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const API = 'https://clients6.google.com/calendar/v3/calendars';
/** Страниц событий по 2500 (предел API) — не больше. */
const MAX_PAGES = 8;
const EVENTS_SHOWN = 20;

/** dateTime события → ISO в UTC; событие на весь день (только date) времени не имеет. */
function isoUtc(v: unknown): string | null {
  const s = text(obj(v).dateTime);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const NONE: GoogleCalendar = { found: false, id: null, summary: null, timeZone: null, total: 0, events: [], icsUrl: null, otherNames: [] };

/** helpers/calendar.py fetch_all + out. profileName — имя профиля: «другие имена» — те, что от него отличаются. */
export async function publicCalendar(session: GoogleSession, email: string, profileName: string | null, ctx: Ctx): Promise<GoogleCalendar> {
  const id = encodeURIComponent(email);
  const res = await session.webApi('calendar', `${API}/${id}`, ctx);
  const cal = obj(await bodyJson(res, ctx));
  if (cal.error) {
    // Закрытый календарь — 404 notFound; остальное — сбой, а не «календаря нет».
    if (res.status === 404) return NONE;
    throw new GoogleError(res.status === 403 ? 'AUTH' : 'HTTP', `Календарь: HTTP ${res.status} ${String(obj(cal.error).message ?? '')}`);
  }

  // get_events, шаблон max_from_beginning — все страницы.
  const items: Json[] = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string | number | boolean> = { calendarId: email, singleEvents: true, maxAttendees: 1, maxResults: 2500 };
    if (pageToken) params.pageToken = pageToken;
    const r = await session.webApi('calendar', `${API}/${id}/events?${query(params)}`, ctx);
    const data = obj(await bodyJson(r, ctx));
    if (data.error) break; // описание календаря открыто, события — нет
    if (Array.isArray(data.items)) items.push(...data.items.map(obj));
    pageToken = text(data.nextPageToken) ?? '';
    if (!pageToken) break;
  }

  const events: GoogleCalendarEvent[] = items.slice(-EVENTS_SHOWN).reverse().map((e) => ({
    title: text(e.summary),
    start: isoUtc(e.start),
    end: isoUtc(e.end),
    location: text(e.location),
    link: text(e.htmlLink),
  }));

  // Имена, которыми владелец подписан в собственных событиях.
  const names = new Set<string>();
  for (const e of items) {
    const creator = obj(e.creator);
    const name = text(creator.displayName);
    if (name && name !== profileName && text(creator.email)?.toLowerCase() === email.toLowerCase()) names.add(name);
  }

  const summary = text(cal.summary);
  return {
    found: true,
    id: text(cal.id),
    summary: summary && summary !== cal.id ? summary : null,
    timeZone: text(cal.timeZone),
    total: items.length,
    events,
    icsUrl: items.length ? `https://calendar.google.com/calendar/ical/${id}/public/basic.ics` : null,
    otherNames: [...names],
  };
}
