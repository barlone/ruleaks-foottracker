import {
  GOOGLE_EMAIL_STEPS, emailDomainInfo,
  type EmailPartId, type EmailPartState, type EmailReport, type EmailSection, type EmailSiteCheck, type ParsedEmail,
} from '@ft/shared';
import type { AppConfig } from '@ft/config';
import { googleSlot, SlotCancelled } from '../google/account.ts';
import { googleErrorText, huntGoogleEmail } from '../google/hunter.ts';
import type { GoogleSession } from '../google/session.ts';
import { checkEmailSite } from '../pages/check.ts';
import { allEmailSites } from '../pages/email-sites.ts';
import { breachDirectory, emailRep, hibpBreaches, intelx, psbdmp } from './breaches.ts';
import { domainDns, hostIps } from './dns.ts';
import { emailErrorText, type Ctx } from './http.ts';
import { hunterDomain } from './hunterio.ts';
import { ipGeo, type IpTarget } from './ipgeo.ts';
import { domainRdap } from './rdap.ts';
import { webMentions } from './web.ts';

// Отчёт «Поиска по Email»: GHunt (аккаунт Google по адресу) + MOSINT (DNS, домен, серверы, утечки, дампы, репутация,
// Hunter, упоминания в вебе, регистрации на сайтах). Части собираются параллельно и независимо: сбой одной — текст
// ошибки в ней, остальные не страдают. Что собирать, решают настройки ([email-search]: переключатели и ключи) и домен
// адреса (emailDomainInfo): регистрация домена, геолокация серверов и Hunter — только для своего домена;
// у Gmail и бесплатных сервисов они говорят о сервисе, а не о человеке.

export interface HuntOptions {
  email: AppConfig['email'];
  /** Служебный аккаунт Google; null — мастер-токена нет (имитация). */
  googleSession: GoogleSession | null;
  googleTimeoutMs: number;
  googleMinIntervalMs: number;
  pages: { timeoutMs: number; concurrency: number; sideEffectProbes: boolean };
  log: (msg: string) => void;
}

export interface HuntProgress {
  set(part: EmailPartId, state: EmailPartState, note?: string | null): void;
}

const SKIP_OFF = 'выключено в настройках сервера';
const SKIP_KEY = 'на сервере не задан ключ API сервиса';

/** Какие части не собираются и почему; null — собирается. */
export function skipReasons(opts: Pick<HuntOptions, 'email'>, kind: ReturnType<typeof emailDomainInfo>['kind']): Record<EmailPartId, string | null> {
  const e = opts.email;
  const own = kind === 'corporate';
  const notOwn = kind === 'gmail' ? 'у адреса Gmail домен принадлежит Google' : kind === 'free' ? 'у бесплатного почтового сервиса домен общий для всех' : 'домен одноразовых ящиков общий для всех';
  return {
    dns: null,
    rdap: !e.rdap ? SKIP_OFF : own ? null : notOwn,
    ipgeo: !e.ipGeo ? SKIP_OFF : own ? null : notOwn,
    google: e.google ? null : SKIP_OFF,
    sites: e.sites ? null : SKIP_OFF,
    hibp: e.keys.hibp ? null : SKIP_KEY,
    breachdirectory: e.keys.breachDirectory ? null : SKIP_KEY,
    intelx: e.keys.intelx ? null : SKIP_KEY,
    pastes: e.pastes ? null : SKIP_OFF,
    emailrep: e.keys.emailrep ? null : SKIP_KEY,
    hunter: !e.keys.hunter ? SKIP_KEY : own ? null : notOwn,
    web: e.web ? null : SKIP_OFF,
  };
}

const pending = <T>(): EmailSection<T> => ({ status: 'skipped', reason: 'не проверялось' });

export function emptyReport(p: ParsedEmail): EmailReport {
  return {
    email: p.email, local: p.local, domain: emailDomainInfo(p.domain),
    dns: pending(), rdap: pending(), ipgeo: pending(), google: pending(), sites: pending(), hibp: pending(),
    breachdirectory: pending(), intelx: pending(), pastes: pending(), emailrep: pending(), hunter: pending(), web: pending(),
  };
}

