# CLAUDE.md

ShinobiX / "Shinobi Journey" — a shinobi RPG browser game. React 19 + Vite SPA
frontend, a set of Vercel-style TypeScript serverless handlers for the API, and
Supabase (Postgres) for storage. The handlers run under a single Express server
(`server.ts` → `dist/server.js`) that serves both the API and the SPA on one
port — deployed on Railway (Docker). (cPanel / Phusion Passenger was a maintained
fallback but is **RETIRED as of 2026-07-17** — Railway is the sole host. Vercel
was the original target and is also retired; the handlers keep their Vercel-style
shape.)

## Architecture

- **`api/`** — the backend. Each `*.ts` file is one endpoint. Ranked lives in
  **root-level files**, not a folder: `api/ranked-season.ts` + the
  `api/_ranked-*.ts` helpers (there is no `api/ranked-queue/` directory).
- **Underscore-prefixed files in `api/` are shared helpers, NOT routes** —
  `_auth.ts`, `_utils.ts` (CORS, etc.), `_storage.ts`, `_ratelimit.ts`,
  `_lock.ts`, `_text-moderation.ts`, `_player-ips.ts`, and the `_*-validate.ts`
  validators. Import from these; don't add a route file starting with `_`.
- **`server.ts`** (repo root) — the Express server (Railway). It imports
  the `api/**` handlers unchanged and registers each on **both** the bare path and
  the `/api`-prefixed path (a dormant holdover from Passenger, which may or may not
  have stripped `/api`; harmless on Railway). It also serves
  the React SPA static build and provides `/health` and `/restart`. Compiles to
  `dist/server.js`.
- **`app.js`** (repo root, CommonJS) — the (retired) cPanel/Passenger entry point;
  Railway runs `node dist/server.js` directly, so this is now dormant. It hardcodes
  Supabase DNS and forces IPv4 (CageFS/CloudLinux couldn't resolve DNS or route
  IPv6), loads `.env`, then `require('./dist/server.js')`.
- **`shinobij.client/`** — React 19 + TypeScript + Vite SPA. `src/main.tsx` →
  `src/App.tsx`. `authFetch.ts` wraps authenticated API calls; `fingerprint.ts`
  produces the `x-client-fp` header.
- **Storage** — Supabase Postgres via `@supabase/supabase-js` (and `pg`). Schema in
  `supabase-schema.sql`; historical migration notes in
  `docs/archive/SUPABASE_MIGRATION.md` (rollback section references retired
  Upstash/Vercel architecture — not a current plan). The legacy
  Upstash/Redis KV layer has been fully migrated to Supabase (the one-off
  `migrate-upstash-*` / `import-*` scripts have been removed; see git history).
  **cPanel disk overlay RETIRED 2026-07-17:** `save:*`, `shared:images*`,
  `shared:imgfields*` now live in Supabase Postgres (the base `kv_store`), same as
  every other key — NOT the cPanel disk. `KV_PROXY_URL` / `REQUIRE_DISK_OVERLAY`
  are unset on Railway (`saveStoreKind='base-store'`). The overlay/proxy code
  (`api/kv-proxy.ts`, `_makeRemoteKv`, the routing wrapper) is now dormant/dead;
  the cutover ran via `POST /api/admin/migrate-to-base` (see
  `docs/RETIRE_CPANEL_RUNBOOK.md`). During the soak, cPanel data is retained for
  rollback (re-add `KV_PROXY_URL` + `REQUIRE_DISK_OVERLAY`); after decommission the
  overlay code can be removed.
- **`scripts/`** — build/test tooling (incl. `run-tests.mjs`, the test auto-discoverer
  described under Conventions) plus one-off migration and balance-simulation scripts.
  Notably `gen-story-pdf.mjs` (+ `_story-pdf-build.py`): render the whole story
  (chapters/interludes/road events) to a review PDF from the LIVE data —
  `node --import tsx scripts/gen-story-pdf.mjs [out.pdf]` (needs `pip install reportlab`).
- **`docs/`** — design and security references. See
  **`docs/auth-and-anti-cheat-patterns.md`** for the token-first auth model and the
  server-minted single-use token pattern for client-reported rewards.
- **`*.slnx`, `*.esproj`** — Visual Studio solution scaffolding (client project only); not the runtime. (The unused `ShinobiJ.Server/` .NET WeatherForecast stub — which also exposed unauthenticated API mirrors — was removed 2026-06.)

## Deployment

**Railway is the sole live/production host.** It runs the Express server
(`dist/server.js`) serving the API **and** the React SPA on one port, plus the
in-process daily snapshot cron.

