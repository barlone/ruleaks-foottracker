import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Исходящие запросы поиска личных страниц идут к сотням чужих сайтов из манифестов. Любой из них (или подменённая
// запись в манифесте) может ответить редиректом на внутренний адрес — localhost, базу, scanstore, метаданные облака —
// и сервер сходил бы туда своими сетевыми правами. Поэтому редиректы здесь следуются вручную: каждый адрес цепочки
// должен быть http(s) и вести не в частную сеть (проверяется и буквальный IP, и результат DNS-запроса имени).

/** Больше переходов по редиректам не делаем (как лимит fetch). */
const MAX_REDIRECTS = 5;

export class OutboundBlocked extends Error {}

/** IPv4 внутри частного, loopback, link-local (в т. ч. метаданные облака 169.254.169.254), CGNAT или 0.0.0.0/8. */
function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** IPv6: loopback, unspecified, unique-local, link-local, а также IPv4-mapped — по правилам IPv4. */
function privateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  const mapped = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return privateV4(mapped[1]!);
  return /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}

export const isPrivateIp = (ip: string): boolean => (isIP(ip) === 4 ? privateV4(ip) : isIP(ip) === 6 ? privateV6(ip) : false);

/** Отказ, если адрес не http(s) или его хост — внутренний (буквально или по DNS). */
export async function assertPublic(u: URL): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new OutboundBlocked(`схема ${u.protocol} не разрешена`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new OutboundBlocked('адрес во внутренней сети');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new OutboundBlocked('адрес во внутренней сети');
    return;
  }
  // Имя: все адреса, в которые оно разрешается, должны быть публичными (иначе rebinding на внутренний адрес).
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return; // не разрешилось — fetch сам ответит ошибкой сети
  }
  if (addrs.some((a) => isPrivateIp(a.address))) throw new OutboundBlocked('адрес во внутренней сети');
}

export interface OutboundInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** false — вернуть первый ответ, даже если это редирект (как fetch redirect: 'manual'). */
  follow: boolean;
  signal: AbortSignal;
}

/**
 * fetch с ручными редиректами и проверкой каждого адреса. Как у fetch 'follow': 301/302/303 переводят
 * POST в GET без тела, 307/308 сохраняют метод и тело; больше MAX_REDIRECTS переходов — отдаётся последний ответ.
 */
export async function outboundFetch(url: string, init: OutboundInit): Promise<Response> {
  let current = new URL(url);
  let { method, body } = init;
  const headers = { ...init.headers };
  for (let hop = 0; ; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { method, headers, body, redirect: 'manual', signal: init.signal });
    const location = res.headers.get('location');
    if (!init.follow || !location || res.status < 300 || res.status > 399 || hop >= MAX_REDIRECTS) return res;
    await res.body?.cancel().catch(() => undefined);
    const next = new URL(location, current);
    if (res.status === 301 || res.status === 302 || res.status === 303) {
      if (method !== 'GET' && method !== 'HEAD') method = 'GET';
      body = undefined;
      delete headers['Content-Type'];
      delete headers['content-type'];
    }
    // На другой источник свои cookie/Authorization не переносим.
    if (next.origin !== current.origin) for (const k of Object.keys(headers)) if (/^(cookie|authorization)$/i.test(k)) delete headers[k];
    current = next;
  }
}
