import { z } from 'zod';
import {
  DossierKind, GraphNode, HypothesisStatus, InfoCredibility, NodeType, Platform, PostKind, SearchJobState, SearchSectionSchema, Source,
} from './domain.ts';

// Файл экспорта досье/расследования (формат v1). Технически ZIP:
//
//   version.v1                  без шифрования — по имени видно версию формата, не зная пароля
//   meta.info                   JSON ExportMeta: автор, примечание, дата, опции, что внутри
//   dossiers/d1.json …          ExportDossier
//   investigations/i1.json      ExportInvestigation
//   relations.json              ExportRelation[] — связи между персонами внутри файла
//   searches/s1.json …          ExportSearch — снимки поиска (только свои снимки экспортирующего)
//   media/m1.jpg …              изображения (data URL из базы → файл)
//
// Всё, кроме version.vN, зашифровано AES-256 (WinZip AE-2). Пароль архива выводится из пароля экспорта
// (пустого, если пользователь его не задал) — см. apps/server/src/export/password.ts.
//
// Идентификаторов базы в файле нет: объекты ссылаются друг на друга локальными ключами (d1, n1, f1, s1…),
// теги — текстом и цветом, типы связей — текстом, изображения — путём файла в архиве. В Markdown ссылки
// [@Имя](/dossiers/<id>) заменяются на [@Имя](ft:d1), ссылки на досье вне файла — на текст.

export const EXPORT_FORMAT = 'ruleaks-foottracker-export';
export const EXPORT_VERSION = 1;
export const EXPORT_EXTENSION = 'ftx';

/** Ссылка на объект внутри файла в Markdown: [@Имя](ft:d1). */
export const EXPORT_LINK_PREFIX = 'ft:';

const Key = z.string().regex(/^[a-z]+\d+$/);
const FilePath = z.string().max(256);

export const ExportTag = z.object({ text: z.string(), color: z.string() });

/** Изображение: файл в архиве или внешняя ссылка (если в базе был не data URL). */
export const ExportImage = z.union([z.object({ file: FilePath }), z.object({ url: z.string() })]);

/** Источник сведений; ref для kind = search — ключ снимка в файле (s1) или нет, если снимок не вошёл. */
export const ExportSource = Source;

const itemBase = {
  source: ExportSource.optional(),
  createdAt: z.string(),
};

export const ExportDossierItem = z.discriminatedUnion('type', [
  z.object({ ...itemBase, type: z.literal('attribute'), key: z.string(), label: z.string(), value: z.string() }),
  z.object({ ...itemBase, type: z.literal('link'), url: z.string(), title: z.string().optional(), platform: Platform }),
  z.object({
    ...itemBase,
    type: z.literal('media'),
    image: ExportImage,
    thumb: ExportImage.optional(),
    caption: z.string().optional(),
    album: z.string().optional(),
  }),
  z.object({ ...itemBase, type: z.literal('note'), markdown: z.string() }),
  z.object({
    ...itemBase,
    type: z.literal('snapshot'),
    /** Ключ снимка в файле; null — снимок не вошёл (чужой). */
    search: Key.nullable(),
    section: SearchSectionSchema,
    kind: z.string(),
    query: z.string(),
    deep: z.boolean(),
    summary: z.string(),
  }),
  z.object({
    ...itemBase,
    type: z.literal('post'),
    kind: PostKind,
    platform: Platform,
    place: z.string().optional(),
    url: z.string().optional(),
    at: z.string().nullable(),
    text: z.string(),
    replyTo: z.string().optional(),
    emoji: z.string().optional(),
    author: z.string().optional(),
    extId: z.string().optional(),
  }),
]);

export const ExportDossier = z.object({
  key: Key,
  kind: DossierKind,
  title: z.string(),
  summaryMd: z.string(),
  tags: z.array(ExportTag),
  /** Обложка — одно из изображений элементов (тот же file/url). */
  cover: ExportImage.nullable(),
  /** Для группы — участники, вошедшие в файл. */
  members: z.array(Key),
  /** Элементы в порядке показа. */
  items: z.array(ExportDossierItem),
  updatedAt: z.string(),
});

