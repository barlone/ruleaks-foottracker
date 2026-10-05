import { z } from 'zod';

// Общие Zod-схемы предметной области. Источник истины для tRPC-ввода на сервере,
// типов на фронте и (в будущем) для проверки JSONB-колонок перед записью в БД.

export const Id = z.string().min(1).max(64);

// ---------- Доступ ----------

/** Досье: только private | shared. Публичными могут быть только расследования. */
export const DossierVisibility = z.enum(['private', 'shared']);
export const InvestigationVisibility = z.enum(['private', 'shared', 'public']);
export const ShareRole = z.enum(['viewer', 'editor']);

export const Share = z.object({
  userId: Id,
  displayName: z.string(),
  role: ShareRole,
});

// ---------- Оценка источника (Admiralty / NATO System) ----------
// Надёжность источника A–F и достоверность сведений 1–6 — стандарт HUMINT-оценки.

export const SourceReliability = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);
export const InfoCredibility = z.enum(['1', '2', '3', '4', '5', '6']);

export const RELIABILITY_LABELS: Record<z.infer<typeof SourceReliability>, string> = {
  A: 'Полностью надёжен',
  B: 'Обычно надёжен',
  C: 'Довольно надёжен',
  D: 'Обычно ненадёжен',
  E: 'Ненадёжен',
  F: 'Нельзя оценить',
};
export const CREDIBILITY_LABELS: Record<z.infer<typeof InfoCredibility>, string> = {
  '1': 'Подтверждено',
  '2': 'Вероятно верно',
  '3': 'Возможно верно',
  '4': 'Сомнительно',
  '5': 'Маловероятно',
  '6': 'Нельзя оценить',
};

/** Происхождение сведений. Есть у каждого элемента досье и каждого факта. */
export const Source = z.object({
  kind: z.enum(['search', 'url', 'manual', 'humint', 'document']),
  /** search: id сохранённого снимка поиска; url: адрес; humint: псевдоним источника. */
  ref: z.string().max(2048).optional(),
  note: z.string().max(2000).optional(),
  reliability: SourceReliability.default('F'),
  credibility: InfoCredibility.default('6'),
  capturedAt: z.string(), // ISO
});

// ---------- Пользователь и доступ к подписке ----------

export const Access = z.object({
  active: z.boolean(),
  unlimited: z.boolean(),
  until: z.string().nullable(),
  /** Причина отказа словами бота (access_error), если active=false. */
  reason: z.string().nullable(),
});

export const User = z.object({
  id: Id,
  tgId: z.string(),
  displayName: z.string(),
  username: z.string().nullable(),
  access: Access,
});

// ---------- Теги ----------
// Тексты тегов общие для всех (таблица tag_texts), словарь у каждого свой: тег = текст + цвет фона.
// Объект ссылается на тег из словаря того, кто его поставил.

/** Фон тегов на выбор; можно указать и любой свой цвет. */
export const TAG_COLORS = [
  '#2ee0ac', '#1fb98c', '#6cb8ff', '#3b82f6', '#a78bfa', '#e879f9',
  '#ff5c7a', '#ff8a4c', '#ffc85c', '#a3e635', '#94a3b8', '#3f4a47',
] as const;
export const DEFAULT_TAG_COLOR = TAG_COLORS[0];

