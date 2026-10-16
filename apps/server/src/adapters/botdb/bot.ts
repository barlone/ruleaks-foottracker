import type pg from 'pg';
import type { Access } from '@ft/shared';
import type { BotBridge, DevLoginTarget, LoginRequestStatus } from '../../ports.ts';
import { LoginRequestStore } from '../login-requests.ts';

// Мост к боту через его базу ([bot-db] в config.ini), только чтение: users и tokens.
//
// Подписка считается так же, как access_error() в app/db/tokens_repository.py бота:
//   нет пользователя или токена → «Токен не установлен»; tokens.disabled → «Токен отключен администратором»;
//   tokens.unlimited → доступ есть; users.subscribed_to пусто → «Подписка не оформлена»;
//   subscribed_to в прошлом → «Подписка истекла ДД.ММ.ГГГГ».
// TODO: когда бот добавит функцию site_user_access(chat_id), вызывать её вместо копии правил.
//
// Вход: пока бот не подтверждает /start login_<nonce>, запросы входа живут в памяти сервера,
// а подтверждаются dev-входом по Telegram ID — пользователь должен существовать в БД бота.

const NO_TOKEN = 'Токен не установлен';
const DISABLED = 'Токен отключен администратором';

interface Row {
  subscribed_to: Date | null;
  token: string | null;
  disabled: boolean | null;
  unlimited: boolean | null;
}

const SQL = `
  select u.subscribed_to, t.token, t.disabled, t.unlimited
  from users u
  left join tokens t on t.id = u.tokenid
  where u.provider = 'tg' and u.provider_id = $1
  limit 1`;

export class BotDbBridge implements BotBridge {
  readonly devLogin: 'tgid' | null;
  private logins = new LoginRequestStore();

  constructor(private pool: pg.Pool, opts: { devLogin: boolean }) {
    this.devLogin = opts.devLogin ? 'tgid' : null;
  }

  private async row(tgId: string): Promise<Row | null> {
    if (!/^\d{1,20}$/.test(tgId)) return null;
    const r = await this.pool.query<Row>(SQL, [tgId]);
    return r.rows[0] ?? null;
  }

  async createLoginRequest() {
    return this.logins.create();
  }

  async getLoginRequest(nonce: string): Promise<LoginRequestStatus> {
    return this.logins.get(nonce);
  }

  async consumeLoginRequest(nonce: string) {
    this.logins.consume(nonce);
  }

  async getAccess(tgId: string): Promise<Access> {
    const r = await this.row(tgId);
    const deny = (reason: string, unlimited = false, until: Date | null = null): Access => ({
      active: false, unlimited, until: until?.toISOString() ?? null, reason,
    });
    if (!r || !r.token) return deny(NO_TOKEN);
    if (r.disabled) return deny(DISABLED, !!r.unlimited, r.subscribed_to);
    if (r.unlimited) return { active: true, unlimited: true, until: null, reason: null };
    if (!r.subscribed_to) return deny('Подписка не оформлена');
    if (r.subscribed_to.getTime() < Date.now()) {
      return deny(`Подписка истекла ${r.subscribed_to.toLocaleDateString('ru-RU', { timeZone: 'UTC' })}`, false, r.subscribed_to);
    }
    return { active: true, unlimited: false, until: r.subscribed_to.toISOString(), reason: null };
  }

  /** UUID-токен шлюза. Отключённый токен не отдаём — шлюз всё равно откажет. */
  async getApiToken(tgId: string) {
    const r = await this.row(tgId);
    return r?.token && !r.disabled ? r.token : null;
  }

  async devConfirm(nonce: string, who: DevLoginTarget) {
    if (!this.devLogin) return { ok: false as const, error: 'Вход без бота выключен ([server] dev-login)' };
    if (!('tgId' in who)) return { ok: false as const, error: 'Укажите Telegram ID пользователя бота' };
    const tgId = who.tgId.trim();
    const exists = /^\d{1,20}$/.test(tgId) && (await this.pool.query(`select 1 from users where provider = 'tg' and provider_id = $1`, [tgId])).rowCount;
    if (!exists) return { ok: false as const, error: `Пользователь с Telegram ID ${tgId} не найден в базе бота` };
    // Имени и ника в БД бота нет: null — новому пользователю хранилище даст имя-заглушку, у существующего
    // имя и @username (по нему делятся досье) не затираются; позже бот будет передавать их при подтверждении входа.
    const ok = this.logins.confirm(nonce, { tgId, displayName: null, username: null });
    return ok ? { ok: true as const } : { ok: false as const, error: 'Ссылка входа устарела, обновите страницу' };
  }
}
