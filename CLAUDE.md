# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**RuLeaks.Следопыт** — a Russian-language HUMINT/OSINT web workbench: search through the RuLeaks API, dossiers on
persons/groups, and investigations (relationship graph, facts, hypotheses). Login is only via the RuLeaks Telegram
bot and access follows the bot's subscription. All user-facing strings are Russian; code comments are mostly Russian.
Design rationale lives in `ARCHITECTURE.md` (keep it in sync when an architectural decision changes).

Related projects (separate repos, read them when integrating):
- `D:\GoProjs\dsstalker-api-gate` — Go API gateway the search talks to (its `CLAUDE.md` documents the job model, throttle, error codes).
- `D:\PyProjs\pyruleaks-bot` — Python Telegram bot; owns `users`/`tokens`/subscriptions (`app/db/tokens_repository.py`, `app/api/endpoints.py`, `app/api/client.py`).
- `D:\HtmlProjs\ruleaks-link` — landing page the visual style is taken from.

## Commands

```bash
npm install
npm run dev            # server (tsx watch, :3001) + web (Vite, :5173, proxies /trpc, /geo and /scans → server); same as run-devel.cmd
npm run typecheck      # tsc --noEmit in every workspace — the only automated check; there are no tests or linter yet
npm run build          # web production build (apps/web/dist)
npm run typecheck -w @ft/server   # one workspace
npm run db -- status | up [N] | down [N] | create <name> | manual <file>   # DB migrations against [project-db]
npm run scans-check -- <uuid>   # scanstore → app chain without browser/nginx (meta, image, sha256, /scans route)
                       # db-upgrade.cmd = `up` + `status` (like `alembic upgrade head`)
```

Migrations: never edit an applied file in `packages/db/migrations`; add a new one (`npm run db -- create …`). The user
applies schema changes to the production DB themselves — generate SQL with `npm run db -- manual <file>` and do not run
DDL through the `ruleaksfoottracker-prod` MCP server unless asked (read-only queries are fine).

Vite uses `strictPort` and the server exits on `EADDRINUSE`: a second `npm run dev` fails instead of silently moving
ports. `.claude/launch.json` defines the `foottracker` preview (runs `npm run dev`); stop it before the user runs their own.

The in-memory stores reset on every server restart, and `tsx watch` restarts on any server-file save — sessions are
lost too, so re-login after editing server code.

Git: commit on the current branch (`main`); do not create branches unless asked. `2_git_pull.cmd`/`3_git_push.cmd`
read the GitHub token from the gitignored `gittoken` file. Never stage `config.ini`, `.mcp.json` or `gittoken` — they
hold live credentials (all three are gitignored; `.mcp.json` was purged from history once already).

## Configuration

One `config.ini` at the repo root (template with comments: `config.example.ini`), loaded by `packages/config`
(`loadConfig()`), which both the server and `vite.config.ts` use. It walks up from cwd to find the file; `FT_CONFIG`
overrides the path, and any key can be overridden by `FT_<SECTION>_<KEY>` env vars (`[bot-db] password` →
`FT_BOT_DB_PASSWORD`). Values are Zod-validated (ini turns `true/false` into booleans — `str()`/`bool()` coerce);
unknown keys are logged as warnings.

