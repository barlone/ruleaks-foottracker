import type { Access } from '@ft/shared';
import type { BotBridge } from '../ports.ts';

// Соло-режим ([config] auth = none | password-sha256): бота нет, на сайте один пользователь.
// Подписка не проверяется (доступ всегда безлимитный), токен шлюза — [api] token из конфига.
// Вход через бота в этом режиме выключен: роутер auth не пускает к start/status/devConfirm.

const UNLIMITED: Access = { active: true, unlimited: true, until: null, reason: null };

/** При выключенном [api] имитации шлюза годится любой токен. */
const FAKE_TOKEN = '00000000-0000-4000-8000-000000000000';

export class SoloBridge implements BotBridge {
  readonly devLogin = null;

  constructor(private apiToken: string | null) {}

  async getAccess(): Promise<Access> {
    return UNLIMITED;
  }

  async getApiToken() {
    return this.apiToken;
  }

  async createLoginRequest(): Promise<never> {
    throw new Error('Вход через бота выключен ([config] auth)');
  }

  async getLoginRequest() {
    return { status: 'expired' as const };
  }

  async consumeLoginRequest() {}

  async devConfirm() {
    return { ok: false as const, error: 'Вход через бота выключен ([config] auth)' };
  }
}

export function soloApiToken(api: { enabled: boolean; token: string }): string | null {
  return api.enabled ? api.token || null : FAKE_TOKEN;
}
