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
3. **Remaining CODE work:** #5 DONE (`cf80b50`), #16+#17 atomic endpoints DONE
   (`bf37f0b`), **#16 item-mint lockdown DONE** (this run — validators reject
   net-new `treasury.items`), **#14 step 1 (telemetry) DONE**, **#27 CLOSED**
   (verified service-role-only + documented; per-player RLS N/A for this auth
   model). Still open:
   - **#14 step 2** — make `_baseSaveVersion` mandatory. **Client prerequisite DONE
     this run** (the immediate-save path now echoes the version too). **Server
     enforcement still GATED**: needs (a) the fixed client deployed to Vercel, and
     (b) the `telemetry:save-noversion:<date>` daily count to stay ~0. **GATE NOT MET
     as of 2026-06-01**: no telemetry rows + no base-store traffic since
     2026-05-30 22:34 UTC, so no signal exists yet. Read it from `public.kv_store`
     directly (NOT `/api/kv/get` — see #14 below).
   - **#17 currency credit-without-debit** — NOT hard-blockable via the save-blob
     validators: clan-war/agenda/warSupply rewards credit currencies through the
     same path and would be deleted. Caps remain the bound; full close needs a
     #7-class server-authoritative-rewards refactor. (Client IS deployed on
     Vercel — cPanel/theravensark is storage-only, never player-facing.)
   Optional, anytime: the #27 `revoke select … from authenticated` hardening
   (needs approval). Each wants explicit user sign-off (balance/auth/schema).
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

### ✅ #16 (item-mint) DONE; #17 currency side partially open by design
Atomic `POST /api/clan/treasury/donate` + `POST /api/village/treasury/donate`
(`bf37f0b`) debit the donor and credit the treasury under dual locks (shared
core `api/_treasury-donate.ts`); the client donate buttons use them and
re-assert the endpoint-credited treasury verbatim (zero-delta save).

