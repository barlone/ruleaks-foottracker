import type { GoogleEmailReport } from './google.ts';

// «Поиск по Email»: отчёт по адресу электронной почты — сведения Google о его аккаунте (перенос GHunt) и всё, что
// о почте и её домене знают внешние источники (перенос MOSINT, https://github.com/alpkeskin/mosint): DNS и почтовые
// политики домена, регистрация домена, геолокация серверов, утечки, дампы, репутация, коллеги по домену,
// упоминания в вебе, регистрации на сайтах. Какие проверки идут, зависит от домена адреса (emailDomainInfo).
// Здесь — разбор ввода, классификация домена и форма отчёта, общие для сервера и веба.

export const MOSINT_URL = 'https://github.com/alpkeskin/mosint';

/** RFC 5321: адрес — не длиннее 254 символов, имя до @ — до 64. */
export const EMAIL_QUERY_MAX = 254;

export interface ParsedEmail {
  /** Адрес в нижнем регистре, домен — в ASCII (punycode). */
  email: string;
  local: string;
  domain: string;
}

const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Домен в ASCII: кириллический домен (почта.рф) → xn--… Через URL — так же в браузере и на сервере. */
function asciiDomain(d: string): string | null {
  try {
    return new URL(`http://${d}/`).hostname;
  } catch {
    return null;
  }
}

/**
 * Синтаксическая проверка адреса (модуль verification MOSINT) до сетевых запросов: имя до @ — по RFC 5322 без
 * кавычек и комментариев (их на практике не встречается), домен — по меткам DNS. Регистр не важен: адрес приводится
 * к нижнему (почтовые сервисы не различают регистр имени, а один адрес должен давать одну запись в истории).
 */
export function parseEmail(raw: string): ParsedEmail | null {
  const q = raw.trim().replace(/^mailto:/i, '');
  if (!q || q.length > EMAIL_QUERY_MAX) return null;
  const at = q.lastIndexOf('@');
  if (at <= 0 || at === q.length - 1) return null;
  const local = q.slice(0, at).toLowerCase();
  if (local.length > 64 || !LOCAL_RE.test(local)) return null;
  const domain = asciiDomain(q.slice(at + 1).toLowerCase().replace(/\.$/, ''));
  if (!domain || !DOMAIN_RE.test(domain)) return null;
  const email = `${local}@${domain}`;
  return email.length > EMAIL_QUERY_MAX ? null : { email, local, domain };
}

/** null — строка годится, иначе — что с ней не так. */
export function emailQueryProblem(raw: string): string | null {
  const q = raw.trim();
  if (!q) return null;
  if (q.length > EMAIL_QUERY_MAX) return `не длиннее ${EMAIL_QUERY_MAX} символов`;
  if (!q.includes('@')) return 'нужен адрес электронной почты: имя@домен';
  return parseEmail(q) ? null : 'адрес записан с ошибкой: имя@домен.зона, без пробелов и кавычек';
}

// ---------- Домен ----------

/**
 * gmail — Gmail (сам Google); free — бесплатный почтовый сервис; disposable — одноразовый ящик; corporate — свой домен
 * (организация или частное лицо). От вида зависят проверки: Hunter, регистрация домена и геолокация серверов
 * имеют смысл только для своего домена — у mail.ru нет «коллег», а серверы Gmail ничего не говорят о человеке.
 */
export type EmailDomainKind = 'gmail' | 'free' | 'disposable' | 'corporate';

export interface EmailDomainInfo {
  domain: string;
  kind: EmailDomainKind;
  /** Название сервиса для gmail / free (Mail.ru, Яндекс Почта…); у своего домена провайдер виден по MX (EmailDns). */
  provider: string | null;
}

const GMAIL = ['gmail.com', 'googlemail.com'];

