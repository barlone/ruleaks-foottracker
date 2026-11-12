import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import type { EmailDns, EmailMailbox, MailboxReason, MailboxVerdict } from '@ft/shared';
import { isPublicIp } from '../pages/outbound.ts';

// Существует ли ящик — вопрос почтовому серверу домена. Метод deep-email-validator
// (https://github.com/mfbx9da4/deep-email-validator, MIT; src/smtp/smtp.ts): соединиться с MX на порту 25, дойти до
// RCPT TO и прочитать ответ, письмо не отправляя. Здесь он перенесён с доработками, без которых ответу нельзя верить:
//   - catch-all: после принятого адреса спрашиваем заведомо случайный — если принят и он, сервер принимает всё
//     подряд, и о ящике ответ ничего не говорит (у библиотеки любой 250 = «существует»);
//   - отказ отказу рознь: 5xx «нет такого получателя» — ящика нет; 5xx по правилам защиты от спама (репутация,
//     обратная DNS-запись нашего сервера) и 4xx (greylisting) — «проверить не удалось», а не «не существует»;
//   - закрытый исходящий порт 25 (обычное дело у хостингов и домашних провайдеров) — отдельная причина;
//   - многострочные ответы, EHLO и STARTTLS (часть серверов без шифрования дальше не говорит);
//   - соединение только с публичным IP, полученным из DNS: MX чужого домена может указывать во внутреннюю сеть.
// Сервер цели видит соединение с нашего адреса и запись об этом остаётся в его журнале — поэтому часть выключена,
// пока её явно не включат ([email-search] smtp-check).

export interface SmtpOptions {
  /** Имя в EHLO: должно совпадать с обратной DNS-записью нашего IP, иначе крупные сервисы не доверяют. */
  helo: string;
  /** Адрес в MAIL FROM; '' — пустой отправитель <>. */
  from: string;
  /** Сколько ждать соединения и каждого ответа. */
  timeoutMs: number;
  signal: AbortSignal;
  log: (msg: string) => void;
  /** Для проверки на ложном сервере: порт и адреса вместо DNS. */
  port?: number;
  resolve?: (host: string) => Promise<string[]>;
}

interface Reply {
  code: number;
  /** Все строки ответа без кодов, через перевод строки. */
  text: string;
}

class ConnectFailed extends Error {}
class SmtpTimeout extends Error {}
class SmtpClosed extends Error {}

/** Разговор с одним сервером: команды по очереди, ответы — целиком (многострочные склеиваются). */
class Session {
  private buf = '';
  private waiter: { resolve: (r: Reply) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private dead: Error | null = null;
  constructor(private sock: net.Socket, private timeoutMs: number) {
    this.attach(sock);
  }

  private attach(sock: net.Socket) {
    this.sock = sock;
    sock.setEncoding('latin1');
    sock.on('data', (chunk: string) => {
      this.buf += chunk;
      if (this.buf.length > 64_000) return this.fail(new SmtpClosed('ответ слишком длинный'));
      this.flush();
    });
    sock.on('error', (e) => this.fail(new SmtpClosed(e.message)));
    sock.on('close', () => this.fail(new SmtpClosed('сервер закрыл соединение')));
  }

  /** Полный ответ в буфере: последняя строка — «код пробел текст», предыдущие — «код-текст». */
  private flush() {
    if (!this.waiter) return;
    const lines = this.buf.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i++) {
      const m = /^(\d{3})([ -]?)(.*)$/.exec(lines[i]!);
      if (!m) continue;
      if (m[2] === '-') continue;
      const text = lines.slice(0, i + 1).map((l) => l.replace(/^\d{3}[ -]?/, '')).join('\n');
      this.buf = lines.slice(i + 1).join('\n');
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      return w.resolve({ code: Number(m[1]), text });
    }
  }

  private fail(e: Error) {
    this.dead ??= e;
    const w = this.waiter;
    this.waiter = null;
    if (w) {
      clearTimeout(w.timer);
      w.reject(e);
    }
  }

