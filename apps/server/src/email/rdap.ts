import type { EmailRdap } from '@ft/shared';
import { OutboundBlocked, outboundFetch } from '../pages/outbound.ts';
import { arr, EmailError, obj, readJson, requestSignal, str, type Ctx } from './http.ts';

// Регистрация домена — замена полей EmailRep new_domain / days_since_domain_creation без ключа API: RDAP (преемник
// WHOIS в JSON). rdap.org по реестру IANA перенаправляет запрос на RDAP-сервер реестра зоны, поэтому редиректы
// следуются через pages/outbound.ts — каждый адрес цепочки проверяется на публичность. Зоны без RDAP (.ru, .рф,
// .su) отвечают 404 — регистрация тогда неизвестна (null).

const RDAP_BOOTSTRAP = 'https://rdap.org/domain/';
const DAY = 86_400_000;

/** Домен и его родители до двух меток: mail.company.co.uk → company.co.uk (регистрируется не поддомен). */
function candidates(domain: string): string[] {
  const labels = domain.split('.');
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2 && out.length < 3; i++) out.push(labels.slice(i).join('.'));
  return out;
}

function eventDate(events: unknown[], action: string): string | null {
  for (const e of events) {
    const o = obj(e);
    if (o && str(o.eventAction)?.toLowerCase() === action) {
      const d = str(o.eventDate);
      if (d && !Number.isNaN(Date.parse(d))) return new Date(d).toISOString();
    }
  }
  return null;
}

/** Имя регистратора из vCard (jCard): ['vcard', [['fn', {}, 'text', 'Имя'], …]]. */
function registrarName(entities: unknown[]): string | null {
  for (const e of entities) {
    const o = obj(e);
    if (!o || !arr(o.roles).includes('registrar')) continue;
    const card = arr(arr(o.vcardArray)[1]);
    for (const prop of card) {
      const p = arr(prop);
      if (p[0] === 'fn' && typeof p[3] === 'string' && p[3].trim()) return p[3].trim();
    }
    const handle = str(o.handle);
    if (handle) return handle;
  }
  return null;
}

export async function domainRdap(domain: string, ctx: Ctx): Promise<EmailRdap | null> {
  for (const d of candidates(domain)) {
    let res: Response;
    try {
      res = await outboundFetch(`${RDAP_BOOTSTRAP}${encodeURIComponent(d)}`, {
        method: 'GET', headers: { Accept: 'application/rdap+json, application/json' }, follow: true, signal: requestSignal(ctx),
      });
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      if (e instanceof OutboundBlocked) throw new EmailError('NET', `RDAP ${d}: ${e.message}`);
      if ((e as Error).name === 'TimeoutError') throw new EmailError('TIMEOUT', `RDAP ${d}: таймаут`);
      throw new EmailError('NET', `RDAP ${d}: ${(e as Error).message}`);
    }
    if (res.status === 404 || res.status === 400) {
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      throw new EmailError(res.status === 429 ? 'LIMIT' : 'HTTP', `RDAP ${d}: HTTP ${res.status}`);
    }
    const data = obj(await readJson(res, ctx, `RDAP ${d}`));
    if (!data) throw new EmailError('PARSE', `RDAP ${d}: не объект`);
    const events = arr(data.events);
    const created = eventDate(events, 'registration');
    return {
      domain: (str(data.ldhName) ?? d).toLowerCase(),
      created,
      updated: eventDate(events, 'last changed'),
      expires: eventDate(events, 'expiration'),
      ageDays: created ? Math.floor((Date.now() - Date.parse(created)) / DAY) : null,
      registrar: registrarName(arr(data.entities)),
      status: arr(data.status).filter((s): s is string => typeof s === 'string'),
      nameservers: arr(data.nameservers).map((n) => str(obj(n)?.ldhName)?.toLowerCase()).filter((n): n is string => !!n),
    };
  }
  return null;
}
