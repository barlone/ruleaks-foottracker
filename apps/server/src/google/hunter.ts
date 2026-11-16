import {
  GOOGLE_ACCOUNT_MODES, parseBssids, parseDalQuery, parseDriveRef,
  type GoogleDriveReport, type GoogleEmailReport, type GoogleEmailStep, type GoogleGaiaReport, type GoogleGeoReport, type GoogleModeId,
  type GoogleReport, type GoogleSection, type GoogleStepId,
} from '@ft/shared';
import { publicCalendar } from './calendar.ts';
import { spiderDal } from './dal.ts';
import { DemoHunter, demoGoogleEmail } from './demo.ts';
import { driveChildCount, driveComments, driveFile, driveSourceApp } from './drive.ts';
import { geolocate, reverseGeocode } from './geolocate.ts';
import { mapsStats } from './maps.ts';
import { GoogleError, type Ctx } from './net.ts';
import { lookupByEmail, lookupByGaia } from './people.ts';
import { playerByEmail } from './playgames.ts';
import type { GoogleSession } from './session.ts';
import { alert } from '../alerting.ts';

// Исполнитель «Поиска по Google»: виды поиска — модули GHunt (modules/gaia.py, drive.py, geolocate.py, spiderdal.py).
// Основа каждого вида — один запрос (профиль, файл, координаты, обход связей): его ошибка проваливает поиск.
// Остальное собирается следом, каждое своим запросом, как GoogleSection — сбой одной части не трогает другие.
// Видам со служебным аккаунтом (Gaia ID, Drive) без мастер-токена отвечает имитация (demo.ts).
// modules/email.py — huntGoogleEmail: часть отчёта «Поиска по Email» (apps/server/src/email).

export interface GoogleHunter {
  /** Виды, которые сейчас отвечают имитацией (нет мастер-токена). */
  readonly demoModes: readonly GoogleModeId[];
  run(mode: GoogleModeId, query: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleReport>;
}

export interface HunterOptions {
  /** Nominatim для адреса точки Wi-Fi; '' — адрес не определяется. */
  reverseGeocodeUrl: string;
  log: (msg: string) => void;
}

/** Текст ошибки для пользователя; подробности (ответ Google) остаются в журнале сервера. */
export function googleErrorText(e: unknown): string {
  if (!(e instanceof GoogleError)) return 'Внутренняя ошибка поиска по Google';
  switch (e.code) {
    case 'AUTH': return 'Google отклонил служебный аккаунт сайта — поиск недоступен, пока администратор не обновит доступ';
    case 'BLOCKED': return 'Google временно ограничил запросы с этого сервера — повторите позже';
    case 'TIMEOUT': return 'Google не ответил вовремя — повторите поиск';
    default: return 'Google ответил не так, как ожидалось — возможно, сервис изменился';
  }
}

/**
 * Отказ служебного аккаунта — вход не принят (AUTH) или Google отвечает капчей (BLOCKED) — дело тех, кто обслуживает
 * сайт: пользователь тут ничего не исправит. Текст алерта постоянный: ответ Google в него не идёт (в нём бывает адрес,
 * который искали).
 */
export function alertGoogleAccount(e: unknown): void {
  if (!(e instanceof GoogleError)) return;
  if (e.code === 'AUTH') alert('google:auth', 'Служебный аккаунт Google: вход не принят — нужен новый мастер-токен (npm run google-login)');
  if (e.code === 'BLOCKED') alert('google:blocked', 'Служебный аккаунт Google: Google отвечает капчей или блокировкой');
}

/** Часть отчёта своим запросом: сбой — текст ошибки в части (подробности — в журнал), отмена — дальше. */
async function googleSection<T>(what: string, ctx: Ctx, log: (msg: string) => void, run: () => Promise<T>): Promise<GoogleSection<T>> {
  try {
    return { status: 'ok', data: await run() };
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    log(`google: ${what} — ${(e as Error)?.message ?? String(e)}`);
    alertGoogleAccount(e);
    return { status: 'error', error: googleErrorText(e) };
  }
}

/**
 * modules/email.py: профиль по адресу (обязательный запрос — его ошибка бросается), затем Play Игры, Карты и
 * публичный календарь. session = null — мастер-токена нет: отвечает имитация.
 */
export async function huntGoogleEmail(
  session: GoogleSession | null, email: string, ctx: Ctx, onStep: (step: GoogleEmailStep) => void, log: (msg: string) => void,
): Promise<GoogleEmailReport> {
  if (!session) return demoGoogleEmail(email, ctx, onStep);
  const skipped = { status: 'skipped' } as const;
  const report: GoogleEmailReport = { mode: 'email', email, found: false, containers: [], profile: null, playGames: skipped, maps: skipped, calendar: skipped, demo: false };

  onStep('auth');
  await session.sessionCookies(ctx);

  onStep('people');
  const person = await lookupByEmail(session, email, ctx);
  if (!person) return report;
  report.found = true;
  report.containers = person.containers;
  report.profile = person.profile;
  // Нет контейнера PROFILE — адрес есть только в контактах служебного аккаунта: публичного аккаунта Google нет.
  if (!person.profile) return report;
  const { gaiaId, name } = person.profile;

  onStep('playgames');
  report.playGames = await googleSection('Play Игры', ctx, log, () => playerByEmail(session, email, ctx));
  onStep('maps');
  report.maps = await googleSection('Карты', ctx, log, () => mapsStats(gaiaId, ctx));
  onStep('calendar');
  report.calendar = await googleSection('Календарь', ctx, log, () => publicCalendar(session, email, name, ctx));
  return report;
}

export class GhuntHunter implements GoogleHunter {
  readonly demoModes: readonly GoogleModeId[];
  private readonly session: GoogleSession | null;
  private readonly opts: HunterOptions;
  private readonly demo = new DemoHunter();

