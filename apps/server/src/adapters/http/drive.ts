import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadable } from 'node:stream/web';
import type { AppConfig } from '@ft/config';
import { DriveError, type DriveAccountRepo, type DriveFileRef, type DriveStorage, type DriveUpload } from '../../ports.ts';

// Google Диск пользователей для архивов страниц. Каждый пользователь Следопыта подключает свой Диск (OAuth 2.0,
// authorization code + offline): доступ drive.file — приложение видит только созданные им файлы и папки, поэтому
// папку выбирать не нужно — Следопыт сам заводит папку приложения ([google-drive] folder-name), в ней — по папке на
// досье (находится по appProperties.ftDossier). У каждого файла appProperties: ftDossier, ftItem, ftSha256 — по ним
// перед отдачей проверяется, что это файл той ссылки, а не подставленный.
// refresh-токен хранится зашифрованным (AES-256-GCM, ключ — sha256 от token-secret); access-токен — в памяти.
// Ходит только на фиксированные адреса Google.

type Cfg = AppConfig['drive'];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Шифрование refresh-токена: iv(12) | tag(16) | шифртекст, base64url. */
export function sealToken(secret: string, token: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

export function openToken(secret: string, sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const key = createHash('sha256').update(secret).digest();
    const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    // Сменили token-secret — токен не расшифровать, Диск нужно подключить заново.
    return null;
  }
}

/** Запрос к Google; сетевые сбои и таймаут — DriveError. */
async function gfetch(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'manual' });
  } catch (e) {
    const err = e as Error;
    if (signal?.aborted) throw err;
    throw new DriveError(err.name === 'TimeoutError' ? 'TIMEOUT' : 'NET', `${new URL(url).pathname}: ${err.message}`);
  }
}

async function fail(res: Response, what: string): Promise<never> {
  const body = await res.text().then((s) => s.slice(0, 300), () => '');
  if (res.status === 404) throw new DriveError('NOT_FOUND', `${what}: 404`);
  throw new DriveError('HTTP', `${what}: ${res.status} ${body}`);
}

