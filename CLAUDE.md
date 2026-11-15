# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**RuLeaks.Следопыт** — a Russian-language HUMINT/OSINT web workbench: search through the RuLeaks API, dossiers on
persons/groups, and investigations (relationship graph, facts, hypotheses). Login is only via the RuLeaks Telegram
bot and access follows the bot's subscription. User-facing strings are written in Russian (the default
interface language) and translated to English by a dictionary (see «Interface language» below); code comments are mostly Russian.
Design rationale lives in `ARCHITECTURE.md` (keep it in sync when an architectural decision changes).

Related projects (separate repos, read them when integrating):
- `D:\GoProjs\dsstalker-api-gate` — Go API gateway the search talks to (its `CLAUDE.md` documents the job model, throttle, error codes).
- `D:\PyProjs\pyruleaks-bot` — Python Telegram bot; owns `users`/`tokens`/subscriptions (`app/db/tokens_repository.py`, `app/api/endpoints.py`, `app/api/client.py`).
- `D:\HtmlProjs\ruleaks-link` — landing page the visual style is taken from.

## Commands

```bash
npm install
npm run dev            # server (tsx watch, :3001) + web (Vite, :5173, proxies /trpc, /geo and /scans → server); same as run-devel.cmd
npm run typecheck      # tsc --noEmit in every workspace; there are no tests or linter yet
npm run i18n-check [-- <path part>]   # every Russian UI string has an English translation and goes through t()
npm run build          # web production build (apps/web/dist)
npm run typecheck -w @ft/server   # one workspace
npm run db -- status | up [N] | down [N] | create <name> | manual <file>   # DB migrations against [project-db]
npm run scans-check -- <uuid>   # scanstore → app chain without browser/nginx (meta, image, sha256, /scans route)
npm run google-login [-- <token>]   # master token of the service Google account → [google-search] master-token
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
`auth.password` checks sha256 against `password-sha256`, fail limit per IP (5/min) and per process (60/min, so rotating
or spoofed addresses don't help; it also bounds the `fails` map, swept by a timer); the hash is mixed into the cookie-signing
secret so a password change ends all sessions, and only the solo user's sessions are accepted). In both solo modes
`SoloBridge` (`adapters/solo.ts`) replaces the bot: access is always active/unlimited, the API token is `[api] token`,
`[bot-db]`/`dev-login` are forced off, and `deps.soloUserId` is upserted at startup from `user-tg-id`/`user-name`.
Bot-only procedures (`start`/`status`/`devConfirm`) answer `NOT_FOUND`; the web reads `auth.mode`.
`npm run password-hash` asks for the password and writes the hash into `config.ini` line by line (comments kept;
offers to switch `auth`; creates the file from the template if missing; `-- --print` only prints). The line-by-line
ini editing is `packages/config/src/ini-edit.ts` (`setIniValue` / `getIniValue`), shared with `npm run google-login`.

Each data source is switched independently by its `enabled` flag:

| Section | `enabled = true` | `enabled = false` |
|---|---|---|
| `[project-db]` | `adapters/postgres/*`: users, sessions, search history, dossiers, investigations in PostgreSQL; startup fails if any migration is unapplied | in-memory store with demo seed data |
| `[bot-db]` | `BotDbBridge`: subscription + API token read from the bot's DB (read-only pool) | `MemoryBotBridge` with three demo profiles |
| `[api]` | `HttpGateway`: real dsstalker-api-gate | `MemoryGateway`: fake deterministic results |
| `[scanstore-api]` | `HttpScanStore`: document scans from scanstore-api-gate | `deps.scans = null`, scans are not shown |

`[config] geo-search` (default `false`) switches the «Поиск по геоданным» section; `[geo-search]` configures its map
(see «Geo search» below). `[config] pages-search` (default `true`) switches «Поиск личных страниц»; `[pages-search]`
sets the per-site timeout and concurrency (see «Personal pages search» below). `[config] google-search` (default
`false`) switches «Поиск по Google»; `[google-search]` holds the service account's master token, the request timeout
and the pause between searches — an empty token means fake demo answers (see «Google search» below).
`[config] email-search` (default `true`) switches «Поиск по Email»; `[email-search]` holds per-part switches for the
keyless checks and the API keys of the keyed ones (see «Email search» below).

`[server] secure-cookie` (default `true`) sets the cookies' Secure flag; it no longer depends on `host`, because
production listens on 127.0.0.1 behind nginx (browsers accept Secure cookies on http://localhost, so dev works).

`[server] trust-proxy` (default `false`) makes Fastify take the client address from `X-Forwarded-For`; production runs behind
nginx/Cloudflare, so without it `req.ip` is the proxy and the per-IP password rate limit is shared by everyone. Values:
`false`, a comma list of proxy addresses/subnets (`127.0.0.1`, `10.0.0.0/8`, `loopback`) or `true` (trust everyone —
the leftmost XFF value is client-written, so it only warns). No hop count: Fastify 5.12 treats a number as «trust
nobody», so digits are a config error. Behind Cloudflare → nginx use `127.0.0.1` plus nginx `real_ip` from Cloudflare.

Production security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy…) are set by nginx, not Fastify — nginx serves
the page: `deploy/nginx/` (snippet + example `server { }` + README). The CSP is `script-src 'self'`, so the web has no
inline scripts (the pre-render theme switch is `public/theme-init.js`) — keep it that way; a new external origin
(images, frames, fetch) needs a matching CSP source there.

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
  Embedded media are capped (`@ft/shared` `media.ts`: 1 MiB per file, 5 MiB per dossier, external URLs are free);
  `checkMediaLimits` in `routers/dossiers.ts` throws `BAD_REQUEST MEDIA_TOO_LARGE` / `MEDIA_QUOTA`, the web pre-checks
  files and tells the user to keep big files on their Google Drive and add a link. Import is not capped.
  Google Drive links (`lib/driveLinks.ts`): a share link pasted into the media URL field is stored as the Drive
  thumbnail URL (`thumbnail?id=…&sz=w1600`; the file must be shared «by link»), and for a video `embedUrl` holds the
  Drive `…/preview` player, opened in an iframe dialog from the gallery (lightbox is images only); the schema accepts
  only that player (`DRIVE_EMBED_RE`) — any other URL would frame a foreign page in a shared dossier. `embedUrl` is not
  in the export v1 format: an exported video comes back as its thumbnail image.
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
over kinds) by the found INN/SNILS/passport/foreign passport/birth certificate/mobile phone/email/Telegram ID/military number/link
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
  followed manually (≤5 hops, 301/302/303 → GET) and every hop must be http(s) to a public address (`isPublicIp`:
  only ipaddr.js `unicast`, IPv4-mapped IPv6 reduced to IPv4 — `[::ffff:7f00:1]` is loopback). Literal IPs are checked
  per hop; names are checked at connect time by the `lookup` of an undici `Agent`, so a second DNS answer cannot
  rebind to an internal address — hence `fetch` from the `undici` package, not the global one (its agent does not fit
  Node's bundled undici). Refusals are `OutboundBlocked` → status `unknown`, so a site cannot bounce the server to
  localhost, the DB, scanstore or cloud metadata.

`jobs.ts` runs all checks for a query (nickname sites + e-mail sites) through `concurrency` workers; each `SiteResult`
carries `by: 'username' | 'email'`, shown in the UI as «по нику» / «по e-mail». Jobs live in server memory (one running
per user, `MAX_RUNNING` per process → `PAGES_BUSY`, finished jobs live an hour → the section's own «История», nothing in
the DB). The browser never talks to the sites (CORS); `pages.job` is polled every second while `running` and returns
only `found` until the job ends. `pages.config` is `null` when `[config] pages-search = false`. Verdicts are heuristic
(a site that answers 200 for any input gives a false «найдено»; WAF pages → «защита от ботов»), and the site lists age —
refresh them periodically. Found pages go to a dossier's «Соцсети и ссылки» via `AddPagesDialog` (the `by` reaches the
source note).

### Google search (GHunt port)

`/search/google` (`features/search/GoogleSearchPage.tsx` + `Google*Result.tsx`, `GoogleParts.tsx`, `routers/google.ts`,
`apps/server/src/google/`): a TypeScript port of [GHunt](https://github.com/mxrch/GHunt) (AGPL-3.0 — see
`google/NOTICE.ghunt` for the file map and the upstream revision). Search-type buttons above the input are GHunt's
modules (`GOOGLE_MODES` in `@ft/shared` `google.ts`, with input parsers `parseGaiaId` / `parseDriveRef` /
`parseBssids` / `parseDalQuery`, `googleQueryProblem`, `normalizeGoogleQuery`, per-mode steps `GOOGLE_STEPS` and the
`GoogleReport` union discriminated by `mode`). `ghunt email` is not a button here: it is `huntGoogleEmail` in
`hunter.ts`, the «Аккаунт Google» part of «Поиск по Email» (old `?mode=email` links redirect there). `hunter.ts`
(`GhuntHunter.run(mode, …)`) dispatches:

- **gaia** (`ghunt gaia`): `lookupByGaia` (`/v2/people?person_id=`, answer in `personResponse[0]`) → Maps. No Play Games
  or calendar (they need the address); the UI offers to search on by the profile's e-mail.
- **drive** (`ghunt drive`, `drive.ts`): `drive/v2internal/files/<id>` with the «Google Диск» app OAuth token
  (`DRIVE_APP`); a `resourcekey` from the link goes in `X-Goog-Drive-Resource-Keys`. 404 / 403 «no access» = not found
  (not shared by link). Users from permissions + permissionsSummary, last modifying user, source app brand
  (`clientauthconfig.googleapis.com`, pantheon key, no auth), folder child count, comment authors.
- **geolocate** (`ghunt geolocate`, `geolocate.ts`): Geolocation API with the Maps JS sample key (Origin-bound), a dummy
  second AP when only one BSSID is given; address via Nominatim at `[google-search] reverse-geocode` (admin-configured,
  plain `fetch`, so a self-hosted one on the LAN works; empty = no address; the public OSM one warns off-loopback —
  the coordinates leave to it). The UI shows the point on the geo-search map and links to a leak search in that radius
  (only when `[config] geo-search` is on).
- **spiderdal** (`ghunt spiderdal`, `dal.ts`): BFS over Digital Asset Links statements (keyless), site + `www.` variant;
  unlike GHunt it is capped (`MAX_ASSETS` 150, `MAX_ROUNDS` 8 → `truncated`), then a Google Play HEAD per package
  (404 = private app).

Every part after the fatal first request is a `GoogleSection` (`ok` / `error` / `skipped`), so one failing does not sink
the report. Found e-mails and Gaia IDs (profile, Drive users, Hunter colleagues) carry a «search on» button
(`Searchable` in `GoogleParts.tsx`): on its own section's page it runs there (`GoogleRunContext` / `EmailRunContext` in
`googleSearch.ts`; `null` = no subscription, no button), elsewhere it navigates — e-mails to «Поиск по Email», Gaia IDs
to «Поиск по Google» (hidden when that section is off).

- **One service Google account** for gaia / drive and the e-mail part of «Поиск по Email». `google/account.ts` holds
  the one `GoogleSession` per process (`googleSession()`) and the shared queue `googleSlot(minIntervalMs, signal, fn)`
  both sections go through, so they never hit Google at the same time. The config holds only its Android master token
  (`[google-search] master-token`, `aas_et/…`; `npm run google-login` exchanges a one-time `oauth2_4/…` token from
  `accounts.google.com/EmbeddedSetup`, or takes a master token / GHunt Companion string / GHunt `creds.m`, validates it
  with a real People lookup of the account's own address and writes it to `config.ini`). `session.ts` derives
  everything else in memory: per-app OAuth tokens (`android.googleapis.com/auth`), web-session cookies (Chrome token →
  `OAuthLogin` uberauth → `MergeSession`) and the `SAPISIDHASH` header + web-client API key/Origin (`apiKeyHeaders` in
  `knowledge.ts`) for the internal web APIs. No OSIDs.
- **No master token**: `GhuntHunter` gets `session = null` and sends gaia / drive to `DemoHunter` (`demo.ts`; the e-mail
  part — `demoGoogleEmail`,
  fake query-deterministic reports; not found: addresses with `nobody`/`none`, Gaia IDs not starting with 1, file IDs
  with `none`); geolocate and spiderdal stay real. `google.config.demoModes` lists the faked modes; the banner shows
  only on those.
- **Hand-rolled pieces**: gRPC over `node:http2` (`net.ts` `grpcUnary` — Node's fetch is HTTP/1.1) and a minimal
  protobuf writer/reader (`proto.ts`; field numbers reach 3·10⁸, so tags are computed arithmetically, not with 32-bit
  shifts); a PNG decoder + average hash (`flathash.ts`) replacing PIL/imagehash for «default profile picture» — the
  photo is requested as a 64 px PNG (`=s64-rp`) and compared with two reference hashes (GHunt's old silhouette and the
  current `/a/default-user`, which GHunt's hash does not match).
- **`net.ts`**: `gfetch` never follows redirects (a redirect to `/sorry` = captcha → `BLOCKED`), enforces an allowlist
  of Google hosts and a per-request timeout; `apiError` maps a Google `{"error": …}` body to a `GoogleError`. Codes
  (`AUTH`, `BLOCKED`, `TIMEOUT`, `HTTP`, `PARSE`, `NOTFOUND`) map to generic Russian texts for the user
  (`googleErrorText`); Google's actual answer goes to the server log as `google: …`. The profile-photo URL comes from
  Google's response, so it is fetched through `pages/outbound.ts`.
- **No `CheckCookie`**: GHunt validates the session with `accounts.google.com/CheckCookie`; Google now answers HTTP
  200 on a good session (used to be 302) just like on a bad one, so it can no longer tell them apart. The session is
  instead validated by its real use — `webApi` retries once on 401, dropping and regenerating cookies. Cookies are
  cached `COOKIE_TTL` (30 min). Play Games search returns gRPC NOT_FOUND (status 5) when the account has no player
  profile — mapped to `NOTFOUND` and treated as «no profile», not an error.
- **`jobs.ts`**: in-memory jobs like the pages search (an hour of «История», polled every second, shown in
  `ProgressDialog` by step), but strictly sequential (`googleSlot`) with `min-interval-sec` between runs, keyless modes included —
  one account and one server IP, and Google answers bursts with captchas and account locks. One unfinished job per user
  (a new search cancels it — in solo mode everyone is the same user), `MAX_PENDING` per process → `GOOGLE_BUSY`.
- **Live-verified against Google**: email and gaia on the service account itself. Drive, geolocate and spiderdal were
  ported 1:1 from GHunt but have not been run against live targets yet.
- Found links (Maps contributor page, calendar .ics, the Drive file, a Maps link to the Wi-Fi point, DAL sites and
  public Play pages) go to a dossier through `AddPagesDialog` (its `note` prop).

### Email search (GHunt + MOSINT)

The section is labelled «Исследовать Email» in the UI (sidebar group of its own, between the searches and the dossiers);
«Поиск по Email» in comments and older text is the same section.

`/search/email` (`features/search/EmailSearchPage.tsx` + `EmailReportView.tsx`, `emailSearch.ts`, `routers/email.ts`,
`apps/server/src/email/`, `NOTICE.mosint`): one e-mail address → one report combining `ghunt email` and
[MOSINT](https://github.com/alpkeskin/mosint) (MIT). The input takes only an address: `parseEmail` in `@ft/shared`
`email.ts` (RFC-ish syntax, lowercased, IDN domain → punycode, `mailto:` stripped) replaces MOSINT's verifier.
`emailDomainInfo` classifies the domain — `gmail` / `free` (built-in provider list) / `disposable` (built-in list of the
known temp-mail services) / `corporate` — and the checks depend on it (`skipReasons` in `email/report.ts`): RDAP, IP
geolocation and Hunter run only for a corporate domain; DNS runs always (for free providers the UI shows it compact).
`emailDomainTypo` / `emailTypoFix` (the `typo` check of deep-email-validator, i.e. mailcheck) suggest the intended domain
when the typed one is one or two edits away from a known provider or has a mistyped zone (`gmial.com`, `yandex.con`);
providers shorter than 7 characters are not compared. It is only a hint — under the input (click fills the fixed
address) and in the report's «Домен» row — never a refusal: a real domain may sit one letter from a known one.
Parts (`EMAIL_PARTS`, each an `EmailSection`: `ok` / `error` / `skipped` with a reason) run in parallel:

- **dns** (`dns.ts`, system resolver, nothing leaves to third parties): MX (provider by host — `MX_PROVIDERS`, Gmail vs
  Google Workspace), null MX, A/AAAA/NS/TXT, SPF (`all` qualifier, `include:`/`redirect=` → known senders), DMARC
  policy, `spoofable` (no DMARC enforcement and SPF not `-all`, as EmailRep), verification TXT tokens → services.
- **mailbox** (`smtp.ts`, off by default — `[email-search] smtp-check`): does the mailbox exist — the method of
  [deep-email-validator](https://github.com/mfbx9da4/deep-email-validator) (MIT) ported, not installed: connect to the
  MX on port 25, EHLO (+ STARTTLS when offered), `MAIL FROM`, `RCPT TO`, no message sent. Added over the library:
  a second `RCPT TO` for a random name (accepted too → `catchall`, nothing can be said), 4xx and anti-spam 5xx are
  `unknown` (`greylist` / `blocked`), not «missing», a refused connection is `no-connect` (outbound port 25 closed),
  multi-line replies, only public IPs from DNS (`isPublicIp`). Verdict + reason are `EmailMailbox` / `MAILBOX_REASONS`
  in `@ft/shared`; connection trouble is a verdict, not a part error. `smtp-helo` should equal the server's PTR name,
  `smtp-from` a real address whose SPF allows the server; the target's mail server logs our IP. Verified against a
  fake SMTP server (12 scenarios) and one live Gmail «no such user» over STARTTLS.
- **rdap** (`rdap.ts`): rdap.org bootstrap via `pages/outbound.ts` (it redirects to the registry); the domain and its
  parents; `.ru`/`.рф`/`.su` have no RDAP → `null`. Replaces EmailRep's domain age without a key.
- **ipgeo** (`ipgeo.ts`): ipapi.co for the domain A and the primary MX host, public IPs only, sequential.
- **google**: `huntGoogleEmail` through `googleSlot` (note «в очереди к Google»); no master token → `demoGoogleEmail`
  without the queue, `email.config.googleDemo` shows the banner. Runs for every domain — a Google account can sit on
  any address.
- **sites**: the pages-search e-mail checks (`allEmailSites` + `checkEmailSite`, `[pages-search]` timeout / concurrency /
  side-effect setting) plus MOSINT's Instagram in `email-sites.ts` `EXTRA` (Twitter, Spotify are in blackbird's file).
  `eCode: 0` in an `EmailSite` = any HTTP status.
- **hibp** / **breachdirectory** / **intelx** / **pastes** / **emailrep** (`breaches.ts`), **hunter** (`hunterio.ts`):
  keyed services ([email-search] `*-key`; empty = skipped «нет ключа»). psbdmp is keyless but its domain no longer
  resolves (Nov 2026), so `pastes` defaults to `false`. IntelX polls results ≤10 s and terminates the search.
- **web** (`web.ts`): MOSINT scrapes Google SERP; Google gives no results without JavaScript, so the server scrapes
  DuckDuckGo's HTML endpoint (`parseDuckHtml`, `blocked` on its anomaly page); the UI adds manual-search links
  (Google, Яндекс, Bing, DuckDuckGo) that the user's browser opens.

`email/http.ts`: `xfetch` (global fetch, `redirect: 'manual'`, timeout + cancel, fixed hosts only), body size cap,
`EmailError` codes (`AUTH`, `LIMIT`, `TIMEOUT`, `HTTP`, `PARSE`, `NET`) → generic Russian texts (`emailErrorText`);
details go to the log as `email: <part> — …`. `email/jobs.ts`: in-memory jobs like pages (one running per user,
`MAX_RUNNING` → `EMAIL_BUSY`, an hour of «История» with a hit count); the view carries per-part state + note
(«Регистрации на сайтах: 12 из 15») and the report only once finished. Keys never reach the browser —
`email.config` returns only which parts are available. Verified live only with `info@example.com`; the keyed services
have not been run (no keys).

### Progress window

`components/ProgressDialog.tsx` is the modal for long processes (gauge, status line, elapsed time, «Отмена»; Esc =
cancel, no closing by clicking outside). Two ways to drive it: `<ProgressDialog>` with props when the state comes from a
polled server job (pages search, Google search, Email search), or `useProcess()` + `<ProcessDialog>` for browser-side async flows — `run(title, fn)`
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
thumbnail re-fetches its URL and shows the HTTP status/type. The startup log and `/health` carry the version and commit (`version.ts`); the version is `APP_VERSION` in
`packages/shared/src/version.ts` (bumped by hand on release, also shown on the login screen), not the package.json versions.

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
- Dark is the default theme; `<html data-theme="light">` overrides the `--color-*` tokens (`:root[data-theme='light']` in
  `styles.css`). Use tokens, never raw colours: `border-text/30`, `bg-bg/70`, not `white` / `black` (equal in dark, right
  in light). Hex concatenation (`${color}55`) does not work on tokens — `withAlpha`. MapLibre cannot read `var()`: colours
  come from `cssColor()` and the map is rebuilt when the `theme` store changes. Tailwind inlines `--shadow-*`, so their
  colour goes through `--ft-mint-rgb`.
- Dossier duplicates: `itemIdentity` in `@ft/shared` is the only definition, used by the router (`addItem`/`updateItem` →
  `CONFLICT DUPLICATE_ITEM`, `addItems` skips and returns `skipped`) and the web (`findDuplicate`, `markDuplicates`,
  `useTargetItems`, `WarnNote`). A new attribute field that is a number or a document goes into `COMPACT_FIELDS`. ARCHITECTURE.md §6.
- Attribute types for manual entry are `ATTR_TYPES` in `@ft/shared` (`attrTypes.ts`): ordered list with its own labels,
  keyed by the gateway field from `LEAK_FIELDS` where one exists (so a hand-typed phone and a found one are the same
  type) and by site-only keys otherwise (`birthaddrs`, `regaddrs`, `liveaddrs`, `vins`). `LEAK_FIELDS` keeps the gateway's
  field set and order (search pages, export) — add a manual type there only when the gateway has the field.
- Attribute rows (`AttributesList` in `DossierPage.tsx`, dnd-kit): drag by the four-dot handle to reorder (positions
  via `reorderItems`; the importance order applies until the user reorders). Linked pairs: the chain button in the
  action row enters «link mode» — the other rows turn into bordered buttons, clicking one makes it the parent
  (`AttributeItem.parentId`, one level, checked by `checkAttrParent` in `routers/dossiers.ts` → `BAD_REQUEST
  BAD_PARENT`; `removeItem` unlinks the children of a removed parent), the X / Esc cancels. Only the pairs in
  `ATTR_PAIRS` (`attrTypes.ts`: names + bdays, pasps + infos) can be linked. Children are shown right under the
  parent, indented, with a chain icon that unlinks, plus a pair line (`PairActions`): copy «parent child» and, for
  names + bdays, a name search. `color` and `parentId` are UI-only: not exported, not in PDF.
- An `emails` attribute row has an «Исследовать» icon (`ResearchEmailLink`, left of the mailmeteor check; only when the
  value parses as an address and the Email section is on) → `/search/email?q=…&from=<dossier id>`. `?from=` on `/search`
  and `/search/email` shows the way back (`features/search/BackToDossier.tsx`) and survives a new search on the page.
- Dossier links are two sections over one item type: «Соцсети» (pages of the person, `link` with no `kind` or `social`)
  and «Ссылки» (`kind: 'web'`, external sites — `features/dossiers/WebLinks.tsx`, above «Посты и реакции»). A web link
  carries `shots`: page screenshots as data URLs with a calendar date (`LinkShot`, «по состоянию на …»), pasted with
  Ctrl+V into the shot dialog or picked as a file and squeezed by `lib/shotImage.ts` (`fitShot`) under the media
  limits — `itemImages` / `dossierMediaBytes` count shots together with media files. Export carries `kind` and
  `shots` as optional keys (additive to v1); the PDF lists the shot dates only. Found pages (`AddPagesDialog`) go to
  «Соцсети». Site archives are planned for this section.
- Add-media dialog: «Из буфера обмена» (`clipboardImage`, Clipboard API) and Ctrl+V anywhere in the open dialog
  (`pastedImage`) take an image from the clipboard; `imageDataUrl` keeps it as is under the file limit and squeezes a
  bigger one (`fitShot`) instead of refusing — a screenshot has no file to put on Google Drive. Helpers: `lib/shotImage.ts`.
- Group members (`MembersEditor`): «Новое досье» creates a person dossier, adds it to the group and opens it with
  `?from=<group id>`; member links carry the same `from`. `/dossiers/$id?from=` shows «← в группу …» right of the
  title (`BackToGroup`), like `/search?from=` shows the way back to the dossier.
- Dossier notes (`NotesList` in `DossierPage.tsx`, dnd-kit): a collapsed note shows a four-dot handle; while one is
  dragged every note is force-collapsed (`forceCollapsed`, own state kept) and the order goes to `reorderItems`.
- Graph notes (`investigations/GraphEditor.tsx`): a node's «Пояснение» is `props.note` (so it travels with `props`
  in export), an edge's is `GraphEdge.label` (≤ 2000); both are 3-row textareas in the side panel. The graph shows an
  edge as «relation · first three words…» (`edgeLabel`), and hovering a node or edge shows the full note in a tooltip
  positioned inside the editor root (absolute, not fixed — React Flow transforms).
- Graph node types are `NodeType` in `@ft/shared` and the `node_type` DB enum (a new type needs a migration, plus
  `NODE_STYLE` and the PDF `COLOR`). `NODE_DOSSIER_KIND` says which types link to a dossier and of which kind:
  `person` → person dossier, `group` («Группа персон») → group dossier; the side panel offers only dossiers of that kind
  and a node still named by default takes the dossier title.
- Graph levels (two, never more): a top-level node may hold an inner graph — nodes whose `GraphNode.parentId` is its id
  (`graph_nodes.parent_id`, cascade delete); an edge lives on the level of its nodes. `@ft/shared` `graph.ts` has the
  rules (`badParentNodes` → `BAD_REQUEST BAD_GRAPH_LEVEL` in `saveGraph`, `sameLevelEdges`, `nodeTitles` =
  «Container › Node» for lists outside the graph). `GraphEditor` keeps the whole graph in state and shows one level by
  marking the rest `hidden` (`enter(id | null)`); the save still sends everything. The export file carries the
  container as an optional `parent` key (additive to v1); the PDF draws inner graphs as separate schemes.
- Block menu («⋯» in a node's top-right corner, rendered in the editor root, not inside the node): enter, open dossier,
  add / remove image, delete. Image and node deletion are only there, not in the side panel. A node with an inner
  graph is deleted by a second click in the menu; the Delete key refuses it (`onBeforeDelete`).
- Graph side links: every block has four connection points (`top`, `bottom`, `left`, `right` handle ids). A side point
  connects only to a side point (`validConnection`; React Flow runs in `ConnectionMode.Loose` so two `source` handles
  can meet), bottom only to top. A side link stores `GraphEdge.sourceSide` / `targetSide` (`left` | `right`, always as
  a pair — `withEdgeSides`; columns `graph_edges.source_side` / `target_side`); no sides = an ordinary bottom → top
  link. Export carries them as optional keys (additive to v1); the PDF graph draws a side link between side midpoints.
- Graph group selection: the toolbar toggle (`boxSelect`) makes a left drag on the pane draw a selection box
  (`selectionOnDrag`, pan moves to the middle / right button; `SelectionMode.Partial`); without it React Flow's own
  Shift + drag does the same. Selected blocks move together by any of them or by the box, and the move is saved like
  a single drag. The side panel still describes one clicked block.
- Graph full screen: `?full=true` on `/investigations/$id` (button right of the editor toolbar, «вернуться в расследование»
  to leave; entering pushes history, leaving replaces). `AppShell` drops the sidebar and banners, `InvestigationPage`
  hides its header with `hidden` — nothing above the editor is unmounted, so the editor keeps its state and level.
- Graph node images: a node linked to a dossier shows the dossier cover, fetched separately by `dossiers.covers`
  (readable ones only; not part of the graph payload, which is re-sent on every save) through `CoversContext`; any
  other node may carry its own `props.image` — a 128×128 WebP data URL made by `lib/squareImage.ts`, non-square
  files go through `components/SquareCropDialog.tsx` (pan + zoom, Telegram-avatar style). Not drawn in the PDF graph.
- Person glyphs (`features/dossiers/glyphs.ts`) are ordinary `PHOTO_ALBUM` media items with an SVG data URL, also set as the
  cover: nothing else has to know about them, but anything that counts or lists photos must skip them with `glyphOf`.
- Interface language (`settings.lang`, `ru` default | `en`): gettext-style `lib/i18n.ts` — the key is the Russian text
  itself, English is `src/i18n/en/*.ts` (a lazy chunk). Every user-visible string goes through `t('… {x} …', { x })`,
  `tn(n, 'form1|form2|form5')`, `tj()` (with elements), `tc(context, ru)` (a word whose English depends on the place —
  key `context::ru`) or `tx()` (text that came from the server — it answers in
  Russian; dictionary keys with `{name}` act as patterns, collected in `en/server.ts`). Never call `t()` at module
  scope: tables stay Russian and are translated where shown (`t(item.label)`); a language change remounts the tree
  under `Root`. Dates/numbers use `locale()`, not `'ru-RU'`. Data (leak values, user text, stored names the code
  compares with) is not translated; PDF/XLSX reports are Russian only. `npm run i18n-check` must pass (mark non-UI
  Cyrillic with `// i18n-ignore`). ARCHITECTURE.md §9.1.
- User settings: `users.settings` jsonb holds only non-default keys, `@ft/shared` holds the schema and defaults (a new
  setting needs no migration), they arrive with `auth.me`, `useUserSettings()` updates them optimistically via
  `settings.update` (`authedProcedure`: works without a subscription). UI: the user dialog in `AppShell`. ARCHITECTURE.md §9.1.
- Sidebar (`Sidebar` in `AppShell.tsx`): the button in its bottom-left corner collapses it to icons (`w-16`; the header
  row shrinks to the user/settings gear, nav items keep only the icon with the label as `title`). The choice is the
  module-level `sidebarCollapsed` store + localStorage `ft.sidebar.collapsed`. Below `lg` (`useNarrowScreen`) the panel
  is always compact and the button is hidden.
- Page containers are full-width with `pt-2.5 pl-6 pr-[30px]` (no centered max-width); the 10 px top padding puts the
  first line of the page title level with the visible top of the sidebar logo — keep it when adding a page.
- List filters («Все / Мои / Доступные мне») live in `?scope=` and the last choice is remembered in localStorage
  (`rememberedScope` in `lib/listView.ts`): a link to the bare list (`/dossiers`, sidebar) reopens the remembered scope.
- Markdown is the storage format for all long text; `@` in the TipTap editor inserts a plain link
  `[@Title](/dossiers/<id>)` rather than a custom node, so stored text stays portable.
- The TipTap editor lives in `components/MarkdownEditor.tsx` and is never imported directly: `MarkdownEditor` in
  `components/Markdown.tsx` is a `lazy` wrapper (same props), so TipTap / ProseMirror (~480 kB) stay out of the entry
  chunk, which eager pages with a create dialog would otherwise drag in. `MarkdownView` stays eager.
- Colour highlighting in Markdown is inline HTML `<mark data-color="yellow">…</mark>` with a colour *name* from
  `HIGHLIGHT_COLORS` (`@ft/shared` `highlight.ts`, also the tag regexes). Three places must agree: the TipTap `Highlight`
  mark in `components/MarkdownEditor.tsx` (own marked tokenizer, so Markdown inside the mark survives), the `remarkHighlight`
  plugin of `MarkdownView` (only this tag pair becomes an element; other HTML stays text — no `rehype-raw`) and
  `pdf/markdown.ts` (tinted `background`). One-line previews strip the tags with `stripHighlight`.
- Every dossier item and fact carries a `source` with an Admiralty-code rating (reliability A–F, credibility 1–6),
  rendered by `SourceBadge`.
- Dialogs center without CSS transforms and editor popups are positioned relative to the editor wrapper: `fixed`
  positioning breaks inside ancestors with `transform`/`backdrop-filter`.
- URL-triggered searches use `useRunOnMount` (ref guard) — React StrictMode would otherwise start them twice.
- Search params are parsed as JSON (`parseSearch` in `router.tsx`), except a bare integer of 16+ digits, which stays a
  string: a 21-digit Gaia ID as a JSON number loses precision (…406647 → …400000) before the route's `text` schema
  turns it back into a string, and the search silently hits another account. The same parser drives `stringifySearch`.
- React Fast Refresh: a `.tsx` module exports only components (types are fine); hooks, helpers and constants go to a
  sibling `.ts` (`features/search/job.ts`, `selection.ts`, `foundScans.ts`, `components/process.ts`, `lib/listView.ts`…).
  Pages read route params with `useSearch({ from: '/search' })` / `useParams({ from: … })`, never by importing route
  objects from `router.tsx` (that cycle through `main.tsx`). Either mistake turns every edit into a full page reload,
  which also re-runs a search whose query is in the URL against the real gateway.
