// Координаты из веб-ссылок карт (поиск по геоданным: кнопка «Из ссылки» и вставка ссылки в поле координат).

export type LinkPoint = { lat: number; lon: number; /** Что именно взято из ссылки — для подсказки. */ what: string };

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

function point(lat: string | number, lon: string | number, what: string): LinkPoint | null {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { lat: la, lon: lo, what };
}

/** «a,b» из параметра запроса; null — не пара чисел. */
function pairParam(v: string | null): [string, string] | null {
  const m = v?.trim().match(new RegExp(`^(${NUM})\\s*,\\s*(${NUM})$`));
  return m ? [m[1]!, m[2]!] : null;
}

function google(url: URL, raw: string): LinkPoint | null {
  // Ссылка на место: координаты самого места — !3d<широта>!4d<долгота> в data= (последняя пара — выбранное место).
  const places = [...raw.matchAll(new RegExp(`!3d(${NUM})!4d(${NUM})`, 'g'))];
  const place = places.at(-1);
  if (place) return point(place[1]!, place[2]!, 'координаты места');
  for (const key of ['q', 'query', 'll', 'center', 'destination', 'daddr']) {
    const p = pairParam(url.searchParams.get(key));
    if (p) return point(p[0], p[1], 'точка из ссылки');
  }
  // Иначе — центр показанной области: /@<широта>,<долгота>,<зум>z или ,<высота>m.
  const view = raw.match(new RegExp(`/@(${NUM}),(${NUM})`));
  if (view) return point(view[1]!, view[2]!, 'центр карты');
  return null;
}

function yandex(url: URL): LinkPoint | null {
  // У Яндекса порядок обратный: «долгота,широта».
  for (const key of ['pt', 'whatshere[point]', 'll']) {
    const p = pairParam(url.searchParams.get(key)?.split('~')[0]?.split(',').slice(0, 2).join(',') ?? null);
    if (p) return point(p[1], p[0], key === 'll' ? 'центр карты' : 'точка из ссылки');
  }
  return null;
}

function osm(url: URL): LinkPoint | null {
  const m = pairParam(url.searchParams.get('mlat') && url.searchParams.get('mlon') ? `${url.searchParams.get('mlat')},${url.searchParams.get('mlon')}` : null);
  if (m) return point(m[0], m[1], 'маркер');
  const view = url.hash.match(new RegExp(`map=\\d+(?:\\.\\d+)?/(${NUM})/(${NUM})`));
  return view ? point(view[1]!, view[2]!, 'центр карты') : null;
}

/** Ссылка Google Maps (а также Яндекс Карт и OpenStreetMap) → точка; null — координат в ссылке нет. */
export function parseMapLink(text: string): LinkPoint | null {
  const s = text.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  let raw = url.href;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Битая %-последовательность — ищем в исходном виде.
  }
  const host = url.hostname.replace(/^www\./, '');
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === 'maps.google.com') return google(url, raw);
  if (/(^|\.)yandex\.[a-z.]+$/.test(host) || host === 'ya.ru') return yandex(url);
  if (/(^|\.)openstreetmap\.org$/.test(host)) return osm(url);
  return null;
}

/** Короткие ссылки (maps.app.goo.gl, goo.gl/maps) координат не содержат — их надо открыть и скопировать полную. */
export function isShortMapLink(text: string): boolean {
  return /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text.trim());
}
