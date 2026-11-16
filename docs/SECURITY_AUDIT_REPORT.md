# Комплексный аудит безопасности: RuLeaks.Следопыт (RuLeaksFoottracker)

**Дата проведения:** Ноябрь 2026 г.  
**Объект аудита:** [D:\JSProjs\RuLeaksFoottracker\](file:///D:/JSProjs/RuLeaksFoottracker/)  
**Стек:** Fastify 5, tRPC 11, React 19, Vite 8, PostgreSQL (node-postgres / Drizzle), pdfmake, Zip.js  

---

## 1. Сводная матрица результатов

| Модуль / Вектор | Оценка риска | Ключевой статус |
|---|---|---|
| **1. Аутентификация и сессии** | 🟡 Средний | Сессии защищены HMAC и хешированием в БД; ссылки входа зависят от in-memory состояния; риск обхода лимита пароля при неверном проксировании. |
| **2. Авторизация и доступ (BACS / IDOR)** | 🟢 Низкий | Высокое качество реализации: строгая изоляция в [authz.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/authz.ts), валидация всех мутаций, отсутствие утечки существования чужих ID. |
| **3. Сетевая безопасность и SSRF** | 🟡 Средний | В [pages/outbound.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/pages/outbound.ts) присутствует теоретический риск DNS Rebinding (TOCTOU между `lookup` и `fetch`). |
| **4. Обработка файлов и документов (PDF/XLSX/ZIP)** | 🟢 Низкий | Отличная изоляция: `pdfmake` в worker_threads с запретом внешних URL; XLSX защищен от Formula Injection; ZIP без записи на диск. |
| **5. Безопасность БД и SQL** | 🟢 Низкий | Параметризованные запросы (`$1`, `$2`), безопасная конкатенация мета-полей; БД бота опрашивается только на чтение. |
| **6. Защита API и HTTP-заголовки** | 🟡 Средний | Отсутствует глобальный Helmet/CSP и clickjacking-защита на уровне сервера; cookie защищены флагами `HttpOnly`, `SameSite=Lax`, `Signed`. |
| **7. Зависимости (Supply Chain)** | 🟡 Средний | 6 уязвимостей уровня Moderate в транзитивных зависимостях (`glob`, `minimatch`, `postcss-selector-parser`). |

---

## 2. Детальный разбор по модулям

### Модуль 1: Аутентификация и сессии

#### 1.1. In-Memory хранение использованных ссылок входа
- **Файл:** [apps/server/src/adapters/login-link.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/adapters/login-link.ts#L44-L67)
- **Механика:**  
  Одноразовые ссылки входа проверяются через HMAC-SHA256, а использованные токены сохраняются в памяти процесса:
  ```ts
  const used = new Map<string, number>();
  ```
- **Риск:**  
  1. При перезапуске сервера список `used` очищается, что позволяет повторно использовать ссылку до истечения её `ttlMs`.  
  2. При горизонтальном масштабировании (несколько инстансов приложения за балансировщиком) ссылка, использованная на узле А, может быть повторно активирована на узле Б.
- **Рекомендация:**  
  Перенести хранение использованных токенов/nonce в таблицу PostgreSQL `used_login_links (token_hash, expires_at)` с удалением по истечении времени.

#### 1.2. Ограничение попыток ввода пароля и спуфинг IP
- **Файл:** [apps/server/src/routers/auth.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/routers/auth.ts#L35-L51)
- **Механика:**  
  Лимит попыток ввода пароля (`MAX_FAILS = 5`) привязан к `ctx.req.ip`. При установке флага `[server] trust-proxy = true` Fastify доверяет заголовку `X-Forwarded-For`.
- **Риск:**  
  1. Если перед сервером отсутствует обратный прокси, который гарантированно затирает входящий `X-Forwarded-For`, атакующий может подменять заголовок на каждом запросе и бесконечно брутфорсить пароль.
  2. В объекте `fails = new Map<string, number[]>()` удаление старых записей происходит только при повторном запросе с *того же самого IP*. Атака перебором с множества случайных IP приведёт к неконтролируемому расходу оперативной памяти (Memory Leak / DoS).
- **Рекомендация:**  
  - Реализовать периодический фоновый вызов `sweep()` по таймеру для очистки устаревших IP из `fails`.
  - Добавить в документацию и валидатор конфигурации строгое требование: `trust-proxy = true` разрешен только при наличии доверенной сети прокси.

---

### Модуль 2: Авторизация и разграничение доступа (BACS / IDOR)

- **Файлы:** [apps/server/src/authz.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/authz.ts), [routers/dossiers.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/routers/dossiers.ts), [routers/investigations.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/routers/investigations.ts)
- **Анализ:**  
  - Архитектура контроля доступа реализована образцово. Все запросы к ресурсам используют централизованную функцию `can(userId, action, obj)` с ролями `owner`, `editor`, `viewer`.
  - Попытка доступа к чужому недоступному ресурсу возвращает `NOT_FOUND` вместо `FORBIDDEN`, что исключает возможность зондирования существующих UUID (ID enumeration).
  - При сохранении связей и графов ([investigations.ts#L70-L86](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/routers/investigations.ts#L70-L86)) строго проверяется, что пользователь имеет право на чтение привязываемых досье. Чужие привязки не затираются и скрываются от редактора.

---

### Модуль 3: Сетевая безопасность и SSRF (Server-Side Request Forgery)

#### 3.1. Time-Of-Check to Time-Of-Use (DNS Rebinding) в `outbound.ts`
- **Файл:** [apps/server/src/pages/outbound.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/pages/outbound.ts#L32-L73)
- **Механика:**  
  Перед выполнением сетевого запроса к сайту вызывается `assertPublic(current)`:
  ```ts
  addrs = await lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new OutboundBlocked(...);
  ...
  const res = await fetch(current, { ... });
  ```
- **Риск:**  
  `dns.lookup` разрешает домен один раз. После этого глобальный `fetch` производит свой собственный DNS-запрос для открытия соединения. Домен с TTL=0 может вернуть белый IP при первом вызове и `127.0.0.1` или cloud metadata `169.254.169.254` при втором вызове (`fetch`), обойдя проверку приватных IP.
- **Рекомендация:**  
  Выполнять обращение непосредственно к предварительно разрешенному IP-адресу, передавая исходный домен в заголовке `Host` и настраивая `servername` для TLS SNI, либо использовать специализированный агент (`undici.Agent` с кастомным резолвером коннектора).

#### 3.2. Расширение диапазона блокируемых IP
- **Файл:** [apps/server/src/pages/outbound.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/pages/outbound.ts#L15-L27)
- **Рекомендация:**  
  Дополнить фильтрацию приватных IPv4 адресов диапазонами `198.18.0.0/15` (тестирование), `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` (документация/TEST-NET), `240.0.0.0/4` (reserved) и широковещательными адресами.

---

### Модуль 4: Обработка файлов и генерация документов

- **Файлы:** [apps/server/src/pdf/worker.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/pdf/worker.ts), [apps/server/src/xlsx/xlsx.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/xlsx/xlsx.ts), [apps/server/src/export/read.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/export/read.ts)
- **Анализ:**  
  - **PDF:** Использование `pdfmake` в выделенном worker thread с жесткими ограничениями:
    ```ts
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((p) => resolve(p).startsWith(FONT_DIR) || resolve(p).startsWith(EMOJI_DIR));
    ```
    Это полностью исключает утечку локальных файлов через генерацию отчетов.
  - **XLSX:** Ячейки записываются в формате inline-строк (`t="inlineStr"`), предотвращая выполнение формул (`=cmd`, `@SUM` и др.) в офисных пакетах.
  - **ZIP-импорт:** Обработка архива происходит целиком в памяти без записи файлов на диск (устранена угроза Zip Slip).
  - **Замечание по DoS (Zip Bomb):** В [read.ts#L31](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/export/read.ts#L31) лимит распакованного объема установлен в `MAX_UNPACKED = 1 ГБ`. Для процесса Node.js распаковка 1 ГБ данных в память может привести к Out-Of-Memory. Рекомендуется понизить порог до 128–256 МБ.

---

### Модуль 5: Базы данных и SQL-инъекции

- **Файлы:** [apps/server/src/adapters/postgres/](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/adapters/postgres/)
- **Анализ:**  
  - Все пользовательские входные данные передаются через плейсхолдеры параметризованных запросов (`$1`, `$2`, `$3` в `node-postgres`).
  - Составные запросы динамических обновлений (`UPDATE ... SET`) формируют список колонок исключительно из предопределенных статических литералов.
  - Взаимодействие с базой данных Telegram-бота изолировано: используются только операции чтения (`SELECT`). Рекомендуется убедиться, что учетная запись PostgreSQL для бота на уровне прав СУБД имеет только грант `SELECT`.

---

### Модуль 6: Защита API, заголовки и фронтенд

#### 6.1. Отсутствие HTTP-заголовков безопасности
- **Файл:** [apps/server/src/index.ts](file:///D:/JSProjs/RuLeaksFoottracker/apps/server/src/index.ts)
- **Риск:**  
  На уровне Fastify не подключен плагин `@fastify/helmet`. Ответы API и статических файлов не содержат:
  - `Content-Security-Policy` (CSP)
  - `X-Frame-Options: DENY` (защита от встраивания в iframe / Clickjacking)
  - `X-Content-Type-Options: nosniff` (отсутствует глобально, задан только в `/scans`)
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **Рекомендация:**  
  Подключить `@fastify/helmet` с базовым профилем безопасности.

#### 6.2. Рендеринг пользовательского контента (XSS)
- **Файл:** [apps/web/src/components/Markdown.tsx](file:///D:/JSProjs/RuLeaksFoottracker/apps/web/src/components/Markdown.tsx)
- **Анализ:**  
  - `dangerouslySetInnerHTML` в веб-приложении отсутствует.
  - `ReactMarkdown` используется без плагина `rehype-raw`, что гарантирует экранирование любого HTML внутри Markdown.
  - Ссылки проверяются: внутренние ссылки используют `<Link>`, внешние содержат `rel="noreferrer noopener"`.

---

### Модуль 7: Зависимости и цепочка поставок (npm audit)

- **Обнаружено:** 6 уязвимостей уровня Moderate.
  - `@fastify/static` (транзитивно через `glob` / `minimatch` — GHSA-3g3m-2fjr-6pw4).
  - `postcss-selector-parser` (через `@tailwindcss/typography` — ReDoS/CPU exhaustion GHSA-rj75-hqrm-r3gf).
- **Рекомендация:**  
  Выполнить обновление пакетов в корне монорепозитория:
  ```bash
  npm update @fastify/static
  npm update @tailwindcss/typography
  ```

---

## 3. Приоритетный план устранения

1. **[P1] Внедрить очистку памяти `fails` в `auth.ts`** — предотвратит утечку памяти при попытках перебора паролей.
2. **[P2] Защитить `outbound.ts` от DNS Rebinding** — устранить TOCTOU при проверке публичных IP-адресов.
3. **[P3] Подключить `@fastify/helmet`** — настроить заголовки защиты от Clickjacking и MIME-sniffing.
4. **[P4] Снизить `MAX_UNPACKED` в `read.ts`** — ограничить объем распаковки ZIP до 128 МБ для исключения OOM.
5. **[P5] Обновить уязвимые npm-пакеты** — устранить замечания `npm audit`.
