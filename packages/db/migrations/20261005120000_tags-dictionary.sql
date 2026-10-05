-- Словарь тегов вместо массивов tags[] у досье и расследований.
--
--   tag_texts — тексты тегов, общие для всех пользователей (один текст хранится один раз, всегда заглавными);
--   tags      — словарь пользователя: «свой» тег = ссылка на текст + цвет фона. Каждый видит только свои;
--   dossier_tags / investigation_tags — теги объекта (ссылаются на тег из словаря того, кто его поставил,
--               поэтому у совладельцев объекта тег показывается с цветом автора).
--
-- Существующие теги переносятся в словарь владельца объекта (текст — заглавными, цвет — по умолчанию).

-- Up Migration

CREATE TABLE tag_texts (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  text        text        NOT NULL UNIQUE CHECK (length(text) BETWEEN 1 AND 64 AND text = upper(text) AND text = btrim(text)),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  owner_id    uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
  text_id     uuid        NOT NULL REFERENCES tag_texts ON DELETE RESTRICT,
  color       text        NOT NULL DEFAULT '#2ee0ac' CHECK (color ~ '^#[0-9a-f]{6}$'),   -- цвет фона
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, text_id)
);
CREATE INDEX tags_text_idx ON tags (text_id);
CREATE TRIGGER tags_updated_at BEFORE UPDATE ON tags FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Удаление тега из словаря снимает его со всех объектов.
CREATE TABLE dossier_tags (
  dossier_id  uuid    NOT NULL REFERENCES dossiers ON DELETE CASCADE,
  tag_id      uuid    NOT NULL REFERENCES tags ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (dossier_id, tag_id)
);
CREATE INDEX dossier_tags_tag_idx ON dossier_tags (tag_id);   -- «где стоит этот тег»

CREATE TABLE investigation_tags (
  investigation_id  uuid    NOT NULL REFERENCES investigations ON DELETE CASCADE,
  tag_id            uuid    NOT NULL REFERENCES tags ON DELETE CASCADE,
  position          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (investigation_id, tag_id)
);
CREATE INDEX investigation_tags_tag_idx ON investigation_tags (tag_id);

-- Перенос: тексты → словари владельцев → связи с объектами (порядок сохраняется).
CREATE TEMP TABLE old_tags ON COMMIT DROP AS
  SELECT 'd' AS kind, d.id AS object_id, d.owner_id, upper(btrim(left(t.text, 64))) AS text, t.ord
  FROM dossiers d, unnest(d.tags) WITH ORDINALITY AS t(text, ord)
  UNION ALL
  SELECT 'i', i.id, i.owner_id, upper(btrim(left(t.text, 64))), t.ord
  FROM investigations i, unnest(i.tags) WITH ORDINALITY AS t(text, ord);
DELETE FROM old_tags WHERE text = '';

INSERT INTO tag_texts (text) SELECT DISTINCT text FROM old_tags ON CONFLICT (text) DO NOTHING;
INSERT INTO tags (owner_id, text_id)
  SELECT DISTINCT o.owner_id, x.id FROM old_tags o JOIN tag_texts x ON x.text = o.text
  ON CONFLICT (owner_id, text_id) DO NOTHING;
INSERT INTO dossier_tags (dossier_id, tag_id, position)
  SELECT o.object_id, t.id, min(o.ord) FROM old_tags o
  JOIN tag_texts x ON x.text = o.text JOIN tags t ON t.text_id = x.id AND t.owner_id = o.owner_id
  WHERE o.kind = 'd' GROUP BY o.object_id, t.id;
INSERT INTO investigation_tags (investigation_id, tag_id, position)
  SELECT o.object_id, t.id, min(o.ord) FROM old_tags o
  JOIN tag_texts x ON x.text = o.text JOIN tags t ON t.text_id = x.id AND t.owner_id = o.owner_id
  WHERE o.kind = 'i' GROUP BY o.object_id, t.id;

DROP INDEX dossiers_tags_idx;
DROP INDEX investigations_tags_idx;
ALTER TABLE dossiers DROP COLUMN tags;
ALTER TABLE investigations DROP COLUMN tags;


-- Down Migration
-- Цвета тегов и словари без связей с объектами теряются; тексты возвращаются в массивы.

ALTER TABLE dossiers ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE investigations ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
UPDATE dossiers d SET tags = s.tags FROM (
  SELECT dt.dossier_id, array_agg(x.text ORDER BY dt.position, x.text) AS tags
  FROM dossier_tags dt JOIN tags t ON t.id = dt.tag_id JOIN tag_texts x ON x.id = t.text_id GROUP BY dt.dossier_id
) s WHERE s.dossier_id = d.id;
UPDATE investigations i SET tags = s.tags FROM (
  SELECT it.investigation_id, array_agg(x.text ORDER BY it.position, x.text) AS tags
  FROM investigation_tags it JOIN tags t ON t.id = it.tag_id JOIN tag_texts x ON x.id = t.text_id GROUP BY it.investigation_id
) s WHERE s.investigation_id = i.id;
CREATE INDEX dossiers_tags_idx       ON dossiers USING gin (tags);
CREATE INDEX investigations_tags_idx ON investigations USING gin (tags);
DROP TABLE investigation_tags, dossier_tags, tags, tag_texts;
