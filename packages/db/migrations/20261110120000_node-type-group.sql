-- Узел графа расследования «Группа персон»: привязывается к групповому досье, как персона — к досье персоны.

-- Up Migration

ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'group' AFTER 'person';


-- Down Migration
-- Значение enum не удаляется: тип пересоздаётся, узлы-группы становятся организациями (привязка к досье остаётся).

ALTER TYPE node_type RENAME TO node_type_old;
CREATE TYPE node_type AS ENUM ('person', 'organization', 'event', 'location', 'asset', 'document');
ALTER TABLE graph_nodes ALTER COLUMN type TYPE node_type
  USING (CASE WHEN type::text = 'group' THEN 'organization' ELSE type::text END)::node_type;
DROP TYPE node_type_old;
