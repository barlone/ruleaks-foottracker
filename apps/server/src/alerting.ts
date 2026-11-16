import { hostname } from 'node:os';
import type { AppConfig } from '@ft/config';

// Алертинг: ошибки, на которые сервер натыкается во время работы, уходят тем, кто его обслуживает, через REST API
// бота blind-postman (D:\GoProjs\blind-postman, POST /api/v1/messages) — пользователю и/или группе из [alerting].
// Устроено так же, как в API-шлюзе (D:\GoProjs\dsstalker-api-gate, commons/alerting.go), чтобы оба сервиса вели
// себя в общем чате одинаково.
//
// alert() никогда не ждёт и не бросает: он вызывается из обработчиков запросов ровно тогда, когда бот тоже может
// отвечать медленно или не отвечать вовсе. Сообщения идут через ограниченную очередь с одним обработчиком;
// переполненная очередь сообщение теряет (запись в журнале). Одна авария даёт тысячи одинаковых ошибок, поэтому
// каждый ключ уходит не чаще раза в ALERT_COOLDOWN_MS, а повторы приходят числом.
//
// Текст алерта уходит на серверы Telegram, поэтому в нём не должно быть того, что искал пользователь, и содержимого
// досье: обработчик называется именем процедуры, ошибка — своим текстом, входные данные запроса не прикладываются.

const MESSAGES_PATH = '/api/v1/messages';
/** Один ключ уходит не чаще этого. Ключи — из конечного набора, так что авария любого размера даёт конечное число сообщений. */
const ALERT_COOLDOWN_MS = 5 * 60_000;
/** Как часто отправлять счётчики повторов, придержанных паузой: у ошибки, которая перестала повторяться, следующего случая не будет. */
const FLUSH_INTERVAL_MS = 30_000;
const QUEUE_SIZE = 64;
const SEND_TIMEOUT_MS = 10_000;
/** Бот принимает до 4096; ошибка длиннее — шум в чате, целиком она есть в журнале. */
const MAX_CHARS = 1500;
/** Сколько ждать последней доставки при завершении процесса. */
const STOP_TIMEOUT_MS = 3_000;
/** Паузы перед повтором при сбое, который может пройти: сеть, 5xx, 429. */
const RETRY_DELAYS_MS = [5_000, 30_000];
/** Ключи хранятся в памяти; сверх этого числа новые сводятся в один («other»), чтобы карта не росла без конца. */
const MAX_KEYS = 500;

interface Target { field: 'user_alias' | 'group_alias'; alias: string }
interface Seen { last: number; repeats: number; latest: string }

export interface AlerterOptions {
  apiUrl: string;
  apiToken: string;
  userAlias: string;
  groupAlias: string;
  log: (msg: string) => void;
  /** Для проверок: свои паузы и «сейчас». */
  cooldownMs?: number;
  flushIntervalMs?: number;
  retryDelaysMs?: number[];
}

export class Alerter {
  private readonly endpoint: string;
  private readonly targets: Target[] = [];
  private readonly source = `foottracker@${hostname()}`;
  private readonly seen = new Map<string, Seen>();
  private readonly queue: string[] = [];
  private working: Promise<void> | null = null;
  private stopped = false;
  /** Обрывает ожидание между повторами и запрос в полёте, когда stop() прождал достаточно. */
  private readonly abort = new AbortController();
  private readonly flushTimer: NodeJS.Timeout;
  private readonly cooldownMs: number;
  private readonly retryDelaysMs: number[];

  constructor(private readonly opts: AlerterOptions) {
    this.endpoint = opts.apiUrl + MESSAGES_PATH;
    this.cooldownMs = opts.cooldownMs ?? ALERT_COOLDOWN_MS;
    this.retryDelaysMs = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
    // Каждый заданный получатель получает алерт своим запросом: отказ бота по одному не должен стоить алерта другому.
    if (opts.userAlias) this.targets.push({ field: 'user_alias', alias: opts.userAlias });
    if (opts.groupAlias) this.targets.push({ field: 'group_alias', alias: opts.groupAlias });
    this.flushTimer = setInterval(() => this.flushRepeats(false), opts.flushIntervalMs ?? FLUSH_INTERVAL_MS);
    // Таймер не должен держать процесс, который иначе бы завершился.
    this.flushTimer.unref();
  }

  get recipients(): number {
    return this.targets.length;
  }

  /** key — вид ошибки для паузы: из конечного набора, не из запроса. */
  raise(key: string, text: string): void {
    if (this.stopped) return;
    const now = Date.now();
    if (!this.seen.has(key) && this.seen.size >= MAX_KEYS) key = 'other';
    let seen = this.seen.get(key);
    if (!seen) {
      seen = { last: 0, repeats: 0, latest: '' };
      this.seen.set(key, seen);
    } else if (now - seen.last < this.cooldownMs) {
      seen.repeats++;
      seen.latest = text;
      return;
    }
    const { repeats } = seen;
    seen.last = now;
    seen.repeats = 0;
    seen.latest = '';
    this.enqueue(this.render(text, repeats, now));
  }

  /**
   * Источник и время в начале: devel и prod могут писать в один чат, а алерт, ждавший в очереди или ушедший с повтора,
   * говорит, когда случилось, а не когда дошло.
   */
  private render(text: string, repeats: number, at: number): string {
    const d = new Date(at);
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const full = `${this.source} ${stamp}\n${text}${repeats > 0 ? `\n(повторов с прошлого сообщения: ${repeats})` : ''}`;
    const chars = [...full];
    return chars.length <= MAX_CHARS ? full : `${chars.slice(0, MAX_CHARS - 1).join('')}…`;
  }

