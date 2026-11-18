import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AppConfig } from '@ft/config';
import type { ArchiveFormat, ArchivePartStatus } from '@ft/shared';
import { SiteArchiveError, type ArchiveFile, type ArchivePoll, type SiteArchiver } from '../../ports.ts';

// Клиент службы RuLeaks.ArchiveBox (форк ArchiveBox, D:\PyProjs\RuLeaksArchiveBox; контракт — его
// docs/ARCHITECTURE.md §4.1). Служба в том же LXC и слушает только 127.0.0.1:
//  • POST cli/add — поставить захват, ответ result.crawl_id (по нему всё остальное);
//  • GET core/snapshots?crawl_id=…&with_archiveresults=true — снимок, его status (sealed = готово) и результаты
//    плагинов с output_files; output_dir — абсолютный путь папки снимка на диске;
//  • DELETE crawls/crawl/{crawl_id} — удалить захват целиком (снимок, файлы, логи), 404 — уже удалён.
// Файлы читаются прямо с диска (Следопыт в группе на чтение data/archive службы), не через HTTP.

type Cfg = AppConfig['siteArchive'];

/** Плагин службы, который даёт формат. */
const PLUGIN: Record<ArchiveFormat, string> = { pdf: 'pdf', wacz: 'archivewebpage' };
const EXT: Record<ArchiveFormat, string> = { pdf: '.pdf', wacz: '.wacz' };
/** Браузер и помощники страницы: закрыть баннеры cookie и всплывающие окна, убрать рекламу и трекеры. */
const BASE_PLUGINS = ['chrome', 'modalcloser', 'istilldontcareaboutcookies', 'ublock'];

const FINAL = new Set(['succeeded', 'failed', 'skipped', 'noresults']);

interface AbResult {
  plugin: string;
  status: string;
  output_str?: string;
  output_files?: Record<string, { root_relative?: boolean; size?: number }> | null;
}
interface AbSnapshot {
  status: string;
  output_dir: string;
  archiveresults?: AbResult[];
}

export class HttpSiteArchiver implements SiteArchiver {
  readonly demo = false;

  constructor(private cfg: Cfg) {}

  private async call(method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.cfg.timeoutMs);
    try {
      return await fetch(`${this.cfg.apiUrl}/api/v1/${path}`, {
        method,
        headers: { 'X-ArchiveBox-API-Key': this.cfg.apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        redirect: 'manual',
      });
    } catch (e) {
      const err = e as Error;
      if (signal?.aborted) throw err;
      throw new SiteArchiveError(err.name === 'TimeoutError' ? 'TIMEOUT' : 'NET', `${method} ${path}: ${err.message}`);
    }
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (res.status === 401 || res.status === 403) throw new SiteArchiveError('AUTH', `${what}: ${res.status} — служба не приняла [site-archive] api-key`);
    if (!res.ok) {
      const detail = await res.text().then((s) => s.slice(0, 300), () => '');
      throw new SiteArchiveError('HTTP', `${what}: ${res.status} ${detail}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new SiteArchiveError('PARSE', `${what}: ответ не JSON`);
    }
  }

  async start(url: string, formats: ArchiveFormat[], signal: AbortSignal): Promise<string> {
    const plugins = [...BASE_PLUGINS, ...formats.map((f) => PLUGIN[f])].join(',');
    const res = await this.call('POST', 'cli/add', {
      urls: [url], plugins, depth: 0, parser: 'url_list', only_new: false, persona: 'Default', snapshot_max_size: 0, crawl_timeout: 0,
    }, signal);
    const b = await this.json<{ success?: boolean; errors?: string[]; result?: { crawl_id?: unknown } }>(res, 'cli/add');
    const crawlId = b.result?.crawl_id;
    if (!b.success || typeof crawlId !== 'string' || !crawlId) {
      throw new SiteArchiveError('PARSE', `cli/add: нет crawl_id${b.errors?.length ? ` (${b.errors.join('; ').slice(0, 300)})` : ''}`);
    }
    return crawlId;
  }

  async poll(ref: string, signal: AbortSignal): Promise<ArchivePoll> {
    const res = await this.call('GET', `core/snapshots?crawl_id=${encodeURIComponent(ref)}&with_archiveresults=true`, null, signal);
    const b = await this.json<{ items?: AbSnapshot[] }>(res, 'core/snapshots');
    const snap = b.items?.[0];
    // Снимка ещё нет: служба не взяла crawl в работу.
    if (!snap) return { stage: 'queued', parts: {} };
    if (typeof snap.output_dir !== 'string' || !isAbsolute(snap.output_dir)) throw new SiteArchiveError('PARSE', 'core/snapshots: нет output_dir');
    const sealed = snap.status === 'sealed';
    const parts: ArchivePoll['parts'] = {};
    for (const f of Object.keys(PLUGIN) as ArchiveFormat[]) {
      const results = (snap.archiveresults ?? []).filter((r) => r.plugin === PLUGIN[f]);
      parts[f] = await part(f, results, snap.output_dir, sealed);
    }
    return { stage: sealed ? 'done' : snap.status === 'queued' ? 'queued' : 'capturing', parts };
  }

  async remove(ref: string): Promise<void> {
    const res = await this.call('DELETE', `crawls/crawl/${encodeURIComponent(ref)}`, null);
    if (res.status === 404) {
      await res.body?.cancel();
      return;
    }
    await this.json(res, 'crawls/crawl DELETE');
  }
}

/** Итог формата по результатам его плагина (у archivewebpage их два хука — start и stop). */
async function part(f: ArchiveFormat, results: AbResult[], dir: string, sealed: boolean) {
  const failed = results.find((r) => r.status === 'failed');
  const allFinal = results.length > 0 && results.every((r) => FINAL.has(r.status));
  let file: ArchiveFile | null = null;
  if (allFinal || sealed) file = await findFile(f, results, dir);
  let status: ArchivePartStatus;
  let error: string | null = null;
  if (file) status = 'ok';
  else if (failed) {
    status = 'failed';
    error = failed.output_str?.trim().slice(0, 300) || null;
  } else if (allFinal || sealed) {
    status = results.length && results.every((r) => r.status === 'skipped') ? 'skipped' : 'failed';
    if (status === 'failed') error = results.length ? 'no output file' : 'plugin did not run';
  } else status = results.some((r) => r.status !== 'queued') ? 'running' : 'pending';
  return { status, error, file };
}

/** Путь файла как ArchiveResult._resolve_output_file_path службы; ключи с «..» и абсолютные отбрасываются. */
async function findFile(f: ArchiveFormat, results: AbResult[], dir: string): Promise<ArchiveFile | null> {
  const root = resolve(dir);
  for (const r of results) {
    for (const [key, meta] of Object.entries(r.output_files ?? {})) {
      if (!key.toLowerCase().endsWith(EXT[f]) || isAbsolute(key) || key.split(/[\\/]/).includes('..')) continue;
      const path = resolve(meta?.root_relative || key.startsWith(`${r.plugin}/`) ? join(root, key) : join(root, r.plugin, key));
      const rel = relative(root, path);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      const st = await stat(path).catch(() => null);
      if (!st?.isFile()) continue;
      return { size: st.size, open: () => createReadStream(path) };
    }
  }
  return null;
}
