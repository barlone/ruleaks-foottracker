import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { AtSign, Building2, Database, FileWarning, Globe, KeyRound, Network, ScrollText, ShieldAlert, UserCheck } from 'lucide-react';
import {
  EMAIL_DOMAIN_KINDS, EMAIL_PARTS, EMAILREP_FLAGS, HIBP_DATA_CLASSES, MAILBOX_REASONS, emailPartLabel, emailTypoFix,
  type BreachDirectoryResult, type EmailDns, type EmailMailbox, type EmailIpGeo, type EmailPartId, type EmailRdap, type EmailRep, type EmailReport,
  type EmailSection, type EmailSites, type EmailWeb, type HibpBreach, type HunterDomain, type HunterEmail, type IntelxResult, type PasteDump,
} from '@ft/shared';
import { Card, CopyButton, Tag, WarnNote } from '../../components/ui.tsx';
import { fmtDate } from '../../lib/format.ts';
import { locale, t, tn, tx } from '../../lib/i18n.ts';
import { AccountResult, Ext, Mono, None, Row, Searchable } from './GoogleParts.tsx';
import { manualSearchLinks, nickOf } from './emailSearch.ts';

// Отчёт «Поиска по Email»: части в порядке важности для расследования — аккаунт Google, регистрации на сайтах,
// утечки и дампы, репутация, домен и его серверы, Hunter, упоминания в вебе. Части, которые не собирались, —
// одним списком с причиной в конце.

/** Часть отчёта: не собиралась — ничего (она в списке «Не проверялось»), не удалась — ошибка, иначе содержимое. */
function Part<T>({ title, icon, section, children, extra }: { title: string; icon: ReactNode; section: EmailSection<T>; children: (data: T) => ReactNode; extra?: ReactNode }) {
  if (section.status === 'skipped') return null;
  return (
    <Card title={<>{icon} {title}{extra}</>}>
      {section.status === 'error' ? <div className="text-sm text-danger">{tx(section.error)}</div> : children(section.data)}
    </Card>
  );
}

