import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';

// Исходящие запросы поиска личных страниц идут к сотням чужих сайтов из манифестов. Любой из них (или подменённая
// запись в манифесте) может ответить редиректом на внутренний адрес — localhost, базу, scanstore, метаданные облака —
// и сервер сходил бы туда своими сетевыми правами. Поэтому:
// - редиректы следуются вручную, каждый адрес цепочки должен быть http(s), а буквальный IP — публичным;
// - имя проверяется в момент соединения: свой lookup у агента undici отвергает непубличные адреса. Отдельная
//   проверка DNS до fetch не годится — fetch разрешает имя ещё раз, и второй ответ может указать внутрь (rebinding).
// Запросы идут через fetch из пакета undici, а не глобальный: глобальному fetch агент из пакета не подходит
// (другая копия undici внутри Node).

/** Больше переходов по редиректам не делаем (как лимит fetch). */
const MAX_REDIRECTS = 5;

export class OutboundBlocked extends Error {}

/**
 * Публичный ли адрес: только диапазон unicast по ipaddr.js. Отсекаются частные сети, loopback, link-local
 * (в т. ч. метаданные облака 169.254.169.254), CGNAT, 0.0.0.0/8, TEST-NET, 198.18/15, 240/4, broadcast, multicast,
 * unique-local, NAT64 (64:ff9b::/96), 6to4, Teredo. IPv4-mapped IPv6 (::ffff:7f00:1 = 127.0.0.1) сводится к IPv4.
 * Неразборчивый адрес — не публичный.
 */
export function isPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  const a = ipaddr.process(ip);
  if (a.range() !== 'unicast') return false;
  // ::/96 — устаревшие IPv4-compatible адреса (::7f00:1); ipaddr.js считает их unicast.
  if (a.kind() === 'ipv6' && a.toByteArray().slice(0, 12).every((b) => b === 0)) return false;
  return true;
}

const BLOCKED = 'адрес во внутренней сети';

/** Отказ, если адрес не http(s) или его хост — localhost / непубличный IP. Имена проверяет lookup агента. */
export function assertPublic(u: URL): void {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new OutboundBlocked(`схема ${u.protocol} не разрешена`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw new OutboundBlocked(BLOCKED);
  if (isIP(host) && !isPublicIp(host)) throw new OutboundBlocked(BLOCKED);
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * lookup для net/tls.connect: разрешает имя и отказывает, если хоть один адрес непубличный. Вызывается при каждом
 * новом соединении, и соединяется сокет именно с проверенными адресами. С autoSelectFamily Node просит all: true.
 */
function safeLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err, []);
    if (!addrs.length) return callback(Object.assign(new Error(`адрес ${hostname} не найден`), { code: 'ENOTFOUND' }), []);
    if (addrs.some((a) => !isPublicIp(a.address))) return callback(new OutboundBlocked(BLOCKED), []);
    if (options.all) return callback(null, addrs);
    callback(null, addrs[0]!.address, addrs[0]!.family);
  });
}

const agent = new Agent({ connect: { lookup: safeLookup } });

/** undici заворачивает ошибку соединения в TypeError: fetch failed { cause } — достаём наш отказ из цепочки. */
function blockedCause(e: unknown): OutboundBlocked | null {
  for (let c = e, i = 0; c instanceof Error && i < 5; c = c.cause, i++) if (c instanceof OutboundBlocked) return c;
  return null;
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
    assertPublic(current);
    let res: Response;
    try {
      // Response из пакета undici совместим с глобальным по поведению; типы у них разные копии.
      res = (await undiciFetch(current, { method, headers, body, redirect: 'manual', signal: init.signal, dispatcher: agent })) as unknown as Response;
    } catch (e) {
      throw blockedCause(e) ?? e;
    }
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
