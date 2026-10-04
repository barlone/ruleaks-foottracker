import type { AppConfig } from '@ft/config';
import type { Deps } from './ports.ts';
import { MemoryBotBridge } from './adapters/memory/bot.ts';
import { MemoryGateway } from './adapters/memory/gateway.ts';
import {
  MemoryDossiers, MemoryInvestigations, MemorySearches, MemorySessions, MemoryUsers,
} from './adapters/memory/store.ts';
import { BotDbBridge } from './adapters/botdb/bot.ts';
import { HttpGateway } from './adapters/http/gateway.ts';
import { openPool } from './adapters/pg.ts';

// Сборка зависимостей по флагам enabled в config.ini. Каждый источник включается отдельно:
//   [bot-db]     enabled → BotDbBridge (подписка и токен из БД бота), иначе имитация бота с демо-учётками;
//   [api]        enabled → HttpGateway (реальный поиск), иначе имитация шлюза с вымышленными данными;
//   [project-db] enabled → PostgreSQL-хранилище досье и расследований (ещё не реализовано), иначе память.
export async function createDeps(cfg: AppConfig, log: (msg: string) => void): Promise<Deps> {
  if (cfg.projectDb.enabled) {
    throw new Error('[project-db] enabled = true: хранилище досье и расследований в PostgreSQL ещё не реализовано — пока enabled = false.');
  }

  let bot: Deps['bot'] = new MemoryBotBridge();
  if (cfg.botDb.enabled) {
    const d = cfg.botDb;
    const { pool, tls } = await openPool(d, { readOnly: true }).catch((e: Error) => {
      throw new Error(`[bot-db] не удалось подключиться к ${d.user}@${d.host}:${d.port}/${d.database}: ${e.message}`);
    });
    pool.on('error', (e) => log(`[bot-db] ошибка соединения: ${e.message}`));
    log(`[bot-db] подключено${tls ? ' (TLS)' : ' (без TLS)'}, только чтение`);
    bot = new BotDbBridge(pool, { devLogin: cfg.server.devLogin && cfg.server.loopback });
  }

  return {
    bot,
    gateway: cfg.api.enabled ? new HttpGateway(cfg.api) : new MemoryGateway(),
    users: new MemoryUsers(),
    sessions: new MemorySessions(),
    searches: new MemorySearches(),
    dossiers: new MemoryDossiers(),
    investigations: new MemoryInvestigations(),
  };
}
