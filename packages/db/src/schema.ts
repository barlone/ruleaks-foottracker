// Черновик схемы БД сайта (база `foottracker`, отдельно от ruleaks/tgcomments/tokens).
// На текущем шаге НЕ подключена: сервер работает на in-memory адаптерах
// (apps/server/src/adapters/memory). Схема фиксирует решения из ARCHITECTURE.md
// и станет источником миграций drizzle-kit, когда появится адаптер PostgreSQL.

import {
  pgTable, pgEnum, text, uuid, bigint, integer, boolean, jsonb, timestamp, real,
  primaryKey, index, uniqueIndex, customType,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const dossierVisibility = pgEnum('dossier_visibility', ['private', 'shared']);
export const investigationVisibility = pgEnum('investigation_visibility', ['private', 'shared', 'public']);
export const shareRole = pgEnum('share_role', ['viewer', 'editor']);
export const objectType = pgEnum('object_type', ['dossier', 'investigation']);
export const dossierKind = pgEnum('dossier_kind', ['person', 'group']);
export const dossierItemType = pgEnum('dossier_item_type', ['attribute', 'link', 'media', 'note', 'snapshot']);
export const nodeType = pgEnum('node_type', ['person', 'organization', 'event', 'location', 'asset', 'document']);
export const hypothesisStatus = pgEnum('hypothesis_status', ['open', 'supported', 'confirmed', 'refuted']);
export const loginStatus = pgEnum('login_status', ['pending', 'confirmed', 'consumed', 'expired']);

// ---------- Пользователи и сессии ----------

/** Пользователь сайта = пользователь бота. Подписку не дублируем: её владелец — БД бота. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tgId: bigint('tg_id', { mode: 'bigint' }).notNull(),
  displayName: text('display_name').notNull(),
  username: text('username'),
  /** Токен API-шлюза, зашифрованный AES-256-GCM (ключ в env). Обновляется при каждом входе. */
  apiTokenEnc: bytea('api_token_enc'),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => [uniqueIndex('users_tg_id_uq').on(t.tgId)]);

export const sessions = pgTable('sessions', {
  /** sha256 от значения cookie — в БД не лежит само значение. */
  idHash: text('id_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

// ---------- Досье ----------

export const dossiers = pgTable('dossiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  kind: dossierKind('kind').notNull(),
  title: text('title').notNull(),
  summaryMd: text('summary_md').notNull().default(''),
  tags: text('tags').array().notNull().default([]),
  visibility: dossierVisibility('visibility').notNull().default('private'),
  coverMediaId: uuid('cover_media_id'),
  version: integer('version').notNull().default(1),
  searchTsv: tsvector('search_tsv'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('dossiers_owner_idx').on(t.ownerId), index('dossiers_tsv_idx').using('gin', t.searchTsv)]);

/** Участники досье-группы. */
export const dossierMembers = pgTable('dossier_members', {
  groupId: uuid('group_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  role: text('role'),
}, (t) => [primaryKey({ columns: [t.groupId, t.memberId] })]);

export const dossierItems = pgTable('dossier_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  type: dossierItemType('type').notNull(),
  /** Тело элемента по схеме DossierItem из @ft/shared (без общих полей). */
  data: jsonb('data').notNull(),
  source: jsonb('source'),
  position: real('position').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index('dossier_items_dossier_idx').on(t.dossierId, t.position)]);

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  s3Key: text('s3_key').notNull(),
  thumbKey: text('thumb_key'),
  mime: text('mime').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  /** Исходные метаданные (EXIF/GPS) — как улика. Публичная копия отдаётся без них. */
  exif: jsonb('exif'),
  createdAt: createdAt(),
}, (t) => [index('media_sha_idx').on(t.ownerId, t.sha256)]);

/** Снимок результата поиска: шлюз хранит результат минуты, досье — навсегда. */
export const searchSnapshots = pgTable('search_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  kind: text('kind').notNull(),
  query: text('query').notNull(),
  deep: boolean('deep').notNull(),
  gatewayJobId: text('gateway_job_id'),
  state: text('state').notNull(), // running | done | failed
  error: text('error'),
  result: jsonb('result'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /** false — временный результат, удаляется через N дней, если не прикреплён к досье/факту. */
  pinned: boolean('pinned').notNull().default(false),
}, (t) => [index('search_snapshots_user_idx').on(t.userId, t.startedAt)]);

// ---------- Расследования ----------

export const investigations = pgTable('investigations', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  descriptionMd: text('description_md').notNull().default(''),
  tags: text('tags').array().notNull().default([]),
  visibility: investigationVisibility('visibility').notNull().default('private'),
  /** Публичная ссылка: без неё публичное расследование не открывается. */
  publicSlug: text('public_slug'),
  version: integer('version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [index('investigations_owner_idx').on(t.ownerId), uniqueIndex('investigations_slug_uq').on(t.publicSlug)]);

export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  investigationId: uuid('investigation_id').notNull().references(() => investigations.id, { onDelete: 'cascade' }),
  type: nodeType('type').notNull(),
  label: text('label').notNull(),
  dossierId: uuid('dossier_id').references(() => dossiers.id, { onDelete: 'set null' }),
  props: jsonb('props').notNull().default({}),
  x: real('x').notNull(),
  y: real('y').notNull(),
}, (t) => [index('nodes_inv_idx').on(t.investigationId)]);

export const edges = pgTable('edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  investigationId: uuid('investigation_id').notNull().references(() => investigations.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => nodes.id, { onDelete: 'cascade' }),
  relation: text('relation').notNull(),
  label: text('label'),
  credibility: text('credibility').notNull().default('6'),
}, (t) => [index('edges_inv_idx').on(t.investigationId)]);