`[config] auth` picks the login mode: `bot-db` (default — login via the bot, subscription and API token from `[bot-db]`),
`none` (solo, no login — every request runs as the single solo user; loopback only) or `password-sha256` (one user,
`auth.password` checks sha256 against `password-sha256`, per-IP fail limit; the hash is mixed into the cookie-signing
secret so a password change ends all sessions, and only the solo user's sessions are accepted). In both solo modes
`SoloBridge` (`adapters/solo.ts`) replaces the bot: access is always active/unlimited, the API token is `[api] token`,
`[bot-db]`/`dev-login` are forced off, and `deps.soloUserId` is upserted at startup from `user-tg-id`/`user-name`.
Bot-only procedures (`start`/`status`/`devConfirm`) answer `NOT_FOUND`; the web reads `auth.mode`.
`npm run password-hash` asks for the password and writes the hash into `config.ini` line by line (comments kept;
offers to switch `auth`; creates the file from the template if missing; `-- --print` only prints).

Each data source is switched independently by its `enabled` flag:

| Section | `enabled = true` | `enabled = false` |
|---|---|---|
| `[project-db]` | `adapters/postgres/*`: users, sessions, search history, dossiers, investigations in PostgreSQL; startup fails if any migration is unapplied | in-memory store with demo seed data |
| `[bot-db]` | `BotDbBridge`: subscription + API token read from the bot's DB (read-only pool) | `MemoryBotBridge` with three demo profiles |
| `[api]` | `HttpGateway`: real dsstalker-api-gate | `MemoryGateway`: fake deterministic results |
| `[scanstore-api]` | `HttpScanStore`: document scans from scanstore-api-gate | `deps.scans = null`, scans are not shown |

`[config] geo-search` (default `false`) switches the «Поиск по геоданным» section; `[geo-search]` configures its map
(see «Geo search» below). `[config] pages-search` (default `true`) switches «Поиск личных страниц»; `[pages-search]`
sets the per-site timeout and concurrency (see «Personal pages search» below).

`[server] trust-proxy` (default `false`) makes Fastify take the client address from `X-Forwarded-For`; production runs behind
nginx/Cloudflare, so without it `req.ip` is the proxy and the per-IP password rate limit is shared by everyone.

`[telegram] login-secret` (shared with the bot, ≥32 chars) enables login by a signed one-time link from the bot:
`/login?tg=…&ts=…&n=…&sig=…[&name=…][&nick=…]`, `sig = base64url(HMAC-SHA256(secret, "tg\nts\nn\nname\nnick"))`,
valid `login-link-ttl-sec` (180 s), single use (`adapters/login-link.ts`, `auth.loginWithLink`, web `/login`).
Exact format and a Python reference are in ARCHITECTURE.md §4.0; `npm run login-link -- <tgId>` makes a test link.

`[server] dev-login` (allowed only when `host` is loopback; bot-db mode only) enables login without the bot: demo-profile buttons, or a
Telegram-ID field when `[bot-db]` is real, plus a «Войти как …» button when `[config] bot-db-dev-quick-login-tg-id` is
set (the ID comes from the server via `auth.devLogin`, never from the bundle).

## Architecture

npm workspaces, all TypeScript ESM consumed as source (no build step for packages; imports use `.ts` extensions):

- `packages/shared` (`@ft/shared`) — Zod domain schemas (`domain.ts`) shared by server input validation and web types;
  the search catalogs (`search.ts`) mirroring the bot's endpoint paths and param names, plus gateway response shapes.
- `packages/config` (`@ft/config`) — config loader described above.
- `packages/db` (`@ft/db`) — site database (PostgreSQL 18 on a remote LXC host): SQL migrations in `migrations/`
  (node-pg-migrate, the schema's source of truth — see `packages/db/README.md`), `src/pg.ts` connection helper shared
  with the server (`@ft/db/pg`), `sql/` one-off scripts (role/database creation, generated manual-apply copy of the
  first migration — pure SQL, they get pasted into a remote psql, so no psql meta-commands), and the tuned
  `config/postgresql.conf` (changed lines marked `# tuned:`).
- `apps/server` (`@ft/server`) — Fastify + tRPC 11 backend-for-frontend. The browser only ever talks to `/trpc`.
- `apps/web` (`@ft/web`) — React 19 SPA: Vite 8, TanStack Router (code-based routes in `src/router.tsx`) + Query,
  tRPC react-query client, Tailwind 4, React Flow (graph), TipTap 3 (Markdown editor), dnd-kit. The web imports only
  the *type* `AppRouter` from `@ft/server/router`.

### Server: ports and adapters

Routers (`src/routers/*`) depend only on interfaces in `src/ports.ts` (`BotBridge`, `SearchGateway`, `*Repo`). Concrete
adapters are chosen in `src/deps.ts` from the config flags: `adapters/memory/*` (stores + `seed.ts` demo data, fake bot,
fake gateway), `adapters/botdb/bot.ts`, `adapters/http/gateway.ts`, `adapters/pg.ts` (pool with libpq-like `sslmode`,
`prefer` falls back to plain TCP), `adapters/login-requests.ts` (in-memory login nonces — will move to the bot DB).
Adding PostgreSQL storage means new repo adapters + a branch in `deps.ts`; routers and web stay unchanged.

- **Procedures** (`src/trpc.ts`): `publicProcedure` → `authedProcedure` (session cookie `ft_sid`, signed) →
  `activeProcedure` (subscription active). Expired subscription = read-only site: reads work, search and every
  mutation throw `FORBIDDEN SUBSCRIPTION_INACTIVE`. Machine-readable error codes travel in the error `message`
  (`NO_SESSION`, `VERSION_CONFLICT`, `NO_RIGHTS`, …) and are mapped to Russian text in `apps/web/src/lib/errors.ts`.
  Unhandled errors leave the server as `INTERNAL` with no stack (`errorFormatter` in `trpc.ts`); details go to the log.
  The bot's subscription answer is cached 60 s (`loadAccess`).
- **Authorization** happens only in `src/authz.ts` (`can()`/`roleOf()`: owner/editor/viewer from `ownerId`,
  `visibility`, `shares`). Routers load objects through a local `load(ctx, id, action)`; an object the user may not read
  is reported as `NOT_FOUND`. When only the right to read plus title/cover is needed (group members, graph nodes,
  relations, export/PDF pre-checks), use `dossiers.heads(ids)` (`DossierHead`, one query) instead of a full `get()`
  per dossier. Dossiers are only `private | shared` (never public — they hold leaked personal data);
  investigations may be `public` and `investigations.get` is a public procedure — `present()` strips shares and links to
  dossiers the viewer cannot read.
- **Optimistic locking**: dossiers/investigations carry `version`; repos throw `VersionConflict` → tRPC `CONFLICT`.
  The graph editor saves the whole graph (`saveGraph`) debounced, with the version.

### PostgreSQL store

`adapters/postgres/*` implement the repo ports against the schema in `packages/db/migrations`. Things that are not
obvious from the schema:
- All ids are UUID v7: `newId()` from `@ft/shared` is used by routers *and* by the browser (graph nodes/edges are
  created client-side), so the DB never assigns ids the client already references. Non-uuid ids from requests are
  treated as "not found" (`mustUuid`) or rejected as `BAD_ID` (`newObjectId` → tRPC `BAD_REQUEST`).
- Every mutation of a dossier/investigation goes through `lockAndBump` (row lock + `version + 1`, optional expected
  version → `VersionConflict`); child tables are rewritten inside the same transaction.
- `saveGraph` upserts nodes/edges by id (ON CONFLICT … WHERE same investigation) and deletes the ones missing from the
  payload; facts, edge↔fact and hypothesis evidence links are re-inserted only for objects of the same investigation.
- jsonb params must be `JSON.stringify`-ed (`json()`), otherwise node-postgres turns JS arrays into PG arrays.
- Media: there is no file storage yet; the image stays in the item's `data.url` and a `media` row with the sha256 of
  that string satisfies the FK (`storage_key = inline/<owner>/<sha>`). Cover = `cover_media_id`.
- Dossiers/investigations are soft-deleted (`deleted_at`); search history "clear" sets `hidden_at`, and a search that
  was attached to a dossier as a snapshot is `pinned`.
- Repos that write `created_by`/`granted_by` take an `actorId` argument (memory adapters ignore it).
- Tags: `tag_texts` (shared, uppercase) → `tags` (per-user dictionary entry: text + color) → `dossier_tags` /
  `investigation_tags`. Objects carry `Tag[]` on read and take `patch.tagIds` on update; `checkTagIds`
  (`routers/tags.ts`) lets an editor add only tags from their own dictionary. UI: `components/Tags.tsx`.
- Person relations: `relation_texts` (shared, lowercase) → `relation_types` (`owner_id NULL` = predefined) →
  `dossier_relations` (from → to, type, per-side `from_note`/`to_note`; shown on both dossiers, each side sees and
  edits its own note). Own router `routers/relations.ts`, not part of
  `Dossier`; `Conflict(code)` from `ports.ts` maps to tRPC `CONFLICT` with that code.

### Export / import file

`dossiers.exportFile` / `investigations.exportFile` (authed, read access) → `apps/server/src/export/build.ts` builds an
encrypted ZIP (`.ftx`, returned as base64; the web downloads it from `components/ExportDialog.tsx`). The format is the
Zod schemas in `packages/shared/src/export.ts`: unencrypted `version.v1`, everything else AES-256 with a password
derived from the user's export password (empty if none) by `export/password.ts`. No DB ids in the file — local keys
(`d1`, `n1`, `s1`…), tags/relation types as text, data-URL images as `media/` files, Markdown dossier links as `ft:d1`.
The salt/iterations and the JSON shape are part of the format: changing them means a new `version.vN`, not an edit
of v1. Dossiers/investigations carry a cross-database `uid` (column, not the PK) written to the file.
Import (`routers/imports.ts`: `upload` chunks → `inspect` → `commit`; files wait in server memory, `export/uploads.ts`)
matches objects by `uid` among the importer's own live objects and fully overwrites them (`replaceContent` in the
repos; the dialog lists them first), otherwise creates private copies with that `uid`. tRPC reserves procedure names
like `apply`/`call`. Details: ARCHITECTURE.md §7.1.

### PDF report

`dossiers.exportPdf` / `investigations.exportPdf` (authed, read access) → `apps/server/src/pdf/report.ts` builds the
pdfmake `Content[]`; the layout itself runs in a worker thread (`pdf/worker.ts`, driven by `pdf/render.ts`: one worker
per process, jobs queued, stopped after 5 min idle, 10 min per job) because pdfmake lays out synchronously and a big
report would stall every request. Content crosses to the worker via structuredClone, so it must contain no functions:
table layouts are referenced by name and registered from `pdf/theme.ts` (`addTableLayouts`); footer, styles and
`pageBreakBefore` live in the worker. pdfmake is loaded there via `createRequire` with the Roboto TTFs shipped in the
`pdfmake` package (the CJS module exports an instance, so ESM named imports don't work); `pdf/markdown.ts` (marked lexer
→ pdfmake blocks), `pdf/graph.ts` (graph as SVG from saved node positions). pdfmake's URL and local-file access is
locked down; only data-URL JPEG/PNG/SVG images render.
Optional password = native PDF AES-256 encryption. The web uses the same `ExportDialog` with `format="pdf"`.
`search.exportTgPdf` (`pdf/tgReport.ts`) builds a report from a saved Telegram search snapshot (all or only the selected
messages, at most `TG_PDF_MAX` = 5000), like the bot's HTML reports. `search.exportAttrPdf` / `search.exportAttrXlsx` export an attribute/geo search result (only the marked values if any,
narrowed by the active attribute filter; `export/attrPick.ts`): `pdf/attrReport.ts` mirrors the result page and adds
print/copy restrictions, orientation, watermark (`PdfJob.permissions` — restrictions need encryption, so they are set
under a random owner password even without an open password), `xlsx/` is an own minimal OOXML writer (rows / columns
layout; ARCHITECTURE.md §7.3).
Emoji render with monochrome Noto Emoji
(`@fontsource/noto-emoji`, the WOFF file — pdfkit fails on WOFF2) via `pdf/emoji.ts`; the dossier report's `clean()`
strips emoji instead. Keep messages longer than a page breakable: an `unbreakable` block taller than a page is lost.

