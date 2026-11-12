import { createHash } from 'node:crypto';
import {
  parseDriveRef,
  type GoogleDriveReport, type GoogleEmailReport, type GoogleGaiaReport, type GoogleMaps, type GoogleModeId, type GoogleProfile, type GoogleReport,
  type GoogleSection, type GoogleStepId,
} from '@ft/shared';
import type { Ctx } from './net.ts';

// Имитация поиска по Google для видов, которым нужен служебный аккаунт (e-mail, Gaia ID, файл Drive), — когда раздел
// включён, а мастер-токена в конфиге нет (как имитация шлюза при [api] enabled = false). Wi-Fi BSSID и Digital Asset
// Links аккаунт не используют и всегда настоящие. Данные вымышленные и зависят только от запроса: один запрос —
// один ответ. Не находятся: адрес с «nobody» / «none», Gaia ID не с единицы, файл с «none» в ID.
// Каждый третий найденный — с закрытым профилем Play Игр и без календаря.

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason as Error);
    }, { once: true });
  });

/** Картинка-заглушка без обращения к внешним сайтам. */
const avatar = (letter: string, color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${color}"/><text x="48" y="62" font-family="sans-serif" font-size="44" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`;

const hash = (s: string) => createHash('sha256').update(s.toLowerCase()).digest();
const DAY = 86400_000;
const at = (daysAgo: number) => new Date(Date.UTC(2026, 9, 1) - daysAgo * DAY).toISOString();
const skipped = { status: 'skipped' } as const;

/** Вымышленный Gaia ID из хеша запроса. */
const gaiaOf = (h: Buffer) => `1${BigInt(`0x${h.subarray(0, 8).toString('hex')}`).toString().padStart(20, '0').slice(0, 20)}`;

function fakeProfile(h: Buffer, gaiaId: string, email: string | null, letter: string): GoogleProfile {
  const variant = h[8]! % 3;
  return {
    gaiaId,
    email,
    name: null,
    photo: variant === 2
      ? { url: avatar('?', '#5f6368'), isDefault: true, flathash: '000018183c3c0000' }
      : { url: avatar(letter.toUpperCase(), ['#1a73e8', '#188038'][variant]!), isDefault: false, flathash: h.subarray(9, 17).toString('hex') },
    cover: null,
    lastUpdated: at(30 + (h[17]! % 600)),
    userTypes: variant === 1 ? ['GOOGLE_USER', 'GOOGLE_ONE_USER'] : ['GOOGLE_USER'],
    entityType: 'PERSON',
    customerId: null,
    enterprise: false,
    apps: variant === 2 ? ['Youtube'] : ['Youtube', 'Photos', 'Maps', 'Google Chat'],
  };
}

function fakeMaps(h: Buffer, gaiaId: string): GoogleSection<GoogleMaps> {
  const profileUrl = `https://www.google.com/maps/contrib/${gaiaId}/reviews`;
  return {
    status: 'ok',
    data: h[8]! % 3 === 2 ? { profileUrl, state: 'empty', stats: {} } : { profileUrl, state: 'ok', stats: { Reviews: 2 + (h[29]! % 40), Ratings: h[30]! % 25, Photos: h[31]! % 90 } },
  };
}

export class DemoHunter {
  async run(mode: GoogleModeId, query: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleReport> {
    if (mode === 'email') return this.email(query, ctx, onStep);
    if (mode === 'gaia') return this.gaia(query, ctx, onStep);
    if (mode === 'drive') return this.drive(query, ctx, onStep);
    throw new Error(`имитации для «${mode}» нет — этот вид работает без аккаунта`);
  }

  private async email(email: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleEmailReport> {
    const h = hash(email);
    const local = email.split('@')[0] ?? 'user';
    const report: GoogleEmailReport = { mode: 'email', email, found: false, containers: [], profile: null, playGames: skipped, maps: skipped, calendar: skipped, demo: true };

    onStep('auth');
    await sleep(400, ctx.signal);
    onStep('people');
    await sleep(600, ctx.signal);
    if (/nobody|none/i.test(local)) return report;

    const gaiaId = gaiaOf(h);
    const variant = h[8]! % 3;
    report.found = true;
    report.containers = ['PROFILE'];
    report.profile = fakeProfile(h, gaiaId, email, local[0] ?? 'u');

    onStep('playgames');
    await sleep(500, ctx.signal);
    report.playGames = {
      status: 'ok',
      data: variant === 2 ? null : {
        id: `g${h.subarray(18, 26).toString('hex')}`,
        name: `${local}_gg`,
        avatarUrl: avatar('G', '#d93025'),
        visible: variant === 0,
        gamerTag: variant === 0 ? `${local}#${h[26]! * 17}` : null,
        title: variant === 0 ? 'Знаток' : null,
        level: variant === 0 ? 3 + (h[27]! % 20) : null,
        xp: variant === 0 ? String(15_000 + h[28]! * 911) : null,
        playedGames: variant === 0 ? 3 : 0,
        achievements: variant === 0 ? 41 : 0,
        lastPlayed: variant === 0 ? { name: 'Шахматы онлайн', at: at(4) } : null,
        topGame: variant === 0 ? { name: 'Судоку', achievements: 27 } : null,
        games: variant === 0 ? [
          { name: 'Шахматы онлайн', lastPlayed: at(4), achievements: 9 },
          { name: 'Судоку', lastPlayed: at(40), achievements: 27 },
          { name: 'Нарды', lastPlayed: at(310), achievements: 5 },
        ] : [],
      },
    };

    onStep('maps');
    await sleep(400, ctx.signal);
    report.maps = fakeMaps(h, gaiaId);

    onStep('calendar');
    await sleep(400, ctx.signal);
    report.calendar = {
      status: 'ok',
      data: variant !== 0
        ? { found: false, id: null, summary: null, timeZone: null, total: 0, events: [], icsUrl: null, otherNames: [] }
        : {
            found: true, id: email, summary: null, timeZone: 'Europe/Moscow', total: 3,
            events: [
              { title: 'Стоматолог', start: at(2), end: new Date(Date.parse(at(2)) + 3600_000).toISOString(), location: 'ул. Вымышленная, 1', link: null },
              { title: 'Планёрка', start: at(9), end: new Date(Date.parse(at(9)) + 1800_000).toISOString(), location: null, link: null },
              { title: 'Отпуск', start: null, end: null, location: null, link: null },
            ],
            icsUrl: `https://calendar.google.com/calendar/ical/${encodeURIComponent(email)}/public/basic.ics`,
            otherNames: ['Иван П.'],
          },
    };
    return report;
  }

  private async gaia(gaiaId: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleGaiaReport> {
    const h = hash(gaiaId);
    const report: GoogleGaiaReport = { mode: 'gaia', gaiaId, found: false, containers: [], profile: null, maps: skipped, demo: true };
    onStep('auth');
    await sleep(400, ctx.signal);
    onStep('people');
    await sleep(600, ctx.signal);
    if (!gaiaId.startsWith('1')) return report;
    report.found = true;
    report.containers = ['PROFILE'];
    report.profile = fakeProfile(h, gaiaId, null, 'G');
    onStep('maps');
    await sleep(400, ctx.signal);
    report.maps = fakeMaps(h, gaiaId);
    return report;
  }

  private async drive(query: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleDriveReport> {
    const ref = parseDriveRef(query);
    const fileId = ref?.id ?? query;
    const h = hash(fileId);
    const report: GoogleDriveReport = { mode: 'drive', fileId, found: false, file: null, sourceApp: skipped, children: skipped, comments: skipped, demo: true };
    onStep('auth');
    await sleep(400, ctx.signal);
    onStep('file');
    await sleep(600, ctx.signal);
    if (/none/i.test(fileId)) return report;

    const isFolder = h[0]! % 4 === 0;
    const owner = { name: 'Анна Смирнова', email: 'anna.smirnova@example.com', gaiaId: gaiaOf(hash(`${fileId}:owner`)) };
    report.found = true;
    report.file = {
      id: fileId,
      title: isFolder ? 'Материалы проекта' : 'Отчёт за квартал',
      mimeType: isFolder ? 'application/vnd.google-apps.folder' : 'application/vnd.google-apps.spreadsheet',
      typeLabel: isFolder ? 'Папка Google Диска' : 'Google Таблица',
      isFolder,
      size: null,
      md5: null,
      createdAt: at(400 + (h[1]! % 300)),
      modifiedAt: at(5 + (h[2]! % 60)),
      link: isFolder ? `https://drive.google.com/drive/folders/${fileId}` : `https://docs.google.com/spreadsheets/d/${fileId}/edit`,
      description: null,
      linkRoles: ['reader', ...(h[3]! % 2 ? ['commenter'] : [])],
      sourceAppId: null,
      image: null,
      video: null,
      parents: [{ id: `0A${h.subarray(4, 12).toString('hex')}`, isRoot: true }],
      users: [
        { ...owner, role: 'owner', photoUrl: avatar('А', '#188038'), lastModifying: false },
        { name: 'Павел Кузнецов', email: 'p.kuznetsov@example.com', gaiaId: gaiaOf(hash(`${fileId}:writer`)), role: 'writer', photoUrl: avatar('П', '#1a73e8'), lastModifying: true },
      ],
      lastModifyingUser: { name: 'Павел Кузнецов', email: 'p.kuznetsov@example.com', photoUrl: avatar('П', '#1a73e8') },
      extraCapabilities: [],
    };
    onStep('app');
    await sleep(300, ctx.signal);
    report.sourceApp = { status: 'ok', data: null };
    onStep('children');
    await sleep(300, ctx.signal);
    report.children = isFolder ? { status: 'ok', data: 12 + (h[13]! % 40) } : skipped;
    onStep('comments');
    await sleep(400, ctx.signal);
    report.comments = {
      status: 'ok',
      data: isFolder ? { total: 0, authors: [] } : { total: 7, authors: [{ name: 'Павел Кузнецов', photoUrl: avatar('П', '#1a73e8'), count: 5 }, { name: 'Анна Смирнова', photoUrl: avatar('А', '#188038'), count: 2 }] },
    };
    return report;
  }
}
