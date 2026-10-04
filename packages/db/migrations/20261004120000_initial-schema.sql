-- RuLeaks.Следопыт — первая версия схемы БД ruleaksfoottracker.
--
-- Миграция node-pg-migrate (SQL-формат: секции «Up Migration» / «Down Migration»).
-- Первую схему создают вручную — см. packages/db/README.md («Ручное применение»):
-- выполнить секцию Up от имени владельца базы, затем 002_mark_initial_migration.sql.
--
-- Требует PostgreSQL 18 (uuidv7()) и расширение pg_trgm (создаётся 001_init_database.sql).
--
-- Соглашения:
--   * идентификаторы — uuid v7 (упорядочены по времени: индексы растут без фрагментации);
--   * время — timestamptz; created_at/updated_at; updated_at ставит триггер set_updated_at();
--   * удаление досье и расследований мягкое (deleted_at), всё вложенное — ON DELETE CASCADE;
--   * свободные структуры (тело элемента досье, источники, свойства узла, ответ шлюза) — jsonb,
--     формат описан Zod-схемами в packages/shared/src/domain.ts;
--   * version — счётчик для оптимистичной блокировки, увеличивает приложение.

-- Up Migration

-- ============================================================================
-- Типы
-- ============================================================================

CREATE TYPE dossier_kind             AS ENUM ('person', 'group');
CREATE TYPE dossier_visibility       AS ENUM ('private', 'shared');            -- публичных досье нет
CREATE TYPE investigation_visibility AS ENUM ('private', 'shared', 'public');
CREATE TYPE share_role               AS ENUM ('viewer', 'editor');
CREATE TYPE dossier_item_type        AS ENUM ('attribute', 'link', 'media', 'note', 'snapshot');
CREATE TYPE node_type                AS ENUM ('person', 'organization', 'event', 'location', 'asset', 'document');
CREATE TYPE hypothesis_status        AS ENUM ('open', 'supported', 'confirmed', 'refuted');
CREATE TYPE evidence_stance          AS ENUM ('supports', 'contradicts');
CREATE TYPE search_section           AS ENUM ('attr', 'tg', 'fuzzy');
CREATE TYPE search_state             AS ENUM ('running', 'done', 'failed', 'choose');
CREATE TYPE gateway_service          AS ENUM ('ruleaks', 'tgcmnts');
CREATE TYPE audited_object           AS ENUM ('dossier', 'investigation', 'search', 'session');

-- Достоверность сведений по шкале Адмиралтейства: '1'..'6'.
CREATE DOMAIN credibility AS char(1) CHECK (VALUE BETWEEN '1' AND '6');

-- ============================================================================
-- Общие функции
-- ============================================================================

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- ============================================================================
-- Пользователи и сессии
-- ============================================================================

-- Пользователь сайта = пользователь Telegram-бота. Подписку и токен API не храним:
-- их источник — БД бота (users / tokens), сайт читает их при каждом обращении.
CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT uuidv7(),
  tg_id         bigint      NOT NULL UNIQUE,
  display_name  text        NOT NULL,
  username      text,                                   -- Telegram @username без «@»
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);
-- Поделиться можно по @username — поиск без учёта регистра.
CREATE UNIQUE INDEX users_username_uq ON users (lower(username)) WHERE username IS NOT NULL;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- В cookie — случайный идентификатор, в БД — только его sha256: утечка таблицы не даёт войти.
CREATE TABLE sessions (
  id_hash       bytea       PRIMARY KEY CHECK (octet_length(id_hash) = 32),
  user_id       uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  user_agent    text,
  ip            inet
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);   -- периодическая чистка истёкших

-- ============================================================================
-- Медиафайлы
-- ============================================================================

