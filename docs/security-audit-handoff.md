# ShinobiX Security Audit — Session Handoff

Status as of commit `5b17321` (branch `claude/romantic-noyce-9e11d4`, pushed to
`origin/main`, working tree clean). This continues the 30-item "full audit
consolidation" handoff. The companion file `docs/security-audit-triage.md` has
the per-item evidence; this file is the **what's-done / what's-left + how-to**.

---

## TL;DR for the next session

1. **Read `docs/security-audit-triage.md` first** — it classifies all 30 items
   REAL / FALSE / ALREADY-HANDLED with file:line evidence. Don't re-audit.
2. **Two non-code items are still open and are the user's job, not yours:**
   - 🔴 **Rotate the leaked secrets** (dashboards) — see "Open: secrets" below.
   - **Optional git history purge** — runbook below; do NOT run in-place.
3. **The remaining CODE work is the "larger/rollout" bucket (#5, #14, #16, #17,
   #27).** Each needs a client rollout or Supabase schema change, so each wants
   its own plan + explicit user sign-off (balance/auth/schema-sensitive).
4. **Hard rules still apply** (see CLAUDE.md): no payout/rate/formula changes
   without explicit ask; keep Vercel + cPanel in sync; never edit `dist/` as
   source — fix TS, `npm run build`, commit the rebuilt dist; always run
   `npm test` (repo root) and `npm run lint` (in `shinobij.client/`).

---

## Environment quirks (read before working — these bit the last session)

- **Repo layout:** this is a **linked git worktree**. `git rev-parse
  --git-common-dir` → the shared `.git` is at `C:/Users/Tyler R/source/repos/NinjaK/.git`,
  shared by ~35 worktrees on ~32 branches. This matters ONLY for history-rewrite
  (see purge runbook). Normal commits/pushes are fine.
- **Shell:** Windows. Bash tool works but `cd "C:\..."` with parens in the path
  fails — use forward-slash quoted paths: `cd "C:/Users/Tyler R/source/repos/NinjaK/.vs/NinjaK/.claude/worktrees/romantic-noyce-9e11d4"`.
  PowerShell is 5.1 — no `??`, no `&&` chaining (use `; if ($?) {}`).
- **The path contains `[name]`** (`api/save/[name].ts`). Bash globbing chokes on
  the brackets; quote the path: `git add "api/save/[name].ts"`.
- **`dist/` is committed and served by cPanel** (`app.js` → `require('./dist/server.js')`).
  After any `api/**` or `server.ts` change you MUST `npm run build:server` and
  commit the regenerated `dist/api/**.js` alongside the source, or cPanel runs
  stale code. `npm run build` also runs `verify:dist`.
- **`.git` LF→CRLF warnings on `git add dist/**`** are harmless noise.
- **Tooling occasionally buffers/► reorders tool output** and once silently
  cancelled a commit mid-batch. After any commit/push, VERIFY with
  `git log -1 --oneline` + `git rev-parse origin/main` before moving on.
- **`git status` shows EOL-only churn** on ~5 untracked-adjacent files and an
  untracked `.claude/` dir — both pre-existing, unrelated; leave them.

---

## Commands

- Backend tests: `npm test` (repo root) — currently **103 passing**.
- Type-check server: `npx tsc -p tsconfig.cpanel.json` (exit 0 = clean).
- Build server bundle: `npm run build:server` (→ `dist/`).
- Verify bundle: `npm run verify:dist`.
- Client lint: `cd shinobij.client && npm run lint` (required for client edits).
- Full build: `npm run build` (server + client + verify).

---

## DONE (shipped to origin/main this run)

| Commit | What |
|--------|------|
| `1db7542` | **cPanel route parity** — registered all 28 client-used handlers in `server.ts`; added `server-routes.test.ts` parity guard; `.cpanel.yml` fails loudly if `dist/server.js` missing; `scripts/verify-dist.mjs`; restart endpoint hardened (dedicated `RESTART_TOKEN`, constant-time, rate-limited, audit-logged); removed unused `cpanel-deploy/`. |
| `0069b0f` | **Secret scrub** — removed hardcoded OpenAI key (`ShinobiJ.Server/appsettings.Development.json`) + Postgres password (`scripts/check-images.mjs`); env-only + fail-closed; `.gitignore` + `.example` template. **Does NOT revoke the live secrets — rotation still required.** |
| `60f2d91` | **Triage doc** (`docs/security-audit-triage.md`) — read-only verification of all 30 items. |
| `63682a4` | **Batch 1+2** — #6 admin→`isFullAdmin` (save-snapshot, snapshot cron, moderation; moderation also dropped body-password); #21 challenge DELETE ownership gate; #28 crypto `randomUUID` for battleId + ranked challenge id; #20 world-state GET 503 `degraded` on KV failure (no silent empty map); #22 guard char projected via shared `stripNonCombatFields`; #23 images GET error → `no-store`; #24 roster sensitive-field-name regex guard. |
| `7e6dca6` | **Batch 4** — #3 KV proxy IP-allowlist (opt-in) + per-IP failed-auth throttle + audit logs; #11 `enforceRateLimitKv({strict})` per-instance fallback on KV outage (applied to `generate-image`); #29 `admin/players` single `mget` instead of N gets; #26 `.NET Program.cs` 404s all `/api` outside Development; added `api/_ratelimit.test.ts`. |
| `5b17321` | **Batch 3** — #12 `warGroundBountyDate` clamped to server UTC; #13 registry built from sanitized payload not raw; #7 claim-rewards fail-open scoped to NX reserve only (real errors now 500); #25 weekly-boss crash-resumable + exactly-once distribution (per-`(week,player)` NX receipt, `creditedPlayers[]`, flag flipped only after all credits land). **No payout/rate/formula changes.** |

Items verified **FALSE / already-handled** in triage (do not redo): #4 (account
takeover — register blocks existing-save names), #9 (PvP move concurrency — lock
already present), #15 (save lock release), #18 (war score verification — already
cross-validated), #19 (clan war outage — already 500s not []), #30 (route smoke
test — built `1db7542`).