### Search (bot parity)

Three sections mirror the bot's menu: `attr` (`/search`, `/deepsearch`), `tg` (`/tgsearch`, Telegram comments
service `/tgcmnts/v1/*`), `fuzzy` (`/regsearch`, glob masks). `routers/search.ts` builds the gateway path/params from
the `@ft/shared` catalogs, resolves a Telegram user from ID / @nick (`search_ids.bynik`; several IDs → job state
`choose`) / phone (raw phone search → first `tgids`), and stores each job as a snapshot (`SearchJob`, with per-section
history and `clearHistory`). The gateway keeps results only minutes, hence snapshots.

Gateway contract that `HttpGateway` reproduces (see the gateway's CLAUDE.md and the bot's `client.py`/`overload.py`):
`Authorization` is the user's raw UUID token (no "Bearer"); business errors come as HTTP 200 `{"error":{"code","text"}}`
(5 overload → retry ≤10 s, 6 DB maintenance, 8 job result expired), 401 = token rejected, 503 = tokens DB down; slow
searches answer `job.state = "need-db-request"` and are polled via `/<service>/v1/job.results?jobid=`. The gateway
throttles each token to one API request per `min-msec-between-reqs` (1 s) and each job poll to once per second —
the client queues requests per token and skips polls that are too early instead of getting refused.