/** Бесплатные почтовые сервисы: домен → название. Не исчерпывающе — самые частые в русскоязычных и мировых данных. */
const FREE_PROVIDERS: Record<string, string> = {
  'mail.ru': 'Mail.ru', 'bk.ru': 'Mail.ru', 'list.ru': 'Mail.ru', 'inbox.ru': 'Mail.ru', 'internet.ru': 'Mail.ru', 'mail.ua': 'Mail.ru',
  'yandex.ru': 'Яндекс Почта', 'ya.ru': 'Яндекс Почта', 'yandex.com': 'Яндекс Почта', 'yandex.by': 'Яндекс Почта', 'yandex.kz': 'Яндекс Почта',
  'yandex.ua': 'Яндекс Почта', 'narod.ru': 'Яндекс Почта',
  'rambler.ru': 'Рамблер', 'lenta.ru': 'Рамблер', 'autorambler.ru': 'Рамблер', 'myrambler.ru': 'Рамблер', 'ro.ru': 'Рамблер', 'rambler.ua': 'Рамблер',
  'vk.com': 'VK', 'vk.ru': 'VK',
  'outlook.com': 'Outlook.com', 'hotmail.com': 'Outlook.com', 'live.com': 'Outlook.com', 'msn.com': 'Outlook.com', 'outlook.ru': 'Outlook.com',
  'hotmail.ru': 'Outlook.com', 'live.ru': 'Outlook.com', 'hotmail.co.uk': 'Outlook.com', 'live.co.uk': 'Outlook.com', 'outlook.de': 'Outlook.com',
  'yahoo.com': 'Yahoo Mail', 'yahoo.co.uk': 'Yahoo Mail', 'yahoo.de': 'Yahoo Mail', 'yahoo.fr': 'Yahoo Mail', 'ymail.com': 'Yahoo Mail', 'rocketmail.com': 'Yahoo Mail',
  'aol.com': 'AOL Mail',
  'icloud.com': 'iCloud', 'me.com': 'iCloud', 'mac.com': 'iCloud',
  'proton.me': 'Proton Mail', 'protonmail.com': 'Proton Mail', 'protonmail.ch': 'Proton Mail', 'pm.me': 'Proton Mail',
  'tutanota.com': 'Tuta', 'tutanota.de': 'Tuta', 'tuta.io': 'Tuta', 'tutamail.com': 'Tuta', 'keemail.me': 'Tuta',
  'gmx.com': 'GMX', 'gmx.de': 'GMX', 'gmx.net': 'GMX', 'gmx.at': 'GMX', 'web.de': 'WEB.DE',
  'zoho.com': 'Zoho Mail', 'zohomail.com': 'Zoho Mail', 'mail.com': 'mail.com', 'email.com': 'mail.com',
  'ukr.net': 'UKR.NET', 'i.ua': 'I.UA', 'meta.ua': 'META.ua', 'bigmir.net': 'bigmir)net',
  'tut.by': 'TUT.BY', 'mail.kz': 'Mail.kz',
  'qq.com': 'QQ Mail', '163.com': 'NetEase', '126.com': 'NetEase', 'sina.com': 'Sina Mail',
  'seznam.cz': 'Seznam', 'wp.pl': 'WP Poczta', 'o2.pl': 'o2', 'interia.pl': 'Interia', 'libero.it': 'Libero',
  'naver.com': 'Naver', 'hanmail.net': 'Daum', 'rediffmail.com': 'Rediffmail',
  'hushmail.com': 'Hushmail', 'fastmail.com': 'Fastmail', 'posteo.de': 'Posteo', 'mailbox.org': 'mailbox.org', 'disroot.org': 'Disroot',
  'cock.li': 'cock.li', 'onionmail.org': 'OnionMail', 'riseup.net': 'Riseup',
};

