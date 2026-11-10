-- Второй уровень графа расследования: у узла верхнего уровня может быть внутренний граф. Узел внутреннего графа
-- ссылается на свой узел-контейнер (parent_id); уровней ровно два — это проверяет приложение. Связь лежит на том же
-- уровне, что и её узлы. Удаление контейнера удаляет и внутренний граф.
-- Заодно: пояснение связи в приложении до 2000 знаков, а ограничение в таблице оставалось 256.

-- Up Migration

ALTER TABLE graph_nodes ADD COLUMN parent_id uuid REFERENCES graph_nodes ON DELETE CASCADE CHECK (parent_id <> id);
CREATE INDEX graph_nodes_parent_idx ON graph_nodes (parent_id) WHERE parent_id IS NOT NULL;

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'graph_edges'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%length(label)%'
  LOOP
    EXECUTE format('ALTER TABLE graph_edges DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE graph_edges ADD CONSTRAINT graph_edges_label_check CHECK (length(label) <= 2000);


-- Down Migration
-- Внутренние графы удаляются, длинные пояснения связей обрезаются.

DELETE FROM graph_nodes WHERE parent_id IS NOT NULL;
DROP INDEX graph_nodes_parent_idx;
ALTER TABLE graph_nodes DROP COLUMN parent_id;

UPDATE graph_edges SET label = left(label, 256) WHERE length(label) > 256;
ALTER TABLE graph_edges DROP CONSTRAINT graph_edges_label_check;
ALTER TABLE graph_edges ADD CONSTRAINT graph_edges_label_check CHECK (length(label) <= 256);