  read(): Promise<Reply> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new SmtpTimeout('сервер не ответил вовремя')), this.timeoutMs);
      this.waiter = { resolve, reject, timer };
      this.flush();
    });
  }

  cmd(line: string): Promise<Reply> {
    if (this.dead) return Promise.reject(this.dead);
    this.sock.write(`${line}\r\n`);
    return this.read();
  }

  /** STARTTLS: сертификат не проверяем — у почтовых серверов он часто на другое имя, а нам нужен только ответ. */
  async startTls(servername: string): Promise<void> {
    const plain = this.sock;
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('close');
    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => reject(new SmtpTimeout('TLS: сервер не ответил вовремя')), this.timeoutMs);
      const s = tls.connect({ socket: plain, servername: net.isIP(servername) ? undefined : servername, rejectUnauthorized: false }, () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (e) => {
        clearTimeout(timer);
        reject(new SmtpClosed(`TLS: ${e.message}`));
      });
    });
    this.buf = '';
    this.attach(secure);
  }

  close() {
    this.sock.destroy();
  }
}

function connect(ip: string, port: number, timeoutMs: number, signal: AbortSignal): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: ip, port });
    const done = (e?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      sock.removeAllListeners('error');
      sock.removeAllListeners('connect');
      if (e) {
        sock.destroy();
        reject(e);
      } else {
        resolve(sock);
      }
    };
    const onAbort = () => done(signal.reason instanceof Error ? signal.reason : new Error('отменено'));
    const timer = setTimeout(() => done(new ConnectFailed('нет соединения за отведённое время')), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    sock.once('error', (e) => done(new ConnectFailed(e.message)));
    sock.once('connect', () => done());
  });
}

/** Отказ по правилам защиты, а не «нет такого ящика»: репутация, чёрные списки, SPF, обратная DNS-запись. */
const POLICY_RE = /spam|block|blacklist|black list|denied|policy|reputation|rbl|dnsbl|spf|ptr|reverse dns|rdns|relay|authenticat|banned|abus|not allowed|not permitted|refused|5\.7\.\d/i;
/**
 * Расширенные коды «получателя нет» (RFC 3463): 5.1.1 — нет ящика, 5.1.10 — нет адреса, 5.2.1 — ящик отключён,
 * 5.4.1 — так Exchange Online отвечает на несуществующий адрес («Recipient address rejected: Access denied»).
 */
