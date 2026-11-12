import type { DalQuery, GoogleDalPackage, GoogleDalReport, GoogleDalSite } from '@ft/shared';
import { WEB_HEADERS } from './knowledge.ts';
import { apiError, bodyJson, gfetch, query, type Ctx } from './net.ts';

// modules/spiderdal.py + apis/digitalassetslinks.py + helpers/playstore.py: «паук» по Digital Asset Links. Сайты и
// Android-приложения объявляют связи друг с другом (/.well-known/assetlinks.json); открытый API Google
// (digitalassetlinks.googleapis.com, без входа) отдаёт эти связи по сайту или по паре «пакет + отпечаток сертификата».
// Обход идёт кругами: найденные активы опрашиваются следом, пока не кончатся новые. В GHunt предела нет — здесь
// он есть (MAX_ASSETS, MAX_ROUNDS): чужой граф связей может оказаться огромным. Пакеты затем проверяются в Google Play:
// нет на витрине — приватное (внутреннее, тестовое) приложение.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Сколько активов опросить за один поиск, сколько кругов и сколько запросов одновременно (GHunt — Semaphore(10)). */
const MAX_ASSETS = 150;
const MAX_ROUNDS = 8;
const CONCURRENCY = 5;
/** Сколько пакетов проверять в Google Play. */
const MAX_PLAY_CHECKS = 60;

interface Asset {
  site: string | null;
  pkg: string | null;
  fp: string | null;
}

const keyOf = (a: Asset) => a.site ?? `${a.pkg}$${a.fp}`;
/** Подпись «найдено через …» — сайт или имя пакета, как в выводе GHunt. */
const labelOf = (a: Asset) => a.site ?? a.pkg ?? '';

/** Обработать items по n штук одновременно. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

/** apis/digitalassetslinks.py list_statements. Ошибка API (нет файла связей, неверный ввод) — пустой список, как у GHunt. */
async function listStatements(a: Asset, ctx: Ctx): Promise<Json[]> {
  const params: Record<string, string> = a.site
    ? { 'source.web.site': a.site }
    : { 'source.androidApp.packageName': a.pkg!, 'source.androidApp.certificate.sha256Fingerprint': a.fp! };
  const res = await gfetch(`https://digitalassetlinks.googleapis.com/v1/statements:list?${query(params)}`, { headers: WEB_HEADERS }, ctx);
  const data = obj(await bodyJson(res, ctx));
  const err = apiError(data, res.status, 'Digital Asset Links');
  if (err) {
    if (err.code === 'BLOCKED') throw err;
    return [];
  }
  return arr(data.statements);
}

/** helpers/playstore.py app_exists: true — пакет есть в Google Play, false — нет, null — не удалось понять. */
async function inPlayStore(pkg: string, ctx: Ctx): Promise<boolean | null> {
  try {
    const res = await gfetch(`https://play.google.com/store/apps/details?${query({ id: pkg })}`, { method: 'HEAD', headers: WEB_HEADERS }, ctx);
    await res.body?.cancel().catch(() => undefined);
    return res.status === 200 ? true : res.status === 404 ? false : null;
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    return null;
  }
}

/** Начальные цели: сайт по https (и http, если ввели http://) и, как GHunt без --strict, вариант с www. */
function initialTargets(q: DalQuery): Asset[] {
  if (q.kind === 'app') return [{ site: null, pkg: q.pkg, fp: q.fingerprint }];
  const hosts = q.host.startsWith('www.') ? [q.host] : [q.host, `www.${q.host}`];
  const schemes = q.http ? ['https', 'http'] : ['https'];
  return hosts.flatMap((h) => schemes.map((s) => ({ site: `${s}://${h}`, pkg: null, fp: null })));
}

/** modules/spiderdal.py main. onPhase — переход к проверке пакетов в Google Play. */
export async function spiderDal(q: DalQuery, query_: string, ctx: Ctx, onPhase: (phase: 'crawl' | 'playstore') => void): Promise<GoogleDalReport> {
  const sites = new Map<string, { leakedBy: string | null }>();
  const pkgs = new Map<string, { pkg: string; fp: string; leakedBy: string | null }>();
  const visited = new Set<string>();
  let targets = initialTargets(q);
  let rounds = 0;
  let scanned = 0;
  let truncated = false;

  onPhase('crawl');
  while (targets.length) {
    rounds++;
    if (scanned + targets.length > MAX_ASSETS) {
      targets = targets.slice(0, MAX_ASSETS - scanned);
      truncated = true;
    }
    scanned += targets.length;
    await pool(targets, CONCURRENCY, async (t) => {
      const statements = await listStatements(t, ctx);
      for (const st of statements) {
        const target = obj(st.target);
        const web = text(obj(target.web).site)?.replace(/^\.+|\.+$/g, '');
        if (web && !sites.has(web)) sites.set(web, { leakedBy: labelOf(t) });
        const app = obj(target.androidApp);
        const pkg = text(app.packageName);
        const fp = text(obj(app.certificate).sha256Fingerprint);
        if (pkg && fp && !pkgs.has(`${pkg}$${fp}`)) pkgs.set(`${pkg}$${fp}`, { pkg, fp, leakedBy: labelOf(t) });
      }
      visited.add(keyOf(t));
      // Исходная цель попадает в результат, только если у неё нашлись связи (как у GHunt).
      if (statements.length) {
        if (t.site && !sites.has(t.site)) sites.set(t.site, { leakedBy: null });
        if (t.pkg && t.fp && !pkgs.has(keyOf(t))) pkgs.set(keyOf(t), { pkg: t.pkg, fp: t.fp, leakedBy: null });
      }
    });
    if (truncated) break;
    targets = [
      ...[...sites.keys()].filter((s) => !visited.has(s)).map((site): Asset => ({ site, pkg: null, fp: null })),
      ...[...pkgs.entries()].filter(([k]) => !visited.has(k)).map(([, v]): Asset => ({ site: null, pkg: v.pkg, fp: v.fp })),
    ];
    if (targets.length && rounds >= MAX_ROUNDS) {
      truncated = true;
      break;
    }
  }

  // Пакеты — по имени, с отпечатками; затем проверка в Google Play.
  const byName = new Map<string, GoogleDalPackage>();
  for (const p of pkgs.values()) {
    const entry = byName.get(p.pkg) ?? { name: p.pkg, public: null, fingerprints: [] };
    if (!entry.fingerprints.some((f) => f.sha256 === p.fp)) entry.fingerprints.push({ sha256: p.fp, leakedBy: p.leakedBy });
    byName.set(p.pkg, entry);
  }
  const packages = [...byName.values()];
  if (packages.length) {
    onPhase('playstore');
    await pool(packages.slice(0, MAX_PLAY_CHECKS), CONCURRENCY, async (p) => {
      p.public = await inPlayStore(p.name, ctx);
    });
  }

  const siteList: GoogleDalSite[] = [...sites.entries()].map(([site, v]) => ({ site, leakedBy: v.leakedBy }));
  return { mode: 'spiderdal', query: query_, found: siteList.length + packages.length > 0, sites: siteList, packages, scanned, rounds, truncated, demo: false };
}
