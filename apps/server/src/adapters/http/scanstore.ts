import type { AppConfig } from '@ft/config';
import type { ScanImage, ScanMeta, ScanStore } from '../../ports.ts';

// Клиент scanstore-api-gate (D:\GoProjs\scanstore-api-gate, описание API — его README.md):
//  • Authorization: Bearer <api_token> — один токен сайта, в браузер не уходит;
//  • GET /scans/{id} — JPEG (ETag = sha256, If-None-Match / If-Modified-Since), GET /scans/{id}/meta — колонки скана
//    и metainfo (OCR-текст), ошибки — {"detail": "..."}: 404 — нет скана, 422 — id не uuid, 401 — токен не принят.
// Сканы неизменяемы (перезаписи и удаления нет), поэтому метаданные кэшируются без срока.

type Cfg = AppConfig['scanstore'];

const META_CACHE_MAX = 5000;

export class ScanStoreError extends Error {}

export class HttpScanStore implements ScanStore {
  private metaCache = new Map<string, ScanMeta | null>();
  /** Запрос метаданных в полёте — одинаковые id из параллельных запросов не дублируются. */
  private inflight = new Map<string, Promise<ScanMeta | null>>();

  constructor(private cfg: Cfg) {}

  private async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    try {
      return await fetch(this.cfg.url + path, {
        headers: { Authorization: `Bearer ${this.cfg.token}`, ...headers },
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
        // Go ServeMux отвечает редиректом на «неправильный» путь — это ошибка, а не другой ресурс.
        redirect: 'manual',
      });
    } catch (e) {
      const err = e as Error;
      throw new ScanStoreError(err.name === 'TimeoutError' ? 'хранилище сканов не ответило вовремя' : `хранилище сканов недоступно: ${err.message}`);
    }
  }

  private async fail(res: Response): Promise<never> {
    const detail = await res.json().then((b: { detail?: unknown }) => b?.detail, () => null);
    if (res.status === 401) throw new ScanStoreError('хранилище сканов не приняло токен ([scanstore-api] token)');
    throw new ScanStoreError(`хранилище сканов ответило ${res.status}${detail ? `: ${String(detail)}` : ''}`);
  }

  async meta(id: string): Promise<ScanMeta | null> {
    if (this.metaCache.has(id)) return this.metaCache.get(id)!;
    let p = this.inflight.get(id);
    if (!p) {
      p = this.loadMeta(id).finally(() => this.inflight.delete(id));
      this.inflight.set(id, p);
    }
    return p;
  }

  private async loadMeta(id: string): Promise<ScanMeta | null> {
    const res = await this.get(`/scans/${id}/meta`, { Accept: 'application/json' });
    if (res.status === 404 || res.status === 422) {
      await res.body?.cancel();
      // «Нет скана» не кэшируется: его могли ещё не догрузить в хранилище.
      return null;
    }
    if (!res.ok) return this.fail(res);
    const b = (await res.json()) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const meta: ScanMeta = {
      id,
      doctype: s(b.doctype) ?? 'unknown',
      docnum: s(b.docnum),
      personName: s(b.person_name),
      personBday: s(b.person_bday),
      sha256: s(b.sha256),
      width: Number(b.width) || 0,
      height: Number(b.height) || 0,
    };
    if (this.metaCache.size >= META_CACHE_MAX) this.metaCache.delete(this.metaCache.keys().next().value!);
    this.metaCache.set(id, meta);
    return meta;
  }

  async image(id: string, cond: { ifNoneMatch?: string }): Promise<ScanImage> {
    const headers: Record<string, string> = { Accept: 'image/jpeg' };
    if (cond.ifNoneMatch) headers['If-None-Match'] = cond.ifNoneMatch;
    const res = await this.get(`/scans/${id}`, headers);
    if (res.status === 304) return { status: 'not-modified', etag: res.headers.get('etag') };
    if (res.status === 404 || res.status === 422) {
      await res.body?.cancel();
      return { status: 'not-found' };
    }
    if (!res.ok || !res.body) return this.fail(res);
    return {
      status: 'ok',
      body: res.body,
      contentType: res.headers.get('content-type') ?? 'image/jpeg',
      length: res.headers.get('content-length'),
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  }
}
