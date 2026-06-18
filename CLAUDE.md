# CLAUDE.md

ShinobiX / "Shinobi Journey" — a shinobi RPG browser game. React 19 + Vite SPA
frontend, a set of Vercel-style TypeScript serverless handlers for the API, and
Supabase (Postgres) for storage. The handlers run under a single Express server
(`server.ts` → `dist/server.js`) that serves both the API and the SPA on one
port — deployed on Railway (Docker) and cPanel / Phusion Passenger. (Vercel was
the original target and is retired; the handlers keep their Vercel-style shape.)

## Commands

Run from the repo root (`shinobix-api` package) unless noted.

- `npm run build`: Build everything — `build:server` (`tsc -p tsconfig.cpanel.json` → `dist/`), then `build:client`, then `verify:dist`.
- `npm run verify:dist`: Post-build sanity check (`node scripts/verify-dist.mjs`); part of `build`, runnable on its own. Fails the build if `dist/server.js` is missing/broken, so a bad compile can't be committed and shipped to cPanel.
- `npm start`: Run the production server (`node app.js`) — the cPanel/Passenger entry point.
- `npm run dev`: Run the server with `node --watch app.js`.
- `npm test`: Run the API/unit tests (`node --import tsx --test` over the colocated `*.test.ts` files). Includes `server-routes.test.ts` (route-parity) and the client `App.size.test.ts` ratchet.

Frontend (run inside `shinobij.client/`):

- `npm run dev`: Vite dev server (default `http://localhost:5173`).
- `npm run build`: Type-check + bundle (`tsc -b && vite build`) → `shinobij.client/dist/`.
- `npm run lint`: ESLint over the client.

## Architecture

- **`api/`** — the backend. Each `*.ts` file is one endpoint with a Vercel-style
  default export: `export default async function handler(req: VercelRequest, res: VercelResponse)`.
  Subfolders group features: `player/`, `pvp/`, `clan/` & `clans/`, `village/` &
  `village-guard/`, `missions/`, `pet/`, `jutsu/`, `bloodlines/`, `profession/`,
  `arena/`, `bank/`, `battle/`, `festival/`, `admin/`, `cron/`, `save/`, and
  `_realtime/` (presence/SSE helpers). Ranked lives in **root-level files**, not a
  folder: `api/ranked-season.ts` + the `api/_ranked-*.ts` helpers (there is no
  `api/ranked-queue/` directory).
- **Underscore-prefixed files in `api/` are shared helpers, NOT routes** —
  `_auth.ts`, `_utils.ts` (CORS, etc.), `_storage.ts`, `_ratelimit.ts`,
  `_lock.ts`, `_text-moderation.ts`, `_player-ips.ts`, and the `_*-validate.ts`
  validators. Import from these; don't add a route file starting with `_`.
- **`server.ts`** (repo root) — the Express server (Railway + cPanel). It imports
  the `api/**` handlers unchanged and registers each on **both** the bare path and
  the `/api`-prefixed path (Passenger may or may not strip `/api`). It also serves
  the React SPA static build and provides `/health` and `/restart`. Compiles to
  `dist/server.js`.
- **`app.js`** (repo root, CommonJS) — the Passenger entry point that `server.ts`
  runs under. It hardcodes Supabase DNS and forces IPv4 (CageFS/CloudLinux can't
  resolve DNS or route IPv6), loads `.env`, then `require('./dist/server.js')`.
- **`shinobij.client/`** — React 19 + TypeScript + Vite SPA. `src/main.tsx` →
  `src/App.tsx`; feature views in `src/screens/` (Village, PvP, Ranked, Clan,
  Mission, Training, Pet, GuardDuty, BloodlineCodex), shared UI in
  `src/components/`, game data/config in `src/data/` & `src/constants/`,
  helpers in `src/lib/`, types in `src/types/`. `authFetch.ts` wraps
  authenticated API calls; `fingerprint.ts` produces the `x-client-fp` header.
- **Storage** — Supabase via `@supabase/supabase-js` (and `pg`). Schema in
  `supabase-schema.sql`; migration notes in `SUPABASE_MIGRATION.md`. The legacy
  Upstash/Redis KV layer has been fully migrated to Supabase (the one-off
  `migrate-upstash-*` / `import-*` scripts have been removed; see git history).
  `api/kv-proxy.ts` is the live Railway→cPanel disk-overlay proxy, not Upstash-era.
- **`scripts/`** — one-off migration and PvP balance-simulation scripts.
- **`docs/`** — design docs (e.g. `professions.md`) and security/auth
  references. See **`docs/auth-and-anti-cheat-patterns.md`** for the token-first
  auth model and the server-minted single-use token pattern for client-reported
  rewards.
- **`*.slnx`, `*.esproj`** — Visual Studio solution scaffolding (client project only); not the runtime. (The unused `ShinobiJ.Server/` .NET WeatherForecast stub — which also exposed unauthenticated API mirrors — was removed 2026-06.)

## Deployment

Two targets run the same Express server (`dist/server.js`), which serves the API
**and** the React SPA on one port, plus the in-process daily snapshot cron.
**Railway is the current live/production host;** cPanel / Passenger is kept as a
maintained, in-parity fallback (it is not serving live player traffic). Keep both
working when changing handlers.

- **Railway** (`railway.json` → `Dockerfile`) — `node dist/server.js`. The Docker
  build runs `npm run build` fresh (server + client), so it self-builds from
  source. Health check `/health`.
