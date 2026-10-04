-- RuLeaks.Следопыт — шаг 1 из 2: роль и база данных.
--
-- Выполнять под суперпользователем (обычно postgres), подключившись к базе postgres.
-- Чистый SQL без метакоманд psql — можно вставлять в терминал целиком.
--
-- ВНИМАНИЕ: впишите пароль в ALTER ROLE ниже (одно место). После запуска уберите его
-- из файла и не коммитьте файл с паролем.
--
-- Дальше: \c ruleaksfoottracker и выполнить 001_init_database.sql.

-- 1. Роль-владелец: может входить, больше никаких прав на кластер.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ruleaksfoottracker') THEN
    CREATE ROLE ruleaksfoottracker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

-- Пароль (хранится как SCRAM-SHA-256). При повторном запуске — обновляется.
SET password_encryption = 'scram-sha-256';
ALTER ROLE ruleaksfoottracker PASSWORD 'ВПИШИТЕ_ПАРОЛЬ';

-- 2. База: UTF-8, локаль ru_RU.UTF-8 (русская сортировка ФИО и текста).
-- Локаль должна быть установлена в ОС сервера: проверка — locale -a | grep ru_RU,
-- установка (Debian/Ubuntu) — sudo locale-gen ru_RU.UTF-8 и перезапуск PostgreSQL.
-- Если база уже есть, эта команда выдаст ошибку «already exists» — это нормально.
CREATE DATABASE ruleaksfoottracker
  OWNER ruleaksfoottracker
  ENCODING 'UTF8'
  TEMPLATE template0
  LOCALE_PROVIDER libc
  LOCALE 'ru_RU.UTF-8';

-- 3. Доступ: подключаться может только владелец (и суперпользователи).
REVOKE ALL ON DATABASE ruleaksfoottracker FROM PUBLIC;
GRANT ALL PRIVILEGES ON DATABASE ruleaksfoottracker TO ruleaksfoottracker;

-- Защита от зависших соединений приложения.
ALTER ROLE ruleaksfoottracker IN DATABASE ruleaksfoottracker SET idle_in_transaction_session_timeout = '60s';

-- 4. Проверка.
SELECT datname AS база, pg_get_userbyid(datdba) AS владелец, pg_encoding_to_char(encoding) AS кодировка,
       datlocprovider AS провайдер, datcollate AS локаль
FROM pg_database WHERE datname = 'ruleaksfoottracker';