-- Сами файлы — в S3-совместимом хранилище; здесь метаданные.
-- EXIF/GPS сохраняется как улика; наружу отдаётся копия без метаданных.
CREATE TABLE media (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  owner_id       uuid        NOT NULL REFERENCES users ON DELETE RESTRICT,
  storage_key    text        NOT NULL UNIQUE,
  thumb_key      text,
  mime           text        NOT NULL,
  size_bytes     bigint      NOT NULL CHECK (size_bytes >= 0),
  sha256         bytea       NOT NULL CHECK (octet_length(sha256) = 32),
  width          integer,
  height         integer,
  original_name  text,
  exif           jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Один и тот же файл у владельца хранится один раз.
CREATE UNIQUE INDEX media_owner_sha_uq ON media (owner_id, sha256);

-- ============================================================================
-- Досье
-- ============================================================================

CREATE TABLE dossiers (
  id              uuid               PRIMARY KEY DEFAULT uuidv7(),
  owner_id        uuid               NOT NULL REFERENCES users ON DELETE RESTRICT,
  kind            dossier_kind       NOT NULL,
  title           text               NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  summary_md      text               NOT NULL DEFAULT '',
  tags            text[]             NOT NULL DEFAULT '{}',
  visibility      dossier_visibility NOT NULL DEFAULT 'private',
  cover_media_id  uuid               REFERENCES media ON DELETE SET NULL,
  version         integer            NOT NULL DEFAULT 1,
  created_at      timestamptz        NOT NULL DEFAULT now(),
  updated_at      timestamptz        NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  -- Полнотекстовый поиск по своим досье: название важнее сводки.
  search_tsv      tsvector GENERATED ALWAYS AS (
                    setweight(to_tsvector('russian'::regconfig, title), 'A') ||
                    setweight(to_tsvector('russian'::regconfig, summary_md), 'C')
                  ) STORED
);
CREATE INDEX dossiers_owner_idx      ON dossiers (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX dossiers_tsv_idx        ON dossiers USING gin (search_tsv);
CREATE INDEX dossiers_title_trgm_idx ON dossiers USING gin (title gin_trgm_ops);   -- нечёткий поиск по названию
CREATE INDEX dossiers_tags_idx       ON dossiers USING gin (tags);
CREATE TRIGGER dossiers_updated_at BEFORE UPDATE ON dossiers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Участники досье-группы: ссылки на досье персон, без копирования.
CREATE TABLE dossier_members (
  group_id    uuid    NOT NULL REFERENCES dossiers ON DELETE CASCADE,
  member_id   uuid    NOT NULL REFERENCES dossiers ON DELETE CASCADE,
  role_label  text,                                     -- «директор», «водитель»…
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, member_id),
  CHECK (group_id <> member_id)
);
CREATE INDEX dossier_members_member_idx ON dossier_members (member_id);   -- «в каких группах состоит»

-- Элементы досье. data — тело по типу (DossierItem в @ft/shared):
--   attribute {key, label, value} · link {url, title, platform} · media {mediaId, caption, album}
--   note {markdown} · snapshot {searchId, section, kind, query, deep, summary}
-- source — происхождение и оценка {kind, ref, note, reliability A–F, credibility 1–6, capturedAt}.
CREATE TABLE dossier_items (
  id          uuid              PRIMARY KEY DEFAULT uuidv7(),
  dossier_id  uuid              NOT NULL REFERENCES dossiers ON DELETE CASCADE,
  type        dossier_item_type NOT NULL,
  data        jsonb             NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  source      jsonb             CHECK (source IS NULL OR jsonb_typeof(source) = 'object'),
  -- Дробная позиция: вставка между соседями без перенумерации.
  position    double precision  NOT NULL,
  -- Для медиа — ссылка на файл (FK держит целостность; в data дублируется для фронтенда).
  media_id    uuid              REFERENCES media ON DELETE RESTRICT,
  created_by  uuid              NOT NULL REFERENCES users ON DELETE RESTRICT,
  created_at  timestamptz       NOT NULL DEFAULT now(),
  updated_at  timestamptz       NOT NULL DEFAULT now(),
  CHECK ((type = 'media') = (media_id IS NOT NULL))
);
CREATE INDEX dossier_items_dossier_idx ON dossier_items (dossier_id, position);
-- Поиск совпадений между досье: «где ещё встречается этот телефон / ник».
CREATE INDEX dossier_items_data_idx    ON dossier_items USING gin (data jsonb_path_ops);
CREATE TRIGGER dossier_items_updated_at BEFORE UPDATE ON dossier_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE dossier_shares (
  dossier_id  uuid        NOT NULL REFERENCES dossiers ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  role        share_role  NOT NULL,
  granted_by  uuid        NOT NULL REFERENCES users ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dossier_id, user_id)
);
CREATE INDEX dossier_shares_user_idx ON dossier_shares (user_id);   -- «доступные мне»

-- ============================================================================
-- Поиск: история и снимки результатов
-- ============================================================================

