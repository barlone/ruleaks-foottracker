import type { BreachDirectoryResult, EmailRep, HibpBreach, IntelxResult, PasteDump } from '@ft/shared';
import { arr, bool, EmailError, num, obj, readJson, sleep, statusError, str, xfetch, type Ctx } from './http.ts';

// Утечки и дампы — модули MOSINT v3/pkg/services: haveibeenpwned, breachdirectory, intelx, psbdmp, emailrep.
// HIBP, BreachDirectory, Intelligence X и EmailRep — только с ключом API ([email-search] *-key); psbdmp ключа не требует.

// ---------- Have I Been Pwned ----------

/** HTML-описание утечки HIBP → текст. */
function htmlText(s: string | null): string | null {
  if (!s) return null;
  const t = s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 700 ? `${t.slice(0, 700)}…` : t || null;
}

/** API v3 breachedaccount: все утечки с адресом (truncateResponse=false — с описанием и классами данных). */
export async function hibpBreaches(email: string, key: string, ctx: Ctx): Promise<HibpBreach[]> {
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`;
  for (let attempt = 0; ; attempt++) {
    const res = await xfetch(url, { headers: { 'hibp-api-key': key, Accept: 'application/json' } }, ctx, 'HIBP');
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return [];
    }
    // 429 у HIBP — частота запросов по ключу; Retry-After — сколько ждать. Короткую паузу переждём один раз.
    const retry = num(res.headers.get('retry-after'));
    if (res.status === 429 && attempt === 0 && retry !== null && retry <= 8) {
      await res.body?.cancel().catch(() => undefined);
      await sleep(retry * 1000 + 200, ctx.signal);
      continue;
    }
    if (res.status !== 200) throw await statusError(res, ctx, 'HIBP');
    return arr(await readJson(res, ctx, 'HIBP')).map(obj).filter((b): b is Record<string, unknown> => !!b).map((b) => ({
      name: str(b.Name) ?? '?',
      title: str(b.Title) ?? str(b.Name) ?? '?',
      domain: str(b.Domain),
      breachDate: str(b.BreachDate),
      addedDate: str(b.AddedDate),
      pwnCount: num(b.PwnCount) ?? 0,
      dataClasses: arr(b.DataClasses).filter((c): c is string => typeof c === 'string'),
      description: htmlText(str(b.Description)),
      verified: bool(b.IsVerified) ?? false,
      sensitive: bool(b.IsSensitive) ?? false,
      spamList: bool(b.IsSpamList) ?? false,
      malware: bool(b.IsMalware) ?? false,
      fabricated: bool(b.IsFabricated) ?? false,
      logoUrl: str(b.LogoPath),
    })).sort((x, y) => (y.breachDate ?? '').localeCompare(x.breachDate ?? ''));
  }
}

// ---------- BreachDirectory (RapidAPI) ----------

const BD_HOST = 'breachdirectory.p.rapidapi.com';
const BD_MAX = 100;

export async function breachDirectory(email: string, key: string, ctx: Ctx): Promise<BreachDirectoryResult> {
  const res = await xfetch(`https://${BD_HOST}/?func=auto&term=${encodeURIComponent(email)}`, {
    headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': BD_HOST, Accept: 'application/json' },
  }, ctx, 'BreachDirectory');
  if (res.status !== 200) throw await statusError(res, ctx, 'BreachDirectory');
  const d = obj(await readJson(res, ctx, 'BreachDirectory'));
  if (!d) throw new EmailError('PARSE', 'BreachDirectory: не объект');
  // success: false без результатов — «ничего не найдено»; с сообщением об ошибке — ошибка.
  if (d.success === false) {
    const msg = str(d.message) ?? str(d.error) ?? '';
    if (!msg || /not found|no result/i.test(msg)) return { found: 0, entries: [] };
    throw new EmailError(/limit|quota/i.test(msg) ? 'LIMIT' : 'HTTP', `BreachDirectory: ${msg}`);
  }
  const entries = arr(d.result).map(obj).filter((e): e is Record<string, unknown> => !!e).slice(0, BD_MAX).map((e) => {
    // sources — массив названий или строка «Unverified».
    const src = e.sources;
    const sources = Array.isArray(src) ? src.filter((s): s is string => typeof s === 'string') : typeof src === 'string' ? [src] : [];
    return {
      sources,
      hasPassword: bool(e.has_password) ?? !!str(e.password),
      password: str(e.password),
      sha1: str(e.sha1),
      hash: str(e.hash),
    };
  });
  return { found: num(d.found) ?? entries.length, entries };
}

// ---------- Intelligence X ----------

const IX_MAX = 100;
/** Сколько раз спрашивать результаты поиска (раз в секунду): IntelX отдаёт их по мере готовности. */
const IX_POLLS = 10;