Job progress is advanced only when the browser polls `search.job` (TanStack Query, also in background tabs); a job
nobody polls stays `running` until `[api] job-timeout-sec`. A server-side poller is planned.

«Дополнительный поиск вторым шагом» (attr, exclusive with deep; `params.step2` = fields to take, `params.step2by` =
kinds to search by): after the raw search, `search/step2.ts` runs up to `STEP2_MAX_SEARCHES` raw searches (round-robin
over kinds) by the found INN/SNILS/passport/foreign passport/birth certificate/email/Telegram ID/military number/link
(`STEP2_SOURCES`; the gateway has no OGRNIP search) in the background — not driven by polls — and adds the chosen fields of their tuples to
the step-1 tuple that held the identifier (`LeakTuple.step2`: `{f, v, by}`; the step-2 leak name is dropped). UI, PDF
and Excel show them in the same record below a dashed rule as «ТЕЛЕФОН² (найден по паспорту)». The job stays `running` with no `gatewayJobId`
while `result.step2` records progress; a poll after a server restart resumes it (ARCHITECTURE.md §5.0).

### Geo search

`/search/geo` (`features/search/GeoSearchPage.tsx` + `GeoPicker.tsx`): MapLibre GL map with a draggable marker
(Latitude/Longitude fields) and a radius circle in km. Search is its own history section `geo` (DB enum value added
by a migration) → `raw_search.byloc_radius` (`lat`, `lon`, `radius` in whole metres ≤ 50 000); the answer has the raw
attribute-search shape and is rendered by `AttrSearchPage`'s exported `JobView`. Query text / `?q=` is
`lat, lon @metres` (the `geolocs` format, `geoQuery`/`parseGeoloc`). «Из ссылки» / pasting a map URL into a coordinate field
takes the point from a Google Maps (`!3d…!4d…` place, else `/@lat,lon` view centre), Yandex (`pt`/`ll`, lon first) or
OSM link (`features/search/mapLinks.ts`); short `maps.app.goo.gl` links carry no coordinates.
`geo.config` (`routers/geo.ts`) returns the map settings or `null` when `[config] geo-search` is off (the nav item
and the page hide). `[geo-search] tiles`: `raster` — public raster tiles (dev only), `pmtiles` — own Protomaps vector
tiles (`tools/geo/` builds the Europe+Russia extract, zoom ≤ 14). Local `pmtiles`/`assets` paths are served by the
server itself at `/geo/tiles.pmtiles` and `/geo/assets/*` behind the session (`geo-files.ts`; the browser reads the file
with Range requests); https URLs are fetched by the browser directly (dev). Vite proxies `/geo` like `/trpc`; the
production proxy must too. The MapLibre worker is wired via `?worker&url` + `setWorkerUrl` (its own `import.meta.url`
lookup breaks after Vite bundling). Map controls are restyled in `styles.css` under `.ft-map.maplibregl-map` (the
lazy chunk's CSS loads later, so equal-specificity selectors would lose).

### Personal pages search

`/search/pages` (`features/search/PagesSearchPage.tsx`): a nickname **or e-mail** → links to the person's pages and
registrations, a TypeScript port of three OSINT tools (`apps/server/src/pages/`). The query is parsed by
`parsePagesQuery` (`@ft/shared`): an e-mail is searched both as an e-mail and by the nickname taken from the part before
`@` (`user+tag@…` → `user`); anything else is a nickname.
- **By nickname** — [Sherlock](https://github.com/sherlock-project/sherlock). `sites.json` is Sherlock's `data.json`
  verbatim (MIT, `LICENSE.sherlock`; refresh `npm run pages-sites-update`), `checkSite` in `check.ts` is the per-site
  verdict (`errorType` message / status_code / response_url, `regexCheck`, `urlProbe`, WAF fingerprints) — keep in step
  with `sherlock.py`.
- **By e-mail** — [holehe](https://github.com/megadose/holehe) + [blackbird](https://github.com/p1ngul1n0/blackbird):
  probe a site's register / password-recovery endpoint and read whether the address is taken. `email-sites.json` is
  blackbird's `email-data.json` verbatim (refresh `npm run pages-email-update`); `email-sites.ts` parses it and appends
  a small code-defined `EXTRA` set of holehe-style checks (e.g. Mail.ru) that are not in blackbird. `checkEmailSite` in
  `check.ts` ports blackbird's verdict (`eCode`+`eString` = taken, `mCode`+`mString` = free, `inputOp` sha256,
  `preCheck` cookie) — this is also holehe's method. Adding more holehe modules = new entries in `EXTRA`.
  The placeholder is blackbird's `{account}` (not Sherlock's `{}`), substituted with context-aware encoding
  (`fillAccount`: percent-encoding in the URL and form bodies, JSON escaping in JSON bodies — `user+tag@…` must survive).
- **Per-site fixes** — `site-overrides.ts` (`SITE_OVERRIDES`, keyed by the `sites.json` name, applied in `allSites()`):
  `disabled` drops a closed site from the list, `patch` replaces `Site` fields, `notFoundMsg` / `claimedMsg` are body strings that turn a standard «найдено» into
  «нет» (the probe becomes GET), `verify` is an arbitrary check after a positive verdict. Add a problem site there
  instead of editing `sites.json` (it is overwritten by `pages-sites-update`); an override for an unknown name is
  logged at startup. Bot-protection pages are detected by `isWafChallenge` from headers too (`x-amzn-waf-action`,
  `cf-mitigated`), which also covers HEAD probes — 7Cups answers 202 + AWS WAF challenge for every nick.
  Probes that submit a real registration (password in the body) or password-recovery form are flagged `sideEffect`
  (`isSideEffect`) and skipped unless `[pages-search] side-effect-probes = true`: they can create an account on the
  target's address or notify them. All probe requests go through `pages/outbound.ts` (`outboundFetch`): redirects are
  followed manually (≤5 hops, 301/302/303 → GET) and every hop must be http(s) to a public address — literal IPs and
  DNS answers in loopback/private/link-local/CGNAT ranges are refused (`OutboundBlocked` → status `unknown`), so a site
  cannot bounce the server to localhost, the DB, scanstore or cloud metadata.

`jobs.ts` runs all checks for a query (nickname sites + e-mail sites) through `concurrency` workers; each `SiteResult`
carries `by: 'username' | 'email'`, shown in the UI as «по нику» / «по e-mail». Jobs live in server memory (one running
per user, `MAX_RUNNING` per process → `PAGES_BUSY`, finished jobs live an hour → the section's own «История», nothing in
the DB). The browser never talks to the sites (CORS); `pages.job` is polled every second while `running` and returns
only `found` until the job ends. `pages.config` is `null` when `[config] pages-search = false`. Verdicts are heuristic
(a site that answers 200 for any input gives a false «найдено»; WAF pages → «защита от ботов»), and the site lists age —
refresh them periodically. Found pages go to a dossier's «Соцсети и ссылки» via `AddPagesDialog` (the `by` reaches the
source note).

