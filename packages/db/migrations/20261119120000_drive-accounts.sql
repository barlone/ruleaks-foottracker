-- Подключённый Google Диск пользователя: туда сохраняются архивы страниц ссылок досье (OAuth, доступ drive.file).
-- refresh_token — зашифрован на сервере (AES-256-GCM, [google-drive] token-secret), в открытом виде в БД не лежит.
-- folder_id — папка приложения на Диске (создаётся при первом сохранении). Сами записи об архивах — в элементах
-- досье (dossier_items.data → archives), а не здесь.

-- Up Migration

CREATE TABLE drive_accounts (
  user_id        uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email          text        NOT NULL,
  refresh_token  text        NOT NULL,
  folder_id      text,
  connected_at   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER drive_accounts_updated_at BEFORE UPDATE ON drive_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Down Migration
-- Подключения теряются: пользователям придётся подключить Диск заново (файлы на Дисках остаются).

DROP TABLE drive_accounts;