/** Связь между персонами: тип общий, пояснение — у каждой стороны своё. */
export const ExportRelation = z.object({
  from: Key,
  to: Key,
  type: z.string(),
  fromNote: z.string().nullable(),
  toNote: z.string().nullable(),
  createdAt: z.string(),
});

export const ExportInvestigation = z.object({
  key: Key,
  title: z.string(),
  descriptionMd: z.string(),
  tags: z.array(ExportTag),
  nodes: z.array(z.object({
    key: Key,
    type: NodeType,
    label: z.string(),
    /** Досье узла, если вошло в файл. */
    dossier: Key.nullable(),
    props: GraphNode.shape.props,
    position: GraphNode.shape.position,
  })),
  edges: z.array(z.object({
    key: Key,
    source: Key,
    target: Key,
    relation: z.string(),
    label: z.string().optional(),
    credibility: InfoCredibility,
    facts: z.array(Key),
  })),
  facts: z.array(z.object({
    key: Key,
    textMd: z.string(),
    occurredAt: z.string().nullable(),
    sources: z.array(ExportSource),
    nodes: z.array(Key),
    createdAt: z.string(),
  })),
  hypotheses: z.array(z.object({
    key: Key,
    title: z.string(),
    textMd: z.string(),
    status: HypothesisStatus,
    evidence: z.array(z.object({ fact: Key, stance: z.enum(['supports', 'contradicts']) })),
    createdAt: z.string(),
  })),
  updatedAt: z.string(),
});

/** Снимок поиска: ответ шлюза как есть. */
export const ExportSearch = z.object({
  key: Key,
  section: SearchSectionSchema,
  kind: z.string(),
  query: z.string(),
  deep: z.boolean(),
  params: z.record(z.string(), z.string()),
  state: SearchJobState,
  error: z.string().nullable(),
  candidates: z.array(z.string()).nullable(),
  result: z.unknown(),
  startedAt: z.string(),
});

export const ExportOptions = z.object({
  /** Пометка автора: можно ли править импортированную копию (пока только хранится в meta.info). */
  editable: z.boolean(),
});

export const ExportMeta = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  app: z.string(),
  exportedAt: z.string(),
  /** Автор досье/расследования — как указал экспортирующий. */
  author: z.string(),
  note: z.string(),
  /** Пароль экспорта задан (без него файл открывается любой установкой Следопыта). */
  passwordProtected: z.boolean(),
  options: ExportOptions,
  /** Что экспортировали. */
  root: z.object({ type: z.enum(['dossier', 'investigation']), key: Key, title: z.string() }),
  /** Структура файла. */
  contents: z.object({
    dossiers: z.array(z.object({ key: Key, file: FilePath, kind: DossierKind, title: z.string() })),
    investigations: z.array(z.object({ key: Key, file: FilePath, title: z.string() })),
    relations: z.object({ file: FilePath, count: z.number().int() }).nullable(),
    searches: z.array(z.object({ key: Key, file: FilePath, query: z.string() })),
    media: z.array(z.object({ file: FilePath, mime: z.string(), size: z.number().int(), sha256: z.string() })),
  }),
});

export const ExportRequest = z.object({
  id: z.string(),
  author: z.string().trim().max(256),
  note: z.string().trim().max(4000),
  /** Пусто — файл всё равно шифруется, паролем, известным системе. */
  password: z.string().max(256),
  options: ExportOptions,
});

export type ExportImage = z.infer<typeof ExportImage>;
export type ExportDossierItem = z.infer<typeof ExportDossierItem>;
export type ExportDossier = z.infer<typeof ExportDossier>;
export type ExportRelation = z.infer<typeof ExportRelation>;
export type ExportInvestigation = z.infer<typeof ExportInvestigation>;
export type ExportSearch = z.infer<typeof ExportSearch>;
export type ExportMeta = z.infer<typeof ExportMeta>;
export type ExportRequest = z.infer<typeof ExportRequest>;
