import { TG_BYNIK_PATH } from '@ft/shared';
import type { AppConfig } from '@ft/config';
import type { GatewayAnswer, SearchGateway } from '../../ports.ts';

// Клиент dsstalker-api-gate. Повторяет поведение клиента бота (app/api/client.py, overload.py):
//  • Authorization — UUID-токен пользователя как есть, без «Bearer»;
//  • ошибки приходят с HTTP 200 в теле {"error":{"code","text"}}; 401 — токен не принят, 503 — БД токенов недоступна;
//  • код 5 (перегрузка) — повторы до 10 с с паузой 2 с; 6 — обслуживание БД; 8 — результат задачи устарел;
//  • тяжёлый поиск отвечает job.state = "need-db-request" и опрашивается через …/v1/job.results?jobid=N.
// Шлюз пропускает с одного токена не чаще одного запроса за [limits] min-msec-between-reqs (1 с),
// а опрос одной задачи — не чаще min-msec-between-job-results. Клиент сам выдерживает эти интервалы,
// чтобы не получать отказы.

type Api = AppConfig['api'];

interface Body {
  error?: { code?: number | string; text?: string };
  job?: { id?: number | string; state?: string };
  ids?: (number | string)[];
}

const ERRORS: Record<string, string> = {
  '1': 'Нет доступа к этому поиску',
  '2': 'Неверные параметры запроса',
  '3': 'Неизвестная задача',
  '4': 'База данных поиска недоступна, попробуйте позже',
  '5': 'Система перегружена, попробуйте повторить запрос через несколько минут',
  '6': 'База данных временно на обслуживании. Повторите запрос через 20–30 минут',
  '7': 'API-сервер перезапускается, повторите запрос через минуту',
  '8': 'Результат устарел — повторите запрос',
};

const OVERLOAD_RETRY_MS = 10_000;
const OVERLOAD_PAUSE_MS = 2_000;
const SPACING_MARGIN_MS = 50;

export class GatewayError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpGateway implements SearchGateway {
  /** Очередь запросов по токену: следующий уходит не раньше, чем через minIntervalMs после предыдущего. */
  private lanes = new Map<string, { tail: Promise<void>; last: number }>();
  /** Опрос задач: время последнего и запрос в полёте — повторный вызов не дублирует запрос. */
  private polls = new Map<string, { last: number; inflight?: Promise<GatewayAnswer> }>();

  constructor(private api: Api) {}

  private spaced<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lane = this.lanes.get(key) ?? { tail: Promise.resolve(), last: 0 };
    this.lanes.set(key, lane);
    const run = lane.tail.then(async () => {
      const wait = lane.last + this.api.minIntervalMs + SPACING_MARGIN_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        lane.last = Date.now();
      }
    });
    lane.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async fetchJson(token: string, path: string, params: Record<string, string>): Promise<Body> {
    const url = new URL(this.api.baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: token, Accept: 'application/json' }, signal: AbortSignal.timeout(this.api.timeoutMs) });
    } catch (e) {
      const err = e as Error;
      throw new GatewayError(err.name === 'TimeoutError' ? 'API-сервер не ответил вовремя' : `API-сервер недоступен: ${err.message}`);
    }
    if (res.status === 401) throw new GatewayError('API-сервер не принял токен пользователя (401)', '401');
    if (res.status === 503) throw new GatewayError('API-сервер не может проверить токен, повторите позже (503)', '503');
    const text = await res.text();
    try {
      return JSON.parse(text) as Body;
    } catch {
      throw new GatewayError(`API-сервер вернул ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  /** Запрос с интервалом по токену и повторами при перегрузке (код 5), как retry_overload бота. */
  private async call(token: string, path: string, params: Record<string, string>): Promise<Body> {
    const deadline = Date.now() + OVERLOAD_RETRY_MS;
    for (;;) {
      const body = await this.spaced(token, () => this.fetchJson(token, path, params));
      const code = body.error ? String(body.error.code ?? '') : null;
      if (code === '5' && Date.now() + OVERLOAD_PAUSE_MS < deadline) {
        await sleep(OVERLOAD_PAUSE_MS);
        continue;
      }
      if (code) throw new GatewayError(errorText(code, body.error?.text), code);
      return body;
    }
  }

  private answer(body: Body): GatewayAnswer {
    const jobId = body.job?.id != null ? String(body.job.id) : null;
    const state = body.job?.state;
    if (state === 'done') return { state: 'done', jobId: jobId ?? '', result: body };
    if (state === 'need-db-request' && jobId) return { state: 'running', jobId };
    if (state === 'db-not-avail') return { state: 'failed', jobId, error: ERRORS['4']! };
    return { state: 'failed', jobId, error: `Неожиданный ответ API-сервера: ${JSON.stringify(body).slice(0, 200)}` };
  }

  async start(token: string, path: string, params: Record<string, string>): Promise<GatewayAnswer> {
    try {
      return this.answer(await this.call(token, path, params));
    } catch (e) {
      if (e instanceof GatewayError) return { state: 'failed', jobId: null, error: e.message, code: Number(e.code) || undefined };
      throw e;
    }
  }

  async poll(token: string, service: 'ruleaks' | 'tgcmnts', jobId: string): Promise<GatewayAnswer> {
    const key = `${service}:${jobId}`;
    const p = this.polls.get(key) ?? { last: 0 };
    this.polls.set(key, p);
    if (p.inflight) return p.inflight;
    // Слишком рано для шлюза — считаем, что задача ещё выполняется, без запроса.
    if (Date.now() - p.last < this.api.minIntervalMs + SPACING_MARGIN_MS) return { state: 'running', jobId };
    p.inflight = (async () => {
      try {
        const body = await this.fetchJson(token, `/${service}/v1/job.results`, { jobid: jobId });
        const code = body.error ? String(body.error.code ?? '') : null;
        if (code === '5') return { state: 'running' as const, jobId }; // перегрузка — спросим в следующий раз
        if (code) return { state: 'failed' as const, jobId, error: errorText(code, body.error?.text), code: Number(code) || undefined };
        const ans = this.answer(body);
        if (ans.state !== 'running') this.polls.delete(key);
        return ans;
      } catch (e) {
        if (!(e instanceof GatewayError)) throw e;
        // Токен отозван — задача завершается ошибкой (как при старте), иначе клиент опрашивал бы её до таймаута.
        if (e.code === '401') {
          this.polls.delete(key);
          return { state: 'failed' as const, jobId, error: e.message, code: 401 };
        }
        return { state: 'running' as const, jobId }; // сеть мигнула — повторим
      } finally {
        p.last = Date.now();
        p.inflight = undefined;
      }
    })();
    return p.inflight;
  }

  async tgIdsByNik(token: string, nik: string): Promise<string[]> {
    const body = await this.call(token, TG_BYNIK_PATH, { nik });
    return [...new Set((body.ids ?? []).map(String))];
  }
}

function errorText(code: string, text?: string): string {
  const known = ERRORS[code];
  // Для неверных параметров текст шлюза полезнее общего (какой параметр и почему).
  if (code === '2' && text) return `${known}: ${text}`;
  return known ?? `Ошибка API-сервера ${code}${text ? `: ${text}` : ''}`;
}
