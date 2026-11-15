-- Боковые (горизонтальные) связи графа расследования: связь выходит из левой или правой точки блока и входит в
-- левую или правую точку другого. Обе стороны заданы — боковая связь; обе пусты — обычная, снизу вверх.

-- Up Migration

ALTER TABLE graph_edges
  ADD COLUMN source_side text CHECK (source_side IN ('left', 'right')),
  ADD COLUMN target_side text CHECK (target_side IN ('left', 'right')),
  ADD CONSTRAINT graph_edges_sides_check CHECK ((source_side IS NULL) = (target_side IS NULL));


-- Down Migration
-- Боковые связи становятся обычными.

ALTER TABLE graph_edges
  DROP CONSTRAINT graph_edges_sides_check,
  DROP COLUMN source_side,
  DROP COLUMN target_side;
