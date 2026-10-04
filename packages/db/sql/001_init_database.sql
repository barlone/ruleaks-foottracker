-- RuLeaks.Следопыт — шаг 2 из 2: настройка внутри базы.
--
-- Выполнять под суперпользователем, подключившись к базе ruleaksfoottracker:
--   \c ruleaksfoottracker
-- Чистый SQL, можно вставлять в терминал целиком и запускать повторно.

-- Схема public принадлежит владельцу базы: полный доступ к таблицам, последовательностям, функциям.
ALTER SCHEMA public OWNER TO ruleaksfoottracker;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- Расширения, которые нужны схеме (packages/db/src/schema.ts):
--   pg_trgm  — нечёткий поиск по названиям досье и тегам;
--   pgcrypto — digest() для хешей сессий.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Проверка.
SELECT current_database() AS база, pg_get_userbyid(nspowner) AS владелец_схемы_public
FROM pg_namespace WHERE nspname = 'public';
SELECT extname AS расширение, extversion AS версия FROM pg_extension ORDER BY 1;

-- Для подключения сайта с другого хоста (на сервере БД, затем SELECT pg_reload_conf();):
--   postgresql.conf:  listen_addresses = '*'            (или конкретный адрес)
--   pg_hba.conf:      hostssl ruleaksfoottracker ruleaksfoottracker <IP сайта>/32 scram-sha-256
-- В config.ini сайта — секция [project-db]: host, port, password, sslmode = require.
