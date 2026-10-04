import { nanoid } from 'nanoid';
import type { LoginRequestStatus } from '../ports.ts';
import { config } from '../config.ts';

// Одноразовые запросы входа (nonce → подтверждение). Пока бот не умеет подтверждать вход
// (/start login_<nonce> и таблица site_login_requests в его БД), запросы живут в памяти сервера,
// а подтверждает их dev-вход. После доработки бота это хранилище заменит таблица в БД бота.

interface Confirmed {
  tgId: string;
  displayName: string;
  username: string | null;
}

type Req = { status: 'pending' | 'confirmed' | 'consumed'; expiresAt: number; user?: Confirmed };

export class LoginRequestStore {
  private requests = new Map<string, Req>();

  create() {
    this.sweep();
    const nonce = nanoid(24);
    const expiresAt = Date.now() + config.loginTtlMs;
    this.requests.set(nonce, { status: 'pending', expiresAt });
    return {
      nonce,
      deepLink: `https://t.me/${config.botUsername}?start=login_${nonce}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  get(nonce: string): LoginRequestStatus {
    const r = this.requests.get(nonce);
    if (!r || r.status === 'consumed' || r.expiresAt < Date.now()) return { status: 'expired' };
    if (r.status === 'pending' || !r.user) return { status: 'pending' };
    return { status: 'confirmed', ...r.user };
  }

  consume(nonce: string) {
    const r = this.requests.get(nonce);
    if (r) r.status = 'consumed';
  }

  confirm(nonce: string, user: Confirmed): boolean {
    const r = this.requests.get(nonce);
    if (!r || r.status !== 'pending' || r.expiresAt < Date.now()) return false;
    r.status = 'confirmed';
    r.user = user;
    return true;
  }

  private sweep() {
    const now = Date.now();
    for (const [k, r] of this.requests) if (r.expiresAt < now) this.requests.delete(k);
  }
}
