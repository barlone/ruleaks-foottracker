import type { Access } from '@ft/shared';
import type { BotBridge, DevLoginTarget, LoginRequestStatus } from '../../ports.ts';
import { LoginRequestStore } from '../login-requests.ts';

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

/** Имитация бота: вход по одной из демо-учёток, подписка и токен — вымышленные. */
export class MemoryBotBridge implements BotBridge {
  readonly devLogin = 'profiles' as const;
  private logins = new LoginRequestStore();

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
    const p = Object.values(DEV_PROFILES).find((u) => u.tgId === tgId);
    return p?.access ?? { active: false, unlimited: false, until: null, reason: 'Подписка не оформлена' };
  }

  async getApiToken(tgId: string) {
    return `00000000-0000-4000-8000-${tgId.padStart(12, '0')}`;
  }

  /** dev: то, что в проде сделает бот по /start login_<nonce>. */
  async devConfirm(nonce: string, who: DevLoginTarget) {
    if (!('profile' in who)) return { ok: false as const, error: 'В демо-режиме вход по демо-учётке' };
    const { tgId, displayName, username } = DEV_PROFILES[who.profile];
    return this.logins.confirm(nonce, { tgId, displayName, username }) ? { ok: true as const } : { ok: false as const, error: 'Ссылка входа устарела' };
  }
}
