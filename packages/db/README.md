# @ft/db — база данных сайта

PostgreSQL 18, база и роль `ruleaksfoottracker`. Подключение — секция `[project-db]` в `config.ini`
(флаг `enabled` для миграций не важен: он включает хранилище в самом сервере).

| Путь | Что это |
|---|---|
| `sql/000_create_database.sql`, `sql/001_init_database.sql` | создание роли и базы, расширения (выполняет суперпользователь один раз) |
| `migrations/*.sql` | миграции схемы — **источник истины** для структуры БД |
| `sql/002_initial_schema.sql` | сгенерированная копия первой миграции для ручного применения (не править руками) |
| `config/postgresql.conf` | настройки сервера БД (LXC, 2 ГБ, 2 vCPU) |
| `src/migrate.ts` | обёртка над node-pg-migrate (`npm run db -- …`) |
| `src/pg.ts` | подключение по `config.ini` (sslmode как у libpq), общее с сервером |

## Миграции (node-pg-migrate)

Аналог alembic: пронумерованные SQL-файлы с секциями `-- Up Migration` / `-- Down Migration`,
применённые версии хранятся в таблице `pgmigrations` (имя файла без `.sql`). Каждая миграция
выполняется в своей транзакции.

```bash
npm run db -- status            # что применено и что ждёт
npm run db -- up                # применить все новые миграции (up 1 — только одну)
npm run db -- down              # откатить последнюю (down 2 — две)
npm run db -- create add-media-albums   # новый файл migrations/<UTC-время>_add-media-albums.sql
npm run db -- manual <файл>     # SQL для ручного применения миграции (в stdout)
```

Правила:
- Применённые миграции не редактировать — изменения только новой миграцией.
- В секции Down — обратное действие; если откат невозможен (потеря данных), так и написать комментарием.
- Объекты создаются от имени `ruleaksfoottracker` (владельца базы) — иначе у приложения не будет прав.

## Ручное применение (первая схема)

`sql/002_initial_schema.sql` — секция Up миграции `20261004120000_initial-schema` в одной транзакции,
с `SET LOCAL ROLE ruleaksfoottracker` (владелец объектов — роль сайта, даже если выполняет суперпользователь)
и записью в `pgmigrations`. После него `npm run db -- status` покажет миграцию применённой, а следующие
пойдут через `npm run db -- up`.

```bash
psql -h <host> -p <port> -U ruleaksfoottracker -d ruleaksfoottracker -f 002_initial_schema.sql
```

или в открытом psql: `\c ruleaksfoottracker`, затем вставить содержимое файла (метакоманд psql в нём нет).
Для другой миграции файл генерируется так: `npm run db -- manual <имя> > migration.sql`.

## Схема v1 (кратко)

- `users`, `sessions` — пользователь = пользователь бота (`tg_id`); в сессии хранится только sha256 cookie.
- `dossiers` (+ `dossier_members`, `dossier_items`, `dossier_shares`), `media` — досье; элементы — jsonb `data`
  по типу и `source` с оценкой источника; дробная `position` для перетаскивания.
- `search_jobs` — история поиска и снимки ответов шлюза (`pinned` — прикреплён к досье, `hidden_at` — очищен из истории).
- `investigations` (+ `investigation_shares`), `graph_nodes`, `graph_edges`, `facts` (+ `fact_nodes`, `edge_facts`),
  `hypotheses` (+ `hypothesis_evidence`).
- `relation_texts`, `relation_types` (типы связей: предопределённые и свои), `dossier_relations` (связи между персонами).
- `tag_texts` (общие тексты тегов), `tags` (словарь пользователя: текст + цвет), `dossier_tags`, `investigation_tags`.
- `revisions` (история правок), `audit_log` (поиски и доступ к чужим объектам).

Идентификаторы — `uuidv7()`; `updated_at` ставит триггер; досье и расследования удаляются мягко (`deleted_at`).
Полнотекстовый поиск — сгенерированные `search_tsv` (`russian`), нечёткий по названию досье — `pg_trgm`.