### Progress window

`components/ProgressDialog.tsx` is the modal for long processes (gauge, status line, elapsed time, «Отмена»; Esc =
cancel, no closing by clicking outside). Two ways to drive it: `<ProgressDialog>` with props when the state comes from a
polled server job (pages search), or `useProcess()` + `<ProcessDialog>` for browser-side async flows — `run(title, fn)`
shows the window for the promise, `p.set()` moves the bar, `p.signal` goes into tRPC calls via the vanilla client
(`utils.client.x.mutate(input, { signal })` — `useMutation` has no signal), cancel rejects with `ProcessCancelled`
(`isCancelled(e)` — don't toast it). Used by `ExportDialog` (file/PDF), `ImportDialog` (upload chunks are determinate,
inspect/commit indeterminate; commit is not cancellable) and `TgPdfDialog`.

### Document scans

Leak tuples carry `scans` — uuids in scanstore-api-gate (`D:\GoProjs\scanstore-api-gate`, API in its README; the
gateway answers them as `prm = 'scan'`). Not a `LEAK_FIELDS` attribute: «Поиск по атрибутам» shows them in a separate
box (`features/search/ScansBox.tsx`, thumbnails + full-screen viewer with ←/→, rotate, save to file, copy as PNG, save to a dossier's media via `SaveScanDialog.tsx` — data URL, album «Сканы документов», source `document` `scanstore:<uuid>`) and as a «Сканы документов» chip in the
field filter. The browser never talks to scanstore: `scan-files.ts` proxies `GET /scans/<uuid>` with the site's
`[scanstore-api] token` (session required, subscription not checked; ETag/304 passed through), `scans.config` /
`scans.meta` (`routers/scans.ts`, metadata without `metainfo`, cached forever — scans are immutable) give captions.
Vite proxies `/scans`; the production proxy must too. Every `/scans` request is logged as `scans <uuid> → <status> …` (401 reason, upstream error, bytes sent); a failed
thumbnail re-fetches its URL and shows the HTTP status/type. The startup log and `/health` carry the version and commit (`version.ts`).

### Bot DB access

`BotDbBridge` opens the pool with `default_transaction_read_only=on` and duplicates the bot's `access_error()` rules
(no token → «Токен не установлен», disabled token, unlimited, `users.subscribed_to`). On top of them
`tokens.forcefoottracker = true` (bot migration 033) gives full site access regardless of the subscription unless the
token is disabled (`Access.forced`, sidebar «● полный доступ»); the column is probed via `information_schema` and
rechecked every 5 min while absent, so the query works on a bot DB without the migration. Users are matched by
`users.provider = 'tg' AND provider_id = <chat id>`. Production login is the signed link the bot sends
(ARCHITECTURE.md §4.0; nothing in the bot DB). Planned (§4.1): the bot adds `site_login_requests` +
`site_user_access()` and confirms `/start login_<nonce>`, replacing dev-login and the duplicated rules.

### Web conventions

- Theme tokens are in `apps/web/src/styles.css` (`@theme`): black background, mint `#2EE0AC`, JetBrains Mono + Manrope;
  border radii are deliberately 3× smaller than Tailwind defaults. Shared primitives are in `src/components/ui.tsx`.
- Page containers are full-width with `pt-2.5 pl-6 pr-[30px]` (no centered max-width); the 10 px top padding puts the
  first line of the page title level with the visible top of the sidebar logo — keep it when adding a page.
- Markdown is the storage format for all long text; `@` in the TipTap editor inserts a plain link
  `[@Title](/dossiers/<id>)` rather than a custom node, so stored text stays portable.
- Every dossier item and fact carries a `source` with an Admiralty-code rating (reliability A–F, credibility 1–6),
  rendered by `SourceBadge`.
- Dialogs center without CSS transforms and editor popups are positioned relative to the editor wrapper: `fixed`
  positioning breaks inside ancestors with `transform`/`backdrop-filter`.
- URL-triggered searches use `useRunOnMount` (ref guard) — React StrictMode would otherwise start them twice.
- React Fast Refresh: a `.tsx` module exports only components (types are fine); hooks, helpers and constants go to a
  sibling `.ts` (`features/search/job.ts`, `selection.ts`, `foundScans.ts`, `components/process.ts`, `lib/listView.ts`…).
  Pages read route params with `useSearch({ from: '/search' })` / `useParams({ from: … })`, never by importing route
  objects from `router.tsx` (that cycle through `main.tsx`). Either mistake turns every edit into a full page reload,
  which also re-runs a search whose query is in the URL against the real gateway.