/** Одноразовые ящики (временная почта): самые известные сервисы; полный список — тысячи доменов и меняется каждый день. */
const DISPOSABLE = new Set([
  'mailinator.com', 'mailinator.net', 'mailinator2.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'guerrillamailblock.com', 'sharklasers.com', 'grr.la', 'pokemail.net', 'spam4.me', '10minutemail.com', '10minutemail.net', '10minutemail.co.uk',
  'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmail.dev', 'tempmailo.com', 'tempr.email', 'temp-mail.ru', 'tempail.com',
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj', 'speed.1s.fr',
  'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf', 'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'trashmail.net',
  'trash-mail.com', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com',
  'emailondeck.com', 'fakeinbox.com', 'fakemail.net', 'getairmail.com', 'mailcatch.com', 'mytemp.email', 'spamgourmet.com', 'mailpoof.com',
  'burnermail.io', 'inboxkitten.com', 'tempinbox.com', 'emailfake.com', 'crazymailing.com', 'mail.tm', 'mail.gw', 'tmail.ws', 'dropmail.me',
  '1secmail.com', '1secmail.net', '1secmail.org', 'esiix.com', 'wwjmp.com', 'xojxe.com', 'yoggm.com', 'harakirimail.com', 'mailforspam.com',
  'spambox.us', 'incognitomail.org', 'anonbox.net', 'emailtemporanea.com', 'cuvox.de', 'dayrep.com', 'einrot.com', 'fleckens.hu', 'gustr.com',
  'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us', 'armyspy.com', 'minuteinbox.com', 'emltmp.com', 'tmpmail.org', 'tmpmail.net',
  'mailto.plus', 'fexpost.com', 'fexbox.org', 'rover.info', 'chitthi.in', 'any.pink', 'merepost.com', 'linshiyouxiang.net', 'vmani.com',
  'disposablemail.com', 'luxusmail.org', 'tempmail.plus', 'mailna.co', 'smailpro.com', 'firemailbox.club', 'altmails.com', 'kurzepost.de',
  'objectmail.com', 'proxymail.eu', 'rcpt.at', 'trash-me.com', 'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org', 'mvrht.net',
  'byom.de', 'mailbox52.ga', 'mailbox80.biz', 'drdrb.net', 'opayq.com', 'spamex.com', 'tempemail.net', 'mailexpire.com', 'spambog.com',
  'eyepaste.com', 'mailmetrash.com', 'tafmail.com', 'thankyou2010.com', 'emailsensei.com', 'notmailinator.com', 'zetmail.com',
]);

