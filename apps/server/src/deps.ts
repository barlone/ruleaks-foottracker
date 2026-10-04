import type { AppConfig } from '@ft/config';
import type { Deps } from './ports.ts';
import { MemoryBotBridge } from './adapters/memory/bot.ts';
import { MemoryGateway } from './adapters/memory/gateway.ts';
import {
  MemoryDossiers, MemoryInvestigations, MemorySearches, MemorySessions, MemoryUsers,
} from './adapters/memory/store.ts';

// Сборка зависимостей по [server] mode:
//   demo — всё в памяти (демо-данные, имитация бота и шлюза);
//   live — [project-db] → adapters/postgres, [bot-db] → adapters/bot-db, [api] → adapters/gateway-http.
export function createDeps(cfg: AppConfig): Deps {
  if (cfg.server.mode === 'live') {
    throw new Error(
      'mode = live: адаптеры PostgreSQL, БД бота и API-шлюза ещё не реализованы. ' +
        'Подключения из config.ini прочитаны и проверены; пока используйте mode = demo.',
    );
  }
  return {
    bot: new MemoryBotBridge(),
    gateway: new MemoryGateway(),
    users: new MemoryUsers(),
    sessions: new MemorySessions(),
    searches: new MemorySearches(),
    dossiers: new MemoryDossiers(),
    investigations: new MemoryInvestigations(),
  };
}
