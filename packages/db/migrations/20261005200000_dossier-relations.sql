-- Связи между персонами (досье персон) и словарь типов связей.
--
--   relation_texts — тексты типов, общие для всех (один текст — одна строка, всегда в нижнем регистре);
--   relation_types — тип связи: ссылка на текст + владелец. owner_id IS NULL — предопределённый тип (виден всем),
--                    иначе тип из словаря пользователя (виден только ему);
--   dossier_relations — связь «досье → досье» одного типа с необязательным пояснением («возможно сын»).
--                    Между двумя персонами может быть несколько связей разных типов; показывается в обоих досье.

-- Up Migration

CREATE TABLE relation_texts (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  text        text        NOT NULL UNIQUE CHECK (length(text) BETWEEN 1 AND 64 AND text = lower(text) AND text = btrim(text)),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE relation_types (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  owner_id    uuid        REFERENCES users ON DELETE CASCADE,          -- NULL — предопределённый
  text_id     uuid        NOT NULL REFERENCES relation_texts ON DELETE RESTRICT,
  position    integer     NOT NULL DEFAULT 0,                          -- порядок предопределённых
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Один текст — один тип у владельца; предопределённые (NULL) тоже уникальны.
CREATE UNIQUE INDEX relation_types_owner_text_uq ON relation_types (owner_id, text_id) NULLS NOT DISTINCT;
CREATE INDEX relation_types_text_idx ON relation_types (text_id);
CREATE TRIGGER relation_types_updated_at BEFORE UPDATE ON relation_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Удаление типа из словаря удаляет и связи этого типа.
CREATE TABLE dossier_relations (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  from_id     uuid        NOT NULL REFERENCES dossiers ON DELETE CASCADE,
  to_id       uuid        NOT NULL REFERENCES dossiers ON DELETE CASCADE,
  type_id     uuid        NOT NULL REFERENCES relation_types ON DELETE CASCADE,
  note        text        CHECK (length(note) <= 500),                 -- «возможно сын», «ООО Ромашка, 2019»
  created_by  uuid        NOT NULL REFERENCES users ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (from_id <> to_id),
  UNIQUE (from_id, to_id, type_id)
);
CREATE INDEX dossier_relations_to_idx ON dossier_relations (to_id);   -- связи, указанные в чужих досье
CREATE TRIGGER dossier_relations_updated_at BEFORE UPDATE ON dossier_relations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO relation_texts (text) VALUES ('родственник'), ('совместная работа'), ('совместная учеба'), ('совместная служба');
INSERT INTO relation_types (owner_id, text_id, position)
  SELECT NULL, x.id, p.ord FROM relation_texts x
  JOIN (VALUES ('родственник', 1), ('совместная работа', 2), ('совместная учеба', 3), ('совместная служба', 4)) AS p(text, ord) ON p.text = x.text;


-- Down Migration

DROP TABLE dossier_relations, relation_types, relation_texts;
