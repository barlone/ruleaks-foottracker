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
npm run dev            # server (tsx watch, :3001) + web (Vite, :5173, proxies /trpc → server); same as run-devel.cmd
npm run typecheck      # tsc --noEmit in every workspace — the only automated check; there are no tests or linter yet
npm run build          # web production build (apps/web/dist)
npm run typecheck -w @ft/server   # one workspace
```

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
unknown keys are logged as warnings. Each data source is switched independently by its `enabled` flag:

| Section | `enabled = true` | `enabled = false` |
|---|---|---|
| `[project-db]` | PostgreSQL store — **not implemented yet** (server refuses to start) | in-memory store with demo seed data |
| `[bot-db]` | `BotDbBridge`: subscription + API token read from the bot's DB (read-only pool) | `MemoryBotBridge` with three demo profiles |
| `[api]` | `HttpGateway`: real dsstalker-api-gate | `MemoryGateway`: fake deterministic results |

`[server] dev-login` (allowed only when `host` is loopback) enables login without the bot: demo-profile buttons, or a
Telegram-ID field when `[bot-db]` is real. `LoginPage.tsx` also has a temporary quick-login button for one fixed ID
(`QUICK_LOGIN_TG_ID`, marked TODO).

## Architecture

npm workspaces, all TypeScript ESM consumed as source (no build step for packages; imports use `.ts` extensions):

- `packages/shared` (`@ft/shared`) — Zod domain schemas (`domain.ts`) shared by server input validation and web types;
  the search catalogs (`search.ts`) mirroring the bot's endpoint paths and param names, plus gateway response shapes.
- `packages/config` (`@ft/config`) — config loader described above.
- `packages/db` (`@ft/db`) — draft Drizzle schema (not wired), `sql/` scripts that create the `ruleaksfoottracker`
  database/role (pure SQL — they get pasted into a remote psql, so no psql meta-commands), and the tuned
  `config/postgresql.conf` of the DB server (PostgreSQL 18, LXC 2 GB/2 vCPU; changed lines marked `# tuned:`).
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
  The bot's subscription answer is cached 60 s (`loadAccess`).
- **Authorization** happens only in `src/authz.ts` (`can()`/`roleOf()`: owner/editor/viewer from `ownerId`,
  `visibility`, `shares`). Routers load objects through a local `load(ctx, id, action)`; an object the user may not read
  is reported as `NOT_FOUND`. Dossiers are only `private | shared` (never public — they hold leaked personal data);
  investigations may be `public` and `investigations.get` is a public procedure — `present()` strips shares and links to
  dossiers the viewer cannot read.
- **Optimistic locking**: dossiers/investigations carry `version`; repos throw `VersionConflict` → tRPC `CONFLICT`.
  The graph editor saves the whole graph (`saveGraph`) debounced, with the version.

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

### Bot DB access

`BotDbBridge` opens the pool with `default_transaction_read_only=on` and duplicates the bot's `access_error()` rules
(no token → «Токен не установлен», disabled token, unlimited, `users.subscribed_to`). Users are matched by
`users.provider = 'tg' AND provider_id = <chat id>`. Planned (see ARCHITECTURE.md §4): the bot adds
`site_login_requests` + `site_user_access()` and confirms `/start login_<nonce>`, replacing dev-login and the
duplicated rules.

### Web conventions

- Theme tokens are in `apps/web/src/styles.css` (`@theme`): black background, mint `#2EE0AC`, JetBrains Mono + Manrope;
  border radii are deliberately 3× smaller than Tailwind defaults. Shared primitives are in `src/components/ui.tsx`.
- Page containers are full-width with `pl-6 pr-[30px]` (no centered max-width).
- Markdown is the storage format for all long text; `@` in the TipTap editor inserts a plain link
  `[@Title](/dossiers/<id>)` rather than a custom node, so stored text stays portable.
- Every dossier item and fact carries a `source` with an Admiralty-code rating (reliability A–F, credibility 1–6),
  rendered by `SourceBadge`.
- Dialogs center without CSS transforms and editor popups are positioned relative to the editor wrapper: `fixed`
  positioning breaks inside ancestors with `transform`/`backdrop-filter`.
- URL-triggered searches use `useRunOnMount` (ref guard) — React StrictMode would otherwise start them twice.
