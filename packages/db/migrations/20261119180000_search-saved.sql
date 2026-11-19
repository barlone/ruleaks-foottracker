-- Сохранённые для редактирования данные поиска: копия ответа шлюза (result), которую пользователь правит на странице
-- результата (пока — удаляет значения глубокого поиска). Исходный снимок result не меняется. NULL — не сохраняли.
-- Удаляются вместе со строкой истории («Очистить историю» обнуляет колонку).

-- Up Migration

ALTER TABLE search_jobs ADD COLUMN saved jsonb;
ALTER TABLE search_jobs ALTER COLUMN saved SET COMPRESSION lz4;


-- Down Migration
-- Сохранённые правки теряются, исходные снимки остаются.

ALTER TABLE search_jobs DROP COLUMN saved;
