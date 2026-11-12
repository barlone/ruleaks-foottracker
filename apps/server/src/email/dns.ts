import { Resolver } from 'node:dns/promises';
import type { EmailDns, EmailMx } from '@ft/shared';
import { EmailError, type Ctx } from './http.ts';

// Модуль dns MOSINT (v3/pkg/dns, библиотека dnsr): записи MX, A, AAAA, NS, TXT, CNAME домена почты — и почтовые
// политики, которые EmailRep выводит из них же (spf_strict, dmarc_enforced, spoofable, primary_mx). Запросы идут
// через системный резолвер сервера; сторонним сервисам домен здесь не передаётся.

/** Кто обслуживает почту домена — по имени MX-сервера. */
const MX_PROVIDERS: [RegExp, string][] = [
  // gmail-smtp-in — сам Gmail; у Google Workspace — aspmx.l.google.com, smtp.google.com.
  [/(^|\.)gmail-smtp-in\.l\.google\.com$/, 'Gmail'],
  [/(^|\.)(google|googlemail)\.com$/, 'Google Workspace'],
  [/\.mail\.protection\.outlook\.com$/, 'Microsoft 365'],
  [/(^|\.)(outlook|hotmail)\.com$/, 'Microsoft Outlook.com'],
  [/(^|\.)yandex\.(net|ru)$/, 'Яндекс 360'],
  [/(^|\.)mail\.ru$/, 'VK WorkSpace (Mail.ru)'],
  [/(^|\.)rambler\.ru$/, 'Рамблер'],
  [/(^|\.)(protonmail\.ch|proton\.me)$/, 'Proton Mail'],
  [/(^|\.)zoho\.(com|eu|in|com\.au)$/, 'Zoho Mail'],
  [/(^|\.)(icloud|me)\.com$/, 'iCloud'],
  [/(^|\.)messagingengine\.com$/, 'Fastmail'],
  [/(^|\.)tutanota\.de$/, 'Tuta'],
  [/(^|\.)yahoodns\.net$/, 'Yahoo'],
  [/(^|\.)gmx\.net$/, 'GMX'],
  [/(^|\.)web\.de$/, 'WEB.DE'],
  [/(^|\.)pphosted\.com$/, 'Proofpoint'],
  [/(^|\.)mimecast\.com$/, 'Mimecast'],
  [/(^|\.)barracudanetworks\.com$/, 'Barracuda'],
  [/(^|\.)(iphmx|ess\.barracuda)\.com$/, 'Cisco Secure Email'],
  [/(^|\.)mx\.cloudflare\.net$/, 'Cloudflare Email Routing'],
  [/(^|\.)(awsapps|amazonaws)\.com$/, 'Amazon WorkMail / SES'],
  [/(^|\.)mailgun\.org$/, 'Mailgun'],
  [/(^|\.)sendgrid\.net$/, 'SendGrid'],
  [/(^|\.)improvmx\.com$/, 'ImprovMX'],
  [/(^|\.)forwardemail\.net$/, 'Forward Email'],
  [/(^|\.)secureserver\.net$/, 'GoDaddy'],
  [/(^|\.)ovh\.net$/, 'OVHcloud'],
  [/(^|\.)(ionos\.(com|de)|kundenserver\.de)$/, 'IONOS'],
  [/(^|\.)hostinger\.com$/, 'Hostinger'],
  [/(^|\.)timeweb\.ru$/, 'Timeweb'],
  [/(^|\.)beget\.(com|ru)$/, 'Beget'],
  [/(^|\.)reg\.ru$/, 'REG.RU'],
  [/(^|\.)nic\.ru$/, 'RU-CENTER'],
  [/(^|\.)sprinthost\.ru$/, 'Спринтхост'],
  [/(^|\.)masterhost\.ru$/, 'Мастерхост'],
  [/(^|\.)jino\.ru$/, 'Джино'],
  [/(^|\.)hostland\.ru$/, 'Hostland'],
  [/(^|\.)ukraine\.com\.ua$/, 'Хостинг Украина'],
];

