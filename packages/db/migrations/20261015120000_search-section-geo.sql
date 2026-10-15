-- Раздел истории поиска «Поиск по геоданным»: точка и радиус (шлюз: raw_search.byloc_radius).
-- Запрос хранится как «широта, долгота @радиус_в_метрах», параметры — в params (lat, lon, radius).

-- Up Migration

ALTER TYPE search_section ADD VALUE IF NOT EXISTS 'geo';


-- Down Migration
-- Значение enum не удаляется: тип пересоздаётся, геопоиски из истории удаляются.

DELETE FROM search_jobs WHERE section = 'geo';
ALTER TYPE search_section RENAME TO search_section_old;
CREATE TYPE search_section AS ENUM ('attr', 'tg', 'fuzzy');
ALTER TABLE search_jobs ALTER COLUMN section TYPE search_section USING section::text::search_section;
DROP TYPE search_section_old;