**Hosting reality (confirmed by user 2026-06-01):** players use the Vercel
deploy (`test-five-delta-37.vercel.app`, pending a real domain). **cPanel /
theravensark.com is NEVER player-facing** — it's storage only (disk KV overlay
for `save:`/`shared:images*`, taking load off Vercel/Supabase). Vercel rebuilds
the client from source on every deploy, so the committed `shinobij.client/dist`
is vestigial (it only feeds cPanel's static serve, which no player hits).
Verified the live Vercel bundle (`index-D-c8lHku.js`) contains both
`/api/(clan|village)/treasury/donate` calls + the `x-player-token` (#5) client →
**the bf37f0b client IS deployed to players.** (Supersedes the earlier
"client not deployed" note, which mistakenly checked cPanel's stale dist.)

**✅ Items lockdown — DONE (this run).** `api/_clan-save-validate.ts` +
`api/_village-state-validate.ts` now reject net-new `treasury.items` submitted
via the save blob: incoming items are normalized (shared `cleanTreasuryItems`)
and any itemId whose count *rises* — or a brand-new itemId — reverts to prev and
logs a suppressed reason. Re-assert (equal) and removals/withdrawals are allowed;
admin bypasses. No gameplay reward adds treasury items via the save blob (every
non-donation item write is a removal), so this is safe. New tests:
`api/_clan-save-validate.test.ts` + `api/_village-state-validate.test.ts`. This
closes #16's `treasury.items` minting hole.

**⚠️ #17 currency credit-without-debit — deliberately NOT hard-blocked.** A
blanket "reject currency increases via the save blob" was the original plan but
is UNSAFE: several gameplay rewards still credit currencies through the save blob
and are indistinguishable from a fake donation in the same field —
clan `warSupply` collection (`App.tsx:21884`, and warSupply is non-donatable by
design), clan-war victory ryo (`App.tsx:21903`, +4000/+1500), and daily-agenda
village currencies (`App.tsx:23042`, +honorSeals/ryo/boneCharms). Blocking
increases would silently delete those. The per-call caps remain the bound
(defense-in-depth). Fully closing #17's currency side needs those rewards moved
server-side — a #7-class server-authoritative-rewards refactor, tracked separately.
- Note: #16's secondary "same-length `warHistory` swap is content-unvalidated"
  is still open and untouched.

### #14 — Mandatory `_baseSaveVersion` (multi-tab conflict)  (LOW-MEDIUM)
- File: `api/save/[name].ts` (optimistic-concurrency guard) + pure helpers in
  `api/save/_save-version.ts` (`parseBaseSaveVersion`, `saveVersionTelemetryKey`).
- **Step 1 — telemetry: DONE (this run).** A non-clan PLAYER save arriving
  without a valid `_baseSaveVersion` now increments a best-effort daily counter
  `telemetry:save-noversion:<UTC-date>` (`{count,lastPlayer,lastAt}`, 45-day TTL)
  and logs `[save-version-telemetry] …`. Admin saves + clan saves excluded. Only
  fires on the missing path → ~zero overhead once clients roll over. **Correction:**
  the autosave timers (debounce/interval/unload) echo the field, but the
  immediate-save helper `pushSaveToServer` (new-character / pet / bloodline saves)
  did NOT — so the *current* client also produced versionless saves. Fixed this run
  (see step-2 prerequisite below). Once the fixed client deploys, a nonzero count =
  truly ancient (pre-2026-05-26, before `3455f8d`) tabs.
  - **Read it (CORRECTED):** the `telemetry:` prefix routes to the **BASE store**
    (Supabase `public.kv_store`), **not** the disk overlay — so the `/api/kv/get`
    proxy (which reads ONLY the disk overlay, see `api/_storage.ts:_DISK_PREFIXES`)
    always returns `null` for this key. Ignore the old "GET /api/kv/get" note.
    Query the row directly instead, e.g. SQL via Supabase/MCP:
    `SELECT value, updated_at FROM public.kv_store WHERE key LIKE 'telemetry:save-noversion:%' ORDER BY key DESC;`
    (per-day key e.g. `telemetry:save-noversion:2026-06-01`). Watch the daily
    `count` trend toward zero across consecutive days.
  - **Gate status checked 2026-06-01:** **NOT met — no signal exists yet.** Zero
    `telemetry:save-noversion:*` rows in `kv_store`, AND the base store has had no
    writes of *any* prefix since `2026-05-30 22:34 UTC` (newest `ratelimit:`/
    `presence:`/`player:` rows), i.e. ~no production traffic since May 30. The
    telemetry code (`757b46f`) only landed 2026-06-01, so there is neither a
    confirmed-zero nor a nonzero — just no data. Step 2 stays blocked until traffic
    resumes and several days of ~0 counts accumulate. Do NOT tighten on an empty table.
- **Step 2 — client prerequisite DONE (this run); server enforcement still OPEN.**
  - **Prerequisite (DONE):** the immediate-save helper `pushSaveToServer`
    (`shinobij.client/src/App.tsx`) now echoes `_baseSaveVersion` for the player's
    OWN saves (new-character, pet, bloodline) and updates the version ref from the
    response (so the next autosave doesn't stale-conflict); it reconciles on 409
    like the autosave timers. Admin saves to *another* player's slot (the admin
    panel `onSave`) pass `echoVersion:false` — the ref tracks THIS player, not the
    target. So once this client deploys, EVERY non-admin own-save carries a numeric
    version and the telemetry `count` should be 0 (only pre-`3455f8d` tabs lack it).
  - **Server enforcement (OPEN, needs sign-off + the data):** once this client is
    deployed AND the daily count stays ~0 for a sustained window, change
    `api/save/[name].ts` (the `baseVersion === null` branch ~L1051) to REJECT
    (e.g. 426/410) instead of allowing. **Do NOT do this before the client above
    deploys**, or current-client immediate saves (which only just started echoing)
    on not-yet-refreshed tabs break. `parseBaseSaveVersion` returns `0` (not null)
    for the current client, so enforcement only rejects field-absent (ancient)
    saves — new players send `0` and pass.
  - Cross-player grants via `patchPlayerSaveCharacter` POST no version and are
    admin-gated (identityName === null → already exempt). Keep admin exempt.

### ✅ #5 — Token/session auth — DONE (`cf80b50`)
Stateless HMAC session tokens (`issuePlayerToken`/`verifyPlayerToken` in
`api/_auth.ts`); login/register/change return `{token}`; client stores +
attaches `x-player-token`, falls back to password, silent refresh-on-401.
Raw password is still persisted as the fallback credential, but the per-request
path is now token-first (no scrypt). If you want to fully stop persisting the
raw password, that's a further step on top of this.

### ✅ #27 — Supabase RLS for `save:` rows — CLOSED (verified + documented, this run)
- File: `supabase-schema.sql` (header "Security posture — audit item #27").
- Verified: `save:%` (+ auth / IP / fingerprint rows) are **already service-role-
  only**. The anon SELECT policy allows only `pvp:%` / `cw-tilecards:%` /
  `challenges:%`; the `authenticated` role has **no policy**, so RLS denies it
  every row by default (the triage's "broad SELECT" was the grant, neutralised by
  deny-by-default — not effective access).
- The proposed "per-player RLS on `save:%`" is **N/A**: players use the game's own
  session-token auth, not Supabase Auth → the browser is always `anon` (Realtime
  only), so there's no `auth.uid()` to scope an owner policy on. Implementing it
  would require migrating auth into Supabase Auth (out of scope; #5 already did
  app-side tokens).
- **No schema change made** (user chose verify-and-document). Documented the
  posture + the rationale in the schema header and corrected the triage note.
- **Optional future hardening (needs approval, idempotent):**
  `revoke select on public.kv_store from authenticated;` — kills the latent "if
  RLS is ever disabled, authenticated sees everything" footgun (the app never uses
  that role). Left unapplied to avoid an unreviewed schema change; if applied, do
  NOT touch the anon SELECT/policy (live Realtime: PvP / clan-war duels / challenge
  inbox depend on it) and re-test those after.

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