export const facts = pgTable('facts', {
  id: uuid('id').primaryKey().defaultRandom(),
  investigationId: uuid('investigation_id').notNull().references(() => investigations.id, { onDelete: 'cascade' }),
  textMd: text('text_md').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  sources: jsonb('sources').notNull().default([]),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
});

/** Факт ↔ узел или ребро графа. */
export const factLinks = pgTable('fact_links', {
  factId: uuid('fact_id').notNull().references(() => facts.id, { onDelete: 'cascade' }),
  nodeId: uuid('node_id').references(() => nodes.id, { onDelete: 'cascade' }),
  edgeId: uuid('edge_id').references(() => edges.id, { onDelete: 'cascade' }),
}, (t) => [index('fact_links_fact_idx').on(t.factId)]);

export const hypotheses = pgTable('hypotheses', {
  id: uuid('id').primaryKey().defaultRandom(),
  investigationId: uuid('investigation_id').notNull().references(() => investigations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  textMd: text('text_md').notNull().default(''),
  status: hypothesisStatus('status').notNull().default('open'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const hypothesisEvidence = pgTable('hypothesis_evidence', {
  hypothesisId: uuid('hypothesis_id').notNull().references(() => hypotheses.id, { onDelete: 'cascade' }),
  factId: uuid('fact_id').notNull().references(() => facts.id, { onDelete: 'cascade' }),
  stance: text('stance').notNull(), // supports | contradicts
}, (t) => [primaryKey({ columns: [t.hypothesisId, t.factId] })]);

// ---------- Доступ и аудит ----------

export const shares = pgTable('shares', {
  objectType: objectType('object_type').notNull(),
  objectId: uuid('object_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: shareRole('role').notNull(),
  grantedBy: uuid('granted_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.objectType, t.objectId, t.userId] }), index('shares_user_idx').on(t.userId)]);

/** История правок: кто, что и когда изменил (diff в JSON Patch). */
export const revisions = pgTable('revisions', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  objectType: objectType('object_type').notNull(),
  objectId: uuid('object_id').notNull(),
  version: integer('version').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  diff: jsonb('diff').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('revisions_obj_idx').on(t.objectType, t.objectId, t.version)]);

/** Аудит доступа к чужим объектам и поисковых запросов. */
export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  objectType: text('object_type'),
  objectId: text('object_id'),
  meta: jsonb('meta'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_user_idx').on(t.userId, t.at)]);

/**
 * Запрос входа через бота. Таблица живёт в БД БОТА (схема `site`), потому что пишет в неё бот:
 * сайт создаёт pending-запрос, бот по /start login_<nonce> подтверждает и проставляет tg_id.
 * Описана здесь для полноты; миграцию делает alembic бота.
 */
export const loginRequests = pgTable('site_login_requests', {
  nonce: text('nonce').primaryKey(),
  status: loginStatus('status').notNull().default('pending'),
  tgId: bigint('tg_id', { mode: 'bigint' }),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  userAgent: text('user_agent'),
});