/** Текст тега: без ведущих «#», пробелы схлопнуты, всегда заглавными. */
export const normalizeTagText = (s: string) => s.replace(/^[#\s]+/, '').replace(/\s+/g, ' ').trim().toUpperCase();

export const TagText = z.string().transform(normalizeTagText).pipe(z.string().min(1).max(64));
export const TagColor = z.string().regex(/^#[0-9a-f]{6}$/i).transform((s) => s.toLowerCase());

export const Tag = z.object({
  id: Id,
  /** Владелец словаря, из которого тег; править тег может только он. */
  ownerId: Id,
  text: z.string(),
  color: z.string(),
});

// ---------- Связи между персонами ----------
// Типы связей — словарь как у тегов: тексты общие, тип виден автору; предопределённые (ownerId = null) — всем.

/** Текст типа связи: пробелы схлопнуты, всегда в нижнем регистре. */
export const normalizeRelationText = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export const RelationText = z.string().transform(normalizeRelationText).pipe(z.string().min(1).max(64));
export const RelationNote = z.string().trim().max(500);

export const RelationType = z.object({
  id: Id,
  /** null — предопределённый тип. */
  ownerId: Id.nullable(),
  text: z.string(),
});

/** Связь «досье → досье» одного типа; показывается в обоих досье. */
export const DossierRelation = z.object({
  id: Id,
  fromId: Id,
  toId: Id,
  typeId: Id,
  typeText: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

// ---------- Досье ----------

export const DossierKind = z.enum(['person', 'group']);

const itemBase = {
  id: Id,
  position: z.number().int(),
  source: Source.optional(),
  createdAt: z.string(),
};

export const AttributeItem = z.object({
  ...itemBase,
  type: z.literal('attribute'),
  /** Ключ из LEAK_FIELDS или произвольный. */
  key: z.string().max(64),
  label: z.string().max(128),
  value: z.string().max(4000),
});

export const Platform = z.enum(['vk', 'telegram', 'ok', 'instagram', 'facebook', 'x', 'youtube', 'web', 'other']);

export const LinkItem = z.object({
  ...itemBase,
  type: z.literal('link'),
  url: z.string().url(),
  title: z.string().max(256).optional(),
  platform: Platform.default('web'),
});

export const MediaItem = z.object({
  ...itemBase,
  type: z.literal('media'),
  mediaId: Id,
  /** Временный URL превью (presigned), выдаётся сервером при чтении. */
  url: z.string(),
  thumbUrl: z.string().optional(),
  caption: z.string().max(1000).optional(),
  album: z.string().max(128).optional(),
});

export const NoteItem = z.object({
  ...itemBase,
  type: z.literal('note'),
  markdown: z.string().max(100_000),
});

export const SnapshotItem = z.object({
  ...itemBase,
  type: z.literal('snapshot'),
  searchId: Id,
  section: z.enum(['attr', 'tg', 'fuzzy']).default('attr'),
  kind: z.string(),
  query: z.string(),
  deep: z.boolean(),
  summary: z.string(),
});

/** Активность в соцсетях: свой пост, комментарий, ответ на чужое сообщение, реакция. */
export const PostKind = z.enum(['post', 'comment', 'reply', 'reaction']);

export const POST_KIND_LABELS: Record<z.infer<typeof PostKind>, string> = {
  post: 'Пост',
  comment: 'Комментарий',
  reply: 'Ответ',
  reaction: 'Реакция',
};

export const PostItem = z.object({
  ...itemBase,
  type: z.literal('post'),
  kind: PostKind,
  platform: Platform.default('telegram'),
  /** Где опубликовано: группа, канал, страница. */
  place: z.string().max(256).optional(),
  /** Ссылка на само сообщение. */
  url: z.string().max(2048).optional(),
  /** Время публикации (для реакции — время реакции), ISO в UTC; null — неизвестно. */
  at: z.string().nullable(),
  /** Текст поста/комментария; для реакции — текст сообщения, на которое реагировали. */
  text: z.string().max(20_000),
  /** Текст сообщения, на которое отвечали. */
  replyTo: z.string().max(20_000).optional(),
  /** Эмодзи реакции. */
  emoji: z.string().max(64).optional(),
  /** Автор, если это не сама персона (например, ответы персоне). */
  author: z.string().max(256).optional(),
  /** Внешний идентификатор — повторный перенос того же сообщения не дублирует его: tg:<группа>:<сообщение>:<вид>. */
  extId: z.string().max(128).optional(),
});

export const DossierItem = z.discriminatedUnion('type', [AttributeItem, LinkItem, MediaItem, NoteItem, SnapshotItem, PostItem]);

export const Dossier = z.object({
  id: Id,
  ownerId: Id,
  kind: DossierKind,
  title: z.string().min(1).max(256),
  summaryMd: z.string().max(100_000),
  tags: z.array(Tag).max(50),
  visibility: DossierVisibility,
  shares: z.array(Share),
  /** Для группы — досье участников. */
  memberIds: z.array(Id),
  coverMediaUrl: z.string().nullable(),
  items: z.array(DossierItem),
  version: z.number().int(),
  updatedAt: z.string(),
});

export const DossierSummary = Dossier.pick({
  id: true, ownerId: true, kind: true, title: true, tags: true, visibility: true, coverMediaUrl: true, updatedAt: true,
}).extend({ itemCount: z.number().int(), role: z.enum(['owner', 'editor', 'viewer']) });

// ---------- Расследования ----------

export const NodeType = z.enum(['person', 'organization', 'event', 'location', 'asset', 'document']);

export const NODE_TYPE_LABELS: Record<z.infer<typeof NodeType>, string> = {
  person: 'Персона',
  organization: 'Организация',
  event: 'Событие',
  location: 'Место',
  asset: 'Объект',
  document: 'Документ',
};

export const GraphNode = z.object({
  id: Id,
  type: NodeType,
  label: z.string().max(256),
  /** Персона/группа ссылается на досье, а не копирует его. */
  dossierId: Id.nullable(),
  /** Для событий — дата, для мест — координаты и т.п. */
  props: z.record(z.string(), z.string()),
  position: z.object({ x: z.number(), y: z.number() }),
});

export const GraphEdge = z.object({
  id: Id,
  source: Id,
  target: Id,
  /** Тип связи: родство, работа, владение, участие, контакт… */
  relation: z.string().max(64),
  label: z.string().max(256).optional(),
  credibility: InfoCredibility.default('6'),
  factIds: z.array(Id).default([]),
});

export const Fact = z.object({
  id: Id,
  textMd: z.string().max(20_000),
  occurredAt: z.string().nullable(),
  sources: z.array(Source),
  nodeIds: z.array(Id),
  createdAt: z.string(),
});

export const HypothesisStatus = z.enum(['open', 'supported', 'confirmed', 'refuted']);

export const Hypothesis = z.object({
  id: Id,
  title: z.string().max(256),
  textMd: z.string().max(20_000),
  status: HypothesisStatus,
  evidence: z.array(z.object({ factId: Id, stance: z.enum(['supports', 'contradicts']) })),
  createdAt: z.string(),
});

export const Investigation = z.object({
  id: Id,
  ownerId: Id,
  title: z.string().min(1).max(256),
  descriptionMd: z.string().max(100_000),
  tags: z.array(Tag).max(50),
  visibility: InvestigationVisibility,
  shares: z.array(Share),
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  facts: z.array(Fact),
  hypotheses: z.array(Hypothesis),
  version: z.number().int(),
  updatedAt: z.string(),
});

export const InvestigationSummary = Investigation.pick({
  id: true, ownerId: true, title: true, tags: true, visibility: true, updatedAt: true,
}).extend({
  nodeCount: z.number().int(),
  factCount: z.number().int(),
  role: z.enum(['owner', 'editor', 'viewer']),
});

// ---------- Поиск ----------

/** choose — по @нику нашлось несколько Telegram ID, пользователь выбирает один (как кнопки в боте). */
export const SearchJobState = z.enum(['running', 'done', 'failed', 'choose']);
export const SearchSectionSchema = z.enum(['attr', 'tg', 'fuzzy']);

export const SearchJob = z.object({
  id: Id,
  section: SearchSectionSchema,
  /** attr: вид поиска (phone, email…); tg: режим (comments, likes…); fuzzy: email | plate. */
  kind: z.string(),
  query: z.string(),
  deep: z.boolean(),
  /** Доп. параметры: bday, vehicpart; tg — во что разрешился пользователь (resolvedTgid, via). */
  params: z.record(z.string(), z.string()),
  state: SearchJobState,
  error: z.string().nullable(),
  candidates: z.array(z.string()).nullable(),
  /** Ответ шлюза как есть: leaks / rows / results / comments / users / years. */
  result: z.unknown().nullable(),
  startedAt: z.string(),
});

// ---------- Типы ----------

export type DossierVisibility = z.infer<typeof DossierVisibility>;
export type InvestigationVisibility = z.infer<typeof InvestigationVisibility>;
export type ShareRole = z.infer<typeof ShareRole>;
export type Share = z.infer<typeof Share>;
export type Tag = z.infer<typeof Tag>;
export type RelationType = z.infer<typeof RelationType>;
export type DossierRelation = z.infer<typeof DossierRelation>;
export type Source = z.infer<typeof Source>;
export type Access = z.infer<typeof Access>;
export type User = z.infer<typeof User>;
export type DossierItem = z.infer<typeof DossierItem>;
export type Dossier = z.infer<typeof Dossier>;
export type DossierSummary = z.infer<typeof DossierSummary>;
export type NodeType = z.infer<typeof NodeType>;
export type GraphNode = z.infer<typeof GraphNode>;
export type GraphEdge = z.infer<typeof GraphEdge>;
export type Fact = z.infer<typeof Fact>;
export type Hypothesis = z.infer<typeof Hypothesis>;
export type HypothesisStatus = z.infer<typeof HypothesisStatus>;
export type Investigation = z.infer<typeof Investigation>;
export type InvestigationSummary = z.infer<typeof InvestigationSummary>;
export type SearchJob = z.infer<typeof SearchJob>;
export type Role = 'owner' | 'editor' | 'viewer';
