import type { GoogleEmailReport, GoogleEmailStep, GoogleSection } from '@ft/shared';
import { publicCalendar } from './calendar.ts';
import { mapsStats } from './maps.ts';
import { GoogleError, type Ctx } from './net.ts';
import { lookupByEmail } from './people.ts';
import { playerByEmail } from './playgames.ts';
import type { GoogleSession } from './session.ts';

// modules/email.py hunt: поиск по e-mail. Профиль аккаунта (People API) — основа: без него поиск не состоялся.
// Play Игры, Карты и календарь собираются следом, каждый своим запросом; их сбой — пометка в своей части отчёта.

/** Кто выполняет поиск: настоящий Google (GhuntHunter) или имитация (google/demo.ts). */
export interface GoogleHunter {
  readonly demo: boolean;
  email(email: string, ctx: Ctx, onStep: (step: GoogleEmailStep) => void): Promise<GoogleEmailReport>;
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

export class GhuntHunter implements GoogleHunter {
  readonly demo = false;
  private readonly session: GoogleSession;
  private readonly log: (msg: string) => void;

  constructor(session: GoogleSession, log: (msg: string) => void) {
    this.session = session;
    this.log = log;
  }

  private async section<T>(what: string, ctx: Ctx, run: () => Promise<T>): Promise<GoogleSection<T>> {
    try {
      return { status: 'ok', data: await run() };
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      this.log(`google: ${what} — ${(e as Error)?.message ?? String(e)}`);
      return { status: 'error', error: googleErrorText(e) };
    }
  }

  async email(email: string, ctx: Ctx, onStep: (step: GoogleEmailStep) => void): Promise<GoogleEmailReport> {
    const skipped = { status: 'skipped' } as const;
    const report: GoogleEmailReport = { email, found: false, containers: [], profile: null, playGames: skipped, maps: skipped, calendar: skipped, demo: false };

    onStep('auth');
    await this.session.sessionCookies(ctx);

    onStep('people');
    const person = await lookupByEmail(this.session, email, ctx);
    if (!person) return report;
    report.found = true;
    report.containers = person.containers;
    report.profile = person.profile;
    // Нет контейнера PROFILE — адрес есть только в контактах служебного аккаунта: публичного аккаунта Google нет.
    if (!person.profile) return report;
    const { gaiaId, name } = person.profile;

    onStep('playgames');
    report.playGames = await this.section('Play Игры', ctx, () => playerByEmail(this.session, email, ctx));
    onStep('maps');
    report.maps = await this.section('Карты', ctx, () => mapsStats(gaiaId, ctx));
    onStep('calendar');
    report.calendar = await this.section('Календарь', ctx, () => publicCalendar(this.session, email, name, ctx));
    return report;
  }
}
