import type { GoogleAddress } from '@ft/shared';
import { apiKeyHeaders, GEO_DUMMY_BSSID } from './knowledge.ts';
import { apiError, bodyJson, gfetch, GoogleError, query, type Ctx } from './net.ts';

// modules/geolocate.py + apis/geolocation.py: координаты точки доступа Wi-Fi по её MAC-адресу (BSSID) — открытый
// Geolocation API Google с ключом примера Maps JavaScript API (ключ принимается только с его Origin). Аккаунт не нужен.
// Адрес по координатам GHunt берёт у Nominatim (OpenStreetMap) — здесь тоже, но адрес сервиса задаётся в конфиге
// ([google-search] reverse-geocode): найденные координаты уходят туда, и в продакшене лучше свой экземпляр.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** User-Agent для Nominatim: правила сервиса требуют имя приложения вместо стандартного UA библиотек. */
const GEOCODER_UA = 'ghunt-port-geolocate/1.0';

export interface GeoFix {
  lat: number;
  lon: number;
  accuracyM: number;
}

/**
 * apis/geolocation.py geolocate. API нужны хотя бы две точки доступа: к единственной GHunt добавляет заведомо
 * известную вторую (GEO_DUMMY_BSSID). null — Google не знает этих точек.
 */
export async function geolocate(bssids: string[], ctx: Ctx): Promise<GeoFix | null> {
  const aps = (bssids.length >= 2 ? bssids : [GEO_DUMMY_BSSID, ...bssids]).map((macAddress) => ({ macAddress }));
  const res = await gfetch('https://www.googleapis.com/geolocation/v1/geolocate', {
    method: 'POST',
    headers: { ...apiKeyHeaders('geolocation'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ considerIp: false, wifiAccessPoints: aps }),
  }, ctx);
  const data = obj(await bodyJson(res, ctx));
  const err = apiError(data, res.status, 'Геолокация');
  if (err) {
    if (err.code === 'NOTFOUND') return null;
    // Ключ примера могут отозвать или ограничить — это не отказ служебного аккаунта (его здесь нет).
    if (err.code === 'AUTH') throw new GoogleError('HTTP', `${err.message} (ключ геолокации отклонён)`);
    throw err;
  }
  const loc = obj(data.location);
  const lat = typeof loc.lat === 'number' ? loc.lat : null;
  const lon = typeof loc.lng === 'number' ? loc.lng : null;
  if (lat === null || lon === null) throw new GoogleError('PARSE', 'Геолокация: в ответе нет координат');
  return { lat, lon, accuracyM: typeof data.accuracy === 'number' ? Math.round(data.accuracy) : 0 };
}

/**
 * Адрес по координатам (Nominatim /reverse), как geopy в GHunt. baseUrl — из конфига администратора, поэтому
 * обычный fetch, а не outboundFetch: свой экземпляр Nominatim может стоять и во внутренней сети. null — адреса нет.
 */
export async function reverseGeocode(baseUrl: string, lat: number, lon: number, ctx: Ctx): Promise<GoogleAddress | null> {
  const url = `${baseUrl}/reverse?${query({ format: 'jsonv2', lat: lat.toFixed(7), lon: lon.toFixed(7), zoom: 18, addressdetails: 1, 'accept-language': 'ru' })}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': GEOCODER_UA, Accept: 'application/json' }, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.timeoutMs)]) });
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    const name = (e as Error)?.name;
    throw new GoogleError(name === 'TimeoutError' ? 'TIMEOUT' : 'HTTP', `Геокодер: ${(e as Error)?.message ?? String(e)}`);
  }
  if (res.status === 429) throw new GoogleError('BLOCKED', 'Геокодер: слишком частые запросы');
  if (!res.ok) throw new GoogleError('HTTP', `Геокодер: HTTP ${res.status}`);
  let data: Json;
  try {
    data = obj(await res.json());
  } catch {
    throw new GoogleError('PARSE', 'Геокодер: ответ не JSON');
  }
  const display = text(data.display_name);
  if (data.error || !display) return null;
  const a = obj(data.address);
  // helpers/gmaps.py sanitize_location: город — city, иначе village, town, municipality.
  const city = text(a.city) ?? text(a.town) ?? text(a.village) ?? text(a.municipality);
  return { display, city, country: text(a.country) };
}