- **cPanel / Phusion Passenger** — `app.js` → `dist/server.js`. The `.cpanel.yml`
  auto-deploy does **not** build — it serves the committed `dist/` verbatim, so
  `npm run build` must be run and committed before deploying (**both** root
  `dist/` and `shinobij.client/dist/`, the latter force-added past `.gitignore`).
  See `CPANEL_SETUP.md` and `Passengerfile.json`.

(Vercel was the original target and is retired — `vercel.json` is deleted.)

Note: there is **no folder-convention auto-routing** anymore — every `api/**`
handler must be imported and `route()`-registered in `server.ts` or it is
unreachable on both targets. `server-routes.test.ts` enforces this both ways
(client call ↔ registration, and handler file ↔ wiring).

## Conventions

- Handlers are Vercel-style and check `req.method` directly (`GET`/`POST`/`DELETE`/`OPTIONS`); return early on `OPTIONS`.
- CORS lives in `api/_utils.ts` `cors()`; the Express server in `server.ts`
  mirrors the same origin allowlist and headers — **keep the two in sync** when
  changing allowed origins or custom headers (`x-admin-password`,
  `x-player-password`, `x-player-name`, `x-kv-token`, `x-client-fp`).
- Tests are colocated as `*.test.ts` next to the code under test and run with the
  built-in `node:test` runner via `tsx`. Add new tests to the `test` script in
  the relevant `package.json` if they aren't picked up automatically.
- **`shinobij.client/src/App.tsx` is the legacy frontend monolith, in active
  drain** into `src/{screens,components,lib,data,constants,types}/`. Put **new**
  screens/components/helpers in their own module under those folders — **not** in
  App.tsx. A line-budget ratchet test (`src/App.size.test.ts`) fails the build if
  App.tsx grows past its budget; when you drain code out, lower `MAX_LINES` to
  lock the win in. Extractions are behavior-preserving verbatim moves: `export`
  the symbols the moved code needs from App, import them back, and keep storage
  keys / props / CSS / balance identical.

## Security & Anti-Cheat

Full details in `docs/auth-and-anti-cheat-patterns.md`. The load-bearing invariants:

- **Auth is token-first.** A 24h HMAC session token (minted by `/api/player-auth`,
  requires `SESSION_SECRET`) is the preferred credential; the password is the
  fallback. The client (`shinobij.client/src/authFetch.ts`) must **not persist the
  plaintext password once a token exists**, and must keep working when the server
  issues no token (`SESSION_SECRET` unset). Online login always mints a fresh
  token, so the worst failure is a re-login, never a lockout.
- **Never trust the client for rewards/currency/XP/outcomes.** Recompute them
  server-side, or gate them on a **server-minted, single-use token**: a `*-start`
  endpoint mints a token (daily cap, reward params *sealed in*), and the report
  endpoint requires it, atomically deletes it on use, and pays out from the sealed
  values — not the client body. Examples: `expedition-start` → `report-pet-event`
  (pet expeditions), `raid-start` → `report-raid` (AI raids). PvP cross-validates
  the real `PvpSession` instead.
- **Shared-state read-modify-write** (treasury, seal pool, bank, territory) goes
  through `withKvLock` (`api/_lock.ts`) with `{ failClosed: true }` for currency
  paths, locking the **shared resource** key — not just the actor's `save:`.

## Hard Rules

- Do not rewrite large systems unless explicitly asked. Prefer small, incremental changes.
- Do not change Supabase schema, SQL migration files, or storage structure without approval.
- Do not modify auth, password, admin, rate-limit, or IP-tracking logic without explaining the risk first.
- Keep player auth **token-first**: never reintroduce durable plaintext-password storage on the client, and never break the no-token (`SESSION_SECRET` unset) fallback path.
- A new client-reported reward/currency endpoint must be **server-authoritative** — recompute the reward, or use the mint-token pattern (see `docs/auth-and-anti-cheat-patterns.md`); never pay out from client-supplied amounts/outcomes.
- Do not remove cPanel/Passenger or Railway support when changing API handlers.
- When adding a new API endpoint, you must BOTH create the `api/**` handler AND
  import + `route()`-register it in `server.ts` — there is no auto-routing, so an
  unregistered handler is unreachable on Railway and cPanel alike.
- After any `api/`/`server.ts` change destined for cPanel, run `npm run build` and
  commit the regenerated `dist/` in the same change — the cPanel auto-deploy serves
  committed `dist/` verbatim and will otherwise ship stale code. (Railway self-builds.)
- Keep CORS headers in `api/_utils.ts` and `server.ts` synchronized.
- Do not commit secrets, API keys, Supabase service keys, passwords, or `.env` contents.
- Always run the relevant tests before saying a task is complete.
- For frontend changes, run `npm run lint` inside `shinobij.client/`.
- For backend/API changes, run `npm test` from the repo root.

## Refactoring Rules

- Preserve existing behavior unless the task explicitly asks for a behavior change.
- Before refactoring, identify the current entry points and callers.
- Keep old function signatures as wrappers when extracting logic.
- Avoid moving files unless necessary.
- After refactoring, summarize:
  - what changed
  - what stayed compatible
  - what tests were run
  - any files that need manual deployment attention

## Game-Specific Priorities

- Shinobi Journey is a live browser RPG project, so avoid changes that break existing player saves.
- Be careful with balance-sensitive systems: jutsu, bloodlines, pets, PvP, ranked queue, village guard, missions, professions, inventory, and premium currency.
- Do not change reward rates, rarity odds, combat formulas, cooldowns, AP costs, or currency payouts unless explicitly asked.
- When changing UI, preserve mobile responsiveness and avoid overlapping side panels.
- When changing battle logic, verify AP costs, targeting, cooldowns, damage tags, and turn resolution.