  /** session = null — мастер-токена нет: виды со служебным аккаунтом отвечают имитацией. */
  constructor(session: GoogleSession | null, opts: HunterOptions) {
    this.session = session;
    this.opts = opts;
    this.demoModes = session ? [] : GOOGLE_ACCOUNT_MODES;
  }

  run(mode: GoogleModeId, query: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleReport> {
    if (!this.session && GOOGLE_ACCOUNT_MODES.includes(mode)) return this.demo.run(mode, query, ctx, onStep);
    switch (mode) {
      case 'gaia': return this.gaia(this.session!, query, ctx, onStep);
      case 'drive': return this.drive(this.session!, query, ctx, onStep);
      case 'geolocate': return this.geolocate(query, ctx, onStep);
      case 'spiderdal': {
        const q = parseDalQuery(query);
        if (!q) throw new GoogleError('PARSE', `Digital Asset Links: не разобран запрос «${query}»`);
        return spiderDal(q, query, ctx, onStep);
      }
    }
  }

  private section<T>(what: string, ctx: Ctx, run: () => Promise<T>): Promise<GoogleSection<T>> {
    return googleSection(what, ctx, this.opts.log, run);
  }

  /** modules/gaia.py: профиль и Карты; Play Игры и календарь ищутся по адресу, его здесь нет. */
  private async gaia(session: GoogleSession, gaiaId: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleGaiaReport> {
    const report: GoogleGaiaReport = { mode: 'gaia', gaiaId, found: false, containers: [], profile: null, maps: { status: 'skipped' }, demo: false };

    onStep('auth');
    await session.sessionCookies(ctx);

    onStep('people');
    const person = await lookupByGaia(session, gaiaId, ctx);
    if (!person) return report;
    report.found = true;
    report.containers = person.containers;
    report.profile = person.profile;
    if (!person.profile) return report;

    onStep('maps');
    report.maps = await this.section('Карты', ctx, () => mapsStats(gaiaId, ctx));
    return report;
  }

  /** modules/drive.py. */
  private async drive(session: GoogleSession, query: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleDriveReport> {
    const ref = parseDriveRef(query);
    if (!ref) throw new GoogleError('PARSE', `Drive: не разобран запрос «${query}»`);
    const skipped = { status: 'skipped' } as const;
    const report: GoogleDriveReport = { mode: 'drive', fileId: ref.id, found: false, file: null, sourceApp: skipped, children: skipped, comments: skipped, demo: false };

    onStep('auth');
    onStep('file');
    const file = await driveFile(session, ref, ctx);
    if (!file) return report;
    report.found = true;
    report.file = file;

    onStep('app');
    if (file.sourceAppId) {
      const id = file.sourceAppId;
      report.sourceApp = await this.section('Drive: приложение-источник', ctx, () => driveSourceApp(id, ctx));
    }
    onStep('children');
    if (file.isFolder) report.children = await this.section('Drive: содержимое папки', ctx, () => driveChildCount(session, ref, ctx));
    onStep('comments');
    report.comments = await this.section('Drive: комментарии', ctx, () => driveComments(session, ref, ctx));
    return report;
  }

  /** modules/geolocate.py. */
  private async geolocate(query: string, ctx: Ctx, onStep: (step: GoogleStepId) => void): Promise<GoogleGeoReport> {
    const bssids = parseBssids(query);
    if (!bssids) throw new GoogleError('PARSE', `Геолокация: не разобран запрос «${query}»`);
    const report: GoogleGeoReport = { mode: 'geolocate', bssids, found: false, lat: null, lon: null, accuracyM: null, address: { status: 'skipped' }, demo: false };

    onStep('locate');
    const fix = await geolocate(bssids, ctx);
    if (!fix) return report;
    report.found = true;
    report.lat = fix.lat;
    report.lon = fix.lon;
    report.accuracyM = fix.accuracyM;

    const base = this.opts.reverseGeocodeUrl;
    if (base) {
      onStep('address');
      report.address = await this.section('Геокодер', ctx, () => reverseGeocode(base, fix.lat, fix.lon, ctx));
    }
    return report;
  }
}