export async function intelx(email: string, key: string, baseUrl: string, ctx: Ctx): Promise<IntelxResult> {
  const headers = { 'x-key': key, Accept: 'application/json' };
  const start = await xfetch(`${baseUrl}/intelligent/search`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ term: email, buckets: [], lookuplevel: 0, maxresults: IX_MAX, timeout: 0, datefrom: '', dateto: '', sort: 4, media: 0, terminate: [] }),
  }, ctx, 'IntelX');
  if (start.status !== 200) throw await statusError(start, ctx, 'IntelX');
  const s = obj(await readJson(start, ctx, 'IntelX'));
  const id = str(s?.id);
  // status: 0 — поиск начат, 1 — неверный запрос, 2 — превышено число одновременных поисков.
  if (!id || num(s?.status) !== 0) {
    throw new EmailError(num(s?.status) === 2 ? 'LIMIT' : 'HTTP', `IntelX: поиск не начат (status ${String(s?.status)})`);
  }

  const records: IntelxResult['records'] = [];
  try {
    for (let i = 0; i < IX_POLLS && records.length < IX_MAX; i++) {
      const res = await xfetch(`${baseUrl}/intelligent/search/result?id=${encodeURIComponent(id)}&limit=${IX_MAX}`, { headers }, ctx, 'IntelX');
      if (res.status !== 200) throw await statusError(res, ctx, 'IntelX');
      const r = obj(await readJson(res, ctx, 'IntelX'));
      for (const rec of arr(r?.records)) {
        const o = obj(rec);
        const systemId = str(o?.systemid);
        if (!o || !systemId || records.some((x) => x.systemId === systemId)) continue;
        records.push({
          systemId,
          name: str(o.name) ?? systemId,
          date: str(o.date),
          bucket: str(o.bucketh) ?? str(o.bucket),
          media: str(o.mediah),
          size: num(o.size),
          link: `https://intelx.io/?did=${encodeURIComponent(systemId)}`,
        });
      }
      // status: 0 — есть результаты, будут ещё; 1 — больше нет; 2 — поиск не найден; 3 — пока пусто, ждать.
      const status = num(r?.status);
      if (status === 1 || status === 2) break;
      await sleep(1000, ctx.signal);
    }
  } finally {
    // Поиск больше не нужен — освобождаем место (лимит одновременных поисков по ключу).
    void xfetch(`${baseUrl}/intelligent/search/terminate?id=${encodeURIComponent(id)}`, { headers }, { timeoutMs: 5000, signal: new AbortController().signal }, 'IntelX')
      .then((r) => r.body?.cancel())
      .catch(() => undefined);
  }
  return { total: records.length, records: records.slice(0, IX_MAX) };
}

// ---------- psbdmp.ws ----------

const PASTES_MAX = 100;

/** Дампы текстов (Pastebin и подобные), где встречается адрес; без ключа. */
export async function psbdmp(email: string, ctx: Ctx): Promise<PasteDump[]> {
  const res = await xfetch(`https://psbdmp.ws/api/v3/search/${encodeURIComponent(email)}`, { headers: { Accept: 'application/json' } }, ctx, 'psbdmp');
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return [];
  }
  if (res.status !== 200) throw await statusError(res, ctx, 'psbdmp');
  const data = await readJson(res, ctx, 'psbdmp');
  const list = Array.isArray(data) ? data : arr(obj(data)?.data);
  if (!Array.isArray(data) && obj(data)?.error) throw new EmailError('HTTP', `psbdmp: ${String(obj(data)?.error)}`);
  return list.map(obj).filter((p): p is Record<string, unknown> => !!p && !!str(p.id)).slice(0, PASTES_MAX).map((p) => {
    const id = str(p.id)!;
    return { id, url: `https://psbdmp.ws/dump/${encodeURIComponent(id)}`, date: str(p.time), tags: str(p.tags), length: num(p.length) };
  });
}

// ---------- EmailRep.io ----------

const REP_FLAGS = [
  'blacklisted', 'malicious_activity', 'malicious_activity_recent', 'credentials_leaked', 'credentials_leaked_recent', 'data_breach',
  'spam', 'free_provider', 'disposable', 'deliverable', 'accept_all', 'valid_mx', 'domain_exists', 'new_domain', 'suspicious_tld',
  'spoofable', 'spf_strict', 'dmarc_enforced',
];

export async function emailRep(email: string, key: string, ctx: Ctx): Promise<EmailRep> {
  const res = await xfetch(`https://emailrep.io/${encodeURIComponent(email)}`, { headers: { Key: key, Accept: 'application/json' } }, ctx, 'EmailRep');
  if (res.status !== 200) throw await statusError(res, ctx, 'EmailRep');
  const d = obj(await readJson(res, ctx, 'EmailRep'));
  if (!d) throw new EmailError('PARSE', 'EmailRep: не объект');
  const det = obj(d.details) ?? {};
  // first_seen / last_seen — «07/01/2019» или «never».
  const seen = (v: unknown) => {
    const s = str(v);
    return s && s !== 'never' ? s : null;
  };
  return {
    reputation: str(d.reputation),
    suspicious: bool(d.suspicious),
    references: num(d.references),
    flags: Object.fromEntries(REP_FLAGS.map((f) => [f, bool(det[f])])),
    firstSeen: seen(det.first_seen),
    lastSeen: seen(det.last_seen),
    daysSinceDomainCreation: num(det.days_since_domain_creation),
    primaryMx: str(det.primary_mx),
    profiles: arr(det.profiles).filter((p): p is string => typeof p === 'string'),
  };
}