-- Шлюз хранит результат минуты, поэтому каждый поиск сохраняется здесь.
-- pinned = снимок прикреплён к досье/факту и не удаляется при чистке истории.
CREATE TABLE search_jobs (
  id               uuid            PRIMARY KEY DEFAULT uuidv7(),
  user_id          uuid            NOT NULL REFERENCES users ON DELETE CASCADE,
  section          search_section  NOT NULL,
  kind             text            NOT NULL,          -- вид поиска / режим Telegram / маска
  query            text            NOT NULL,
  deep             boolean         NOT NULL DEFAULT false,
  params           jsonb           NOT NULL DEFAULT '{}',   -- bday, vehicpart, tgid, via…
  state            search_state    NOT NULL,
  error            text,
  candidates       text[],                             -- state = choose: Telegram ID на выбор
  result           jsonb,                              -- ответ шлюза как есть
  gateway_service  gateway_service NOT NULL,
  gateway_job_id   text,
  started_at       timestamptz     NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  pinned           boolean         NOT NULL DEFAULT false,
  hidden_at        timestamptz                          -- «очистить историю»: скрыть, не удаляя закреплённые
);
CREATE INDEX search_jobs_history_idx ON search_jobs (user_id, section, started_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX search_jobs_running_idx ON search_jobs (started_at) WHERE state = 'running';   -- фоновый опрос шлюза
CREATE INDEX search_jobs_cleanup_idx ON search_jobs (started_at) WHERE NOT pinned;          -- чистка старых снимков
-- Большие ответы шлюза (deep-поиск) сжимаются быстрее lz4.
ALTER TABLE search_jobs ALTER COLUMN result SET COMPRESSION lz4;

-- ============================================================================
-- Расследования
-- ============================================================================

CREATE TABLE investigations (
  id              uuid                     PRIMARY KEY DEFAULT uuidv7(),
  owner_id        uuid                     NOT NULL REFERENCES users ON DELETE RESTRICT,
  title           text                     NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  description_md  text                     NOT NULL DEFAULT '',
  tags            text[]                   NOT NULL DEFAULT '{}',
  visibility      investigation_visibility NOT NULL DEFAULT 'private',
  -- Публичное расследование открывается только по неугадываемой ссылке.
  public_slug     text                     UNIQUE,
  version         integer                  NOT NULL DEFAULT 1,
  created_at      timestamptz              NOT NULL DEFAULT now(),
  updated_at      timestamptz              NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  search_tsv      tsvector GENERATED ALWAYS AS (
                    setweight(to_tsvector('russian'::regconfig, title), 'A') ||
                    setweight(to_tsvector('russian'::regconfig, description_md), 'C')
                  ) STORED,
  CHECK (visibility <> 'public' OR public_slug IS NOT NULL)
);
CREATE INDEX investigations_owner_idx  ON investigations (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX investigations_public_idx ON investigations (updated_at DESC) WHERE visibility = 'public' AND deleted_at IS NULL;
CREATE INDEX investigations_tsv_idx    ON investigations USING gin (search_tsv);
CREATE INDEX investigations_tags_idx   ON investigations USING gin (tags);
CREATE TRIGGER investigations_updated_at BEFORE UPDATE ON investigations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE investigation_shares (
  investigation_id  uuid        NOT NULL REFERENCES investigations ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  role              share_role  NOT NULL,
  granted_by        uuid        NOT NULL REFERENCES users ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (investigation_id, user_id)
);
CREATE INDEX investigation_shares_user_idx ON investigation_shares (user_id);

-- Узлы графа связей. Персона/группа ссылается на досье, а не копирует его.
CREATE TABLE graph_nodes (
  id                uuid             PRIMARY KEY DEFAULT uuidv7(),
  investigation_id  uuid             NOT NULL REFERENCES investigations ON DELETE CASCADE,
  type              node_type        NOT NULL,
  label             text             NOT NULL CHECK (length(label) <= 256),
  dossier_id        uuid             REFERENCES dossiers ON DELETE SET NULL,
  props             jsonb            NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(props) = 'object'),   -- date, координаты…
  x                 double precision NOT NULL DEFAULT 0,
  y                 double precision NOT NULL DEFAULT 0,
  created_at        timestamptz      NOT NULL DEFAULT now(),
  updated_at        timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX graph_nodes_investigation_idx ON graph_nodes (investigation_id);
CREATE INDEX graph_nodes_dossier_idx       ON graph_nodes (dossier_id) WHERE dossier_id IS NOT NULL;   -- «в каких расследованиях фигурирует»
CREATE TRIGGER graph_nodes_updated_at BEFORE UPDATE ON graph_nodes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE graph_edges (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  investigation_id  uuid        NOT NULL REFERENCES investigations ON DELETE CASCADE,
  source_node_id    uuid        NOT NULL REFERENCES graph_nodes ON DELETE CASCADE,
  target_node_id    uuid        NOT NULL REFERENCES graph_nodes ON DELETE CASCADE,
  relation          text        NOT NULL CHECK (length(relation) BETWEEN 1 AND 64),   -- «руководит», «знакомы»…
  label             text        CHECK (length(label) <= 256),
  credibility       credibility NOT NULL DEFAULT '6',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (source_node_id <> target_node_id)
);
CREATE INDEX graph_edges_investigation_idx ON graph_edges (investigation_id);
CREATE INDEX graph_edges_source_idx        ON graph_edges (source_node_id);
CREATE INDEX graph_edges_target_idx        ON graph_edges (target_node_id);
CREATE TRIGGER graph_edges_updated_at BEFORE UPDATE ON graph_edges FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Факты: одно утверждение — один факт. sources — массив Source (как у элементов досье).
CREATE TABLE facts (
  id                uuid        PRIMARY KEY DEFAULT uuidv7(),
  investigation_id  uuid        NOT NULL REFERENCES investigations ON DELETE CASCADE,
  text_md           text        NOT NULL,
  occurred_at       timestamptz,                        -- NULL — дата неизвестна
  sources           jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  created_by        uuid        NOT NULL REFERENCES users ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX facts_timeline_idx ON facts (investigation_id, occurred_at NULLS LAST);
CREATE TRIGGER facts_updated_at BEFORE UPDATE ON facts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Факт ↔ объекты графа, о которых он.
CREATE TABLE fact_nodes (
  fact_id  uuid NOT NULL REFERENCES facts ON DELETE CASCADE,
  node_id  uuid NOT NULL REFERENCES graph_nodes ON DELETE CASCADE,
  PRIMARY KEY (fact_id, node_id)
);
CREATE INDEX fact_nodes_node_idx ON fact_nodes (node_id);

-- Факты, подтверждающие связь.
CREATE TABLE edge_facts (
  edge_id  uuid NOT NULL REFERENCES graph_edges ON DELETE CASCADE,
  fact_id  uuid NOT NULL REFERENCES facts ON DELETE CASCADE,
  PRIMARY KEY (edge_id, fact_id)
);
CREATE INDEX edge_facts_fact_idx ON edge_facts (fact_id);

-- Гипотезы и доказательная база (упрощённый ACH: факт за / против).
CREATE TABLE hypotheses (
  id                uuid              PRIMARY KEY DEFAULT uuidv7(),
  investigation_id  uuid              NOT NULL REFERENCES investigations ON DELETE CASCADE,
  title             text              NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  text_md           text              NOT NULL DEFAULT '',
  status            hypothesis_status NOT NULL DEFAULT 'open',
  created_by        uuid              NOT NULL REFERENCES users ON DELETE RESTRICT,
  created_at        timestamptz       NOT NULL DEFAULT now(),
  updated_at        timestamptz       NOT NULL DEFAULT now()
);
CREATE INDEX hypotheses_investigation_idx ON hypotheses (investigation_id);
CREATE TRIGGER hypotheses_updated_at BEFORE UPDATE ON hypotheses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE hypothesis_evidence (
  hypothesis_id  uuid            NOT NULL REFERENCES hypotheses ON DELETE CASCADE,
  fact_id        uuid            NOT NULL REFERENCES facts ON DELETE CASCADE,
  stance         evidence_stance NOT NULL,
  PRIMARY KEY (hypothesis_id, fact_id)
);
CREATE INDEX hypothesis_evidence_fact_idx ON hypothesis_evidence (fact_id);

-- ============================================================================
-- История правок и аудит
-- ============================================================================

-- Кто что изменил: снимок изменений на каждую новую версию досье/расследования.
CREATE TABLE revisions (
  id           bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  object_type  audited_object NOT NULL CHECK (object_type IN ('dossier', 'investigation')),
  object_id    uuid           NOT NULL,
  version      integer        NOT NULL,
  user_id      uuid           REFERENCES users ON DELETE SET NULL,
  diff         jsonb          NOT NULL,                 -- JSON Patch от предыдущей версии
  created_at   timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, version)
);

-- Поиски и открытие чужих объектов — для разбора инцидентов.
CREATE TABLE audit_log (
  id           bigint         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid           REFERENCES users ON DELETE SET NULL,
  action       text           NOT NULL,                 -- search.start, dossier.read, share.grant…
  object_type  audited_object,
  object_id    uuid,
  meta         jsonb,
  ip           inet,
  created_at   timestamptz    NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_idx   ON audit_log (user_id, created_at DESC);
CREATE INDEX audit_log_object_idx ON audit_log (object_type, object_id) WHERE object_id IS NOT NULL;
CREATE INDEX audit_log_time_idx   ON audit_log USING brin (created_at);


-- Down Migration

DROP TABLE IF EXISTS audit_log, revisions,
  hypothesis_evidence, hypotheses, edge_facts, fact_nodes, facts,
  graph_edges, graph_nodes, investigation_shares, investigations,
  search_jobs, dossier_shares, dossier_items, dossier_members, dossiers,
  media, sessions, users CASCADE;
DROP FUNCTION IF EXISTS set_updated_at();
DROP DOMAIN IF EXISTS credibility;
DROP TYPE IF EXISTS audited_object, gateway_service, search_state, search_section, evidence_stance,
  hypothesis_status, node_type, dossier_item_type, share_role, investigation_visibility,
  dossier_visibility, dossier_kind;
