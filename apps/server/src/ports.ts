// Порты (интерфейсы) сервера. Роутеры зависят только от них; реализации
// подставляются в src/app.ts. Сейчас есть только in-memory адаптеры
// (src/adapters/memory) — следующий шаг: postgres/, bot-http/, gateway-http/.

import type {
  Access, Dossier, DossierItem, DossierSummary, Fact, GraphEdge, GraphNode, Hypothesis,
  Investigation, InvestigationSummary, SearchJob, SearchSection, Share, User,
} from '@ft/shared';

// ---------- Бот (владелец пользователей и подписок) ----------

export type LoginRequestStatus =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'confirmed'; tgId: string; displayName: string; username: string | null };

/**
 * Мост к боту pyruleaks-bot. В проде — HTTP к его FastAPI (`/api/site/*`, заголовок X-Site-Key):
 * бот владеет таблицами users/tokens и сам решает, активна ли подписка (access_error).
 */
export interface BotBridge {
  /** Регистрирует одноразовый вход; ссылка ведёт в бота: t.me/<bot>?start=login_<nonce>. */
  createLoginRequest(meta: { userAgent?: string }): Promise<{ nonce: string; deepLink: string; expiresAt: string }>;
  getLoginRequest(nonce: string): Promise<LoginRequestStatus>;
  /** Помечает запрос использованным — повторно по тому же nonce не войти. */
  consumeLoginRequest(nonce: string): Promise<void>;
  getAccess(tgId: string): Promise<Access>;
  /** UUID-токен шлюза пользователя. Никогда не уходит в браузер. */
  getApiToken(tgId: string): Promise<string | null>;
}

// ---------- Поисковый шлюз ----------

export type GatewayAnswer =
  | { state: 'done'; jobId: string; result: unknown }
  | { state: 'running'; jobId: string }
  | { state: 'failed'; jobId: string | null; error: string; code?: number };

/** dsstalker-api-gate: синхронное окно 2 с, дальше опрос job.results. */
export interface SearchGateway {
  start(token: string, path: string, params: Record<string, string>): Promise<GatewayAnswer>;
  poll(token: string, service: 'ruleaks' | 'tgcmnts', jobId: string): Promise<GatewayAnswer>;
  /** search_ids.bynik: Telegram ID по нику (отвечает сразу, без job.results). */
  tgIdsByNik(token: string, nik: string): Promise<string[]>;
}

// ---------- Хранилище сайта ----------

export interface UserRepo {
  upsertByTgId(u: { tgId: string; displayName: string; username: string | null }): Promise<{ id: string }>;
  get(id: string): Promise<Omit<User, 'access'> | null>;
  findByUsername(username: string): Promise<Omit<User, 'access'> | null>;
}

export interface SessionRepo {
  create(userId: string, ttlMs: number): Promise<string>;
  get(sid: string): Promise<{ userId: string } | null>;
  delete(sid: string): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

/** Служебные поля задачи, которые не уходят в браузер. */
export interface SearchJobInternals {
  userId: string;
  gatewayJobId: string | null;
  gatewayService: 'ruleaks' | 'tgcmnts';
}

export interface SearchRepo {
  create(job: Omit<SearchJob, 'id'> & SearchJobInternals): Promise<SearchJob>;
  get(id: string, userId: string): Promise<(SearchJob & SearchJobInternals) | null>;
  update(id: string, patch: Partial<SearchJob> & Partial<SearchJobInternals>): Promise<void>;
  listRecent(userId: string, section: SearchSection, limit: number): Promise<SearchJob[]>;
  /** Очистка истории раздела. Снимки, прикреплённые к досье, в PostgreSQL-адаптере остаются (pinned). */
  clear(userId: string, section: SearchSection): Promise<number>;
}

/** all — всё, что пользователь может открыть: свои, расшаренные ему и (для расследований) публичные. */
export type Scope = 'all' | 'mine' | 'shared' | 'public';

export interface DossierRepo {
  list(userId: string, scope: Exclude<Scope, 'public'>, q?: string): Promise<DossierSummary[]>;
  get(id: string): Promise<Dossier | null>;
  create(d: Pick<Dossier, 'ownerId' | 'kind' | 'title' | 'summaryMd' | 'tags'>): Promise<Dossier>;
  update(id: string, version: number, patch: Partial<Pick<Dossier, 'title' | 'summaryMd' | 'tags' | 'visibility' | 'memberIds' | 'coverMediaUrl'>>): Promise<Dossier>;
  addItem(id: string, item: DossierItem): Promise<Dossier>;
  updateItem(id: string, item: DossierItem): Promise<Dossier>;
  removeItem(id: string, itemId: string): Promise<Dossier>;
  reorderItems(id: string, orderedIds: string[]): Promise<Dossier>;
  setShares(id: string, shares: Share[]): Promise<Dossier>;
  remove(id: string): Promise<void>;
}

export interface InvestigationRepo {
  list(userId: string, scope: Scope, q?: string): Promise<InvestigationSummary[]>;
  get(id: string): Promise<Investigation | null>;
  create(i: Pick<Investigation, 'ownerId' | 'title' | 'descriptionMd' | 'tags'>): Promise<Investigation>;
  update(id: string, version: number, patch: Partial<Pick<Investigation, 'title' | 'descriptionMd' | 'tags' | 'visibility'>>): Promise<Investigation>;
  /** Граф сохраняется целиком (редактор шлёт состояние после серии правок). */
  saveGraph(id: string, version: number, nodes: GraphNode[], edges: GraphEdge[]): Promise<Investigation>;
  upsertFact(id: string, fact: Fact): Promise<Investigation>;
  removeFact(id: string, factId: string): Promise<Investigation>;
  upsertHypothesis(id: string, h: Hypothesis): Promise<Investigation>;
  removeHypothesis(id: string, hId: string): Promise<Investigation>;
  setShares(id: string, shares: Share[]): Promise<Investigation>;
  remove(id: string): Promise<void>;
}

export interface Deps {
  bot: BotBridge;
  gateway: SearchGateway;
  users: UserRepo;
  sessions: SessionRepo;
  searches: SearchRepo;
  dossiers: DossierRepo;
  investigations: InvestigationRepo;
}

/** Конфликт версий (оптимистичная блокировка) — роутер превращает в CONFLICT. */
export class VersionConflict extends Error {
  constructor(public readonly current: number) {
    super('VERSION_CONFLICT');
  }
}
