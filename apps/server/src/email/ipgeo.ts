import type { EmailIpGeo } from '@ft/shared';
import { isPublicIp } from '../pages/outbound.ts';
import { EmailError, num, obj, readJson, statusError, str, xfetch, type Ctx } from './http.ts';

// Модуль ipapi MOSINT (v3/pkg/services/ipapi): где стоят серверы домена — адрес домена (A) и основного почтового
// сервера (MX). Сервис ipapi.co без ключа (1000 запросов в сутки на адрес сервера). Непубличные адреса (домен,
// указывающий во внутреннюю сеть) не отправляются.

export interface IpTarget {
  ip: string;
  role: EmailIpGeo['role'];
  host: string;
}

/** Геолокация по очереди — у бесплатного ipapi.co строгий лимит частоты. */
export async function ipGeo(targets: IpTarget[], ctx: Ctx): Promise<EmailIpGeo[]> {
  const out: EmailIpGeo[] = [];
  for (const t of targets) {
    if (!isPublicIp(t.ip)) continue;
    const what = `ipapi ${t.ip}`;
    const res = await xfetch(`https://ipapi.co/${encodeURIComponent(t.ip)}/json/`, { headers: { Accept: 'application/json' } }, ctx, what);
    if (res.status !== 200) throw await statusError(res, ctx, what);
    const d = obj(await readJson(res, ctx, what));
    if (!d) throw new EmailError('PARSE', `${what}: не объект`);
    if (d.error) {
      const reason = str(d.reason) ?? '';
      if (/rate ?limit/i.test(reason)) throw new EmailError('LIMIT', `${what}: ${reason}`);
      if (/reserved/i.test(reason)) continue;
      throw new EmailError('HTTP', `${what}: ${reason} ${str(d.message) ?? ''}`);
    }
    out.push({
      ip: t.ip,
      role: t.role,
      host: t.host,
      city: str(d.city),
      region: str(d.region),
      country: str(d.country_name),
      countryCode: str(d.country_code),
      lat: num(d.latitude),
      lon: num(d.longitude),
      timezone: str(d.timezone),
      asn: str(d.asn),
      org: str(d.org),
    });
  }
  return out;
}
