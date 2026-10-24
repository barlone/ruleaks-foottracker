import type { AppConfig } from '@ft/config';
import type { Deps } from './ports.ts';
import { MemoryBotBridge } from './adapters/memory/bot.ts';
import { MemoryGateway } from './adapters/memory/gateway.ts';
import {
  MemoryDossiers, MemoryInvestigations, MemoryRelations, MemorySearches, MemorySessions, MemoryTags, MemoryUsers,
} from './adapters/memory/store.ts';
import { BotDbBridge } from './adapters/botdb/bot.ts';
import { SoloBridge, soloApiToken } from './adapters/solo.ts';
import { HttpGateway } from './adapters/http/gateway.ts';
import { HttpScanStore } from './adapters/http/scanstore.ts';
import { openPool } from './adapters/pg.ts';
import { migrationStatus } from '@ft/db/status';
import { PgUsers, PgSessions } from './adapters/postgres/users.ts';
import { PgSearches } from './adapters/postgres/searches.ts';
import { PgDossiers } from './adapters/postgres/dossiers.ts';
import { PgInvestigations } from './adapters/postgres/investigations.ts';
import { PgTags } from './adapters/postgres/tags.ts';
import { PgRelations } from './adapters/postgres/relations.ts';

// Сборка зависимостей по флагам enabled в config.ini. Каждый источник включается отдельно:
//   [config]     auth = none | password-sha256 → SoloBridge: один пользователь, без бота и проверки подписки,
//                токен API из [api] token; [bot-db] при этом не подключается;
//   [bot-db]     enabled → BotDbBridge (подписка и токен из БД бота), иначе имитация бота с демо-учётками;
//   [api]        enabled → HttpGateway (реальный поиск), иначе имитация шлюза с вымышленными данными;
//   [scanstore-api] enabled → HttpScanStore (картинки сканов документов из результатов поиска), иначе сканов нет;
//   [project-db] enabled → PostgreSQL: пользователи, сессии, история поиска, досье, расследования;
//                         иначе — память с демо-данными (сбрасывается при перезапуске).
export async function createDeps(cfg: AppConfig, log: (msg: string) => void): Promise<Deps> {
  const store = cfg.projectDb.enabled ? await openProjectStore(cfg, log) : memoryStore();

  if (cfg.auth.mode !== 'bot-db') {
    const { tgId, displayName } = cfg.auth.user;
    const { id } = await store.users.upsertByTgId({ tgId, displayName, username: null });
    return { bot: new SoloBridge(soloApiToken(cfg.api)), soloUserId: id, gateway: gateway(cfg), scans: scans(cfg), ...store };
  }

  const devLogin = cfg.server.devLogin && cfg.server.loopback;
  let bot: Deps['bot'] = new MemoryBotBridge({ devLogin });
  if (cfg.botDb.enabled) {
    const d = cfg.botDb;
    const { pool, tls } = await openPool(d, { readOnly: true }).catch((e: Error) => {
      throw new Error(`[bot-db] не удалось подключиться к ${d.user}@${d.host}:${d.port}/${d.database}: ${e.message}`);
    });
    pool.on('error', (e) => log(`[bot-db] ошибка соединения: ${e.message}`));
    log(`[bot-db] подключено${tls ? ' (TLS)' : ' (без TLS)'}, только чтение`);
    bot = new BotDbBridge(pool, { devLogin, log });
  }

  return { bot, soloUserId: null, gateway: gateway(cfg), scans: scans(cfg), ...store };
}

const gateway = (cfg: AppConfig) => (cfg.api.enabled ? new HttpGateway(cfg.api) : new MemoryGateway());
const scans = (cfg: AppConfig) => (cfg.scanstore.enabled ? new HttpScanStore(cfg.scanstore) : null);

type Store = Pick<Deps, 'users' | 'sessions' | 'searches' | 'dossiers' | 'investigations' | 'tags' | 'relations'>;

function memoryStore(): Store {
  const tags = new MemoryTags();
  return {
    tags,
    relations: new MemoryRelations(),
    users: new MemoryUsers(),
    sessions: new MemorySessions(),
    searches: new MemorySearches(),
    dossiers: new MemoryDossiers(tags),
    investigations: new MemoryInvestigations(tags),
  };
}

async function openProjectStore(cfg: AppConfig, log: (msg: string) => void): Promise<Store> {
  const d = cfg.projectDb;
  const { pool, tls } = await openPool(d, { readOnly: false }).catch((e: Error) => {
    throw new Error(`[project-db] не удалось подключиться к ${d.user}@${d.host}:${d.port}/${d.database}: ${e.message}`);
  });
  pool.on('error', (e) => log(`[project-db] ошибка соединения: ${e.message}`));
  // Схема должна соответствовать коду: все миграции из packages/db/migrations применены.
  const st = await migrationStatus(pool);
  if (st.pending.length) {
    await pool.end();
    throw new Error(`[project-db] не применены миграции: ${st.pending.join(', ')} — npm run db -- up (или вручную, см. packages/db/README.md)`);
  }
  log(`[project-db] подключено${tls ? ' (TLS)' : ' (без TLS)'}, миграций: ${st.applied.size}`);
  return {
    users: new PgUsers(pool),
    sessions: new PgSessions(pool),
    searches: new PgSearches(pool),
    dossiers: new PgDossiers(pool),
    investigations: new PgInvestigations(pool),
    tags: new PgTags(pool),
    relations: new PgRelations(pool),
  };
}
