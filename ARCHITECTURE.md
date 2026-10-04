# RuLeaks.Следопыт — архитектура

Веб-инструмент для HUMINT/OSINT-расследований: **Поиск** через API RuLeaks, **Досье** на персон и группы,
**Расследования** с графом связей, фактами и гипотезами. Вход — только через Telegram-бот RuLeaks,
доступ — по действующей подписке бота.

Статус: **прототип архитектуры и интерфейса**. Сервер работает на in-memory адаптерах с демо-данными;
ни БД, ни бот, ни API-шлюз пока не подключены. Все решения ниже отражены в коде каркаса.

---

## 1. Окружение: три системы

```
            ┌──────────────────────── браузер (SPA) ────────────────────────┐
            │ React · TanStack Router/Query · tRPC client · cookie ft_sid   │
            └───────────────────────────────┬───────────────────────────────┘
                                            │ /trpc  (только сюда)
                              ┌─────────────▼─────────────┐
                              │  apps/server (Node, BFF)   │
                              │  Fastify + tRPC            │
                              └──┬───────────┬──────────┬──┘
           X-Site-Key, HTTP      │           │ Bearer   │ SQL
       ┌─────────────────────────▼──┐  ┌─────▼────────┐ ┌▼──────────────────┐
       │ pyruleaks-bot (FastAPI)    │  │ dsstalker-   │ │ PostgreSQL        │
       │ users · tokens · подписки  │  │ api-gate (Go)│ │ база `foottracker`│
       │ /api/site/* (новое)        │  │ raw/deep/job │ │ (досье, графы…)   │
       └────────────────────────────┘  └──────────────┘ └───────────────────┘
```

| Система | Владеет | Сайт обращается |
|---|---|---|
| **pyruleaks-bot** | пользователи (`users`), токены (`tokens`), подписка (`users.subscribed_to`, `access_error()`) | по HTTP к новым внутренним эндпоинтам `/api/site/*` |
| **dsstalker-api-gate** | поиск по утечкам, асинхронные задачи, кэш, троттлинг | по HTTP с UUID-токеном пользователя в `Authorization` |
| **foottracker DB** | всё, что создаёт сайт: досье, медиа, расследования, доступы, снимки поиска | напрямую (Drizzle) |

Правило: **сайт не читает и не пишет таблицы бота напрямую.** Подписку и токены решает бот — так логика
`access_error()` остаётся в одном месте, а у сайта нет прав на БД бота.

## 2. Стек

| Слой | Выбор | Почему |
|---|---|---|
| Монорепо | **npm workspaces** | Общие Zod-схемы и типы; pnpm можно включить позже без изменений структуры |
| Фронтенд | **React 19 + Vite 8**, SPA | Всё за авторизацией, SEO не нужно; статику раздаёт Caddy/nginx |
| Маршруты и данные | **TanStack Router** (code-based) + **TanStack Query** | Типизированные маршруты и search-параметры, кэш, инвалидация |
| API | **tRPC 11** + **Zod 4** | Сквозная типизация без кодогенерации; схемы из `@ft/shared` |
| UI | **Tailwind CSS 4** + Radix (Dialog) + lucide | Тема из ruleaks.link: `#000`, мята `#2EE0AC`, JetBrains Mono + Manrope |
| Граф связей | **React Flow 12** (`@xyflow/react`) + **elkjs** | Свои узлы, связи с подписями, мини-карта, авторасстановка |
| Markdown | **TipTap 3** + `@tiptap/markdown`; просмотр — `react-markdown` + GFM | Визуальный редактор, хранится чистый Markdown |
| Медиа | **dnd-kit** (порядок), **yet-another-react-lightbox** (просмотр) | Сетка фото с перетаскиванием, альбомы, обложка |
| Сервер | **Node 24 + Fastify 5** | Быстрый, зрелые плагины (cookie, multipart, rate-limit) |
| БД | **PostgreSQL** + **Drizzle ORM** | Черновик схемы в `packages/db` |
| Файлы (план) | S3-совместимое хранилище (MinIO/R2), presigned upload, `sharp` | Файлы не идут через Node и не лежат в БД |
| Фоновые задачи (план) | **pg-boss** | Очередь на Postgres: превью, EXIF, очистка снимков. Redis не нужен |

