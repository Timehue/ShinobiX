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

### Convergence-safety note (important for the remaining steps)
Once the client sends `ranked:true` at session creation, the server credits the
rating AND (until cut over) the client also self-applies it. These **converge**
(same formula, same base rating), and the client's autosave runs under the
permissive ±200 sanitizer — so there is **no double-credit explosion**; worst
case is a tiny divergence if the snapshot ratings differ. This makes activating
the server crediting low-risk and lets the client read-back cutover be done
carefully afterward, before the sanitizer tighten.

### Precise remaining cutover (client + pet-arena server)
1. **Pet-arena server (battle-result):** extend `api/pet/battle-result.ts` to
   credit `petRankedRating` via `creditRankedOutcome` (kind `'pet'`) when the body
   flags ranked — read the opponent's `petRankedRating` from their save (it
   already loads `oppSave` for the level clamp) and the caller's from theirs
   inside the existing `withKvLock(saveKey)`. Gate dormant on `body.ranked`.
2. **Activate (low-risk, convergence-safe):** add `ranked:true` + `rankedKind`
   to the `/api/pvp/session` POST body at the RANKED creation sites and `ranked`
   to the ranked `/api/pet/battle-result` calls. Session-creation sites in
   `App.tsx`: ~5556, ~10033, ~27701, ~28819, ~32163 — only the ones where the
   match is ranked (`mode==="ranked"` → `rankedKind:'player'`; `mode==="rankedPet"`
   → `'pet'`). Pet-arena battle-result calls: ~14453, ~14574.
3. **Read-back cutover (stop self-applying):** thread the `rating` returned by
   `claim-rewards` / `battle-result` into the win/loss appliers and use
   `rating.value` instead of `rankedDelta(...)`:
   - Shared-session duel (`PvpBattleScreen`): the claim effect at App.tsx ~36060
     fetches claim-rewards; capture `data.rating` and pass it to
     `onWin`/`onLoss`. `handlePvpWin` (~10359/10420) and `handlePvpLoss`
     (~10517/10520) override `rankedRating` with `rating.value` when present.
   - Player arena (`BattleScreen`, ~33136/33170/33213) — its own win/loss path.
   - Pet 1v1 (`rankedPet`) and pet arena (~14506-14524) — `petRankedRating`.
   Counters (`rankedWins`/`rankedLosses`) already increment by 1 from the same
   base on both sides, so they converge — leave that logic, override only the
   rating value.
4. **Telemetry + sanitizer tighten (final, gated):** once the read-back client
   is deployed and telemetry shows no client-driven `rankedRating` increases,
   tighten `api/save/[name].ts` so the ±200 swing clamp becomes "re-assert /
   decrease only" for `rankedRating`/`petRankedRating`. This is what finally
   makes the server the SOLE authority. NOT before the read-back client is live.

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