/** Собирает отчёт в report (по частям — пока идёт поиск, их ход виден через progress). */
export async function huntEmail(report: EmailReport, opts: HuntOptions, signal: AbortSignal, progress: HuntProgress): Promise<void> {
  const { email, domain } = report;
  const e = opts.email;
  const ctx: Ctx = { timeoutMs: e.timeoutMs, signal };
  const skip = skipReasons(opts, domain.kind);

  /** Собирает одну часть: пропуск — с причиной, сбой — общий текст (подробности — в журнал). */
  const part = async <K extends EmailPartId>(id: K, run: () => Promise<EmailReport[K] extends EmailSection<infer T> ? T : never>, errorText = emailErrorText) => {
    const reason = skip[id];
    if (reason) {
      (report[id] as EmailSection<unknown>) = { status: 'skipped', reason };
      progress.set(id, 'skipped');
      return;
    }
    progress.set(id, 'running');
    try {
      const data = await run();
      (report[id] as EmailSection<unknown>) = { status: 'ok', data };
    } catch (err) {
      if (signal.aborted) throw err;
      opts.log(`email: ${id} — ${(err as Error)?.message ?? String(err)}`);
      (report[id] as EmailSection<unknown>) = { status: 'error', error: errorText(err) };
    }
    progress.set(id, 'done');
  };

  const dns = part('dns', () => domainDns(domain.domain, ctx));

  await Promise.all([
    dns,
    // Серверы домена: его адрес (A) и основной почтовый сервер (MX) — по данным DNS.
    part('ipgeo', async () => {
      await dns;
      const d = report.dns.status === 'ok' ? report.dns.data : null;
      const targets: IpTarget[] = [];
      if (d?.a[0]) targets.push({ ip: d.a[0], role: 'domain', host: domain.domain });
      const mx = d?.mx[0]?.host;
      if (mx) {
        const ip = (await hostIps(mx, ctx))[0];
        if (ip && !targets.some((t) => t.ip === ip)) targets.push({ ip, role: 'mx', host: mx });
      }
      return ipGeo(targets, ctx);
    }),
    part('rdap', () => domainRdap(domain.domain, ctx)),
    part('google', async () => {
      const step = (s: (typeof GOOGLE_EMAIL_STEPS)[number]['id']) => progress.set('google', 'running', GOOGLE_EMAIL_STEPS.find((x) => x.id === s)?.label ?? null);
      const gctx = { timeoutMs: opts.googleTimeoutMs, signal };
      // Имитация аккаунт не трогает — без очереди.
      if (!opts.googleSession) return huntGoogleEmail(null, email, gctx, step, opts.log);
      progress.set('google', 'running', 'в очереди к Google');
      return googleSlot(opts.googleMinIntervalMs, signal, () => huntGoogleEmail(opts.googleSession, email, gctx, step, opts.log));
    }, (err) => (err instanceof SlotCancelled ? 'Отменено' : googleErrorText(err))),
    part('sites', () => checkSites(email, opts.pages, signal, (done, total) => progress.set('sites', 'running', `${done} из ${total}`))),
    part('hibp', () => hibpBreaches(email, e.keys.hibp, ctx)),
    part('breachdirectory', () => breachDirectory(email, e.keys.breachDirectory, ctx)),
    part('intelx', () => intelx(email, e.keys.intelx, e.intelxUrl, ctx)),
    part('pastes', () => psbdmp(email, ctx)),
    part('emailrep', () => emailRep(email, e.keys.emailrep, ctx)),
    part('hunter', () => hunterDomain(domain.domain, email, e.keys.hunter, ctx)),
    part('web', () => webMentions(email, ctx)),
  ]);
}

/** Регистрации на сайтах по адресу — те же проверки, что в «Поиске личных страниц» по e-mail. */
async function checkSites(
  email: string, opts: HuntOptions['pages'], signal: AbortSignal, onProgress: (done: number, total: number) => void,
) {
  const all = allEmailSites(true);
  const sites = opts.sideEffectProbes ? all : all.filter((s) => !s.sideEffect);
  const checks: EmailSiteCheck[] = [];
  let next = 0;
  onProgress(0, sites.length);
  const worker = async () => {
    while (!signal.aborted) {
      const site = sites[next++];
      if (!site) return;
      const r = await checkEmailSite(site, email, { timeoutMs: opts.timeoutMs, signal });
      checks.push({ site: r.site, url: r.urlMain, status: r.status, httpStatus: r.httpStatus, error: r.error, nsfw: r.nsfw });
      onProgress(checks.length, sites.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, sites.length) }, worker));
  if (signal.aborted) throw signal.reason as Error;
  const order = { claimed: 0, waf: 1, unknown: 2, available: 3, illegal: 4 } as const;
  checks.sort((a, b) => order[a.status] - order[b.status] || a.site.localeCompare(b.site, 'en'));
  return { checks, skippedSideEffect: all.length - sites.length };
}

/** Сколько находок в отчёте — для истории: аккаунт Google, регистрации, утечки, документы, дампы, упоминания. */
export function hitsOf(r: EmailReport): number {
  const ok = <T>(s: EmailSection<T>) => (s.status === 'ok' ? s.data : null);
  return (ok(r.google)?.found ? 1 : 0)
    + (ok(r.sites)?.checks.filter((c) => c.status === 'claimed').length ?? 0)
    + (ok(r.hibp)?.length ?? 0)
    + (ok(r.breachdirectory)?.entries.length ?? 0)
    + (ok(r.intelx)?.records.length ?? 0)
    + (ok(r.pastes)?.length ?? 0)
    + (ok(r.web)?.hits.filter((h) => h.exact).length ?? 0);
}