- **Railway** (`railway.json` → `Dockerfile`) — `node dist/server.js`. The Docker
  build runs `npm run build` fresh (server + client) on every push to `main`, so
  it **self-builds from source** — committed `dist/` is NOT used. Health check
  `/health`.
- **cPanel / Phusion Passenger — RETIRED (2026-07-17).** No longer a deploy
  target. `app.js` (the Passenger entry) and the dual bare-path/`/api`-path route
  registration in `server.ts` remain as dormant, harmless code, but nothing
  serves the committed `dist/` anymore. **Do not commit `dist/`** — it is served
  by no one, and a source rebuild churns ~600 files on line-endings alone.
  The cPanel deploy scaffolding (`CPANEL_SETUP.md`, `Passengerfile.json`,
  `.cpanel.yml`, `startup.cjs`) has been removed; `app.js` is kept only as a
  local-run entry point (`npm start`/`npm run dev`).

(Vercel was the original target and is retired. Do not add `vercel.json`,
Vercel routes, builds, env, cron, or runtime settings back to this repo. If a
retired Vercel project starts reporting GitHub statuses again, disconnect or
delete that project outside the repo instead.)

Note: there is **no folder-convention auto-routing** anymore — every `api/**`
handler must be imported and `route()`-registered in `server.ts` or it is
unreachable. `server-routes.test.ts` enforces this both ways
(client call ↔ registration, and handler file ↔ wiring).

## Conventions

- Handlers are Vercel-style and check `req.method` directly (`GET`/`POST`/`DELETE`/`OPTIONS`); return early on `OPTIONS`.
- CORS lives in `api/_utils.ts` `cors()`; the Express server in `server.ts`
  mirrors the same origin allowlist and headers — **keep the two in sync** when
  changing allowed origins or custom headers (`x-admin-password`,
  `x-player-password`, `x-player-name`, `x-kv-token`, `x-client-fp`).
- Tests are colocated as `*.test.ts` next to the code under test and run with the
  built-in `node:test` runner via `tsx`. **`scripts/run-tests.mjs`** (the `test`
  script) **auto-discovers** them: it scans `api/`, `scripts/`, `shared/`,
  `shinobij.client/src/`, and `shinobij.client/scripts/` recursively for
  `*.test.{ts,mjs,cjs}` (skipping `node_modules/` and `dist/`), so a test
  colocated under one of those five roots runs with **no registration step**. Note
  each root is resolved from the repo root, so `shinobij.client/scripts` must be
  spelled out — a bare `scripts` means the repo-root one only. A test file
  **outside** those roots is invisible to the runner unless it is named in the
  short explicit list at the top of that script — which is why the two repo-root
  files (`cpanel-dns.test.cjs`, `server-routes.test.ts`) are listed there. Put new
  tests under a scan root, or they silently never run.
- Frontend conventions (the App.tsx drain rule and its line-budget ratchet) live
  in `shinobij.client/CLAUDE.md`, loaded when working under that directory.

## Security & Anti-Cheat

Full details in `docs/auth-and-anti-cheat-patterns.md`. The load-bearing invariants:

- **Auth is token-first.** A 24h HMAC session token (minted by `/api/player-auth`,
  requires `SESSION_SECRET`) is the preferred credential; the password is the
  fallback. The client (`shinobij.client/src/authFetch.ts`) must **not persist the
  plaintext password once a token exists**, and must keep working when the server
  issues no token (`SESSION_SECRET` unset). Online login always mints a fresh
  token, so the worst failure is a re-login, never a lockout.
- **Some accounts have no password at all** — Google sign-in
  (`api/_google-auth.ts`, `api/auth/google/*`) and guest play. They are extra
  doors to the same slug-keyed account, not a second identity system. Two rules
  follow: every password comparison must **fail closed** on a missing
  `hash`/`salt` (see the explicit guard in `verifyAgainst`, and do not reduce it
  to optional chaining), and those accounts must be **refused at creation** when
  `SESSION_SECRET` is unset, since they would have no way back in. Guests are
  reclaimed after 14 days by `api/cron/_guest-sweep.ts`, which rotates the
  session epoch rather than deleting it.
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
- Do not remove Railway support when changing API handlers. (cPanel/Passenger is retired; its dormant `app.js` and the dual-path `route()` registration can stay but need not be maintained.)
- When adding a new API endpoint, you must BOTH create the `api/**` handler AND
  import + `route()`-register it in `server.ts` — there is no auto-routing, so an
  unregistered handler is unreachable.
- **Do NOT commit `dist/`.** Railway self-builds from source on every push to
  `main`, and cPanel (which used to serve committed `dist/`) is retired — so a
  committed `dist/` is served by no one, and a source rebuild only churns it on
  line-endings.