/** Строка для запроса q Drive API ('…' с экранированием). */
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Имя папки досье: название без символов, которые мешают на Диске и в выгрузках. */
const folderTitle = (title: string, dossierId: string) =>
  (title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Досье') + ` · ${dossierId.slice(-6)}`;

export class HttpDriveStorage implements DriveStorage {
  readonly demo = false;
  readonly folderName: string;
  private access = new Map<string, { token: string; until: number }>();

  constructor(private cfg: Cfg, private accounts: DriveAccountRepo) {
    this.folderName = cfg.folderName;
  }

  connectUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUrl,
      response_type: 'code',
      scope: `openid email ${DRIVE_SCOPE}`,
      access_type: 'offline',
      // Без prompt=consent Google не выдаёт refresh-токен повторно подключающемуся.
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
    });
    return `${AUTH_URL}?${p}`;
  }

  async connect(userId: string, code: string): Promise<{ email: string }> {
    const res = await gfetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, redirect_uri: this.cfg.redirectUrl, grant_type: 'authorization_code',
      }),
      timeoutMs: this.cfg.timeoutMs,
    });
    if (!res.ok) return fail(res, 'oauth token');
    const t = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };
    // Google даёт снять галочку «Диск» на экране согласия — тогда сохранять некуда.
    if (!t.scope?.split(' ').includes(DRIVE_SCOPE)) throw new DriveError('SCOPE', 'доступ к Диску не выдан');
    if (!t.refresh_token || !t.access_token) throw new DriveError('HTTP', 'oauth token: нет refresh_token');
    const email = emailOf(t.id_token) ?? 'Google';
    const prev = await this.accounts.get(userId);
    // Другой аккаунт Google — прежняя папка приложения недоступна новому токену.
    const folderId = prev && prev.email === email ? prev.folderId : null;
    await this.accounts.save({ userId, email, refreshToken: sealToken(this.cfg.tokenSecret, t.refresh_token), folderId });
    this.access.set(userId, { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 120) * 1000 });
    return { email };
  }

  async status(userId: string) {
    const a = await this.accounts.get(userId);
    return a ? { email: a.email } : null;
  }

  async disconnect(userId: string): Promise<void> {
    const a = await this.accounts.get(userId);
    this.access.delete(userId);
    if (!a) return;
    const refresh = openToken(this.cfg.tokenSecret, a.refreshToken);
    if (refresh) {
      await gfetch(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: 'POST', timeoutMs: this.cfg.timeoutMs })
        .then((r) => r.body?.cancel())
        .catch((e) => console.warn(`drive: отзыв токена не удался: ${(e as Error).message}`));
    }
    await this.accounts.remove(userId);
  }

  /** Действующий access-токен пользователя (обновляется по refresh-токену). */
  private async token(userId: string): Promise<string> {
    const hit = this.access.get(userId);
    if (hit && hit.until > Date.now()) return hit.token;
    const a = await this.accounts.get(userId);
    if (!a) throw new DriveError('NOT_CONNECTED', 'Диск не подключён');
    const refresh = openToken(this.cfg.tokenSecret, a.refreshToken);
    if (!refresh) throw new DriveError('REVOKED', 'токен не расшифровывается (сменён token-secret)');
    const res = await gfetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
      timeoutMs: this.cfg.timeoutMs,
    });
    if (res.status === 400 || res.status === 401) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (b.error === 'invalid_grant') throw new DriveError('REVOKED', 'доступ к Диску отозван в аккаунте Google');
      throw new DriveError('HTTP', `oauth refresh: ${res.status} ${b.error ?? ''}`);
    }
    if (!res.ok) return fail(res, 'oauth refresh');
    const t = (await res.json()) as { access_token: string; expires_in?: number };
    this.access.set(userId, { token: t.access_token, until: Date.now() + ((t.expires_in ?? 3600) - 120) * 1000 });
    return t.access_token;
  }

  private async api<T>(userId: string, url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token(userId);
    const res = await gfetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, timeoutMs: this.cfg.timeoutMs });
    if (res.status === 401) this.access.delete(userId);
    if (!res.ok) return fail(res, new URL(url).pathname);
    return (await res.json()) as T;
  }

  private async createFolder(userId: string, name: string, parent: string | null, appProperties: Record<string, string>): Promise<string> {
    const f = await this.api<{ id: string }>(userId, `${API}?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}), appProperties }),
    });
    return f.id;
  }

  /** Папка приложения: записанная, если жива, иначе новая. */
  private async rootFolder(userId: string): Promise<string> {
    const a = await this.accounts.get(userId);
    if (!a) throw new DriveError('NOT_CONNECTED', 'Диск не подключён');
    if (a.folderId) {
      const f = await this.api<{ trashed?: boolean }>(userId, `${API}/${encodeURIComponent(a.folderId)}?fields=id,trashed`).catch((e) => {
        if (e instanceof DriveError && e.code === 'NOT_FOUND') return { trashed: true };
        throw e;
      });
      if (!f.trashed) return a.folderId;
    }
    const id = await this.createFolder(userId, this.cfg.folderName, null, { ftRoot: '1' });
    await this.accounts.save({ ...a, folderId: id });
    return id;
  }

  private async dossierFolder(userId: string, root: string, dossierId: string, title: string): Promise<string> {
    const query = `${q(root)} in parents and mimeType = ${q(FOLDER_MIME)} and trashed = false and appProperties has { key='ftDossier' and value=${q(dossierId)} }`;
    const found = await this.api<{ files: Array<{ id: string }> }>(userId, `${API}?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1&spaces=drive`);
    return found.files[0]?.id ?? this.createFolder(userId, folderTitle(title, dossierId), root, { ftDossier: dossierId });
  }

  async upload(userId: string, place: { dossierId: string; dossierTitle: string; itemId: string }, files: DriveUpload[], signal: AbortSignal): Promise<string[]> {
    const root = await this.rootFolder(userId);
    const folder = await this.dossierFolder(userId, root, place.dossierId, place.dossierTitle);
    const ids: string[] = [];
    try {
      for (const f of files) ids.push(await this.uploadOne(userId, folder, place, f, signal));
    } catch (e) {
      // Половина архива на Диске не нужна.
      await this.trash(userId, ids);
      throw e;
    }
    return ids;
  }

  /** Возобновляемая загрузка одним PUT: сначала метаданные (адрес сессии загрузки), потом поток файла. */
  private async uploadOne(userId: string, folder: string, place: { dossierId: string; itemId: string }, f: DriveUpload, signal: AbortSignal): Promise<string> {
    const token = await this.token(userId);
    const init = await gfetch(`${UPLOAD}?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': f.mime, 'X-Upload-Content-Length': String(f.size),
      },
      body: JSON.stringify({ name: f.name, parents: [folder], appProperties: { ftDossier: place.dossierId, ftItem: place.itemId, ftSha256: f.sha256 } }),
      signal,
      timeoutMs: this.cfg.timeoutMs,
    });
    if (!init.ok) return fail(init, 'upload init');
    const session = init.headers.get('location');
    await init.body?.cancel();
    if (!session?.startsWith('https://www.googleapis.com/upload/drive/v3/files')) throw new DriveError('HTTP', 'upload init: нет адреса сессии');
    const put = await gfetch(session, {
      method: 'PUT',
      headers: { 'Content-Type': f.mime, 'Content-Length': String(f.size) },
      body: Readable.toWeb(Readable.from(f.open())) as ReadableStream,
      // @ts-expect-error — undici: тело-поток требует duplex
      duplex: 'half',
      signal,
      timeoutMs: this.cfg.uploadTimeoutMs,
    });
    if (!put.ok) return fail(put, 'upload');
    return ((await put.json()) as { id: string }).id;
  }

  async open(owner: string, ref: DriveFileRef) {
    const meta = await this.api<{ size?: string; trashed?: boolean; appProperties?: Record<string, string> }>(
      owner, `${API}/${encodeURIComponent(ref.fileId)}?fields=size,trashed,appProperties`,
    );
    if (meta.trashed) throw new DriveError('NOT_FOUND', 'файл в корзине Диска');
    if (meta.appProperties?.ftDossier !== ref.dossierId || meta.appProperties?.ftItem !== ref.itemId) throw new DriveError('CHANGED', 'файл другой ссылки');
    const token = await this.token(owner);
    const res = await gfetch(`${API}/${encodeURIComponent(ref.fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: this.cfg.uploadTimeoutMs });
    if (!res.ok || !res.body) return fail(res, 'download');
    return { size: Number(meta.size ?? res.headers.get('content-length') ?? 0), body: Readable.fromWeb(res.body as WebReadable<Uint8Array>) };
  }

  async trash(owner: string, fileIds: string[]): Promise<void> {
    for (const id of fileIds) {
      await this.api(owner, `${API}/${encodeURIComponent(id)}?fields=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
      }).catch((e) => console.warn(`drive: не удалось удалить ${id}: ${(e as Error).message}`));
    }
  }
}

/** Адрес из id_token ответа Google (пришёл напрямую по TLS от oauth2.googleapis.com — подпись не проверяется). */
function emailOf(idToken: string | undefined): string | null {
  const part = idToken?.split('.')[1];
  if (!part) return null;
  try {
    const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { email?: unknown };
    return typeof p.email === 'string' ? p.email.slice(0, 254) : null;
  } catch {
    return null;
  }
}
