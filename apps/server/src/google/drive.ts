import type { DriveRef, GoogleDriveApp, GoogleDriveComments, GoogleDriveFile, GoogleDriveUser } from '@ft/shared';
import {
  apiKeyHeaders, DRIVE_APP, DRIVE_DEFAULT_FILE_CAPS, DRIVE_DEFAULT_FOLDER_CAPS, DRIVE_FIELDS, DRIVE_FOLDER_MIME, DRIVE_MIME_LABELS, WEB_HEADERS,
} from './knowledge.ts';
import { apiError, bodyJson, gfetch, GoogleError, query, type Ctx } from './net.ts';
import type { GoogleSession } from './session.ts';

// modules/drive.py, apis/drive.py, helpers/drive.py, apis/clientauthconfig.py: файл или папка Google Drive по ID.
// Запросы — внутренний Drive API v2 (drive/v2internal) с токеном OAuth приложения «Google Диск» служебного аккаунта:
// файл, открытый «всем, у кого есть ссылка», отдаёт метаданные, разрешения (участники с именем, e-mail и Gaia ID),
// автора последней правки и комментарии. Бренд приложения-источника — без входа, по ключу консоли Google Cloud.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const iso = (v: unknown): string | null => {
  const s = text(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const API = 'https://www.googleapis.com/drive/v2internal/files';
/** Страниц комментариев по 100 — не больше (GHunt берёт одну). */
const COMMENT_PAGES = 5;
const AUTHORS_SHOWN = 20;

/** Ошибка доступа к файлу: нет такого или служебному аккаунту не открыт — для поиска это «не найден», не сбой. */
const NO_ACCESS = new Set(['notFound', 'insufficientFilePermissions', 'forbidden', 'cannotAccessFile', 'appNotAuthorizedToFile']);
const RATE_LIMIT = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded']);

/** Запрос к Drive API с токеном приложения; на 401 токен запрашивается заново и запрос повторяется один раз. */
async function driveApi(session: GoogleSession, ref: DriveRef, path: string, params: Record<string, string | number | boolean>, ctx: Ctx): Promise<{ status: number; data: Json }> {
  for (let attempt = 0; ; attempt++) {
    const token = await session.oauth(DRIVE_APP, ctx);
    const headers: Record<string, string> = { ...WEB_HEADERS, Authorization: `OAuth ${token}` };
    // Файлы, расшаренные до обновления безопасности 2021 г., открываются только вместе с resourcekey из ссылки.
    if (ref.resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${ref.id}/${ref.resourceKey}`;
    const res = await gfetch(`${API}/${encodeURIComponent(ref.id)}${path}?${query(params)}`, { headers }, ctx);
    const data = obj(await bodyJson(res, ctx));
    if (res.status === 401 && attempt === 0) {
      session.dropOauth(DRIVE_APP);
      continue;
    }
    return { status: res.status, data };
  }
}

/** Причина ошибки Drive API (error.errors[0].reason). */
const reasonOf = (data: Json): string | null => text(arr(obj(data.error).errors)[0]?.reason);

/** Ответ с ошибкой → null (файл не открыт), исключение (лимит, токен, прочее) или undefined — ошибки нет. */
function driveError(status: number, data: Json, what: string): null | undefined {
  if (!data.error && status < 400) return undefined;
  const reason = reasonOf(data);
  if (reason && RATE_LIMIT.has(reason)) throw new GoogleError('BLOCKED', `${what}: ${reason}`);
  if (status === 404 || (status === 403 && (!reason || NO_ACCESS.has(reason)))) return null;
  throw apiError(data, status, what) ?? new GoogleError('HTTP', `${what}: HTTP ${status}`);
}

/** helpers/drive.py get_users_from_file: участники из разрешений и сводки разрешений + автор последней правки. */
function usersOf(d: Json): { users: GoogleDriveUser[]; lastModifyingUser: GoogleDriveFile['lastModifyingUser'] } {
  const users = new Map<string, GoogleDriveUser>();
  for (const p of [...arr(d.permissions), ...arr(obj(d.permissionsSummary).selectPermissions)]) {
    const email = text(p.emailAddress);
    if (!email) continue;
    const k = email.toLowerCase();
    const prev = users.get(k);
    // Сводка разрешений бывает беднее (без имени и фото): не затираем уже известное.
    users.set(k, {
      name: text(p.name) ?? prev?.name ?? null,
      email,
      gaiaId: text(p.userId) ?? prev?.gaiaId ?? null,
      role: text(p.role) ?? prev?.role ?? 'none',
      photoUrl: text(p.photoLink) ?? prev?.photoUrl ?? null,
      lastModifying: false,
    });
  }
  const lm = obj(d.lastModifyingUser);
  const lmEmail = text(lm.emailAddress) ?? text(lm.emailAddressFromAccount);
  const lastModifyingUser = Object.keys(lm).length
    ? { name: text(lm.displayName), email: lmEmail, photoUrl: text(obj(lm.picture).url) }
    : null;
  if (lmEmail) {
    const u = users.get(lmEmail.toLowerCase());
    if (u) u.lastModifying = true;
  }
  // Порядок ролей — как вывод GHunt: владельцы, редакторы, комментаторы, читатели, без прав.
  const order = ['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader', 'none'];
  const rank = (r: string) => (order.indexOf(r) < 0 ? order.length : order.indexOf(r));
  return { users: [...users.values()].sort((a, b) => rank(a.role) - rank(b.role)), lastModifyingUser };
}

function parseFile(d: Json): GoogleDriveFile {
  const mimeType = text(d.mimeType) ?? '';
  const isFolder = mimeType === DRIVE_FOLDER_MIME;
  const caps = Object.entries(obj(d.capabilities)).filter(([, v]) => v === true).map(([k]) => k).sort();
  const defaults = isFolder ? DRIVE_DEFAULT_FOLDER_CAPS : DRIVE_DEFAULT_FILE_CAPS;
  const link = arr(d.permissions).find((p) => p.id === 'anyoneWithLink');
  const linkRole = text(link?.role);
  const img = obj(d.imageMediaMetadata);
  const vid = obj(d.videoMediaMetadata);
  const { users, lastModifyingUser } = usersOf(d);
  return {
    id: text(d.id) ?? '',
    title: text(d.title) ?? '',
    mimeType,
    typeLabel: DRIVE_MIME_LABELS[mimeType] ?? null,
    isFolder,
    size: num(d.fileSize),
    md5: text(d.md5Checksum),
    createdAt: iso(d.createdDate),
    modifiedAt: iso(d.modifiedDate),
    link: text(d.alternateLink),
    description: text(d.description),
    linkRoles: linkRole ? [linkRole, ...(Array.isArray(link?.additionalRoles) ? link.additionalRoles.filter((r): r is string => typeof r === 'string' && r !== linkRole) : [])] : null,
    sourceAppId: text(d.sourceAppId) ?? (typeof d.sourceAppId === 'number' ? String(d.sourceAppId) : null),
    image: num(img.width) && num(img.height) ? { width: num(img.width)!, height: num(img.height)!, rotation: num(img.rotation) } : null,
    video: num(vid.width) && num(vid.height) ? { width: num(vid.width)!, height: num(vid.height)!, durationMs: num(vid.durationMillis) } : null,
    parents: arr(d.parents).map((p) => ({ id: text(p.id) ?? '', isRoot: p.isRoot === true })).filter((p) => p.id),
    users,
    lastModifyingUser,
    extraCapabilities: caps.filter((c) => !defaults.includes(c)),
  };
}

/** apis/drive.py get_file. null — файла нет или он не открыт по ссылке. */
export async function driveFile(session: GoogleSession, ref: DriveRef, ctx: Ctx): Promise<GoogleDriveFile | null> {
  const { status, data } = await driveApi(session, ref, '', { fields: DRIVE_FIELDS.join(','), supportsAllDrives: true }, ctx);
  if (driveError(status, data, 'Drive') === null) return null;
  return parseFile(data);
}

/** apis/drive.py get_childs: элементов в папке (одна страница до 1000, как у GHunt: «1000 и больше»). */
export async function driveChildCount(session: GoogleSession, ref: DriveRef, ctx: Ctx): Promise<number> {
  const { status, data } = await driveApi(session, ref, '/children', { supportsAllDrives: true, maxResults: 1000 }, ctx);
  if (driveError(status, data, 'Drive: содержимое папки') === null) return 0;
  return arr(data.items).length;
}

/** apis/drive.py get_comments + helpers/drive.py get_comments_from_file: авторы комментариев и ответов по числу сообщений. */
export async function driveComments(session: GoogleSession, ref: DriveRef, ctx: Ctx): Promise<GoogleDriveComments> {
  const authors = new Map<string, { name: string; photoUrl: string | null; count: number }>();
  let total = 0;
  const count = (author: Json) => {
    const name = text(author.displayName) ?? '—';
    const photoUrl = text(obj(author.picture).url);
    // Два человека могут носить одно имя, но не одну картинку — ключ, как у GHunt, «имя + картинка».
    const k = `${name}$${photoUrl ?? ''}`;
    const a = authors.get(k) ?? { name, photoUrl, count: 0 };
    a.count++;
    authors.set(k, a);
    total++;
  };
  let pageToken = '';
  for (let page = 0; page < COMMENT_PAGES; page++) {
    const params: Record<string, string | number | boolean> = { supportsAllDrives: true, maxResults: 100 };
    if (pageToken) params.pageToken = pageToken;
    const { status, data } = await driveApi(session, ref, '/comments', params, ctx);
    // Комментарии закрыты или недоступны — это «комментариев нет», а не сбой.
    if (driveError(status, data, 'Drive: комментарии') === null) break;
    for (const c of arr(data.items)) {
      count(obj(c.author));
      for (const r of arr(c.replies)) count(obj(r.author));
    }
    pageToken = text(data.nextPageToken) ?? '';
    if (!pageToken) break;
  }
  return { total, authors: [...authors.values()].sort((a, b) => b.count - a.count).slice(0, AUTHORS_SHOWN) };
}

/** apis/clientauthconfig.py get_brand: приложение Google Cloud, создавшее файл (по номеру проекта). null — не найдено. */
export async function driveSourceApp(projectNumber: string, ctx: Ctx): Promise<GoogleDriveApp | null> {
  const url = `https://clientauthconfig.googleapis.com/v1/brands/lookupkey/brand/${encodeURIComponent(projectNumber)}?${query({ readMask: '*', $outputDefaults: true })}`;
  const res = await gfetch(url, { headers: apiKeyHeaders('pantheon') }, ctx);
  const data = obj(await bodyJson(res, ctx));
  const err = apiError(data, res.status, 'Бренд приложения');
  if (err) {
    if (err.code === 'NOTFOUND' || res.status === 400) return null;
    throw err;
  }
  return {
    id: projectNumber,
    name: text(data.displayName),
    homePage: text(data.homePageUrl),
    iconUrl: text(data.iconUrl) ?? text(data.storedIconUrl),
    supportEmail: text(data.supportEmail),
  };
}
