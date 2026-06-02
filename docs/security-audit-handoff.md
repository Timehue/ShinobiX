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
   - **#14 step 2 — DONE this run** (client prerequisite + server enforcement;
     user-authorized for the low-traffic test env). Non-clan player saves without a
     numeric `_baseSaveVersion` are now rejected (426); admins exempt, current/
     post-2026-05-26 clients unaffected, only pre-`3455f8d` tabs forced to refresh.
     **Deploy + watch:** confirm no legit-client 426s after the new client rolls
     out (telemetry `telemetry:save-noversion:<date>` in `public.kv_store`; read it
     directly, NOT via `/api/kv/get` — see #14 below).
   - **#17 currency credit-without-debit — ✅ Stage 1 DONE** (refactor, this run).
     All live save-blob treasury-currency increases (clan + village) are now
     rejected by the validators; legit credits flow through atomic server
     endpoints — `donate` (clan+village), clan `territory/collect-supply`, village
     `claim-daily-agenda` — each re-asserted at zero delta. (The earlier
     "clan-war ryo" blocker was DEAD code; agenda + warSupply are now endpoints.)
     Remaining is broad **#7/Stage 3**: move PERSONAL ryo/XP/seals/ranked-rating
     crediting server-side (server-owned daily counters + receipts).
   The #27 `revoke select … from authenticated` hardening is now **APPLIED**
   (2026-06-01, user-approved).
   - **Residual hardening DONE (`0e02527`, 2026-06-01):** #10 (`failClosed`
     locks on the currency/treasury endpoints), #8 (chat POST 503 on session-
     lookup throw), #23-partial (internal-host image-URL rejection). #29 closed
     as no-change (N+1 already gone; only an O(n) scan remains → indexes deferred).
     See the DONE table row. **The only substantive code item left is #7/Stage 3**
     (server-authoritative PERSONAL rewards) — large, balance-sensitive, needs a
     plan + explicit sign-off. Smaller leftovers that remain by choice: #23 pet-
     image ownership (blocked on a client save-then-upload change), #5 stop
     persisting the raw password (further step on top of tokens).
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
| `0e02527` | **Residual hardening (#8, #10, #23 partial; #29 closed-as-no-change)** — **#10:** opt-in `failClosed` on `withKvLock` (throws `LockContendedError` instead of running the critical section unlocked when the lock can't be acquired); applied to the currency/treasury endpoints (clan+village donate both nested locks, treasury-transfer outer+both credit locks, collect-supply per-sector+treasury locks, seal-pool donate full RMW + distribute **pool lock only**). **Deliberately NOT** failClosed where a throw would *lose* currency: `claim-daily-agenda` (NX marker already consumed) + distribute's recipient-credit lock (pool already debited) — both documented in-code. Refactored to `withLockCore` over injected `LockPrimitives` (testable; `withKvLock` unchanged wrapper); `api/_lock.test.ts`. **#8:** `pvp/chat` POST returns **503** on a session-lookup *throw* (was silently posting a fighter's line tagged `spectator`); `null` session (post-battle banter) still → spectator. **#23 (partial):** image URLs to internal/non-public hosts rejected (localhost, private/loopback/link-local/CGNAT IPv4, IPv6 ULA, numeric/hex IP obfuscation, internal TLDs); public CDN + data URLs unaffected; `api/images.test.ts`. **Pet-image ownership still deferred** — the client publishes `pet:<id>` *before* the debounced autosave persists the pet, so a save-read check would 403 real uploads (documented in `images.ts`). **#29:** no code change — the N+1 individual-get pattern is already gone in roster/bloodlines/injured-villagers (single `keys`-scan + one `mget`); remaining O(n) scan needs secondary indexes (deferred until scale demands). **No payout/rate/formula changes.** Suite 182/182. |

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

### ✅ #16 DONE; ✅ #17 Stage 1 DONE (currency lockdown + server endpoints)
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

**#17 currency credit-without-debit — server-authoritative refactor, ✅ Stage 1 DONE.**
Correction to the earlier note: the "clan-war victory ryo" credit (`_resolveClanWar`)
is **dead code** (`void`-suppressed, superseded by the live `/api/clan/war/*`
endpoints), so clan-treasury currencies have NO live save-blob increase except
`warSupply` collection. The live save-blob currency increases are only:
clan `warSupply` (`collectTerritoryWarSupply`) and the village daily-agenda
(`claimVillageAgenda` → +honorSeals/ryo/boneCharms). Stage 1 closes #17 in steps:
- **✅ Step 1a — DONE (this run):** `_clan-save-validate.ts` now REJECTS save-blob
  increases for clan `ryo/fateShards/boneCharms/auraStones/mythicSeals`
  (credit-without-debit) — donations re-assert zero-delta, nothing else credits
  them. Admin exempt; decreases + zero-delta allowed. (As of 1b, **warSupply is
  blocked too** — see below; ALL clan-treasury currency increases via the save
  blob are now rejected.)
- **✅ Step 1b — DONE (this run):** `POST /api/clan/territory/collect-supply`
  (`api/clan/territory/collect-supply.ts` + pure core `api/_territory-supply.ts`,
  tested; registered in `server.ts`). Scans `world:territory:*`, recomputes each
  owned sector's accrual server-side (mirrors `produceSectorWarSupply`), zeroes
  sectors under per-sector locks (debit-first), then credits the clan treasury
  `warSupply` under the clan-save lock; idempotent (2nd call collects 0). Client
  `collectTerritoryWarSupply` now calls it and re-asserts the returned treasury.
  The validator now rejects save-blob `warSupply` increases too. Also fixes the
  latent +100-truncation bug. **Permission note:** gated at clan MEMBERSHIP (like
  donate) since collection only feeds the shared treasury — the "leader/elder"
  restriction stays a client UI gate (`canSpendTerritoryScrolls`), not a server
  boundary (faithfully porting the contribution-rank role model server-side was
  fragile and unnecessary for a no-personal-gain action).
- **✅ Step 1c — DONE (this run):** `POST /api/village/claim-daily-agenda`
  (`api/village/claim-daily-agenda.ts`; registered in `server.ts`) credits the
  FIXED shared-treasury amounts (+15 HS/+1500 ryo/+2 BC) at most once per player
  per UTC day, gated by an NX marker `agenda-claimed:<village>:<player>:<date>`
  (no player-save write → can't race the autosave version guard). Client
  `claimVillageAgenda` calls it, re-asserts the returned treasury, and handles
  `alreadyClaimed` (cross-device) without double-crediting. `_village-state-validate.ts`
  now rejects save-blob village-treasury currency increases (admin exempt;
  decreases stay seatedKage-gated; contributionPoints stays client-credited).
  **Scope (lean, by design):** this closes #17's arbitrary-amount + repeat
  vectors on the shared treasury. It deliberately does NOT (a) re-verify task
  completion — the daily counters are still client-incremented, a Stage-3 item —
  or (b) move the PERSONAL agenda reward (player ryo/seals) server-side — that's
  the player's own currency, capped by the save sanitizer, also broad-#7/Stage-3.
- **✅ #17 Stage 1 COMPLETE.** All live save-blob treasury-currency increases
  (clan ryo/fate/bone/aura/mythic + warSupply; village all 6) are now rejected by
  the validators; the legitimate credits flow through atomic server endpoints
  (donate / collect-supply / claim-daily-agenda), each re-asserted at zero delta.
  Remaining #7/Stage-3 work (separate): move PERSONAL ryo/XP/seals/ranked-rating
  crediting server-side (server-owned daily counters + receipts), which also
  enables true agenda task-verification.
- ✅ #16's secondary "same-length `warHistory` swap" — DONE (this run).
  `_clan-save-validate.ts` now treats a same-length `warHistory` write as a
  verbatim re-assert (allowed for anyone) vs a content change (allowed only for
  admin-role — same trust as adding an entry). Previously ANY member could
  rewrite an entry's result / reward / `warCrateId` to mint a War Crate claim
  without growing the array. The leadership war-finalization at the 12-entry cap
  (prepend + drop oldest = same length) still works (`callerIsAdminRole`). Tests
  added to `_clan-save-validate.test.ts`. The deeper "validate war-record content
  against the actual war result" is server-authoritative-rewards territory (#7).

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
  - **Server enforcement — DONE (this run, user-authorized for the test env).**
    `api/save/[name].ts` now REJECTS a non-clan player save with no version stamp
    (HTTP 426 + `code:CLIENT_REFRESH_REQUIRED`) instead of allowing it, via the
    pure helper `isVersionlessPlayerSave(isClanSave, identityName, baseVersion)` in
    `api/save/_save-version.js` (tested in `_save-version.test.ts`). Telemetry is
    still recorded on the rejected path. Rationale it's safe despite the telemetry
    gate being unconfirmable (no traffic since May 30): **admins are exempt**
    (authFetch attaches `x-admin-password` on every request when logged in →
    `identityName === null`); the **current client echoes a numeric version on
    every own-save path** so it's never rejected; **post-2026-05-26 clients** echo
    `0+` on autosave (and any rejected immediate save is masked by the next
    autosave, which persists the same state with a version); only **pre-2026-05-26
    (`3455f8d`) tabs** — which don't echo at all — are hard-rejected and must
    refresh. The game is in low-traffic testing, so that population is ~0. If a
    legitimate client is ever rejected, the message tells the user to refresh.
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
- Documented the posture + rationale in the schema header and corrected the
  triage note.
- **Defense-in-depth hardening — APPLIED 2026-06-01 (user-approved).** Migration
  `harden_kv_store_revoke_authenticated_select` ran `revoke select on
  public.kv_store from authenticated;` on prod (`soaychxshtbgwujhytsf`), and
  `supabase-schema.sql` no longer re-grants select to `authenticated` (the
  `revoke all … from authenticated` stands alone). Verified post-apply: the
  `authenticated` grant is gone; the `anon` SELECT grant + `kv_store_anon_select`
  policy + RLS are untouched, so live Realtime (PvP / clan-war duels / challenge
  inbox) is unaffected. Reverse with `grant select on public.kv_store to
  authenticated;` if ever needed.

---

## Partially-addressed (note for completeness)

- **#7 server-authoritative rewards — Stage 3 ran 2026-06-01; see
  `docs/security-audit-7-stage3-plan.md` for the full design + outcome.** Shipped
  to `main`: Phase 0 (`_credit-player`/`_ranked-rating`/`_xp-engine` cores), Phase 1
  (ranked rating, player + pet — server-authoritative incl. sanitizer reject),
  Phase 2 (village daily-agenda + map-control personal rewards), Phase 3 (PvP-win
  base ryo + XP via the verbatim `gainXp` port on `claim-rewards`, convergence-safe),
  and Phase 4f (bank-interest claim). **Phase 4 CLOSED under "Option A (pragmatic,
  no rewrite)":** bank interest was the only further source reachable without a
  rewrite. The recon conclusion (in the plan doc) is that genuinely server-
  authoritative ryo/xp — and any cap reduction — needs **Option B**: a server-owned
  **ledger** for `ryo`/`xp`/`level` (client reads server values instead of self-
  applying, so the sanitizer can flip cap→reject) **plus** server-side run/battle
  verification (tower, story, missions, AI-kills — none are verifiable today; the
  Endless Tower alone legitimately banks ~2M ryo / ~700K raw XP in one save, which
  pins the per-save cap). That is a deliberate multi-week future program. The save
  sanitizer caps remain the economic gate for all still-client-applied sources.
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
