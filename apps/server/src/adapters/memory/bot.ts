import { nanoid } from 'nanoid';
import type { Access } from '@ft/shared';
import type { BotBridge, LoginRequestStatus } from '../../ports.ts';
import { config } from '../../config.ts';

// Имитация бота. Подтверждение входа делает auth.devConfirm (кнопка на странице входа в dev).

interface FakeTgUser {
  tgId: string;
  displayName: string;
  username: string | null;
  access: Access;
}

const in30days = () => new Date(Date.now() + 30 * 86400_000).toISOString();

export const DEV_PROFILES: Record<'active' | 'expired' | 'colleague', FakeTgUser> = {
  active: {
    tgId: '100000001',
    displayName: 'Следопыт',
    username: 'sledopyt_dev',
    access: { active: true, unlimited: false, until: in30days(), reason: null },
  },
  expired: {
    tgId: '100000002',
    displayName: 'Без подписки',
    username: 'nosub_dev',
    access: { active: false, unlimited: false, until: '2026-09-01T00:00:00Z', reason: 'Подписка истекла 01.09.2026' },
  },
  colleague: {
    tgId: '100000003',
    displayName: 'Коллега',
    username: 'colleague_dev',
    access: { active: true, unlimited: true, until: null, reason: null },
  },
};

type Req = { status: 'pending' | 'confirmed' | 'consumed'; expiresAt: number; user?: FakeTgUser };

export class MemoryBotBridge implements BotBridge {
  private requests = new Map<string, Req>();

  async createLoginRequest() {
    const nonce = nanoid(24);
    const expiresAt = Date.now() + config.loginTtlMs;
    this.requests.set(nonce, { status: 'pending', expiresAt });
    return {
      nonce,
      deepLink: `https://t.me/${config.botUsername}?start=login_${nonce}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async getLoginRequest(nonce: string): Promise<LoginRequestStatus> {
    const r = this.requests.get(nonce);
    if (!r || r.status === 'consumed' || r.expiresAt < Date.now()) return { status: 'expired' };
    if (r.status === 'pending' || !r.user) return { status: 'pending' };
    return { status: 'confirmed', tgId: r.user.tgId, displayName: r.user.displayName, username: r.user.username };
  }

  async consumeLoginRequest(nonce: string) {
    const r = this.requests.get(nonce);
    if (r) r.status = 'consumed';
  }

  async getAccess(tgId: string): Promise<Access> {
    const p = Object.values(DEV_PROFILES).find((u) => u.tgId === tgId);
    return p?.access ?? { active: false, unlimited: false, until: null, reason: 'Подписка не оформлена' };
  }

  async getApiToken(tgId: string) {
    return `00000000-0000-4000-8000-${tgId.padStart(12, '0')}`;
  }

  /** dev: то, что в проде сделает бот по /start login_<nonce>. */
  devConfirm(nonce: string, profile: keyof typeof DEV_PROFILES): boolean {
    const r = this.requests.get(nonce);
    if (!r || r.status !== 'pending') return false;
    r.status = 'confirmed';
    r.user = DEV_PROFILES[profile];
    return true;
  }
}
