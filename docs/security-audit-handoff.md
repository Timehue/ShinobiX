# ShinobiX Security Audit — Session Handoff

Status as of commit `bf37f0b` (pushed to `origin/main`, working tree clean).
This continues the 30-item "full audit consolidation" handoff. The companion
file `docs/security-audit-triage.md` has the per-item evidence; this file is
the **what's-done / what's-left + how-to**.

---

## TL;DR for the next session

1. **Read `docs/security-audit-triage.md` first** — it classifies all 30 items
   REAL / FALSE / ALREADY-HANDLED with file:line evidence. Don't re-audit.
2. **Two non-code items are still open and are the user's job, not yours:**
   - 🔴 **Rotate the leaked secrets** (dashboards) — see "Open: secrets" below.
   - **Optional git history purge** — runbook below; do NOT run in-place.
3. **Remaining CODE work:** #5 DONE (`cf80b50`), #16+#17 DONE (`bf37f0b`). Still
   open: **#14** (mandatory `_baseSaveVersion`), **#27** (Supabase RLS), plus the
   **#16/#17 follow-up** (lock the clan/village validators to reject treasury
   *increases* via the save blob now that the atomic endpoints exist — do this
   only after the migrated client has rolled out, or stale tabs break). Each
   wants its own plan + explicit user sign-off (balance/auth/schema-sensitive).
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
| `cf80b50` | **#5 stateless session tokens** — `issuePlayerToken`/`verifyPlayerToken` (HMAC-SHA256, constant-time, stateless); `authedPlayer` tries token first, falls back to password (ban check identical on both paths); `verify`/`register`/`change` return `{token}`; client stores + attaches `x-player-token` (token-only when present), silent refresh-on-401; `x-player-token` added to CORS allow-headers in **both** `_utils.ts` + `server.ts`; `api/_auth.test.ts` (9 cases). Cuts per-request scrypt cost. |
| `bf37f0b` | **#16+#17 atomic treasury donate** — new `POST /api/clan/treasury/donate` + `POST /api/village/treasury/donate` (nested-folder files → resolve on Vercel **and** cPanel). Each debits donor save + credits the shared treasury under dual KV locks (treasury row outer, donor inner), **debit-first** so a credit failure can't mint free treasury; self+membership gated, 30/min rate-limit, audit-logged. Shared IO-free core `api/_treasury-donate.ts` (+ `_treasury-donate.test.ts`, 15 cases). Client donate buttons (clan ryo/special/item/territory-scrolls + village ryo/special/item) migrated to the endpoints; clan XP / contrib / village contributionPoints / notices stay client-side, written on top of the returned treasury (zero-delta in the validators) — **no reward/balance logic moved server-side.** Registered in `server.ts`. **No payout/rate/formula changes.** |

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
radius first. Suggested order now: **#16/#17 follow-up → #14 → #27**.

### ✅ #16 + #17 — DONE (`bf37f0b`), with a follow-up still open
Atomic `POST /api/clan/treasury/donate` + `POST /api/village/treasury/donate`
now debit the donor and credit the treasury under dual locks (shared core
`api/_treasury-donate.ts`); the client donate buttons use them. This migrated
the legitimate traffic onto the safe path **but did NOT yet lock down the
validators** — by design, so old/stale client tabs don't break mid-rollout.

**FOLLOW-UP (open, needs sign-off): lock down the save-blob treasury path.**
- Files: `api/_clan-save-validate.ts` (treasury block ~L295-327, incl.
  `treasury.items` which still takes any 200-cap array), `api/_village-state-validate.ts`
  (treasury block ~L170-208, items ~L204-206).
- Change: reject treasury *increases* (currency deltas > 0 and net-new
  `treasury.items`) submitted via the save blob — they must now come from the
  donate endpoints. Allow zero-delta writes (the migrated client re-asserts the
  endpoint-credited treasury) and admin. This is what actually CLOSES #16's
  item-minting hole and #17's credit-without-debit hole.
- Do this **only after** the client in `bf37f0b` has rolled out to players, or
  a stale tab still crediting via the save blob will have its donation silently
  suppressed. Confirm rollout with the user first.
- Note: #16's secondary "same-length `warHistory` swap is content-unvalidated"
  is still open and untouched.

### #14 — Mandatory `_baseSaveVersion` (multi-tab conflict)  (LOW-MEDIUM)
- File: `api/save/[name].ts` (optimistic-concurrency check ~L1011-1026).
- Now: version check exists but is OPT-IN (skipped if client omits the field) for
  old-client compat.
- Direction: telemetry first (log how many saves arrive without the field), then
  once the client always sends it, make it required for player saves. Needs a
  client rollout BEFORE tightening or it locks out stale tabs.

### ✅ #5 — Token/session auth — DONE (`cf80b50`)
Stateless HMAC session tokens (`issuePlayerToken`/`verifyPlayerToken` in
`api/_auth.ts`); login/register/change return `{token}`; client stores +
attaches `x-player-token`, falls back to password, silent refresh-on-401.
Raw password is still persisted as the fallback credential, but the per-request
path is now token-first (no scrypt). If you want to fully stop persisting the
raw password, that's a further step on top of this.

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