/** Подтверждения владения доменом в TXT: по ним видно, какими сервисами пользуется организация. */
const VERIFICATIONS: [RegExp, string][] = [
  [/^google-site-verification=/i, 'Google'],
  [/^yandex-verification[:=]/i, 'Яндекс'],
  [/^MS=ms\d+/i, 'Microsoft 365'],
  [/^facebook-domain-verification=/i, 'Meta (Facebook)'],
  [/^apple-domain-verification=/i, 'Apple'],
  [/^atlassian-domain-verification=/i, 'Atlassian'],
  [/^status-page-domain-verification=/i, 'Atlassian Statuspage'],
  [/^docusign=/i, 'DocuSign'],
  [/^globalsign-domain-verification=/i, 'GlobalSign'],
  [/^zoho-verification=/i, 'Zoho'],
  [/^mailru-verification[:=]/i, 'Mail.ru'],
  [/^vk-(site|domain)-verification/i, 'VK'],
  [/^have-i-been-pwned-verification=/i, 'Have I Been Pwned'],
  [/^stripe-verification=/i, 'Stripe'],
  [/^adobe-idp-site-verification=/i, 'Adobe'],
  [/^adobe-sign-verification=/i, 'Adobe Sign'],
  [/^amazonses:/i, 'Amazon SES'],
  [/^hubspot-(developer|domain)-verification=/i, 'HubSpot'],
  [/^onetrust-domain-verification=/i, 'OneTrust'],
  [/^slack-domain-verification=/i, 'Slack'],
  [/^openai-domain-verification=/i, 'OpenAI'],
  [/^anthropic-domain-verification/i, 'Anthropic'],
  [/^dropbox-domain-verification=/i, 'Dropbox'],
  [/^canva-site-verification=/i, 'Canva'],
  [/^miro-verification=/i, 'Miro'],
  [/^figma-domain-verification/i, 'Figma'],
  [/^notion-domain-verification/i, 'Notion'],
  [/^webexdomainverification/i, 'Webex'],
  [/^cisco-ci-domain-verification=/i, 'Cisco'],
  [/^zoom[-_]verify/i, 'Zoom'],
  [/^protonmail-verification=/i, 'Proton'],
  [/^brevo-code:/i, 'Brevo'],
  [/^pinterest-site-verification=/i, 'Pinterest'],
  [/^tiktok-developers-site-verification=/i, 'TikTok'],
  [/^twilio-domain-verification=/i, 'Twilio'],
  [/^mongodb-site-verification=/i, 'MongoDB'],
  [/^postman-domain-verification=/i, 'Postman'],
  [/^teamviewer-sso-verification=/i, 'TeamViewer'],
  [/^dynatrace-site-verification=/i, 'Dynatrace'],
  [/^knowbe4-site-verification=/i, 'KnowBe4'],
  [/^citrix-verification-code=/i, 'Citrix'],
  [/^logmein-verification-code=/i, 'LogMeIn'],
  [/^jamf-site-verification=/i, 'Jamf'],
  [/^klaviyo-site-verification=/i, 'Klaviyo'],
  [/^ahrefs-site-verification_/i, 'Ahrefs'],
  [/^yahoo-verification-key=/i, 'Yahoo'],
  [/^cursor-domain-verification/i, 'Cursor'],
  [/^wrike-verification=/i, 'Wrike'],
  [/^bitrix-verification/i, 'Битрикс24'],
];

