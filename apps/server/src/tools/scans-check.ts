import { createHash } from 'node:crypto';
import { loadConfig } from '@ft/config';

// Проверка цепочки сканов без браузера и nginx: npm run scans-check -- <uuid скана>
//   1) хранилище: /health, /scans/<uuid>/meta, /scans/<uuid> (статус, тип, размер, sha256 полученного файла);
//   2) это приложение: /scans/<uuid> без сессии на [server] host:port — маршрут зарегистрирован, если ответ 401.
// uuid скана — из адреса картинки в браузере (DevTools → Network) или из строк «scans <uuid> → …» лога.

const cfg = loadConfig();
const id = (process.argv[2] ?? '').toLowerCase();
const s = cfg.scanstore;

const ms = (t0: number) => `${Date.now() - t0} мс`;
const line = (ok: boolean, text: string) => console.log(`${ok ? 'OK  ' : 'FAIL'} ${text}`);

async function get(url: string, headers: Record<string, string> = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(s.timeoutMs) });
    const body = Buffer.from(await res.arrayBuffer());
    return { res, body, time: ms(t0) };
  } catch (e) {
    return { error: (e as Error).message, time: ms(t0) };
  }
}

const auth = { Authorization: `Bearer ${s.token}` };
console.log(`[scanstore-api] enabled = ${s.enabled}, url = ${s.url || '(пусто)'}, токен ${s.token ? `${s.token.length} симв.` : 'не задан'}`);
if (!/^[0-9a-f-]{36}$/.test(id)) {
  console.log('Укажите uuid скана: npm run scans-check -- 01a13145-5ee0-7747-b66a-689fa8bfd301');
  process.exit(2);
}
if (!s.url) process.exit(2);

const health = await get(`${s.url}/health`);
line('res' in health && health.res!.ok, `хранилище /health: ${'res' in health ? `${health.res!.status} ${health.body!.toString().trim().slice(0, 100)}` : health.error} · ${health.time}`);

let sha: string | null = null;
const meta = await get(`${s.url}/scans/${id}/meta`, { ...auth, Accept: 'application/json' });
if ('res' in meta) {
  const ok = meta.res!.ok;
  let info = meta.body!.toString().slice(0, 200);
  if (ok) {
    const m = JSON.parse(meta.body!.toString()) as Record<string, unknown>;
    sha = String(m.sha256 ?? '');
    info = `doctype ${m.doctype}, ${m.size_bytes} байт, ${m.width}×${m.height}, файл ${m.file}, sha256 ${sha.slice(0, 16)}…`;
  }
  line(ok, `хранилище /scans/${id}/meta: ${meta.res!.status} ${info} · ${meta.time}`);
} else line(false, `хранилище /scans/${id}/meta: ${meta.error} · ${meta.time}`);

const img = await get(`${s.url}/scans/${id}`, { ...auth, Accept: 'image/jpeg' });
if ('res' in img) {
  const r = img.res!;
  const got = createHash('sha256').update(img.body!).digest('hex');
  const type = r.headers.get('content-type');
  const ok = r.ok && type === 'image/jpeg' && (!sha || got === sha);
  const detail = r.ok ? `${type}, Content-Length ${r.headers.get('content-length')}, получено ${img.body!.length} байт, sha256 ${sha ? (got === sha ? 'совпадает с meta' : `НЕ совпадает (${got.slice(0, 16)}…)`) : got.slice(0, 16) + '…'}` : img.body!.toString().slice(0, 200);
  line(ok, `хранилище /scans/${id}: ${r.status} ${detail} · ${img.time}`);
} else line(false, `хранилище /scans/${id}: ${img.error} · ${img.time}`);

const host = ['0.0.0.0', '::'].includes(cfg.server.host) ? '127.0.0.1' : cfg.server.host;
const app = await get(`http://${host.includes(':') ? `[${host}]` : host}:${cfg.server.port}/scans/${id}`);
if ('res' in app) {
  const st = app.res!.status;
  const hint = st === 401 ? 'маршрут есть (без сессии — 401, как и должно быть)' : st === 404 ? 'маршрута нет: [scanstore-api] выключен или сервер старой версии' : `неожиданный ответ ${app.res!.headers.get('content-type') ?? ''}`;
  line(st === 401 || (cfg.auth.mode === 'none' && st === 200), `приложение ${host}:${cfg.server.port}/scans/${id}: ${st} — ${hint} · ${app.time}`);
} else line(false, `приложение ${host}:${cfg.server.port}: ${app.error} (сервер не запущен?)`);