  private enqueue(text: string): void {
    if (this.queue.length >= QUEUE_SIZE) {
      this.opts.log('alerting: очередь заполнена, алерт потерян');
      return;
    }
    this.queue.push(text);
    this.working ??= this.work().finally(() => {
      this.working = null;
    });
  }

  /** Счётчики, придержанные паузой: у ключей, чья пауза истекла, или у всех — при завершении. */
  private flushRepeats(all: boolean): void {
    const now = Date.now();
    for (const seen of this.seen.values()) {
      if (seen.repeats > 0 && (all || now - seen.last >= this.cooldownMs)) {
        const text = this.render(seen.latest, seen.repeats, now);
        seen.last = now;
        seen.repeats = 0;
        seen.latest = '';
        this.enqueue(text);
      }
    }
  }

  private async work(): Promise<void> {
    for (let text = this.queue.shift(); text !== undefined; text = this.queue.shift()) {
      for (const target of this.targets) {
        const error = await this.send(target, text);
        // Не alert(): это и есть канал, по которому идут алерты.
        if (error) this.opts.log(`alerting: не доставлено ${target.alias}: ${error}`);
      }
    }
  }

  /** Попытки для одного получателя. Ответ бота 2xx — конец: доставка в Telegram со своими повторами — уже его очередь. */
  private async send(target: Target, text: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      const { retry, error } = await this.post(target, text);
      // При завершении — по одной попытке: ожидание пережило бы stop().
      if (!error || !retry || attempt >= this.retryDelaysMs.length || this.stopped) return error;
      const aborted = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), this.retryDelaysMs[attempt]);
        this.abort.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(true); }, { once: true });
      });
      if (aborted) return error;
    }
  }

  /** Одна попытка. 4xx повторять незачем: неизвестный псевдоним, заблокировавший бота получатель и неверный токен такими и останутся. */
  private async post(target: Target, text: string): Promise<{ retry: boolean; error: string | null }> {
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [target.field]: target.alias, text }),
        signal: AbortSignal.any([AbortSignal.timeout(SEND_TIMEOUT_MS), this.abort.signal]),
      });
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        return { retry: false, error: null };
      }
      // Ответ чужого сервиса: в журнал — только его начало.
      const answer = (await res.text().catch(() => '')).slice(0, 300).trim();
      return { retry: res.status >= 500 || res.status === 429, error: `HTTP ${res.status}: ${answer}` };
    } catch (e) {
      return { retry: true, error: (e as Error).message };
    }
  }

  /** Даёт обработчику отправить то, что в очереди, и ждёт его не дольше timeoutMs. После этого raise() ничего не делает. */
  async stop(timeoutMs = STOP_TIMEOUT_MS): Promise<void> {
    if (this.stopped) return;
    this.flushRepeats(true);
    this.stopped = true;
    clearInterval(this.flushTimer);
    const done = this.working ?? Promise.resolve();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      done.then(() => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), timeoutMs); }),
    ]);
    clearTimeout(timer);
    if (timedOut) this.opts.log(`alerting: при завершении в очереди осталось алертов: ${this.queue.length + 1}, они потеряны`);
    this.abort.abort();
  }
}

/** Работающий отправитель; null — [alerting] не настроен (тогда alert() ничего не делает, в том числе в служебных утилитах). */
let active: Alerter | null = null;

/** Запускает отправку, если [alerting] настроен. Вызывается до подключения к базам: уже первая неудача может быть сообщена. */
export function startAlerter(cfg: AppConfig['alerting'], log: (msg: string) => void): void {
  if (!cfg.enabled || active) return;
  active = new Alerter({ apiUrl: cfg.apiUrl, apiToken: cfg.apiToken, userAlias: cfg.userAlias, groupAlias: cfg.groupAlias, log });
  log(`alerting: через ${cfg.apiUrl}, получателей: ${active.recipients}`);
}

/**
 * Сообщить об ошибке настроенным получателям. key — вид ошибки (для паузы): только из конечного набора, никогда не
 * из запроса. В text не должно быть искомых значений и содержимого досье — он уходит на серверы Telegram.
 */
export function alert(key: string, text: string): void {
  active?.raise(key, text);
}

/**
 * Сообщить, что процесс завершается из-за ошибки, и дождаться отправки всего, что в очереди (не дольше трёх секунд).
 * Это последний вызов перед process.exit: alert() только ставит в очередь, а очередь уходит вместе с процессом.
 */
export async function finalAlert(text: string): Promise<void> {
  const a = active;
  if (!a) return;
  a.raise('exit', text);
  active = null;
  await a.stop();
}

/** Текст ошибки для алерта: сообщение причины (у ошибки tRPC — её cause), без стека. */
export function errorLine(e: unknown): string {
  const err = e as { cause?: unknown; message?: unknown } | null;
  const cause = err && typeof err === 'object' && err.cause instanceof Error ? err.cause : err;
  const msg = cause && typeof cause === 'object' && typeof (cause as { message?: unknown }).message === 'string' ? (cause as Error).message : String(e);
  return msg.replace(/\s+/g, ' ').trim() || 'ошибка без текста';
}