## 3. Структура репозитория

```
packages/shared   Zod-схемы предметной области, каталог видов поиска, форма ответов шлюза
packages/db       Drizzle-схема БД foottracker (черновик, не подключена)
apps/server       Fastify + tRPC (BFF)
  src/ports.ts        интерфейсы: BotBridge, SearchGateway, *Repo  ← роутеры зависят только от них
  src/adapters/memory in-memory реализации + демо-данные (seed.ts)
  src/deps.ts         сборка зависимостей (здесь же будет выбор адаптеров по env)
  src/authz.ts        can()/roleOf() — единственное место проверки прав
  src/trpc.ts         контекст, сессия, процедуры public / authed / active
  src/routers/        auth · search · dossiers · investigations
apps/web          React SPA
  src/router.tsx      все маршруты в одном месте
  src/components/     ui-кит, оболочка, вход, Markdown, доступы, источник/оценка
  src/features/       search · dossiers · investigations
```

**Порты и адаптеры.** Следующий шаг — добавить `adapters/postgres`, `adapters/bot-http`,
`adapters/gateway-http` и переключать их в `deps.ts`. Роутеры, фронтенд и схемы при этом не меняются.

## 4. Авторизация через бота

Основной путь — **deep-link** (Telegram Login Widget требует `/setdomain`, и `oauth.telegram.org`
у части пользователей из РФ работает нестабильно).

```
браузер              сайт (BFF)                     бот
  │ auth.start ───────▶ POST /api/site/login-requests ──▶ nonce, TTL 5 мин
  │ ◀── deepLink t.me/<bot>?start=login_<nonce> + QR
  │ (пользователь в Telegram) ─────────────────────────▶ /start login_<nonce>
  │                                                     кнопка «Войти на сайт» → confirmed, tg_id
  │ auth.status (опрос 1.5 с) ─▶ GET /api/site/login-requests/<nonce>
  │                            ◀── confirmed + профиль
  │                            consume; upsert user; сессия
  │ ◀── Set-Cookie ft_sid (httpOnly, Secure, SameSite=Lax, signed)
```

- Сессия хранится на сервере (`sessions`, в БД — sha256 от значения cookie), срок 30 дней.
  JWT не используем: сессию нужно уметь отозвать сразу (команда бота «Завершить все сессии на сайте»).
- **Контроль подписки** — `GET /api/site/users/<tg_id>/access` (ответ бота кэшируется на 60 с).
  Неактивная подписка переводит сайт в **режим чтения**: свои и расшаренные объекты видны,
  поиск и любые изменения запрещены (`activeProcedure` → `FORBIDDEN SUBSCRIPTION_INACTIVE`).
  Баннер в интерфейсе ведёт в бота для продления; есть кнопка «проверить снова».
- **Токен шлюза** (`GET /api/site/users/<tg_id>/api-token`) читается только сервером и никогда не уходит
  в браузер. В БД сайта он хранится зашифрованным (AES-256-GCM), ключ — в env.