const Count = ({ n, tone = 'mint' }: { n: number; tone?: 'mint' | 'danger' | 'warn' }) => (
  <span className={clsx('ml-2 font-mono text-[11px]', n ? (tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-mint') : 'text-mute')}>{n}</span>
);

const ok = <T,>(s: EmailSection<T>): T | null => (s.status === 'ok' ? s.data : null);

export function EmailReportView({ report, pagesEnabled }: { report: EmailReport; pagesEnabled: boolean }) {
  const r = report;
  const google = ok(r.google);
  const sites = ok(r.sites);
  const claimed = sites?.checks.filter((c) => c.status === 'claimed') ?? [];
  const nick = nickOf(r.local);
  const skipped = EMAIL_PARTS.filter((p) => r[p.id].status === 'skipped');
  // Домен похож на известный почтовый сервис, но не он: возможно, адрес записан с опечаткой.
  const typoFix = emailTypoFix({ email: r.email, local: r.local, domain: r.domain.domain });

  return (
    <>
      <Card title={<><AtSign size={13} /> {t('Адрес')}</>}>
        <div className="divide-y divide-line-soft">
          <Row label="E-mail"><span className="inline-flex items-center gap-2"><Mono>{r.email}</Mono><CopyButton value={r.email} /></span></Row>
          <Row label={t('Домен')}>
            <span className="font-mono">{r.domain.domain}</span>
            <Tag tone={r.domain.kind === 'disposable' ? 'danger' : r.domain.kind === 'corporate' ? 'info' : 'dim'} className="ml-2">
              {r.domain.provider ? `${tx(r.domain.provider)} · ` : ''}{t(EMAIL_DOMAIN_KINDS[r.domain.kind])}
            </Tag>
            {ok(r.dns)?.mailProvider && r.domain.kind === 'corporate' && <Tag tone="dim" className="ml-1.5">{t('почта: {provider}', { provider: tx(ok(r.dns)!.mailProvider!) })}</Tag>}
            {ok(r.dns)?.exists === false && <Tag tone="danger" className="ml-1.5">{t('домена не существует')}</Tag>}
            {ok(r.dns)?.nullMx && <Tag tone="warn" className="ml-1.5">{t('домен не принимает почту')}</Tag>}
            {typoFix && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                <Tag tone="warn">{t('возможно, опечатка в домене')}</Tag>
                <span className="text-dim">{t('имелся в виду')}</span>
                <Searchable value={typoFix} mode="email" />
              </div>
            )}
          </Row>
          {r.mailbox.status !== 'skipped' && (
            <Row label={t('Ящик')}>
              {r.mailbox.status === 'error' ? <span className="text-sm text-danger">{tx(r.mailbox.error)}</span> : <MailboxView box={r.mailbox.data} />}
            </Row>
          )}
          <Row label={t('Найдено')}>
            <div className="flex flex-wrap gap-1.5">
              {r.google.status === 'ok' && <Tag tone={google?.found ? 'mint' : 'dim'}>{google?.found ? t('аккаунт Google') : t('аккаунта Google нет')}{google?.demo ? ` (${t('имитация')})` : ''}</Tag>}
              {sites && <Tag tone={claimed.length ? 'mint' : 'dim'}>{t('регистраций на сайтах: {n}', { n: claimed.length })}</Tag>}
              {ok(r.hibp) && <Tag tone={ok(r.hibp)!.length ? 'danger' : 'dim'}>{t('утечек HIBP: {n}', { n: ok(r.hibp)!.length })}</Tag>}
              {ok(r.breachdirectory) && <Tag tone={ok(r.breachdirectory)!.entries.length ? 'danger' : 'dim'}>{t('паролей BreachDirectory: {n}', { n: ok(r.breachdirectory)!.entries.length })}</Tag>}
              {ok(r.intelx) && <Tag tone={ok(r.intelx)!.records.length ? 'warn' : 'dim'}>{t('документов IntelX: {n}', { n: ok(r.intelx)!.records.length })}</Tag>}
              {ok(r.pastes) && <Tag tone={ok(r.pastes)!.length ? 'warn' : 'dim'}>{t('дампов: {n}', { n: ok(r.pastes)!.length })}</Tag>}
              {ok(r.web) && <Tag tone={ok(r.web)!.hits.some((h) => h.exact) ? 'mint' : 'dim'}>{t('упоминаний в вебе: {n}', { n: ok(r.web)!.hits.filter((h) => h.exact).length })}</Tag>}
            </div>
          </Row>
          <Row label={t('Искать дальше')}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link to="/search" search={{ kind: 'email', q: r.email }} className="text-mint hover:underline">{t('адрес в утечках RuLeaks')}</Link>
              {pagesEnabled && nick && <Link to="/search/pages" search={{ q: nick }} className="text-mint hover:underline">{t('ник «{nick}» на сайтах', { nick })}</Link>}
              {manualSearchLinks(r.email).map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="text-mint hover:underline">{l.label}</a>)}
            </div>
          </Row>
        </div>
      </Card>

      {r.google.status !== 'skipped' && (
        <section className="space-y-6">
          <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-mute"><UserCheck size={13} /> {t('Аккаунт Google')}</h2>
          {r.google.status === 'error' ? <Card><div className="text-sm text-danger">{tx(r.google.error)}</div></Card> : <AccountResult report={r.google.data} />}
        </section>
      )}

      <Part title={t('Регистрации на сайтах')} icon={<Globe size={13} />} section={r.sites} extra={<Count n={claimed.length} />}>{(s) => <SitesView sites={s} />}</Part>

      <div className="grid items-start gap-6 2xl:grid-cols-2">
        <Part title="Have I Been Pwned" icon={<ShieldAlert size={13} />} section={r.hibp} extra={<Count n={ok(r.hibp)?.length ?? 0} tone="danger" />}>{(b) => <HibpView breaches={b} />}</Part>
        <Part title="BreachDirectory" icon={<KeyRound size={13} />} section={r.breachdirectory} extra={<Count n={ok(r.breachdirectory)?.entries.length ?? 0} tone="danger" />}>{(b) => <BreachDirectoryView result={b} />}</Part>
        <Part title="Intelligence X" icon={<Database size={13} />} section={r.intelx} extra={<Count n={ok(r.intelx)?.records.length ?? 0} tone="warn" />}>{(x) => <IntelxView result={x} />}</Part>
        <Part title={t('Дампы Pastebin (psbdmp)')} icon={<ScrollText size={13} />} section={r.pastes} extra={<Count n={ok(r.pastes)?.length ?? 0} tone="warn" />}>{(p) => <PastesView pastes={p} />}</Part>
      </div>

      <Part title={t('Репутация (EmailRep)')} icon={<FileWarning size={13} />} section={r.emailrep}>{(e) => <EmailRepView rep={e} />}</Part>

      <Part title={r.domain.kind === 'corporate' ? t('Домен и почтовые серверы') : t('Почтовый сервис {name}', { name: r.domain.provider ? tx(r.domain.provider) : r.domain.domain })} icon={<Network size={13} />} section={r.dns}>
        {(d) => <DomainView dns={d} rdap={r.rdap} ipgeo={r.ipgeo} compact={r.domain.kind !== 'corporate'} />}
      </Part>

      <Part title={t('Домен в Hunter.io')} icon={<Building2 size={13} />} section={r.hunter}>{(h) => <HunterView hunter={h} />}</Part>

      <Part title={t('Упоминания в вебе')} icon={<Globe size={13} />} section={r.web} extra={<Count n={ok(r.web)?.hits.filter((h) => h.exact).length ?? 0} />}>{(w) => <WebView web={w} />}</Part>

      {skipped.length > 0 && (
        <Card title={t('Не проверялось')}>
          <div className="space-y-1 text-sm">
            {skipped.map((p) => (
              <div key={p.id} className="flex flex-wrap gap-x-3">
                <span className="w-56 shrink-0 text-dim">{t(emailPartLabel(p.id as EmailPartId))}</span>
                <span className="text-mute">{tx((r[p.id] as { reason: string }).reason)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

// ---------- Существование ящика ----------

const MAILBOX_TAG: Record<EmailMailbox['verdict'], { label: string; tone: 'mint' | 'danger' | 'warn' | 'dim' }> = {
  exists: { label: 'существует', tone: 'mint' },
  missing: { label: 'не существует', tone: 'danger' },
  catchall: { label: 'проверить нельзя', tone: 'warn' },
  unknown: { label: 'не удалось проверить', tone: 'dim' },
};

/** Что ответил почтовый сервер домена на вопрос о получателе (SMTP до RCPT TO, письмо не отправлялось). */
function MailboxView({ box }: { box: EmailMailbox }) {
  const tag = MAILBOX_TAG[box.verdict];
  return (
    <div className="space-y-1">
      <div>
        <Tag tone={tag.tone}>{t(tag.label)}</Tag>
        <span className="ml-2 text-sm text-dim">{t(MAILBOX_REASONS[box.reason])}</span>
      </div>
      {box.verdict === 'exists' && box.catchAll === false && (
        <div className="text-xs text-mute">{t('Случайный адрес того же домена сервер отверг — значит, он различает существующие ящики.')}</div>
      )}
      {box.verdict === 'exists' && box.catchAll === null && box.reason === 'accepted' && (
        <div className="text-xs text-mute">{t('Проверить, не принимает ли сервер любые адреса, не удалось — вывод менее надёжен.')}</div>
      )}
      {box.mx && (
        <div className="font-mono text-[11px] text-mute">
          {box.mx}{box.tls ? ' · TLS' : ''}{box.code ? ` · ${box.code}` : ''}{box.reply ? ` ${box.reply}` : ''}
        </div>
      )}
    </div>
  );
}

// ---------- Регистрации ----------

const SITE_STATUS = { claimed: 'занят', available: 'свободен', waf: 'защита от ботов', unknown: 'нет ответа', illegal: '—' } as const;

function SitesView({ sites }: { sites: EmailSites }) {
  const claimed = sites.checks.filter((c) => c.status === 'claimed');
  const unclear = sites.checks.filter((c) => c.status === 'waf' || c.status === 'unknown');
  return (
    <div className="space-y-3">
      {claimed.length ? (
        <div className="flex flex-wrap gap-2">
          {claimed.map((c) => (
            <a key={c.site} href={c.url} target="_blank" rel="noreferrer" className="rounded-lg border border-mint/40 bg-mint/8 px-3 py-1.5 text-sm text-mint hover:bg-mint/15">
              {c.site}{c.nsfw && <span className="ml-1.5 text-[10px] text-warn">18+</span>}
            </a>
          ))}
        </div>
      ) : <None>{t('Ни один из проверенных сайтов не сообщил, что адрес занят.')}</None>}
      <p className="font-mono text-[11px] text-mute">
        {t('Проверено {n}: форма регистрации или восстановления пароля сайта сообщает, занят ли адрес. Вердикт эвристический.', { n: sites.checks.length })}
        {unclear.length > 0 && <> {t('Не удалось проверить: {n}.', { n: unclear.length })}</>}
        {sites.skippedSideEffect > 0 && <> {t('Пропущено проб, которые могли бы написать владельцу адреса: {n}.', { n: sites.skippedSideEffect })}</>}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer font-mono text-xs text-dim hover:text-text">{t('Все проверки')}</summary>
        <div className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
          {sites.checks.map((c) => (
            <div key={c.site} className="flex justify-between gap-3">
              <span className="truncate">{c.site}</span>
              <span className={clsx('shrink-0 font-mono text-[11px]', c.status === 'claimed' ? 'text-mint' : c.status === 'available' ? 'text-mute' : 'text-warn')} title={c.error ? tx(c.error) : (c.httpStatus ? `HTTP ${c.httpStatus}` : undefined)}>
                {t(SITE_STATUS[c.status])}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ---------- Утечки ----------

function HibpView({ breaches }: { breaches: HibpBreach[] }) {
  if (!breaches.length) return <None>{t('Адреса нет в известных HIBP утечках.')}</None>;
  return (
    <div className="divide-y divide-line-soft">
      {breaches.map((b) => (
        <div key={b.name} className="space-y-1 py-2.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{b.title}</span>
            {b.domain && <span className="font-mono text-xs text-dim">{b.domain}</span>}
            <span className="font-mono text-[11px] text-mute">{b.breachDate ? fmtDate(b.breachDate) : t('дата неизвестна')} · {tn(b.pwnCount, '{n} аккаунт|{n} аккаунта|{n} аккаунтов', { n: b.pwnCount.toLocaleString(locale()) })}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {b.dataClasses.map((c) => <Tag key={c} tone={/password|credit|bank|passport|security/i.test(c) ? 'danger' : 'dim'}>{HIBP_DATA_CLASSES[c] ? t(HIBP_DATA_CLASSES[c]) : c}</Tag>)}
            {b.sensitive && <Tag tone="warn">{t('чувствительная')}</Tag>}
            {b.spamList && <Tag tone="warn">{t('спам-список')}</Tag>}
            {b.malware && <Tag tone="warn">{t('вредоносное ПО')}</Tag>}
            {b.fabricated && <Tag tone="warn">{t('возможно, подделка')}</Tag>}
            {!b.verified && <Tag tone="dim">{t('не подтверждена')}</Tag>}
          </div>
          {b.description && (
            <details>
              <summary className="cursor-pointer font-mono text-[11px] text-mute hover:text-text">{t('описание (англ.)')}</summary>
              <p className="mt-1 text-xs text-dim">{b.description}</p>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

function BreachDirectoryView({ result }: { result: BreachDirectoryResult }) {
  if (!result.entries.length) return <None>{t('Записей нет.')}</None>;
  return (
    <div className="space-y-2">
      <WarnNote>{t('Пароли и хеши из утечек — чувствительные данные: используйте их только в рамках расследования.')}</WarnNote>
      <div className="divide-y divide-line-soft">
        {result.entries.map((e, i) => (
          <div key={i} className="space-y-0.5 py-2 text-sm first:pt-0">
            <div className="flex flex-wrap gap-1">{e.sources.length ? e.sources.map((s) => <Tag key={s} tone="dim">{s}</Tag>) : <None>{t('источник не указан')}</None>}</div>
            {e.password && <div className="flex items-center gap-2"><span className="w-14 font-mono text-[11px] text-mute">{t('пароль')}</span><Mono>{e.password}</Mono><CopyButton value={e.password} /></div>}
            {e.sha1 && <div className="flex items-center gap-2"><span className="w-14 font-mono text-[11px] text-mute">SHA-1</span><span className="truncate font-mono text-xs">{e.sha1}</span><CopyButton value={e.sha1} /></div>}
            {e.hash && <div className="flex items-center gap-2"><span className="w-14 font-mono text-[11px] text-mute">{t('хеш')}</span><span className="truncate font-mono text-xs">{e.hash}</span><CopyButton value={e.hash} /></div>}
            {!e.hasPassword && !e.password && <None>{t('без пароля')}</None>}
          </div>
        ))}
      </div>
      {result.found > result.entries.length && <div className="font-mono text-[11px] text-mute">{t('Всего записей: {found}, показаны первые {shown}.', { found: result.found, shown: result.entries.length })}</div>}
    </div>
  );
}

function IntelxView({ result }: { result: IntelxResult }) {
  if (!result.records.length) return <None>{t('Документов нет.')}</None>;
  return (
    <div className="space-y-1">
      {result.records.map((x) => (
        <div key={x.systemId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <a href={x.link} target="_blank" rel="noreferrer" className="min-w-0 truncate text-mint hover:underline">{x.name}</a>
          <span className="font-mono text-[11px] text-mute">{[x.date && fmtDate(x.date), x.bucket, x.media].filter(Boolean).join(' · ')}</span>
        </div>
      ))}
      <p className="pt-1 font-mono text-[11px] text-mute">{t('Документы открываются на intelx.io (нужна учётная запись).')}</p>
    </div>
  );
}

function PastesView({ pastes }: { pastes: PasteDump[] }) {
  if (!pastes.length) return <None>{t('Дампов с адресом нет.')}</None>;
  return (
    <div className="space-y-1">
      {pastes.map((p) => (
        <div key={p.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <Ext href={p.url}>{p.id}</Ext>
          <span className="font-mono text-[11px] text-mute">{[p.date && fmtDate(p.date), p.length !== null && tn(p.length, '{n} симв.'), p.tags].filter(Boolean).join(' · ')}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Репутация ----------

function EmailRepView({ rep }: { rep: EmailRep }) {
  const flags = EMAILREP_FLAGS.filter((f) => rep.flags[f.key] !== null && rep.flags[f.key] !== undefined);
  return (
    <div className="divide-y divide-line-soft">
      <Row label={t('Репутация')}>
        {rep.reputation ? <Tag tone={rep.reputation === 'high' ? 'mint' : rep.reputation === 'medium' ? 'info' : 'warn'}>{({ high: t('высокая'), medium: t('средняя'), low: t('низкая'), none: t('нет данных') } as Record<string, string>)[rep.reputation] ?? rep.reputation}</Tag> : <None />}
        {rep.suspicious && <Tag tone="danger" className="ml-1.5">{t('подозрительный')}</Tag>}
        {rep.references !== null && <span className="ml-2 font-mono text-xs text-mute">{t('источников: {n}', { n: rep.references })}</span>}
      </Row>
      <Row label={t('Впервые / последний раз')}>{rep.firstSeen ?? '—'} / {rep.lastSeen ?? '—'}</Row>
      {rep.daysSinceDomainCreation !== null && <Row label={t('Возраст домена')}>{tn(rep.daysSinceDomainCreation, '{n} дн.', { n: rep.daysSinceDomainCreation.toLocaleString(locale()) })}</Row>}
      {rep.primaryMx && <Row label={t('Основной MX')}><span className="font-mono text-xs">{rep.primaryMx}</span></Row>}
      <Row label={t('Признаки')}>
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => {
            const v = rep.flags[f.key]!;
            return <Tag key={f.key} tone={v ? (f.bad ? 'danger' : 'mint') : 'dim'}>{v ? t(f.label) : t('не {flag}', { flag: t(f.label) })}</Tag>;
          })}
        </div>
      </Row>
      {rep.profiles.length > 0 && <Row label={t('Профили')}><div className="flex flex-wrap gap-1.5">{rep.profiles.map((p) => <Tag key={p}>{p}</Tag>)}</div></Row>}
    </div>
  );
}

// ---------- Домен ----------

const DMARC: Record<string, string> = { none: 'только наблюдение (p=none)', quarantine: 'в карантин (p=quarantine)', reject: 'отклонять (p=reject)' };
const SPF_ALL: Record<string, string> = { '-all': 'строго (-all)', '~all': 'мягко (~all)', '?all': 'нейтрально (?all)', '+all': 'разрешено всем (+all)' };

function DomainView({ dns, rdap, ipgeo, compact }: { dns: EmailDns; rdap: EmailSection<EmailRdap | null>; ipgeo: EmailSection<EmailIpGeo[]>; compact: boolean }) {
  const policies = (
    <>
      <Row label="SPF">
        {dns.spf ? (
          <div className="space-y-1">
            <div className="break-all font-mono text-xs">{dns.spf}</div>
            {dns.spfAll && <div className="text-xs text-dim">{t('чужие отправители: {policy}', { policy: SPF_ALL[dns.spfAll] ? t(SPF_ALL[dns.spfAll]!) : dns.spfAll })}</div>}
            {dns.spfIncludes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">{dns.spfIncludes.map((i) => <Tag key={i.value} tone={i.service ? 'info' : 'dim'}><span title={i.value}>{i.service ? tx(i.service) : i.value}</span></Tag>)}</div>
            )}
          </div>
        ) : <None>{t('нет')}</None>}
      </Row>
      <Row label="DMARC">
        {dns.dmarc ? <div className="space-y-1"><div>{DMARC[dns.dmarcPolicy ?? 'none'] && t(DMARC[dns.dmarcPolicy ?? 'none']!)}</div><div className="break-all font-mono text-xs text-dim">{dns.dmarc}</div></div> : <None>{t('нет')}</None>}
      </Row>
      <Row label={t('Подделка писем')}>
        {dns.spoofable ? <Tag tone="warn">{t('возможна: DMARC не применяется и SPF не строгий')}</Tag> : <Tag tone="dim">{t('затруднена')}</Tag>}
      </Row>
    </>
  );
  return (
    <div className="divide-y divide-line-soft">
      {!dns.exists && <Row label={t('Домен')}><span className="text-danger">{t('не существует (NXDOMAIN) — письма на адрес не доставляются; учётки на него могли остаться с прежних времён')}</span></Row>}
      <Row label={t('Почтовые серверы (MX)')}>
        {dns.nullMx ? <span className="text-warn">{t('домен объявил, что почту не принимает (null MX)')}</span> : dns.mx.length ? (
          <div className="space-y-0.5">
            {dns.mx.map((m) => <div key={m.host} className="font-mono text-xs"><span className="mr-2 text-mute">{m.priority}</span>{m.host}</div>)}
            {dns.mailProvider && <Tag tone="info">{tx(dns.mailProvider)}</Tag>}
          </div>
        ) : <None>{t('нет')}</None>}
      </Row>
      {compact ? (
        <details className="py-1.5">
          <summary className="cursor-pointer font-mono text-xs text-dim hover:text-text">{t('Почтовые политики сервиса')}</summary>
          <div className="divide-y divide-line-soft">{policies}</div>
        </details>
      ) : (
        <>
          {policies}
          {dns.verifications.length > 0 && (
            <Row label={t('Подтверждён в сервисах')}>
              <div className="flex flex-wrap gap-1.5">{[...new Set(dns.verifications.map((v) => v.service))].map((s) => <Tag key={s} tone="info">{tx(s)}</Tag>)}</div>
            </Row>
          )}
          <Row label={t('Адреса (A / AAAA)')}>{dns.a.length || dns.aaaa.length ? <span className="font-mono text-xs">{[...dns.a, ...dns.aaaa].join(', ')}</span> : <None>{t('нет')}</None>}</Row>
          <Row label={t('Серверы имён (NS)')}>{dns.ns.length ? <span className="font-mono text-xs">{dns.ns.join(', ')}</span> : <None>{t('нет')}</None>}</Row>
          {rdap.status !== 'skipped' && (
            <Row label={t('Регистрация домена')}>
              {rdap.status === 'error' ? <span className="text-danger">{tx(rdap.error)}</span> : !rdap.data ? <None>{t('реестр зоны не отвечает по RDAP (так у .ru, .рф, .su)')}</None> : <RdapView rdap={rdap.data} />}
            </Row>
          )}
          {ipgeo.status !== 'skipped' && (
            <Row label={t('Где серверы')}>
              {ipgeo.status === 'error' ? <span className="text-danger">{tx(ipgeo.error)}</span> : !ipgeo.data.length ? <None>{t('нет публичных адресов')}</None> : <IpGeoView list={ipgeo.data} />}
            </Row>
          )}
          {dns.txt.length > 0 && (
            <details className="py-1.5">
              <summary className="cursor-pointer font-mono text-xs text-dim hover:text-text">{t('Все TXT-записи ({n})', { n: dns.txt.length })}</summary>
              <div className="mt-1 space-y-0.5">{dns.txt.map((txt, i) => <div key={i} className="break-all font-mono text-[11px] text-dim">{txt}</div>)}</div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function RdapView({ rdap }: { rdap: EmailRdap }) {
  return (
    <div className="space-y-0.5 text-sm">
      {rdap.domain && <div className="font-mono text-xs text-dim">{rdap.domain}</div>}
      <div>
        {t('создан {date}', { date: rdap.created ? fmtDate(rdap.created) : '—' })}
        {rdap.ageDays !== null && (
          <span className={clsx('ml-2 font-mono text-xs', rdap.ageDays < 90 ? 'text-warn' : 'text-mute')}>
            {rdap.ageDays < 90 ? `${t('недавно:')} ` : ''}
            {Math.floor(rdap.ageDays / 365) ? `${tn(Math.floor(rdap.ageDays / 365), '{n} г.')} ` : ''}
            {tn(rdap.ageDays % 365, '{n} дн.')}
          </span>
        )}
      </div>
      {rdap.expires && <div className="text-dim">{t('оплачен до {date}', { date: fmtDate(rdap.expires) })}</div>}
      {rdap.registrar && <div className="text-dim">{t('регистратор: {name}', { name: rdap.registrar })}</div>}
      {rdap.status.length > 0 && <div className="font-mono text-[11px] text-mute">{rdap.status.join(', ')}</div>}
    </div>
  );
}

function IpGeoView({ list }: { list: EmailIpGeo[] }) {
  return (
    <div className="space-y-1.5">
      {list.map((g) => (
        <div key={g.ip} className="text-sm">
          <span className="font-mono text-xs">{g.ip}</span>
          <span className="ml-2 text-xs text-mute">{g.role === 'mx' ? t('почтовый сервер {host}', { host: g.host ?? '' }) : t('сайт домена')}</span>
          <div className="text-dim">
            {[g.city, g.region, g.country].filter(Boolean).join(', ') || t('место неизвестно')}
            {(g.org || g.asn) && <span className="ml-2 font-mono text-[11px] text-mute">{[g.asn, g.org].filter(Boolean).join(' · ')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Hunter ----------

function HunterPerson({ e }: { e: HunterEmail }) {
  const name = [e.firstName, e.lastName].filter(Boolean).join(' ');
  return (
    <div className="space-y-0.5 py-2 text-sm first:pt-0">
      <Searchable value={e.value} mode="email" mono={false} />
      <div className="text-dim">
        {name || <None>{t('имя неизвестно')}</None>}
        {(e.position || e.department) && <span className="ml-2 text-xs text-mute">{[e.position, e.department, e.seniority].filter(Boolean).join(' · ')}</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs">
        {e.linkedin && <Ext href={e.linkedin}>LinkedIn</Ext>}
        {e.twitter && <Ext href={`https://x.com/${e.twitter.replace(/^@/, '')}`}>@{e.twitter.replace(/^@/, '')}</Ext>}
        {e.phone && <span className="font-mono">{e.phone}</span>}
        {e.confidence !== null && <span className="font-mono text-mute">{t('уверенность {n}%', { n: e.confidence })}</span>}
      </div>
      {e.sources.length > 0 && (
        <details>
          <summary className="cursor-pointer font-mono text-[11px] text-mute hover:text-text">{t('где опубликован ({n})', { n: e.sources.length })}</summary>
          <div className="mt-1 space-y-0.5">
            {e.sources.map((s) => (
              <div key={s.uri} className="flex flex-wrap items-baseline gap-x-2">
                <Ext href={s.uri}>{s.uri}</Ext>
                <span className="font-mono text-[10px] text-mute">{s.extractedOn ?? ''}{s.stillOnPage === false ? ` · ${t('уже снят')}` : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function HunterView({ hunter: h }: { hunter: HunterDomain }) {
  return (
    <div className="space-y-3">
      <div className="divide-y divide-line-soft">
        <Row label={t('Организация')}>{h.organization ?? <None />}{h.industry && <span className="ml-2 text-xs text-mute">{h.industry}</span>}{h.country && <span className="ml-2 font-mono text-xs text-mute">{h.country}</span>}</Row>
        {h.description && <Row label={t('Описание')}><span className="text-dim">{h.description}</span></Row>}
        <Row label={t('Шаблон адресов')}>{h.pattern ? <Mono>{h.pattern}</Mono> : <None>{t('не определён')}</None>}</Row>
        <Row label={t('Признаки')}>
          <div className="flex flex-wrap gap-1.5">
            {h.webmail && <Tag tone="dim">{t('веб-почта')}</Tag>}
            {h.disposable && <Tag tone="danger">{t('одноразовые ящики')}</Tag>}
            {h.acceptAll && <Tag tone="dim">{t('сервер принимает любые адреса')}</Tag>}
            {h.total !== null && <Tag tone="info">{t('адресов у Hunter: {n}', { n: h.total })}</Tag>}
          </div>
        </Row>
        {h.links.length > 0 && <Row label={t('Соцсети')}>{h.links.map((l) => <span key={l.url} className="mr-3"><Ext href={l.url}>{l.label}</Ext></span>)}</Row>}
        <Row label={t('Сам адрес')}>{h.target ? <HunterPerson e={h.target} /> : <None>{t('в выборке Hunter его нет')}</None>}</Row>
      </div>
      {h.emails.filter((e) => e !== h.target).length > 0 && (
        <details open>
          <summary className="cursor-pointer font-mono text-xs text-dim hover:text-text">{t('Другие адреса домена ({n})', { n: h.emails.length - (h.target ? 1 : 0) })}</summary>
          <div className="divide-y divide-line-soft">{h.emails.filter((e) => e !== h.target).map((e) => <HunterPerson key={e.value} e={e} />)}</div>
        </details>
      )}
    </div>
  );
}

// ---------- Веб ----------

function WebView({ web }: { web: EmailWeb }) {
  if (web.state === 'blocked') return <div className="text-sm text-warn">{t('{engine} принял сервер за бота и выдачу не отдал — воспользуйтесь ссылками ручного поиска в карточке «Адрес».', { engine: web.engine })}</div>;
  if (!web.hits.length) return <None>{t('{engine}: ничего не найдено.', { engine: web.engine })}</None>;
  return (
    <div className="space-y-2.5">
      {web.hits.map((h) => (
        <div key={h.url} className={clsx('text-sm', !h.exact && 'opacity-60')}>
          <a href={h.url} target="_blank" rel="noreferrer" className="font-semibold text-mint hover:underline">{h.title}</a>
          {!h.exact && <span className="ml-2 font-mono text-[10px] text-mute">{t('адреса во фрагменте нет')}</span>}
          <div className="truncate font-mono text-[11px] text-mute">{h.url}</div>
          {h.snippet && <div className="text-xs text-dim">{h.snippet}</div>}
        </div>
      ))}
      <p className="font-mono text-[11px] text-mute">{t('Выдача {engine} по точной фразе. Google без JavaScript выдачу не отдаёт — для него ссылка в карточке «Адрес».', { engine: web.engine })}</p>
    </div>
  );
}