---

## OPEN — non-code (user action required)

### 🔴 Secret rotation (highest priority, only the user can do this)
The scrub removed secrets from the working tree but they remain VALID and live in
git history / on GitHub. The user said they'd rotate. Confirm done; until then the
leaked values still work. Rotate ALL of:
- **OpenAI API key** (was in `appsettings.Development.json`).
- **Supabase Postgres password** (was in `scripts/check-images.mjs` conn string).
- **Supabase `service_role` key** (appeared in an earlier commit per triage).
After rotating, update env vars on **Vercel**, **cPanel**, and local `.env`.

### Git history purge (optional, deferred — do NOT run in-place)
The user chose "purge + force-push" but it's unsafe in this shared-worktree repo:
`git filter-repo` in-place would rewrite ~32 branches and orphan all ~35
worktrees. Safe runbook (run only when no other worktree sessions are active):
1. Fresh **bare** clone elsewhere: `git clone --mirror <url> shinobix-mirror`.
2. `pip install git-filter-repo` (Python 3.14 is available; module not yet
   installed). Run `git filter-repo --replace-text <patterns.txt>` against the
   mirror to strip the OpenAI key, the pg password, and the service_role JWT.
3. `git push --force` the mirror back.
4. Every existing worktree/clone is now invalid → re-clone.
Rotation (above) makes the historical values dead regardless, so this is
defense-in-depth, not the actual fix.

---

## OPEN — code (the "larger/rollout" bucket; each needs a plan + sign-off)

These were intentionally NOT done as drive-bys: each touches auth/economy/schema
and needs a client rollout or migration. Tackle one at a time, smallest blast
radius first. Suggested order: **#16 → #17 → #14 → #5 → #27**.

### #16 — Clan-save authority: treasury.items ownership  (MEDIUM)
- File: `api/_clan-save-validate.ts` (treasury.items handling, ~L295-327).
- Now: incoming `treasury.items` accepted with only a 200-item cap, no ownership
  check. A regular member can POST arbitrary item objects.
