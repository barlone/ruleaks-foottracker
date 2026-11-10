import type { GoogleMaps } from '@ft/shared';
import { GMAPS_STATS_PB, WEB_HEADERS } from './knowledge.ts';
import { bodyJson, gfetch, GoogleError, type Ctx } from './net.ts';

// helpers/gmaps.py get_reviews: статистика участника Карт Google по Gaia ID — без входа, обычным запросом к
// www.google.com. Разбор самих отзывов и фото в GHunt отключён (Google поменял формат, issue #529), поэтому
// и здесь — только счётчики и ссылка на страницу участника.

export const mapsProfileUrl = (gaiaId: string) => `https://www.google.com/maps/contrib/${gaiaId}/reviews`;

export async function mapsStats(gaiaId: string, ctx: Ctx): Promise<GoogleMaps> {
  const profileUrl = mapsProfileUrl(gaiaId);
  const pb = GMAPS_STATS_PB.replace('{}', gaiaId);
  let res: Response;
  try {
    res = await gfetch(`https://www.google.com/locationhistory/preview/mas?authuser=0&hl=en&gl=us&pb=${pb}`, { headers: WEB_HEADERS }, ctx);
  } catch (e) {
    // «failed» в GHunt: адрес сервера заблокирован, Google показывает капчу.
    if (e instanceof GoogleError && e.code === 'BLOCKED') return { profileUrl, state: 'blocked', stats: {} };
    throw e;
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    throw new GoogleError('HTTP', `Карты: HTTP ${res.status}`);
  }
  const data = await bodyJson(res, ctx);
  // data[16][8][0] — секции статистики: [6] — название (Reviews, Ratings, Photos…), [7] — число.
  const sections: unknown = (((data as unknown[] | null)?.[16] as unknown[] | null | undefined)?.[8] as unknown[] | null | undefined)?.[0];
  const stats: Record<string, number> = {};
  if (Array.isArray(sections)) {
    for (const sec of sections) {
      if (Array.isArray(sec) && typeof sec[6] === 'string' && typeof sec[7] === 'number') stats[sec[6]] = sec[7];
    }
  }
  const total = (stats.Reviews ?? 0) + (stats.Ratings ?? 0) + (stats.Photos ?? 0);
  return { profileUrl, state: total ? 'ok' : 'empty', stats };
}