/** Кому SPF разрешает слать письма от имени домена (include: / redirect=). */
const SPF_SERVICES: [RegExp, string][] = [
  [/(^|\.)_spf\.google\.com$/, 'Google Workspace'],
  [/(^|\.)spf\.protection\.outlook\.com$/, 'Microsoft 365'],
  [/(^|\.)_spf\.yandex\.(net|ru)$/, 'Яндекс 360'],
  [/(^|\.)_spf\.mail\.ru$/, 'Mail.ru'],
  [/(^|\.)sendgrid\.net$/, 'SendGrid'],
  [/(^|\.)mailgun\.org$/, 'Mailgun'],
  [/(^|\.)amazonses\.com$/, 'Amazon SES'],
  [/(^|\.)servers\.mcsv\.net$/, 'Mailchimp'],
  [/(^|\.)mandrillapp\.com$/, 'Mandrill'],
  [/(^|\.)(sendinblue|brevo)\.com$/, 'Brevo'],
  [/(^|\.)salesforce\.com$/, 'Salesforce'],
  [/(^|\.)zoho\.(com|eu)$/, 'Zoho'],
  [/(^|\.)mailjet\.com$/, 'Mailjet'],
  [/(^|\.)sparkpostmail\.com$/, 'SparkPost'],
  [/(^|\.)mtasv\.net$/, 'Postmark'],
  [/(^|\.)unisender\.com$/, 'UniSender'],
  [/(^|\.)(hubspotemail\.net|hubspot\.com)$/, 'HubSpot'],
  [/(^|\.)protonmail\.ch$/, 'Proton'],
  [/(^|\.)icloud\.com$/, 'iCloud'],
  [/(^|\.)zendesk\.com$/, 'Zendesk'],
  [/(^|\.)freshdesk\.com$/, 'Freshdesk'],
  [/(^|\.)atlassian\.net$/, 'Atlassian'],
  [/(^|\.)bitrix24\./, 'Битрикс24'],
  [/(^|\.)esputnik\.com$/, 'eSputnik'],
  [/(^|\.)dashamail\.(ru|com)$/, 'DashaMail'],
  [/(^|\.)mindbox\.ru$/, 'Mindbox'],
  [/(^|\.)notisend\.ru$/, 'NotiSend'],
  [/(^|\.)smtp\.bz$/, 'SMTP.BZ'],
  [/(^|\.)timeweb\.ru$/, 'Timeweb'],
  [/(^|\.)beget\.(com|ru)$/, 'Beget'],
  [/(^|\.)reg\.ru$/, 'REG.RU'],
];

const match = (list: [RegExp, string][], s: string) => list.find(([re]) => re.test(s))?.[1] ?? null;

/** TXT-записей показываем не больше, длинные обрезаем: ключи DKIM и подобное в отчёте ни к чему. */
const MAX_TXT = 40;
const MAX_TXT_LEN = 500;

type Answer<T> = { value: T; nx: boolean };

/** Запрос DNS: «нет таких записей» и «нет такого имени» — пустой ответ, остальное (таймаут, отказ) — ошибка. */
async function ask<T>(run: () => Promise<T>, empty: T): Promise<Answer<T>> {
  try {
    return { value: await run(), nx: false };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENODATA' || code === 'ENONAME') return { value: empty, nx: false };
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return { value: empty, nx: true };
    throw e;
  }
}

export async function domainDns(domain: string, ctx: Ctx): Promise<EmailDns> {
  const resolver = new Resolver({ timeout: Math.min(ctx.timeoutMs, 5000), tries: 2 });
  const stop = () => resolver.cancel();
  ctx.signal.addEventListener('abort', stop, { once: true });
  try {
    const [mx, a, aaaa, ns, txt, dmarc, cname] = await Promise.all([
      ask(() => resolver.resolveMx(domain), [] as { exchange: string; priority: number }[]),
      ask(() => resolver.resolve4(domain), [] as string[]),
      ask(() => resolver.resolve6(domain), [] as string[]),
      ask(() => resolver.resolveNs(domain), [] as string[]),
      ask(() => resolver.resolveTxt(domain), [] as string[][]),
      ask(() => resolver.resolveTxt(`_dmarc.${domain}`), [] as string[][]),
      ask(() => resolver.resolveCname(domain), [] as string[]),
    ]);
    if (ctx.signal.aborted) throw ctx.signal.reason as Error;
    return analyze({ mx, a, aaaa, ns, txt, dmarc, cname });
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ETIMEOUT') throw new EmailError('TIMEOUT', `DNS ${domain}: таймаут`);
    throw new EmailError('NET', `DNS ${domain}: ${code ?? ''} ${(e as Error).message}`);
  } finally {
    ctx.signal.removeEventListener('abort', stop);
  }
}