- Keep CORS headers in `api/_utils.ts` and `server.ts` synchronized.
- Do not commit secrets, API keys, Supabase service keys, passwords, or `.env` contents.
- Always run the relevant tests before saying a task is complete.
- For frontend changes, run `npm run lint` inside `shinobij.client/`.
- For backend/API changes, run `npm test` from the repo root.
- **For any change to a SCREEN or COMPONENT, run the two e2e suites CI gates on.**
  Root `npm test` is `node:test` only — it never opens a browser — so a change
  that lints, typechecks and passes 6,300 unit tests can still redden CI. That
  is not hypothetical: it is how a pet-duel branch reached `main` in 2026-08 and
  failed the release gate on a screen it never touched. Both run from
  `shinobij.client/`, and both need a **client build first** (CI runs the root
  `npm run build` ahead of them) plus browsers once via
  `npm run test:e2e:install`:
  - `npm run test:e2e` — the cross-browser responsive + accessibility smoke
    (`e2e/`, 5 browser projects). ~2 min locally, ~5 min in CI.
  - `npm run test:e2e:combat-layout` — the combat layout / jutsu-arming matrix
    (`e2e-live/combat-layout-matrix.spec.ts`). **~11 min locally** — budget for
    it; it is much slower than its CI wall time suggests. Run it as
    `COMBAT_LAYOUT_CAPTURE_PHASE=after COMBAT_LAYOUT_STRICT=1 npm run
    test:e2e:combat-layout`; without those two you are running a laxer check
    than the gate does.

  For a narrow change, `npx playwright test <spec> --project=<name>` is seconds
  rather than minutes and is enough to clear a specific suspicion — but only the
  full suites match what CI will actually say.

  Two things that will stop you before any test runs, both verified 2026-08-16:
  - **Delete `shinobij.client/.playwright-dist-*` between runs.** The preview
    harness refuses to overwrite its own snapshot ("Refusing to overwrite
    pre-existing immutable snapshot"), so a previous run's leftover makes the
    webServer fail to start and every spec reports as failed without executing.
    It is gitignored, so `rm -rf shinobij.client/.playwright-dist-*` is free.
  - **WebKit DOES run here now** (re-verified 2026-08-17, Playwright 1.61.1 /
    WebKit 26.5). This entry used to say the opposite — `browserType.launch:
    Target page, context or browser has been closed` on every webkit project —
    and that stale note cost real money: two consecutive `main` CI failures were
    webkit-only regressions that nobody reproduced locally because everyone
    believed webkit was unlaunchable. **Run webkit before pushing anything that
    touches combat layout**; it is the browser CI fails on:
    ```bash
    npx playwright test --config=playwright.combat-layout.config.ts --project=webkit-layout
    ```
    A single webkit spec is ~30s, so there is no excuse for shipping blind. If
    webkit ever does fail to launch again, re-check this before believing it —
    the failure below is far more common and looks identical.
  - **A leftover preview server masquerades as a browser failure.** The harness
    dies with `http://127.0.0.1:<port>/health is already used` before a single
    spec executes — which reads exactly like a catastrophic browser regression.
    Since 2026-08-20 the local ports are **per-worktree** (derived in
    `shinobij.client/e2e-ports.ts`; the runner prints `[e2e] ... server port
    NNNN for this worktree` at startup — CI keeps the fixed 4173/4183), so a
    sibling session's run can no longer hold your port. A held port therefore
    means a process from **this** worktree. Before killing it, check its start
    time — a process that started minutes ago is probably a live run (yours or
    a sibling agent's in this same worktree), not an orphan; killing it made a
    live run's tests reconnect to the wrong server on 2026-08-20:
    ```bash
    netstat -ano | grep ":<port>.*LISTENING"   # note the PID, then:
    powershell -Command "Get-Process -Id <PID> | Select-Object StartTime, Path"
    ```
    Stop-Process only if it predates every run you know about; otherwise wait
    for the live run to finish (or override with `COMBAT_LAYOUT_PORT` /
    `PLAYWRIGHT_PORT` / `LIVE_E2E_PORT`).

  **These are flaky under load.** A single red e2e is not yet a regression: check
  whether the same spec passes on the other browser projects in that run, and
  re-run it locally before reverting anything. Two consecutive `main` runs in
  2026-08 failed on two *different* unrelated specs, and the first one passed on
  re-run. Read the failing assertion before believing the failure is yours.
  (The other suites — `test:e2e:live`, `:visual`, `:warfront` — are NOT in CI.
  Run them when touching what they cover, but they gate nothing.)

## Refactoring Rules

- Preserve existing behavior unless the task explicitly asks for a behavior change.
- Keep old function signatures as wrappers when extracting logic.
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
