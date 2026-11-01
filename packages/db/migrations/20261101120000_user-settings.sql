-- Индивидуальные настройки пользователя (тема оформления и то, что появится дальше). В jsonb лежат только ключи
-- со значением не по умолчанию: {} — всё по умолчанию, {"theme":"light"} — выбрана светлая тема. Новая настройка
-- миграции не требует; значения по умолчанию и проверка — в @ft/shared (UserSettings, DEFAULT_USER_SETTINGS).

-- Up Migration

ALTER TABLE users
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb
  CONSTRAINT users_settings_object CHECK (jsonb_typeof(settings) = 'object');


-- Down Migration
-- Выбранные настройки теряются: у всех снова значения по умолчанию.

ALTER TABLE users DROP COLUMN settings;