function analyze(r: {
  mx: Answer<{ exchange: string; priority: number }[]>; a: Answer<string[]>; aaaa: Answer<string[]>; ns: Answer<string[]>;
  txt: Answer<string[][]>; dmarc: Answer<string[][]>; cname: Answer<string[]>;
}): EmailDns {
  const mxAll: EmailMx[] = r.mx.value
    .map((m) => ({ host: m.exchange.toLowerCase().replace(/\.$/, ''), priority: m.priority }))
    .sort((x, y) => x.priority - y.priority || x.host.localeCompare(y.host));
  // RFC 7505: единственная запись «MX 0 .» — домен почту не принимает.
  const nullMx = mxAll.length === 1 && mxAll[0]!.host === '';
  const mx = mxAll.filter((m) => m.host);
  const txt = r.txt.value.map((chunks) => chunks.join(''));
  const spf = txt.find((t) => /^v=spf1(\s|$)/i.test(t)) ?? null;
  const dmarc = r.dmarc.value.map((c) => c.join('')).find((t) => /^v=DMARC1/i.test(t)) ?? null;

  let spfAll: string | null = null;
  const spfIncludes: EmailDns['spfIncludes'] = [];
  if (spf) {
    for (const tok of spf.split(/\s+/).slice(1)) {
      const all = /^([-~?+]?)all$/i.exec(tok);
      if (all) spfAll = `${all[1] || '+'}all`;
      const inc = /^(?:include:|redirect=)(.+)$/i.exec(tok)?.[1]?.toLowerCase();
      if (inc && !spfIncludes.some((i) => i.value === inc)) spfIncludes.push({ value: inc, service: match(SPF_SERVICES, inc) });
    }
  }
  const p = dmarc ? /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)/i.exec(dmarc)?.[1]?.toLowerCase() : undefined;
  const dmarcPolicy = dmarc ? ((p as EmailDns['dmarcPolicy']) ?? 'none') : null;
  // Подделку письма от имени домена получатели отсекают, если DMARC требует отклонять / помещать в карантин
  // или SPF строгий (-all). Иначе — «spoofable», как у EmailRep.
  const spoofable = !(dmarcPolicy === 'quarantine' || dmarcPolicy === 'reject') && spfAll !== '-all';

  const verifications: EmailDns['verifications'] = [];
  for (const t of txt) {
    const service = match(VERIFICATIONS, t);
    if (service) verifications.push({ service, value: t.length > 120 ? `${t.slice(0, 120)}…` : t });
  }

  const exists = !(r.mx.nx && r.a.nx && r.ns.nx && r.txt.nx);
  return {
    exists,
    mx,
    nullMx,
    mailProvider: mx.map((m) => match(MX_PROVIDERS, m.host)).find(Boolean) ?? null,
    a: r.a.value,
    aaaa: r.aaaa.value,
    ns: r.ns.value.map((n) => n.toLowerCase()).sort(),
    txt: txt.slice(0, MAX_TXT).map((t) => (t.length > MAX_TXT_LEN ? `${t.slice(0, MAX_TXT_LEN)}…` : t)),
    spf,
    spfAll,
    spfIncludes,
    dmarc,
    dmarcPolicy,
    spoofable: exists && !nullMx && spoofable,
    verifications,
  };
}

/** Адреса IPv4 почтового сервера (для геолокации). */
export async function hostIps(host: string, ctx: Ctx): Promise<string[]> {
  const resolver = new Resolver({ timeout: Math.min(ctx.timeoutMs, 5000), tries: 2 });
  try {
    return await resolver.resolve4(host);
  } catch {
    return [];
  }
}