/** Ближайший к адресу «известный» домен: поддомен (smtp.mail.ru) наследует вид родителя. */
function lookupUp<T>(domain: string, get: (d: string) => T | undefined): T | undefined {
  for (let d = domain; d.includes('.'); d = d.slice(d.indexOf('.') + 1)) {
    const v = get(d);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function emailDomainInfo(domain: string): EmailDomainInfo {
  const d = domain.toLowerCase();
  if (GMAIL.includes(d)) return { domain: d, kind: 'gmail', provider: 'Gmail' };
  if (lookupUp(d, (x) => (DISPOSABLE.has(x) ? true : undefined))) return { domain: d, kind: 'disposable', provider: null };
  const free = lookupUp(d, (x) => FREE_PROVIDERS[x]);
  if (free) return { domain: d, kind: 'free', provider: free };
  return { domain: d, kind: 'corporate', provider: null };
}

// ---------- Опечатка в домене ----------
// Проверка typo из deep-email-validator (она на библиотеке mailcheck): домен адреса сравнивается со списком
// известных почтовых сервисов и доменных зон; похожий, но не совпадающий — вероятная опечатка (gmial.com, mail.ry,
// yandex.con). Это подсказка, а не отказ: домен, отличающийся от известного одной буквой, бывает и настоящим.

/** Зоны, которых нет, но в которые легко опечататься, → настоящая. Существующие зоны (.co, .cm, .ne) сюда нельзя. */
const TLD_TYPOS: Record<string, string> = {
  con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', cpm: 'com', comm: 'com', coml: 'com', 'com,': 'com',
  nte: 'net', nett: 'net', ogr: 'org', orgg: 'org', rru: 'ru', ruu: 'ru', ry: 'ru', 'ру': 'ru',
};

/** Расстояние Дамерау — Левенштейна (перестановка соседних букв — одна правка), не больше max + 1. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Домен, который, вероятно, имелся в виду, или null. Известный сервис (в том числе одноразовый) не трогаем.
 * Короткие домены (ya.ru, bk.ru, me.com) в сравнении не участвуют: в одной правке от них — тысячи настоящих;
 * до 8 знаков допускается одна правка, длиннее — две.
 */
export function emailDomainTypo(domain: string): string | null {
  const d = domain.toLowerCase();
  if (emailDomainInfo(d).kind !== 'corporate') return null;
  const dot = d.lastIndexOf('.');
  const tld = TLD_TYPOS[d.slice(dot + 1)];
  const fixed = tld ? `${d.slice(0, dot + 1)}${tld}` : d;
  if (fixed !== d && emailDomainInfo(fixed).kind !== 'corporate') return fixed;
  let best: string | null = null;
  let bestDist = 3;
  for (const known of [...GMAIL, ...Object.keys(FREE_PROVIDERS)]) {
    if (known.length < 7) continue;
    const max = known.length >= 9 ? 2 : 1;
    const dist = editDistance(fixed, known, max);
    if (dist <= max && dist < bestDist) {
      best = known;
      bestDist = dist;
    }
  }
  return best ?? (fixed !== d ? fixed : null);
}

/** Адрес с исправленным доменом, если в домене похоже на опечатку; иначе null. */
export function emailTypoFix(p: ParsedEmail): string | null {
  const domain = emailDomainTypo(p.domain);
  return domain ? `${p.local}@${domain}` : null;
}

export const EMAIL_DOMAIN_KINDS: Record<EmailDomainKind, string> = {
  gmail: 'Gmail',
  free: 'бесплатный почтовый сервис',
  disposable: 'одноразовый ящик',
  corporate: 'свой домен',
};

// ---------- Части отчёта ----------

/** Части отчёта в порядке показа; по ним же — индикатор хода работы. */
export const EMAIL_PARTS = [
  { id: 'dns', label: 'DNS и почтовые политики' },
  { id: 'mailbox', label: 'Существование ящика' },
  { id: 'rdap', label: 'Регистрация домена' },
  { id: 'ipgeo', label: 'Геолокация серверов' },
  { id: 'google', label: 'Аккаунт Google' },
  { id: 'sites', label: 'Регистрации на сайтах' },
  { id: 'hibp', label: 'Have I Been Pwned' },
  { id: 'breachdirectory', label: 'BreachDirectory' },
  { id: 'intelx', label: 'Intelligence X' },
  { id: 'pastes', label: 'Дампы Pastebin' },
  { id: 'emailrep', label: 'Репутация (EmailRep)' },
  { id: 'hunter', label: 'Домен в Hunter.io' },
  { id: 'web', label: 'Упоминания в вебе' },
] as const;

export type EmailPartId = (typeof EMAIL_PARTS)[number]['id'];
export const emailPartLabel = (id: EmailPartId) => EMAIL_PARTS.find((p) => p.id === id)!.label;

/** Часть отчёта: собрана, не удалась или не проверялась (с причиной: нет ключа API, не нужна для такого домена…). */
export type EmailSection<T> = { status: 'ok'; data: T } | { status: 'error'; error: string } | { status: 'skipped'; reason: string };

export interface EmailMx {
  host: string;
  priority: number;
}

/** Записи DNS домена почты и что из них следует (модуль dns MOSINT + почтовые политики EmailRep). */
export interface EmailDns {
  /** Домен существует (есть хоть одна запись); false — NXDOMAIN, почта на него не доставляется. */
  exists: boolean;
  mx: EmailMx[];
  /** «Null MX» (RFC 7505): домен объявил, что почту не принимает. */
  nullMx: boolean;
  /** Кто обслуживает почту — по именам MX (Google Workspace, Microsoft 365, Яндекс 360…). */
  mailProvider: string | null;
  a: string[];
  aaaa: string[];
  ns: string[];
  txt: string[];
  spf: string | null;
  /** Чем кончается SPF: -all (строго), ~all (мягко), ?all, +all; null — SPF нет или без all. */
  spfAll: string | null;
  /** Сервисы, которым SPF разрешает слать письма от имени домена (include:, redirect=). */
  spfIncludes: { value: string; service: string | null }[];
  dmarc: string | null;
  /** p= из DMARC; null — DMARC нет. */
  dmarcPolicy: 'none' | 'quarantine' | 'reject' | null;
  /** Письмо от имени домена легко подделать: DMARC не применяется (нет или p=none) и SPF не строгий. */
  spoofable: boolean;
  /** Подтверждения владения доменом в сторонних сервисах (TXT: google-site-verification, MS=…). */
  verifications: { service: string; value: string }[];
}

/** Ответ на вопрос «есть ли такой ящик»: существует, нет, сервер принимает всё подряд (понять нельзя), не удалось узнать. */
export type MailboxVerdict = 'exists' | 'missing' | 'catchall' | 'unknown';

export type MailboxReason =
  | 'accepted' | 'full' | 'rejected' | 'catchall'
  | 'no-domain' | 'null-mx' | 'no-mx'
  | 'no-connect' | 'greylist' | 'blocked' | 'tls' | 'timeout' | 'protocol';

/** Почему вынесен такой вердикт — по-русски. */
export const MAILBOX_REASONS: Record<MailboxReason, string> = {
  accepted: 'почтовый сервер принял этот адрес',
  full: 'ящик есть, но переполнен',
  rejected: 'почтовый сервер ответил, что такого получателя нет',
  catchall: 'сервер принимает любые адреса домена, даже случайные, — существует ли именно этот ящик, узнать нельзя',
  'no-domain': 'домена не существует',
  'null-mx': 'домен объявил, что почту не принимает',
  'no-mx': 'у домена нет почтовых серверов',
  'no-connect': 'нет соединения с почтовым сервером: скорее всего, у хостинга этого сайта закрыт исходящий порт 25',
  greylist: 'сервер ответил временным отказом (greylisting или недоверие к адресу нашего сервера)',
  blocked: 'сервер отказал по правилам защиты от спама: репутация, обратная DNS-запись или SPF нашего сервера',
  tls: 'сервер не стал продолжать без шифрования',
  timeout: 'сервер не ответил вовремя',
  protocol: 'сервер прервал разговор',
};

/**
 * Проверка ящика у почтового сервера домена (SMTP до RCPT TO, письмо не отправляется) — метод deep-email-validator
 * с определением catch-all (apps/server/src/email/smtp.ts).
 */
export interface EmailMailbox {
  verdict: MailboxVerdict;
  reason: MailboxReason;
  /** Сервер, который отвечал (или до которого не достучались); null — до серверов дело не дошло. */
  mx: string | null;
  /** Код и текст ответа сервера, решившего дело (обрезан). */
  code: number | null;
  reply: string | null;
  /** Разговор шёл по STARTTLS. */
  tls: boolean;
  /** Принял ли сервер заведомо несуществующий адрес: true — catch-all, false — различает адреса, null — не выяснено. */
  catchAll: boolean | null;
}

/** RDAP: регистрация домена. */
export interface EmailRdap {
  /** Домен, по которому ответил реестр (для поддомена — родительский). */
  domain: string;
  created: string | null;
  updated: string | null;
  expires: string | null;
  /** Дней с регистрации; null — дата неизвестна. */
  ageDays: number | null;
  registrar: string | null;
  status: string[];
  nameservers: string[];
}

/** Геолокация адреса сервера домена (ipapi.co). */
export interface EmailIpGeo {
  ip: string;
  /** Чей это адрес: домена (A) или почтового сервера (MX). */
  role: 'domain' | 'mx';
  host: string;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
  timezone: string | null;
  asn: string | null;
  org: string | null;
}

/** Регистрация на сайте по e-mail (blackbird, holehe, MOSINT: Instagram, Twitter, Spotify). */
export interface EmailSiteCheck {
  site: string;
  url: string;
  /** claimed — адрес занят; available — свободен; waf — защита от ботов; unknown — нет ответа. */
  status: 'claimed' | 'available' | 'waf' | 'unknown' | 'illegal';
  httpStatus: number | null;
  error: string | null;
  nsfw: boolean;
}

export interface EmailSites {
  checks: EmailSiteCheck[];
  /** Пробы с побочным действием (регистрация, восстановление пароля) пропущены настройками сервера. */
  skippedSideEffect: number;
}

/** Утечка из Have I Been Pwned (API v3 breachedaccount). */
export interface HibpBreach {
  name: string;
  title: string;
  domain: string | null;
  breachDate: string | null;
  addedDate: string | null;
  pwnCount: number;
  dataClasses: string[];
  description: string | null;
  verified: boolean;
  sensitive: boolean;
  spamList: boolean;
  malware: boolean;
  fabricated: boolean;
  logoUrl: string | null;
}

/** BreachDirectory: пароли и хеши из утечек. */
export interface BreachDirectoryResult {
  found: number;
  entries: { sources: string[]; hasPassword: boolean; password: string | null; sha1: string | null; hash: string | null }[];
}

/** Intelligence X: документы в архивах утечек, даркнета, вставок. */
export interface IntelxResult {
  /** Записей всего (показаны первые). */
  total: number;
  records: { systemId: string; name: string; date: string | null; bucket: string | null; media: string | null; size: number | null; link: string }[];
}

/** Дамп текста (psbdmp.ws), где встречается адрес. */
export interface PasteDump {
  id: string;
  url: string;
  date: string | null;
  tags: string | null;
  length: number | null;
}

/** EmailRep.io: репутация адреса. */
export interface EmailRep {
  reputation: string | null;
  suspicious: boolean | null;
  /** Сколько источников знают адрес. */
  references: number | null;
  /** Флаги (blacklisted, malicious_activity…): только известные, null — сервис не ответил про этот флаг. */
  flags: Record<string, boolean | null>;
  firstSeen: string | null;
  lastSeen: string | null;
  daysSinceDomainCreation: number | null;
  primaryMx: string | null;
  /** Сайты, где EmailRep видел профиль с этим адресом. */
  profiles: string[];
}

export interface HunterEmail {
  value: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  seniority: string | null;
  department: string | null;
  linkedin: string | null;
  twitter: string | null;
  phone: string | null;
  confidence: number | null;
  sources: { uri: string; extractedOn: string | null; lastSeenOn: string | null; stillOnPage: boolean | null }[];
}

/** Hunter.io domain-search: организация домена, шаблон адресов, известные сотрудники. */
export interface HunterDomain {
  organization: string | null;
  description: string | null;
  industry: string | null;
  country: string | null;
  /** Шаблон адресов: {first}.{last} и т. п. */
  pattern: string | null;
  webmail: boolean | null;
  disposable: boolean | null;
  acceptAll: boolean | null;
  links: { label: string; url: string }[];
  /** Адресов домена у Hunter всего (показаны первые). */
  total: number | null;
  emails: HunterEmail[];
  /** Сам запрошенный адрес среди известных Hunter. */
  target: HunterEmail | null;
}

export interface WebMention {
  title: string;
  url: string;
  snippet: string | null;
  /** В заголовке или фрагменте есть сам адрес (поисковик мог найти и похожее). */
  exact: boolean;
}

export interface EmailWeb {
  engine: string;
  /** blocked — поисковик показал проверку на бота: выдачи нет. */
  state: 'ok' | 'blocked';
  hits: WebMention[];
}

export interface EmailReport {
  email: string;
  local: string;
  domain: EmailDomainInfo;
  dns: EmailSection<EmailDns>;
  mailbox: EmailSection<EmailMailbox>;
  rdap: EmailSection<EmailRdap | null>;
  ipgeo: EmailSection<EmailIpGeo[]>;
  google: EmailSection<GoogleEmailReport>;
  sites: EmailSection<EmailSites>;
  hibp: EmailSection<HibpBreach[]>;
  breachdirectory: EmailSection<BreachDirectoryResult>;
  intelx: EmailSection<IntelxResult>;
  pastes: EmailSection<PasteDump[]>;
  emailrep: EmailSection<EmailRep>;
  hunter: EmailSection<HunterDomain>;
  web: EmailSection<EmailWeb>;
}

/** Ход работы над частью отчёта. */
export type EmailPartState = 'pending' | 'running' | 'done' | 'skipped';

/** Классы данных HIBP — подписи по-русски (остальные показываются как есть). */
export const HIBP_DATA_CLASSES: Record<string, string> = {
  'Email addresses': 'e-mail', Passwords: 'пароли', Usernames: 'имена пользователей', Names: 'имена', 'Phone numbers': 'телефоны',
  'Physical addresses': 'адреса', 'IP addresses': 'IP-адреса', 'Dates of birth': 'даты рождения', Genders: 'пол',
  'Geographic locations': 'местоположение', 'Credit cards': 'банковские карты', 'Partial credit card data': 'часть данных карт',
  'Bank account numbers': 'банковские счета', 'Passport numbers': 'номера паспортов', 'Government issued IDs': 'документы',
  'Social security numbers': 'номера соцстрахования', 'Job titles': 'должности', Employers: 'работодатели', 'Chat logs': 'переписка',
  'Private messages': 'личные сообщения', 'Security questions and answers': 'контрольные вопросы', 'Password hints': 'подсказки паролей',
  'Auth tokens': 'токены входа', 'Device information': 'устройства', 'Browser user agent details': 'данные браузера', 'Website activity': 'активность на сайте',
  'Purchases': 'покупки', 'Social media profiles': 'профили соцсетей', 'Spoken languages': 'языки', 'Time zones': 'часовые пояса',
  'Historical passwords': 'старые пароли', 'Salutations': 'обращения', 'Avatars': 'аватары', 'Biometric data': 'биометрия',
  'Sexual orientations': 'ориентация', 'Religions': 'религия', 'Ethnicities': 'этническая принадлежность', 'Health insurance information': 'медстраховка',
  'Family members\' names': 'имена родственников', 'Marital statuses': 'семейное положение', 'Education levels': 'образование',
};

/** Флаги EmailRep — подписи по-русски; true у «плохих» флагов — тревожный признак. */
export const EMAILREP_FLAGS: { key: string; label: string; bad: boolean }[] = [
  { key: 'blacklisted', label: 'в чёрных списках', bad: true },
  { key: 'malicious_activity', label: 'вредоносная активность', bad: true },
  { key: 'malicious_activity_recent', label: 'вредоносная активность недавно', bad: true },
  { key: 'credentials_leaked', label: 'учётные данные утекали', bad: true },
  { key: 'credentials_leaked_recent', label: 'учётные данные утекали недавно', bad: true },
  { key: 'data_breach', label: 'есть в утечках', bad: true },
  { key: 'spam', label: 'рассылал спам', bad: true },
  { key: 'free_provider', label: 'бесплатный почтовый сервис', bad: false },
  { key: 'disposable', label: 'одноразовый ящик', bad: true },
  { key: 'deliverable', label: 'письма доставляются', bad: false },
  { key: 'accept_all', label: 'сервер принимает любые адреса', bad: false },
  { key: 'valid_mx', label: 'MX в порядке', bad: false },
  { key: 'domain_exists', label: 'домен существует', bad: false },
  { key: 'new_domain', label: 'домен зарегистрирован недавно', bad: true },
  { key: 'suspicious_tld', label: 'подозрительная доменная зона', bad: true },
  { key: 'spoofable', label: 'письма от домена легко подделать', bad: true },
  { key: 'spf_strict', label: 'строгий SPF', bad: false },
  { key: 'dmarc_enforced', label: 'DMARC применяется', bad: false },
];
