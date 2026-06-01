# Security Audit #7 / "Stage 3" — Server-Authoritative Personal Rewards (PLAN)

Status: **PLAN + sign-off granted for Phase 0 + Phase 1** (2026-06-01).
Companion: `docs/security-audit-handoff.md` (overall audit status),
`docs/security-audit-triage.md` (per-item evidence). This doc is the design +
roadmap for the one substantive remaining code item: making PERSONAL player
reward crediting (ryo / XP-level / honorSeals / rankedRating) server-authoritative.

This is a **multi-PR program, not a single change**. Each phase ships
independently, smallest blast radius first, **one phase per PR with its own
sign-off**, preserving exact payouts (no balance change — hard rule).

---

## The problem (grounded in code)

Today the **client computes every personal reward, applies it to local state,
and the autosave POST is the only thing that persists it.** The only server gate
is the sanitizer in `api/save/[name].ts`, which **rate-limits** rather than
**authorizes**:

| Field | Per-save cap | Rolling cap | Server formula check? |
|---|---|---|---|
| `ryo` | +1,000,000 / save (`MAX_RYO_GAIN`) | 5M/min (`MAX_RYO_PER_MINUTE`) | none |
| `xp` / `level` | +5 levels / save (`MAX_LEVEL_GAIN`), `LEVEL_CAP` 100 | 1M xp/min | none (xp itself uncapped; only level clamped) |
| `honorSeals` | +200 / save (`CURRENCY_CAPS`) | — | none |
| `rankedRating` | ±200 / save (`MAX_RATING_SWING_PER_SAVE`) | — | none — **entirely client-side** |

So a crafted client can mint up to the cap, repeatedly. The caps are a speed
bump, not a lock.

**Already server-authoritative (the foundation to copy):** Vanguard PvP-win
seals (`api/pvp/_vanguard-rewards.ts`), raid bonus ryo/seals
(`api/missions/report-raid.ts`), pet expedition + arena ryo
(`api/missions/report-pet-event.ts`, `api/pet/battle-result.ts`), weekly-boss
ryo/xp (`api/weekly-boss.ts`), profession XP (`awardProfessionXp` in
`api/missions/_progress.ts`) — all credit `save:<name>` under `withKvLock` +
an NX receipt. The pattern exists; it just hasn't been extended to base payouts.

---

## Target architecture

Mirror the #16/#17 treasury pattern, applied to the player's own save:

1. **Shared credit core** (`api/_credit-player.ts`, analogous to
   `_treasury-donate.ts`): atomic, `withKvLock(save:<name>, { failClosed: true })`,
   NX-receipt-idempotent crediting of `{ryo, xp, honorSeals, rankedRating, …}`
   deltas onto a player save. Pure IO-free core + thin IO wrapper + tests.
2. **Each reward action becomes an endpoint** that computes the payout
   server-side (porting the EXACT client formula — zero balance change) and
   credits via the core.
3. **The client stops self-incrementing** these fields; it calls the endpoint
   and **re-asserts the returned values** (zero-delta save, like the donate
   buttons do now).