const NO_USER_RE = /\b5\.1\.(1|10)\b|\b5\.2\.1\b|\b5\.4\.1\b|user unknown|unknown user|no such (user|recipient|mailbox|address)|does(n't| not) exist|mailbox (not found|unavailable)|recipient (not found|rejected: user)|invalid (recipient|mailbox)|нет такого/i;

const shorten = (s: string) => (s.length > 300 ? `${s.slice(0, 300)}…` : s).replace(/\s+/g, ' ').trim();

/** Отказ до RCPT TO (приветствие, EHLO, MAIL FROM): сервер не захотел с нами говорить. */
function refusal(r: Reply): MailboxReason {
  if (r.code >= 400 && r.code < 500) return 'greylist';
  if (r.code === 530 || /starttls|tls/i.test(r.text)) return 'tls';
  return 'blocked';
}

type Outcome = Pick<EmailMailbox, 'verdict' | 'reason' | 'code' | 'reply' | 'tls' | 'catchAll'>;

async function talk(s: Session, host: string, email: string, domain: string, opts: SmtpOptions): Promise<Outcome> {
  let secure = false;
  const out = (verdict: MailboxVerdict, reason: MailboxReason, r: Reply | null, catchAll: boolean | null = null): Outcome =>
    ({ verdict, reason, code: r?.code ?? null, reply: r ? shorten(r.text) : null, tls: secure, catchAll });

  const greet = await s.read();
  if (greet.code !== 220) return out('unknown', refusal(greet), greet);

  const hello = async () => {
    let r = await s.cmd(`EHLO ${opts.helo}`);
    // Старый сервер без ESMTP.
    if (r.code >= 500) r = await s.cmd(`HELO ${opts.helo}`);
    return r;
  };
  let ehlo = await hello();
  if (ehlo.code !== 250) return out('unknown', refusal(ehlo), ehlo);

  if (/^STARTTLS\b/im.test(ehlo.text)) {
    const r = await s.cmd('STARTTLS');
    if (r.code === 220) {
      await s.startTls(host);
      secure = true;
      ehlo = await hello();
      if (ehlo.code !== 250) return out('unknown', refusal(ehlo), ehlo);
    }
  }

  const mail = await s.cmd(`MAIL FROM:<${opts.from}>`);
  if (mail.code !== 250) return out('unknown', refusal(mail), mail);

  const rcpt = await s.cmd(`RCPT TO:<${email}>`);
  if (rcpt.code === 250 || rcpt.code === 251) {
    // Сервер принял адрес. Принимает ли он вообще всё? Случайное имя, которого быть не может.
    const probe = await s.cmd(`RCPT TO:<zq${randomBytes(9).toString('hex')}@${domain}>`).catch(() => null);
    if (probe && (probe.code === 250 || probe.code === 251)) return out('catchall', 'catchall', rcpt, true);
    // Случайный отвергнут — значит, сервер различает адреса. Не ответил на пробу — различает ли, неизвестно.
    return out('exists', 'accepted', rcpt, probe && probe.code >= 500 ? false : null);
  }
  if (rcpt.code >= 500) {
    // 552 / 5.2.2 — ящик переполнен: он есть.
    if (rcpt.code === 552 || /\b5\.2\.2\b|over quota|quota exceeded|mailbox full/i.test(rcpt.text)) return out('exists', 'full', rcpt);
    if (NO_USER_RE.test(rcpt.text)) return out('missing', 'rejected', rcpt);
    if (POLICY_RE.test(rcpt.text)) return out('unknown', 'blocked', rcpt);
    // 550/551/553 без пояснений — по смыслу кода это «получатель не принят».
    if ([550, 551, 553].includes(rcpt.code)) return out('missing', 'rejected', rcpt);
    return out('unknown', 'blocked', rcpt);
  }
  return out('unknown', 'greylist', rcpt);
}

const fixed = (verdict: MailboxVerdict, reason: MailboxReason): EmailMailbox =>
  ({ verdict, reason, mx: null, code: null, reply: null, tls: false, catchAll: null });

/**
 * Спрашивает почтовые серверы домена (два первых по приоритету), принимают ли они письма на адрес.
 * Сбой связи — не ошибка, а вердикт «неизвестно» с причиной: так отчёт объясняет, почему проверить не удалось.
 */
export async function checkMailbox(email: string, domain: string, dns: EmailDns, opts: SmtpOptions): Promise<EmailMailbox> {
  if (!dns.exists) return fixed('missing', 'no-domain');
  if (dns.nullMx) return fixed('missing', 'null-mx');
  // Без MX почта идёт на адрес самого домена (RFC 5321 §5.1).
  const hosts = dns.mx.length ? [...dns.mx].sort((a, b) => a.priority - b.priority).slice(0, 2).map((m) => m.host) : dns.a.length ? [domain] : [];
  if (!hosts.length) return fixed('missing', 'no-mx');
  // Имя и адрес — из разобранного parseEmail; на всякий случай не пускаем в команду ничего, что её разорвёт.
  if (/[\s<>]/.test(email) || /[\s<>]/.test(opts.helo) || /[\s<>]/.test(opts.from)) throw new Error('недопустимые символы в адресе или настройках SMTP');

  const resolver = new Resolver({ timeout: Math.min(opts.timeoutMs, 5000), tries: 2 });
  const resolve = opts.resolve ?? ((h: string) => resolver.resolve4(h).catch(() => [] as string[]));
  let last: EmailMailbox = { ...fixed('unknown', 'no-connect'), mx: hosts[0]! };

  for (const host of hosts) {
    if (opts.signal.aborted) throw opts.signal.reason as Error;
    const ips = (await resolve(host)).filter((ip) => opts.resolve || isPublicIp(ip));
    if (!ips.length) {
      opts.log(`email: mailbox — ${host}: нет публичного адреса`);
      continue;
    }
    let sock: net.Socket;
    try {
      sock = await connect(ips[0]!, opts.port ?? 25, Math.min(opts.timeoutMs, 10_000), opts.signal);
    } catch (e) {
      if (!(e instanceof ConnectFailed)) throw e;
      opts.log(`email: mailbox — ${host} (${ips[0]}): ${e.message}`);
      continue;
    }
    const s = new Session(sock, Math.min(opts.timeoutMs, 20_000));
    const onAbort = () => s.close();
    opts.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await talk(s, host, email, domain, opts);
      await s.cmd('QUIT').catch(() => null);
      opts.log(`email: mailbox — ${host}: ${r.verdict}/${r.reason} ${r.code ?? ''} ${r.reply ?? ''}`);
      return { ...r, mx: host };
    } catch (e) {
      if (opts.signal.aborted) throw opts.signal.reason as Error;
      const reason: MailboxReason = e instanceof SmtpTimeout ? 'timeout' : 'protocol';
      opts.log(`email: mailbox — ${host}: ${(e as Error).message}`);
      last = { ...fixed('unknown', reason), mx: host };
    } finally {
      opts.signal.removeEventListener('abort', onAbort);
      s.close();
    }
  }
  return last;
}