- Direction: validate item additions server-side (route through an authorized
  endpoint / verify against the donor's inventory) rather than trusting the
  clan-save blob. Same-length `warHistory` swap is also content-unvalidated.
- Risk: clan data is veteran-sensitive — must NOT wipe existing treasury/history.

### #17 — Atomic treasury donate endpoints  (MEDIUM)
- Files: `api/_clan-save-validate.ts`, `api/_village-state-validate.ts`,
  pattern to copy: `api/village/treasury-transfer.ts` (already atomic, Kage-only).
- Now: generic clan/village treasury CREDITS via the save validators use a
  "trust-the-debit" model (explicitly noted in-code) — a client can credit the
  treasury without debiting their save (bounded by per-call caps). Honor Seals
  already have an atomic donate endpoint (`api/clan/seal-pool/donate.ts`) — mirror
  that for ryo/fate/bone/aura/etc.
- Direction: new `POST /api/clan/treasury/donate` (and village equivalent) that
  debits donor save + credits treasury under dual locks, like treasury-transfer.
- Remember: new endpoint must be registered in BOTH `api/**` (Vercel) AND
  `server.ts` (cPanel), and `server-routes.test.ts` will enforce it.

### #14 — Mandatory `_baseSaveVersion` (multi-tab conflict)  (LOW-MEDIUM)
- File: `api/save/[name].ts` (optimistic-concurrency check ~L1011-1026).
- Now: version check exists but is OPT-IN (skipped if client omits the field) for
  old-client compat.
- Direction: telemetry first (log how many saves arrive without the field), then
  once the client always sends it, make it required for player saves. Needs a
  client rollout BEFORE tightening or it locks out stale tabs.

### #5 — Token/session auth (stop raw passwords in browser storage)  (LARGER)
- Files: `shinobij.client/src/authFetch.ts`, `App.tsx`; server `api/_auth.ts`,
  `api/player-auth.ts`.
- Now: player password persisted in localStorage, admin pw in sessionStorage; the
  fetch interceptor attaches them to every `/api/` call.
- Direction: move to short-lived signed session tokens (issue on login, verify
  server-side, refresh). This is a real auth-model change — design doc + the
  user's explicit OK first. Per CLAUDE.md, explain the risk before touching auth.

### #27 — Supabase RLS for `save:` rows  (LARGER, schema)
- File: `supabase-schema.sql`. Triage rated this LOW (anon is already restricted
  to `pvp:%`, `cw-tilecards:%`, `challenges:%`).
- Now: the `authenticated` role has broad SELECT; protection relies on app-layer
  projections (single failure point).
- Direction: per-player RLS so a logged-in user can only SELECT their own
  `save:<name>`. **Do NOT change schema without approval** (CLAUDE.md hard rule)
  and test against live realtime subscriptions, which depend on the anon allowlist.

---

## Partially-addressed (note for completeness)

- **#7 server-authoritative rewards** — Batch 3 made claim-rewards honest about
  errors, but the deeper model (client still self-applies ryo/XP/ranked-rating
  then autosaves; server endpoint is only a double-fire guard) is unchanged. Full
  server-authoritative payouts (server credits, client only displays) is a large
  reward-system refactor — same caution class as #5. The save sanitizer remains
  the real economic gate.
- **#29 full KV scans** — fixed the worst offender (`admin/players` N-gets). The
  others (`roster`, `bloodlines/list`, `injured-villagers`) already use `mget`
  but still do a full `keys('*')` scan (one indexed query, not N). True
  pagination/secondary indexes would be a larger change if scale demands it.

---

## How to pick up

1. `cd` into the worktree, `git fetch origin`, confirm `git rev-parse HEAD ==
   origin/main` (should be `5b17321` or later).
2. Skim `docs/security-audit-triage.md`.
3. Pick ONE larger/rollout item, write a short plan, get user sign-off.
4. Edit TS source → `npx tsc -p tsconfig.cpanel.json` → `npm test` →
   `npm run build:server` (commit rebuilt dist) → client `npm run lint` if client
   touched → commit (Co-Authored-By trailer per CLAUDE.md) → push `HEAD:main`
   (verify it's a clean fast-forward first) → confirm `origin/main` moved.
