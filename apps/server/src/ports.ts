// Порты (интерфейсы) сервера. Роутеры зависят только от них; реализации выбирает src/deps.ts
// по флагам enabled в config.ini: adapters/memory (демо), adapters/postgres, adapters/botdb, adapters/http.
// actorId — кто выполняет действие (created_by / granted_by в БД).

import type {
  Access, Dossier, DossierItem, DossierSummary, Fact, GraphEdge, GraphNode, Hypothesis,
  Investigation, InvestigationSummary, DossierRelation, RelationType, SearchJob, SearchSection, Share, Tag, User,
} from '@ft/shared';

// ---------- Бот (владелец пользователей и подписок) ----------

export type LoginRequestStatus =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'confirmed'; tgId: string; displayName: string; username: string | null };

/**
 * Мост к боту pyruleaks-bot. В проде — SQL к его базе ([bot-db]): site_login_requests, site_user_access(), users/tokens;
 * бот владеет таблицами users/tokens и сам решает, активна ли подписка (access_error).
 */
/** Кого подтвердить при dev-входе: демо-учётку (имитация бота) или реального пользователя бота по Telegram ID. */
export type DevLoginTarget = { profile: 'active' | 'expired' | 'colleague' } | { tgId: string };

export interface BotBridge {
  /** Какой dev-вход поддерживает реализация: profiles — демо-учётки, tgid — по Telegram ID, null — только через бота. */
  readonly devLogin: 'profiles' | 'tgid' | null;
  /** dev: подтвердить вход вместо бота. */
  devConfirm(nonce: string, who: DevLoginTarget): Promise<{ ok: true } | { ok: false; error: string }>;
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

/**
 * Фильтр списков: title — подстрока названия без учёта регистра; tagIds — теги словаря пользователя,
 * объект должен иметь все (сравниваются тексты: подходит и такой же тег из словаря соавтора).
 */
export interface ListFilter {
  title?: string;
  tagIds?: string[];
}

/** Словарь тегов пользователя. Тег чужого словаря не виден и не правится (NOT_FOUND). */
export interface TagRepo {
  list(userId: string): Promise<Tag[]>;
  /** Тег с таким текстом уже есть в словаре — TagExists. */
  create(userId: string, text: string, color: string): Promise<Tag>;
  update(userId: string, id: string, patch: { text?: string; color?: string }): Promise<Tag>;
  /** Удаление из словаря снимает тег со всех досье и расследований. */
  remove(userId: string, id: string): Promise<void>;
}

/** Связи между досье персон и словарь их типов. */
export interface RelationRepo {
  /** Предопределённые типы + словарь пользователя. */
  listTypes(userId: string): Promise<RelationType[]>;
  /** Такой тип уже есть (свой или предопределённый) — Conflict RELATION_TYPE_EXISTS. */
  createType(userId: string, text: string): Promise<RelationType>;
  /** Только свой тип; удаление удаляет и связи этого типа. */
  removeType(userId: string, id: string): Promise<void>;
  /** Связи, где досье — любая из сторон. */
  list(dossierId: string): Promise<DossierRelation[]>;
  get(id: string): Promise<DossierRelation | null>;
  /**
   * Связь типа typeId между досье dossierId и otherId. Пояснения — с точки зрения каждой стороны:
   * note — в досье dossierId, otherNote — в досье otherId (undefined — не менять). Если связь того же типа
   * между этими досье уже есть (в любом направлении), обновляются её пояснения, а не заводится вторая.
   */
  add(
    r: { dossierId: string; otherId: string; typeId: string; note?: string | null; otherNote?: string | null },
    actorId: string,
  ): Promise<DossierRelation>;
  remove(id: string): Promise<void>;
}

/** Теги объекта задаются списком id тегов из словарей (порядок — как в списке). */
export type DossierPatch = Partial<Pick<Dossier, 'title' | 'summaryMd' | 'visibility' | 'memberIds' | 'coverMediaUrl'> & { tagIds: string[] }>;
export type InvestigationPatch = Partial<Pick<Investigation, 'title' | 'descriptionMd' | 'visibility'> & { tagIds: string[] }>;

export interface DossierRepo {
  list(userId: string, scope: Exclude<Scope, 'public'>, filter?: ListFilter): Promise<DossierSummary[]>;
  get(id: string): Promise<Dossier | null>;
  create(d: Pick<Dossier, 'ownerId' | 'kind' | 'title' | 'summaryMd'>): Promise<Dossier>;
  update(id: string, version: number, patch: DossierPatch): Promise<Dossier>;
  addItem(id: string, item: DossierItem, actorId: string): Promise<Dossier>;
  updateItem(id: string, item: DossierItem): Promise<Dossier>;
  removeItem(id: string, itemId: string): Promise<Dossier>;
  reorderItems(id: string, orderedIds: string[]): Promise<Dossier>;
  setShares(id: string, shares: Share[], actorId: string): Promise<Dossier>;
  remove(id: string): Promise<void>;
}

export interface InvestigationRepo {
  list(userId: string, scope: Scope, filter?: ListFilter): Promise<InvestigationSummary[]>;
  get(id: string): Promise<Investigation | null>;
  create(i: Pick<Investigation, 'ownerId' | 'title' | 'descriptionMd'>): Promise<Investigation>;
  update(id: string, version: number, patch: InvestigationPatch): Promise<Investigation>;
  /** Граф сохраняется целиком (редактор шлёт состояние после серии правок). */
  saveGraph(id: string, version: number, nodes: GraphNode[], edges: GraphEdge[]): Promise<Investigation>;
  upsertFact(id: string, fact: Fact, actorId: string): Promise<Investigation>;
  removeFact(id: string, factId: string): Promise<Investigation>;
  upsertHypothesis(id: string, h: Hypothesis, actorId: string): Promise<Investigation>;
  removeHypothesis(id: string, hId: string): Promise<Investigation>;
  setShares(id: string, shares: Share[], actorId: string): Promise<Investigation>;
  remove(id: string): Promise<void>;
}

export interface Deps {
  /** При [config] auth = none | password-sha256 — SoloBridge (без бота, подписка не проверяется). */
  bot: BotBridge;
  /** Единственный пользователь соло-режима ([config] user-tg-id); при входе через бота — null. */
  soloUserId: string | null;
  gateway: SearchGateway;
  users: UserRepo;
  sessions: SessionRepo;
  searches: SearchRepo;
  dossiers: DossierRepo;
  investigations: InvestigationRepo;
  tags: TagRepo;
  relations: RelationRepo;
}

/** Конфликт версий (оптимистичная блокировка) — роутер превращает в CONFLICT. */
export class VersionConflict extends Error {
  constructor(public readonly current: number) {
    super('VERSION_CONFLICT');
  }
}

/** Конфликт с машиночитаемым кодом (TAG_EXISTS, RELATION_TYPE_EXISTS…) — роутер превращает в CONFLICT. */
export class Conflict extends Error {}

/** Тег с таким текстом уже есть в словаре пользователя. */
export class TagExists extends Conflict {
  constructor() {
    super('TAG_EXISTS');
  }
}