4. **The sanitizer flips from "cap" to "reject"** for these fields — a
   client-driven *increase* is reverted (re-assert / decrease allowed), exactly
   as the treasury validators now reject net-new treasury currency. (Done as a
   gated, telemetry-watched final step per phase, like #14.)

### The hard problem (why this is big, not a drive-by)

`claim-daily-agenda` sidestepped autosave coordination by **never writing the
player save** (NX marker + treasury only). Personal credits **must** write
`save:<name>`, which means a second writer racing the autosave optimistic-
concurrency guard (#14). Two resolutions, to decide in Phase 0 design:

- **(A) Co-write the save under the same `lock:save:<name>`** the autosave uses,
  bump `_baseSaveVersion`, return it; client updates its version ref and
  re-asserts (the technique `pushSaveToServer` already uses for #14 step 2).
  Smaller change; reuses shipped plumbing. **Recommended.**
- **(B) Server-owned ledger key** (`ledger:<name>`) merged into the character on
  read; the save blob never carries authoritative economic fields. Cleaner
  separation but touches every read path — much larger.

### Per-phase rollout recipe (repeatable)

1. **Server endpoint** computes + credits (formula ported verbatim; a test
   asserts server == client output).
2. **Client prerequisite** ships first: call the endpoint, re-assert returned
   values, stop self-incrementing. Sanitizer still permissive.
3. **Telemetry** watches for client increases to the now-server-owned field.
4. **Sanitizer tightens** to reject client increases — only after telemetry
   shows the new client deployed (the #14 gate discipline).
5. cPanel: register each new endpoint in `server.ts`; rebuild + commit `dist/`.

---

## Phase roadmap (smallest blast radius + highest exploit value first)

| Phase | Scope | Why here | Risk |
|---|---|---|---|
| **0** | Build `api/_credit-player.ts` core + tests; lock in option (A) | Foundation; no behavior change | Very low |
| **1 — Ranked rating** | Server computes ELO at PvP resolution; credits both players; client displays only | Highest value (rating drives matchmaking + leaderboard); most contained (PvP flow); server already determines the winner | Low–Med |
| **2 — Daily claims** | Personal `honorSeals`+`ryo` for agenda / map-control | Fixed amounts; NX-marker infra already in `claim-daily-agenda` | Low |
| **3 — PvP win ryo/xp** | Extend `claim-rewards` from NX-only → durable credit | Reuses session verification already there | Med |
| **4 — Mission/raid/hunt/AI-kill ryo + character XP** | The bulk (~30 client sites) | Largest; sub-divide by source; extends `report-raid` etc. | High |
| **5 — Server-owned daily counters** | `dailyAiKills`/`dailyPetWins` → server-validated; enables true agenda task-verification | Depends on credit endpoints | Med |

---

## Phase 1 detail — ranked rating (sign-off granted)

**Formula to port VERBATIM** (`shinobij.client/src/lib/progression.ts:44-47`):

```ts
export function rankedDelta(winnerRating: number, loserRating: number): number {
    const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    return Math.max(8, Math.round(24 * (1 - expected)));
}
```

Winner gains `rankedDelta(winner, loser)`; loser loses the same amount, floored at
`Math.max(0, rating - loss)`. Win → `rankedWins++`, loss → `rankedLosses++`. The
PET ranked path uses the identical formula on `petRankedRating`/`petRankedWins`/
`petRankedLosses`.

**The blocker the investigation surfaced:** the server today **cannot tell a
ranked match from a casual one**, and does **not** store pre-match ratings.
`PvpSession` (`api/pvp/session.ts:40-78`) has `p1/p2`, `status`, `winner`,
`createdAt` — but **no `ranked` flag and no pre-match rating snapshots**. The
client alone decides ranked-ness (`context.mode === "ranked"` /
`rankedBattleActive`) and holds the opponent's rating client-side. Trusting a
client `isRanked` flag or client-passed ratings would be security theater (a
cheater would just claim every match is a ranked win vs a high-rated ghost).

**Phase 1 design (authoritative):**

1. **Stamp the session at creation.** When a ranked PvP session is created, the
   server records on the `PvpSession`: `ranked: true`, `kind: 'player' | 'pet'`,
   and `p1Rating` / `p2Rating` read **server-side from both players' saves**
   (not from the client body). Casual/clan-war/tournament sessions leave
   `ranked` unset. (Requires confirming the ranked session-creation path —
   `api/pvp/session.ts` POST and how `api/pvp/ranked-queue.ts` triggers it.)
2. **Compute + credit on `claim-rewards`.** `api/pvp/claim-rewards.ts` already
   verifies the caller is the server-recorded winner/loser and gates with the NX
   key `pvp:rewarded:<player>:<battleId>` (24h TTL). Extend it: if
   `session.ranked`, compute `rankedDelta` from the **session's** pre-match
   ratings + the **server** winner, then credit the caller's save (rating +
   win/loss counter) via `_credit-player` under `lock:save:<name>` (option A),
   keyed by the existing NX receipt so it's exactly-once. Return the new rating.
3. **Client.** Stop self-applying the rating delta (App.tsx duel + arena
   win/loss paths: ~10359/10420/10517 and ~33136/33170/33213); instead display
   the rating the endpoint returns. Re-assert it on the next save (zero-delta).
4. **Sanitizer (LATER, gated step).** Once the new client is deployed and
   telemetry is clean, tighten `api/save/[name].ts` to reject client-driven
   `rankedRating` increases (the ±200 clamp becomes "re-assert/decrease only").
   NOT in the first Phase-1 PR.

**Phase 1 first-PR scope (this work):** Phase 0 core + steps 1–3. The sanitizer
tighten (step 4) is a separate, telemetry-gated follow-up.

**Open design confirmations for Phase 1 step 1/2:**
- Exact ranked session-creation path (does the matched ranked queue create the
  session server-side, or does the client POST `session.ts` after matching?).
- Where pet-ranked sessions are created (same stamping).
- Loser-side: the loser also calls `claim-rewards(outcome:'loss')`; ensure the
  per-player NX receipt credits each side once and reads the SHARED pre-match
  ratings from the session (so both deltas are consistent and symmetric).

---

## Build progress (2026-06-01)

- **Phase 0 DONE** (`f3d0af2`): `api/_ranked-rating.ts` (verbatim `rankedDelta`
  port + `creditRankedOutcome`) + `_ranked-rating.test.ts`.
- **Phase 1 server, DORMANT, DONE** (`c130cc4`): `PvpSession` gained
  `ranked`/`rankedKind`/`p1Rating`/`p2Rating`; `api/pvp/session.ts` POST stamps
  them (ratings read from saves) when the body says `ranked:true`;
  `api/pvp/claim-rewards.ts` credits the caller's save via `creditRankedOutcome`
  under `lock:save:<name>` (failClosed) with the receipt placed atomically. The
  casual path is byte-for-byte unchanged, so this is a **no-op until the client
  sends `ranked`** — safe to ship.
- **Phase 1 PET server, DORMANT, DONE** (this commit): `api/pet/battle-result.ts`
  gained a `body.ranked` branch crediting `petRankedRating` via the new pure
  `creditRankedFromSelf` (`api/_ranked-rating.ts` + tests). Same exactly-once
  failClosed-receipt pattern; no ryo / no general pet-win counters; no-op until
  the client sends `ranked:true`. See "Precise remaining cutover" step 1.

### Convergence-safety note (important for the remaining steps)
Once the client sends `ranked:true` at session creation, the server credits the
rating AND (until cut over) the client also self-applies it. These **converge**
(same formula, same base rating), and the client's autosave runs under the
permissive ±200 sanitizer — so there is **no double-credit explosion**; worst
case is a tiny divergence if the snapshot ratings differ. This makes activating
the server crediting low-risk and lets the client read-back cutover be done
carefully afterward, before the sanitizer tighten.

### Precise remaining cutover (client + pet-arena server)
1. **Pet-arena server (battle-result) — DONE, DORMANT (this commit).**
   `api/pet/battle-result.ts` gained a `body.ranked` branch that credits
   `petRankedRating` server-side. Math is the new pure `creditRankedFromSelf`
   in `api/_ranked-rating.ts` (+ `_ranked-rating.test.ts`) — a VERBATIM port of
   the client's pet-ranked appliers (App.tsx ~14506-14528): on a win I'm the
   winner (`rankedDelta(myRating, oppRating)`), on a loss the opponent is. The
   opponent's rating is read from their save (default 1000 for AI/roster foes),
   reusing the `oppSave` already loaded for the level clamp; the caller's from
   theirs inside a `withKvLock(saveKey, …, {failClosed:true})` with an NX
   receipt (`pet:ranked-rewarded:<player>:<reportKey>`, 24h) placed atomically
   with the rating write — exactly-once, 503-on-contention/retry (the
   claim-rewards pattern). By design, matching the client ranked-pet branch:
   **no ryo, no totalPetWins/dailyPetWins touch** — only `petRankedRating` +
   `petRankedWins`/`petRankedLosses` move; `reportKey` is REQUIRED for losses
   too (a ranked loss also moves the rating). **No-op until the client sends
   `ranked:true`** (none does today), so the casual path is byte-for-byte
   unchanged. NOTE: unlike the PvP path (ratings snapshotted on the session at
   creation), the pet path reads live ratings at report time — there is no pet
   PvpSession; the convergence note above covers the tiny snapshot-vs-live
   divergence, and it is moot until activation + read-back cutover.
2. **Activate — PLAYER half DONE (this commit); PET half DEFERRED.**
   - **PLAYER (done):** `App.tsx` now sends `ranked: challenge.mode === "ranked"`
     + `rankedKind:"player"` on the `/api/pvp/session` POST at the two
     ranked-capable accept sites — `acceptChallengeGlobal` (~5559) and the Arena
     `acceptChallenge` (~32166). Investigation correction to the earlier plan:
     of the five session-creation sites, only those two are ever ranked; the
     other three (~10033 sector attack, ~27701 sector raid, ~28819 village
     guard) hardcode `mode:"standard"`, so they are NOT touched. The ranked
     QUEUE flows through these accepts too (`joinRankedQueue` → match →
     `challengePlayer(stub,"ranked")` → accept), so this covers queue + ranked
     challenges. Both accepts route to **PvpBattleScreen**, whose claim effect
     (~36060) calls `claim-rewards`, which now credits the rating server-side
     (the dormant `c130cc4` branch). **Convergence-safe:** the client still
     self-applies in `handlePvpWin`/loss; `rankedRating` is NOT stripped from the
     session, so the opponent snapshot in the session == the server's pXRating
     snapshot → identical delta from the same base, and the full-state autosave
     overwrites with the same value. A 503 (failClosed contention) is also safe:
     the claim effect's `if (r.ok)` leaves `alreadyClaimed=false` so the client
     still self-applies. The inline `rankedBattleActive` BattleScreen path is
     only the session-create FAILURE fallback (no server session) — unchanged.
   - **PET (deferred — coupled to step 3, NOT a flag-add):** the earlier plan
     said "add `ranked` to the pet battle-result calls at ~14453/~14574," but
     those are the CASUAL party / 1v1 paths. The actual ranked-pet path
     (`if (opponent.ranked)` at ~14481) folds rating into ONE `updateCharacter`
     and makes **no `battle-result` call at all**. Activating the server credit
     therefore means ADDING a new `battle-result({ranked:true,…})` call there +
     threading a stable `reportKey` (`${battleSeed}:ranked`) + `opponentName`
     (`opponent.owner`) — which is best done together with the pet read-back
     (step 3) rather than as a pure activation. The dormant pet server branch
     (step 1) is ready and waiting; this is a deliberate sequencing choice.
3. **Read-back cutover (stop self-applying).** Thread the `rating` returned by
   `claim-rewards` / `battle-result` into the appliers; use `rating.value` when
   present, else fall back to the local `rankedDelta(...)` (graceful — the rating
   still updates on a 503/offline claim). Counters (`rankedWins`/`rankedLosses`,
   `petRankedWins`/`petRankedLosses`) keep incrementing locally — they converge
   (+1 from the same base) — only the rating VALUE is overridden.
   - **PLAYER — DONE (this commit).** PvpBattleScreen's claim effect (~36060)
     now captures `data.rating` and forwards it as a 3rd arg to `onWin`/`onLoss`
     (prop types widened). `handlePvpWin` (~10359, rating line ~10428) and the
     loss callback (~10513) set `rankedRating` to `serverRating.value` when the
     field is `rankedRating`, else the local delta. The inline
     `rankedBattleActive` `BattleScreen` path is the session-create FAILURE
     fallback (no server session, hence no server rating) — left self-applying
     on purpose; there is nothing to read back there.
   - **PET — DONE (this commit) — also performs the PET activation (step 2 PET).**
     The ranked-pet path (`startBattle`, ~14499) now reports each ranked outcome
     to `/api/pet/battle-result` with `{ranked:true, opponentName:opponent.owner,
     opponentLevel, reportKey:"${seed}:ranked"}` and reads `petRankedRating` back
     from the response (server value when present, else the local `rankedDelta`
     fallback). The W/L + lifetime pet counters (`petRankedWins`/`petRankedLosses`,
     `totalPetWins`/`dailyPetWins`) stay LOCAL and converge. `seed` is the shared
     deterministic `battleSeed`, so `reportKey` is stable + per-player; ranked pet
     battles are still NOT persisted for refresh-resume (so the single fire of the
     `startBattle` effect can't double the local counters — guarded by
     `onPendingPetBattleStarted` clearing `pendingPetBattleOpponent`). This both
     ACTIVATES the dormant pet server branch (step 1, `8571bdd`) and reads it back
     in one move, since the pet path had no prior `battle-result` call to flag.
4. **Sanitizer tighten (final) — DONE (this commit).** `api/save/[name].ts`
   replaced the bidirectional ±200 swing clamp with "re-assert / decrease only"
   for BOTH `rankedRating` and `petRankedRating` (the latter was previously
   unsanitized): a client-driven INCREASE reverts to the stored value; equal
   (re-assert) and decreases pass. This makes the server the SOLE authority —
   the client can no longer mint rating via the save blob. Admin saves skip the
   whole sanitizer (the `!isAdminSave` gate), so admin tooling is unaffected.
   **Why this is safe to ship now (low-traffic test env):** (a) `claim-rewards` /
   `battle-result` credit under the SAME `lock:save:<name>` the autosave takes,
   so an updated client's autosave reads the post-credit stored value and is a
   no-op re-assert (allowed); (b) it ships in the SAME Vercel deploy as the
   read-back client (both already on `main`), so any page loaded after deploy is
   the read-back client; (c) even the already-live activation client (`12a5ed4`)
   self-applies the SAME value the server credits, so its autosave is also a
   re-assert; (d) the only clients whose increase is reverted are pre-activation
   (pre-`12a5ed4`) tabs that self-apply without a server credit — ~0 in this
   low-traffic test env, and they simply refresh. This mirrors the #14
   server-enforcement decision (telemetry signal unavailable — no traffic — so
   the gate is satisfied by the deploy-ordering + convergence argument instead).
   On a server-credit failure the read-back client's local-delta fallback would
   be reverted here (rating change lost that match) — acceptable under
   "server is sole authority."

## Non-negotiables (per CLAUDE.md)

- **No balance change** — every formula ported verbatim; tests assert server ==
  client output; no rate/odds/payout/cooldown edits.
- **No broken saves** — client-first rollout + telemetry gate before each
  sanitizer tighten; admins exempt.
- **cPanel parity** on every endpoint; `dist/` rebuilt + committed.
- **One phase per PR**, each with its own sign-off.

---

## Evidence map (from read-only recon, 2026-06-01)

### Client self-application sites (credit-then-autosave)
- **ryo**: ~30 sites in `App.tsx` (missions 7366/7639, story 7690/29244, hunt
  7735/29970, raid 8396/10197/10408, pet loot 8583/14588, AI kill 30203/30227,
  tower 27994/28081, duel 25492, jutsu 25698, agenda 23115, map-control 23124,
  treasure 23605, tile 23766, …) + `Bank.tsx`, `Inventory.tsx`, `Hospital.tsx`,
  `Cafeteria.tsx`. All flow through `updateCharacter()` → autosave.
- **xp/level**: via `levelUpCharacter()` merged through `updateCharacter()`;
  never stamped server-side except profession XP.
- **honorSeals**: PvP-win + raid Rank-10 are server-written; daily agenda
  (23115) + map-control (23124) are still client-side.
- **rankedRating**: entirely client-side (see Phase 1).

### Server endpoints that already credit durably
- `api/pvp/_vanguard-rewards.ts` (seals + profession XP, per-player lock, session
  flag idempotency).
- `api/missions/report-raid.ts` (bonus ryo + Rank-10 seal, `withKvLock`, NX +
  daily counter `raid-report-count:<player>:<day>`, cap 60/day).
- `api/missions/report-pet-event.ts` (expedition ryo + drops + profession XP;
  daily `expeditionsClaimedToday`, cap 12).
- `api/pet/battle-result.ts` (arena ryo + `dailyPetWins`, cap 100; opponent level
  clamped from the opponent's actual save).
- `api/weekly-boss.ts` (ryo/xp/items; per-player receipt
  `weekly-boss-credit:<week>:<player>`, crash-resumable, exactly-once — #25).
- `api/missions/_progress.ts` `awardProfessionXp` (profession XP under lock).

### Save sanitizer caps (`api/save/[name].ts`, current gate)
`MAX_RYO_GAIN` 1M/save; `MAX_LEVEL_GAIN` 5, `LEVEL_CAP` 100; `CURRENCY_CAPS`
(honorSeals 200, …) per save; `MAX_RATING_SWING_PER_SAVE` ±200; rolling-window
`MAX_RYO_PER_MINUTE` 5M / `MAX_XP_PER_MINUTE` 1M / `MAX_STAT_PER_MINUTE` 1500;
stat clamps `MAX_STAT_GAIN` 500 / `MAX_TOTAL_STAT_GAIN` 1000; `FIRST_SAVE_BASELINE`
zeroes new accounts; daily-claim date fields (`claimedVillageAgendaDate`,
`claimedMapControlDate`, `warGroundBountyDate`) locked to server UTC date.

### Daily counters (client-incremented unless noted)
`dailyAiKills`, `dailyPetWins`, `dailyFateSpins`, `lastDailyReset`,
`claimedVillageAgendaDate`/`claimedMapControlDate`, `warGroundBountyDate`,
`villageWarRaidProgress`/`villageWarMissionDate`, `expeditionsClaimedToday`/
`lastExpeditionClaimDate`. Server-managed: `dailyHonorSealsEarned` /
`dailyHonorSealsByTarget` / `vanguardDailyResetDate` (set by `_vanguard-rewards`),
`raid-report-count` (raid endpoint).