### Что добавить в pyruleaks-bot

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/site/login-requests` | создать `nonce` (таблица `site_login_requests`, миграция alembic) |
| `GET` | `/api/site/login-requests/{nonce}` | `pending` / `confirmed{tg_id, name, username}` / `expired` |
| `POST` | `/api/site/login-requests/{nonce}/consume` | одноразовость |
| `GET` | `/api/site/users/{tg_id}/access` | `{active, unlimited, until, reason}` — та же логика `access_error()` |
| `GET` | `/api/site/users/{tg_id}/api-token` | UUID-токен шлюза |

Все `/api/site/*` требуют заголовок `X-Site-Key` по аналогии с `require_admin_key`. Слушать их нужно
на внутреннем интерфейсе. Обработчик `/start login_<nonce>` подключается к существующему `start_payload()`
в `app/bot/handlers/main.py`; кнопка подтверждения — callback с префиксом `site_login:`, не пересекающимся
с существующими (`search_`, `deep_search_`, `payment:` …).

## 5. Поиск

Три раздела повторяют меню бота. Каталоги путей и параметров — в `packages/shared/src/search.ts`
(сверены с `app/api/endpoints.py` и `app/api/client.py` бота):

| Раздел | Маршрут | Команда бота | Что ищет |
|---|---|---|---|
| Поиск по атрибутам | `/search` | `/search`, `/deepsearch` | 18 видов: телефон, email, ФИО+дата, документы, авто, Telegram ID… raw или deep |
| Поиск в Telegram | `/search/telegram` | `/tgsearch` | комментарии, реакции, ответы пользователя и ему, активность по месяцам и часам, полнотекстовый поиск (`/tgcmnts/v1/*`) |
| Нечёткий поиск | `/search/fuzzy` | `/regsearch` | маска email (`emailmask`), маска госномера (`platemask` + `vehicpart`) |

- В Telegram-поиске пользователь задаётся ID, @ником или телефоном — сервер разрешает его, как бот
  (`_parse_identifier`): ник → `search_ids.bynik`, телефон → raw-поиск по телефону и первый `tgids`.
  Если ник принадлежит нескольким ID, задача получает состояние `choose` и интерфейс предлагает выбрать.
- Маски проверяются до отправки так же, как в шлюзе (`checkGlobMask`, `checkVehicPart`); латиница
  в госномере заменяется кириллицей.
- История ведётся по каждому разделу отдельно и очищается кнопкой в блоке «История».
- Комментарии Telegram переносятся в досье заметками-цитатами (источник — ссылка на сообщение),
  найденные Telegram ID — атрибутами.
- **Сервер — посредник.** `search.start` вызывает шлюз с токеном пользователя. Если ответ пришёл
  в синхронное окно (2 с), задача сразу `done`. Иначе сохраняется `gatewayJobId`, и `search.job` опрашивает
  `job.results` при каждом запросе клиента (позже — SSE и фоновый опрос через pg-boss).
- **Снимки.** Шлюз хранит результат 1–15 минут, поэтому сайт сохраняет каждый результат в `search_snapshots`.
  Снимок, прикреплённый к досье или факту, становится постоянным (`pinned`); остальные чистятся через N дней.
- В интерфейсе любое найденное значение можно отметить для досье или сделать следующим шагом поиска
  (молния ⚡: телефон → поиск по телефону и т. д.). Перенос в досье создаёт атрибуты с источником
  `search:<snapshotId>` и элемент «снимок поиска».

## 6. Досье

- Виды: **персона** и **группа лиц**. Группа ссылается на досье участников, а не копирует их.
- Элементы досье — `attribute | link | media | note | snapshot` (discriminated union в `@ft/shared`).
  Порядок задаётся `position`, медиа переставляются перетаскиванием.
- **Видимость досье: только `private | shared`.** Публичных досье нет: в них персональные данные из утечек.
- Сводка и заметки хранятся в Markdown. Упоминание: набрать `@` → выбрать досье → в текст вставляется
  обычная ссылка `[@Название](/dossiers/<id>)`. Свой синтаксис не нужен, текст читается где угодно.
- **Медиа (план):** presigned PUT в S3 → запись `media` → задача pg-boss: превью (`sharp`), sha256
  (дедупликация), EXIF/GPS сохраняется как улика. В прототипе файл встраивается как data URL.

## 7. Расследования

- **Связи** — граф React Flow. Узлы: персона, организация, событие, место, объект, документ.
  Узел-персона ссылается на досье (двойной клик открывает его). Связь хранит тип (`руководит`, `знакомы`…),
  пояснение, достоверность и подтверждающие факты. Стиль линии зависит от достоверности:
  сплошная — подтверждено, пунктир — сомнительно.
- Граф сохраняется **целиком** с задержкой 1,2 с после последней правки, с номером версии
  (оптимистичная блокировка: при конфликте сервер отвечает `CONFLICT`, клиент перечитывает данные).
  Для совместной работы в реальном времени позже подключить Yjs + Hocuspocus. Модель данных менять не придётся.
- **Факты** — хронология. Каждый факт: Markdown-текст, дата, источники с оценкой, привязка к узлам.
- **Гипотезы** — упрощённый ACH (анализ конкурирующих гипотез): каждый факт помечается как
  «подкрепляет» или «противоречит», статус: открыта → подкреплена → подтверждена / опровергнута.
- Видимость: `private | shared | public`. Публичное расследование открывается **без входа**, но
  сервер скрывает список доступов и ссылки на досье, которые читатель не может открыть (`present()`).

## 8. Оценка источников

У каждого атрибута, заметки, медиа и факта есть `source`: тип (`search`, `url`, `humint`, `document`,
`manual`), ссылка или псевдоним источника и оценка по **системе Адмиралтейства (NATO)**:
надёжность источника **A–F** и достоверность сведений **1–6**. В интерфейсе это бейдж `B2`
с цветом и подсказкой. Стандарт HUMINT-аналитики позволяет отделять проверенное от слухов.

## 9. Доступ

- Роли: `owner` · `editor` · `viewer`. Поделиться можно по Telegram `@username`. Получатель должен
  хотя бы раз войти на сайт.
- Все проверки прав — в `apps/server/src/authz.ts` (`can(user, 'read'|'edit'|'manage', obj)`).
  Чужой недоступный объект неотличим от несуществующего (`NOT_FOUND`).
- `manage` (видимость, доступы, удаление) — только владелец.
- План: RLS в Postgres как второй рубеж; таблица `audit_log` для поисков и открытия чужих объектов.

## 10. Модель данных

См. `packages/db/src/schema.ts`. Основное:

```
users(id, tg_id, display_name, username, api_token_enc)      sessions(id_hash, user_id, expires_at)
dossiers(id, owner_id, kind, title, summary_md, tags, visibility, version, search_tsv)
dossier_members(group_id, member_id)                          dossier_items(id, dossier_id, type, data jsonb, source jsonb, position)
media(id, owner_id, s3_key, thumb_key, sha256, exif)          search_snapshots(id, user_id, kind, query, deep, result jsonb, pinned)
investigations(id, owner_id, title, description_md, visibility, public_slug, version)
nodes(id, investigation_id, type, label, dossier_id, props, x, y)   edges(id, source_id, target_id, relation, credibility)
facts(id, investigation_id, text_md, occurred_at, sources)    fact_links(fact_id, node_id | edge_id)
hypotheses(id, investigation_id, title, status)               hypothesis_evidence(hypothesis_id, fact_id, stance)
shares(object_type, object_id, user_id, role)                 revisions(object_type, object_id, version, diff)   audit_log(...)
```

JSONB — для гибких частей (тело элемента досье, источники, props узла); то, по чему ищут
и фильтруют, — в колонках. Поиск по своим досье: `tsvector('russian')` + `pg_trgm`.

## 11. Безопасность

- `noindex, nofollow` на всём сайте; публичные расследования открываются только по ссылке.
- Cookie: httpOnly, Secure, SameSite=Lax, подписанная. tRPC-мутации идут POST с JSON, а CORS закрыт:
  фронт и API на одном origin.
- Ограничения ввода — Zod-схемы (длины, количество узлов графа ≤ 2000, связей ≤ 5000).
- (план) Rate-limit на `auth.start` и `search.start` (`@fastify/rate-limit`), поверх троттлинга шлюза.
- Токен шлюза, ключ шифрования, `X-Site-Key`, секрет cookie — только из env.

## 12. Развёртывание (план)

Docker Compose: `caddy` (TLS, статика `apps/web/dist`, прокси `/trpc` → server) + `server` + `minio`.
Postgres — существующий кластер, отдельная база `foottracker` и отдельная роль.

## 13. Дорожная карта

1. ✅ Каркас, архитектура, интерфейс на in-memory данных.
2. В боте: `/api/site/*` + `/start login_` + таблица `site_login_requests`.
3. `adapters/bot-http`, `adapters/gateway-http` — реальный вход и поиск.
4. `adapters/postgres` + миграции drizzle-kit; снимки поиска в БД.
5. S3 + pg-boss: загрузка медиа, превью, EXIF.
6. SSE для статуса поиска и уведомлений, история правок (`revisions`), аудит.
7. Совместное редактирование графа (Yjs), хронология событий (timeline), экспорт отчёта (PDF/HTML).
