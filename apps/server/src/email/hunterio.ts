import type { HunterDomain, HunterEmail } from '@ft/shared';
import { arr, bool, EmailError, num, obj, readJson, statusError, str, xfetch, type Ctx } from './http.ts';

// Модуль hunter MOSINT (v3/pkg/services/hunter): Hunter.io Domain Search — организация домена, шаблон адресов
// сотрудников ({first}.{last}…), известные адреса с именами, должностями и страницами, где они опубликованы.
// Только для своего домена: у бесплатных почтовых сервисов «сотрудников» нет.

/** Бесплатный план Hunter отдаёт не больше 10 адресов за запрос. */
const LIMIT = 10;

function email(o: Record<string, unknown>): HunterEmail {
  return {
    value: (str(o.value) ?? '').toLowerCase(),
    firstName: str(o.first_name),
    lastName: str(o.last_name),
    position: str(o.position),
    seniority: str(o.seniority),
    department: str(o.department),
    linkedin: str(o.linkedin),
    twitter: str(o.twitter),
    phone: str(o.phone_number),
    confidence: num(o.confidence),
    sources: arr(o.sources).map(obj).filter((s): s is Record<string, unknown> => !!s && !!str(s.uri)).slice(0, 20).map((s) => ({
      uri: str(s.uri)!,
      extractedOn: str(s.extracted_on),
      lastSeenOn: str(s.last_seen_on),
      stillOnPage: bool(s.still_on_page),
    })),
  };
}

export async function hunterDomain(domain: string, target: string, key: string, ctx: Ctx): Promise<HunterDomain> {
  // Ключ — в адресе запроса (так устроен API Hunter); адрес в журнал не пишется.
  const res = await xfetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=${LIMIT}&api_key=${encodeURIComponent(key)}`, {
    headers: { Accept: 'application/json' },
  }, ctx, 'Hunter');
  if (res.status !== 200) throw await statusError(res, ctx, 'Hunter');
  const root = obj(await readJson(res, ctx, 'Hunter'));
  const d = obj(root?.data);
  if (!d) throw new EmailError('PARSE', 'Hunter: нет data');
  const meta = obj(root?.meta);
  const emails = arr(d.emails).map(obj).filter((e): e is Record<string, unknown> => !!e && !!str(e.value)).map(email);
  const links: HunterDomain['links'] = [];
  for (const [label, v] of [['LinkedIn', d.linkedin], ['Twitter', d.twitter], ['Facebook', d.facebook], ['Instagram', d.instagram], ['YouTube', d.youtube]] as const) {
    const s = str(v);
    if (s) links.push({ label, url: /^https?:\/\//i.test(s) ? s : label === 'Twitter' ? `https://x.com/${s.replace(/^@/, '')}` : s });
  }
  return {
    organization: str(d.organization),
    description: str(d.description),
    industry: str(d.industry),
    country: str(d.country),
    pattern: str(d.pattern),
    webmail: bool(d.webmail),
    disposable: bool(d.disposable),
    acceptAll: bool(d.accept_all),
    links,
    total: num(meta?.results),
    emails,
    target: emails.find((e) => e.value === target) ?? null,
  };
}
