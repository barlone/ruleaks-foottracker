import { createHash } from 'node:crypto';
import type { GoogleEmailReport, GoogleEmailStep } from '@ft/shared';
import type { GoogleHunter } from './email.ts';
import type { Ctx } from './net.ts';

// Имитация поиска по Google — когда раздел включён, а мастер-токена в конфиге нет (как имитация шлюза при
// [api] enabled = false). Данные вымышленные и зависят только от адреса: один и тот же запрос даёт один ответ.
// Адрес с «nobody» / «none» в имени не находится; каждый третий — с закрытым профилем Play Игр и без календаря.

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

export class DemoHunter implements GoogleHunter {
  readonly demo = true;

  async email(email: string, ctx: Ctx, onStep: (step: GoogleEmailStep) => void): Promise<GoogleEmailReport> {
    const h = createHash('sha256').update(email.toLowerCase()).digest();
    const local = email.split('@')[0] ?? 'user';
    const skipped = { status: 'skipped' } as const;
    const report: GoogleEmailReport = { email, found: false, containers: [], profile: null, playGames: skipped, maps: skipped, calendar: skipped, demo: true };

    onStep('auth');
    await sleep(400, ctx.signal);
    onStep('people');
    await sleep(600, ctx.signal);
    if (/nobody|none/i.test(local)) return report;

    const gaiaId = `1${BigInt(`0x${h.subarray(0, 8).toString('hex')}`).toString().padStart(20, '0').slice(0, 20)}`;
    const variant = h[8]! % 3;
    const day = 86400_000;
    const at = (daysAgo: number) => new Date(Date.UTC(2026, 9, 1) - daysAgo * day).toISOString();
    report.found = true;
    report.containers = ['PROFILE'];
    report.profile = {
      gaiaId,
      email,
      name: null,
      photo: variant === 2
        ? { url: avatar('?', '#5f6368'), isDefault: true, flathash: '000018183c3c0000' }
        : { url: avatar(local[0]!.toUpperCase(), ['#1a73e8', '#188038'][variant]!), isDefault: false, flathash: h.subarray(9, 17).toString('hex') },
      cover: null,
      lastUpdated: at(30 + (h[17]! % 600)),
      userTypes: variant === 1 ? ['GOOGLE_USER', 'GOOGLE_ONE_USER'] : ['GOOGLE_USER'],
      entityType: 'PERSON',
      customerId: null,
      enterprise: false,
      apps: variant === 2 ? ['Youtube'] : ['Youtube', 'Photos', 'Maps', 'Google Chat'],
    };

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
    const profileUrl = `https://www.google.com/maps/contrib/${gaiaId}/reviews`;
    report.maps = {
      status: 'ok',
      data: variant === 2 ? { profileUrl, state: 'empty', stats: {} } : { profileUrl, state: 'ok', stats: { Reviews: 2 + (h[29]! % 40), Ratings: h[30]! % 25, Photos: h[31]! % 90 } },
    };

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
}
