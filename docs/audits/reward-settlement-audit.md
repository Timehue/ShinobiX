# Reward-Settlement Audit — Phase 0 (2026-07-31)

> Historical snapshot. Solo PvE settlement rows were superseded by the
> 2026-08-04 cutover; see `docs/architecture/combat-runtime-boundaries.md`.

> **Follow-up status (2026-08-03):** ranked-season settlement now uses an
> in-save receipt written atomically with rating reset and podium reward. A
> durable original-field plan survives partial failure, retries only unsettled
> players, and advances the season clock only after the full plan completes.

> **P0-2 status (2026-08-01,** branch `refactor/reward-settlement-p0-2`**):**
> the contract is now documented (`docs/architecture/reward-settlement-contract.md`)
> and inventoried by `api/_settlement-contract.test.ts`. Landed fixes: player
> trade journals through economy-tx with a pending-nonce-before-debit guard
> (the P2 double-debit/burn window); the Arena→queue mission-win handoff parks
> in a durable client outbox (`shinobij.client/src/lib/claim-outbox.ts`) —
> the open loss race below is closed; the ranked-season NX-marker rollback was
> the interim fix later superseded by the 2026-08-03 in-save receipt; Card Clash AI settles against an in-save
> `redeemedCardClashAiSessions` receipt (duplicate window closed). The
> claim-mission token-before-payout ordering and the HG/casual-PvP bounded
> client-trust items are deliberately unchanged (documented trade-offs;
> fighter authority is P0-3). The table below remains the Phase 0 record.

Baseline: `origin/main` @ `de50b3385`. Claims tagged **VERIFIED** or **INFERRED**.

Legend: persistence **MPS** = `mutatePlayerSave`
(`api/save/_mutate-player-save.ts:41-72` — `withKvLock('save:<name>',
{failClosed:true})` → single `kv.set` with `bumpSaveVersion`);
**WKL** = hand-rolled `withKvLock` + `bumpSaveVersion` + `kv.set`.
"Atomic" = claim-stamp and payout in the SAME kv write.

**Headline: no P0/P1 reward-integrity findings.** Every currency path checked
passes `{failClosed:true}`; the dominant pattern (receipt embedded in the payout
write) is atomic by construction. Remaining P2s are documented design trade-offs
or loss-only windows.

## Master table

| Path | Handler | Eligibility | RNG | Reward source | Persistence | Atomic stamp+payout | Idempotency | Retry-dup risk | Severity |
|---|---|---|---|---|---|---|---|---|---|
| Mission claim | `api/missions/claim-mission.ts` | server catalog + token (combat) / progress receipt (field/hunt) / save flags | none | server | WKL failClosed, one write (`:219,:474-478`) | YES | date receipt `claimedServerMissions`, token del, one-time flags | none | P3 |
| Combat queue | `api/missions/queue-combat-claim.ts` | C/B/A/S: sealed server combat session; E/D: client "I won" (bounded ≤25xp/20ryo) | server seed | none paid here | WKL | n/a | binding settle + single-use token | none | P3 (E/D by design) |
| AI fight | `api/missions/report-ai-fight.ts` | sealed token from ai-fight-start | server | sealed base (legacy tokens hard-clamped) | MPS | YES (receipt `:119` in payout write) | `redeemedAiFightRewards` replay-echo | none | P3 |
| Raids | `raid-start.ts` + `report-raid.ts` | single-use token or real PvpSession + NX | none | fixed server constants | token del + NX + WKL (`:272-285`) | NO — multi-write | consumeSingleUseToken / NX ×2 | none (loss-only partials) | P3 |
| Pet expeditions | `expedition-start.ts` + `report-pet-event.ts` | sealed token + lease `serverSeal`, time-gated (`:206`) | server (`:317-319`) | fully sealed; body overwritten | WKL failClosed one write (`:328-342`) | YES | `redeemedPetExpeditionTokens` + exact lease token | none | none/P3 |
| World explore | `api/world/explore.ts` | client claim + fail-closed daily cap 150 | none | server formula | MPS | YES | requestId receipt `redeemedSectorExplorations` (last 150) | none | P3 |
| Ancient chests | `api/world/open-chest.ts` | client claim + daily cap 23 | server randomInt inside lock | server-rolled | MPS | YES (loot+counter+receipt one write) | `redeemedAncientChests`, replay echoes prior loot | none | P3 |
| Pet befriend | `encounter-start.ts` + `befriend.ts` | sealed 20-min token, owner-checked | server | sealed pet, server trait | MPS; token del after | YES | token + `redeemedPetEncounters` | none | none |
| Pet train/evolve | `pet/progress.ts`, `evolve.ts` | save-state lease / gates under lock | none | sealed/spec | MPS / WKL | YES | state machine (cleared lease ⇒ 409) | none | none |
| Pet battles | `pet/battle-result.ts` | battle-start token; ranked: re-sim from sealed seed | server sim | server (sealed level / Elo) | WKL failClosed | casual YES; ranked NX-before-write | token + in-save receipt / NX `pet:ranked-settled` | ranked: loss-window only | P3 |
| PvP rewards | `api/pvp/claim-rewards.ts` | real PvpSession, winner identity, 2h window (`:132-150`) | n/a | server (Elo, base ryo/XP, stat growth, item deduction) | sorted multi-save WKL failClosed (`:57-66`) | YES — receipt embedded in credited char (`:393-395`) | in-save `serverSettlementReceipts`; casual grants = NX key (fail-open) | casual dup possible on KV outage | **P2 (casual)** |
| Ranked season | `api/cron/_ranked-season.ts` | cron/admin only | none | fixed table | distributed job lease + two-hour WKL; WKL per save | YES — reset, reward, and receipt share one write | in-save `rankedSeasonSettlementReceipts` + durable season plan | none | none/P3 |
| Towers/Spire | `api/towers/settle.ts` + `_tower-store.ts` | server session, membership | none | sealed catalog | WKL failClosed | NEAR — NX receipts before write, rollback in catch | per-run NX + first-clear NX + weekly tier NX | process-kill strands receipt | P3 |
| Hollow Gate run | `hollow-gate/settle.ts` | sealed run token | none | **min(client haul, server depth ceiling)** | nested WKL failClosed | YES (`redeemedHollowGateRuns` in payout write) | in-save list + token del + marker | none | **P2 (design)** |
| HG combat | `hollow-gate/combat-settle.ts` | sealed binding; **pve outcome client-claimed**; tactical/pet server-proven | server randomInt | server table | WKL ×2 failClosed | NX before write + rollback | NX `hg-combat-paid` + settled binding | strand window | **P2 (pve win claim)** |
| Weekly boss | `api/weekly-boss.ts` | server run record + session; damage = server boss-HP delta; legacy client damage admin-only (`:495-548`) | server seed | server table | boss lock + save lock | NX receipt before write + rollback | per-(week,player) NX | none (loss window) | P3 |
| Clan boss | `clan-boss/assault-settle.ts` | server tower session + roster | none | server extract | WKL failClosed | settled flag + applied check | eventId-deduped point awards | low | none/P3 |
| Card packs | `card-clash/open-pack.ts`; `shop/settle.ts` | save state + chronicle latch | server randomInt | server catalog | MPS | YES | shop: requestId settlement receipts; open-pack: none (purchase) | open-pack retry re-buys (player pays) | P3/none |
| Card Clash AI / starter | `claim-starter.ts`; `ai-move.ts`; `match.ts` | save latch / server session+engine | server | sealed constants | MPS | AI: payout then session-mark split (`ai-move.ts:153-160`) | latch / `settledAt` + daily date stamp | AI: 5–50 ryo dup if session write fails | P3 |
| Gauntlet | `api/pet/gauntlet.ts` | sealed token + **server re-simulation** (`:138`) | sealed seed | sealed schedule | WKL + bump (`:164-202`) | YES (receipt in payout write `:187-198`) | `redeemedPetGauntletRuns` + daily flags | none | none |
| Miraa wager | `api/festival/sunscar.ts:99-172` | escrow-at-start + sealed token | server roll (`:151`) | sealed bet; client outcome ignored; old mint path 410 (`:170`) | MPS ×2 | consume→credit split (`:143` vs `:152`) | consumeSingleUseToken (delete rowcount) | none (winnings-loss window, logged `:161`) | P3 |
| Shop/sell | `shop/settle.ts`; `inventory/sell.ts` | save state + server catalog/ownership | server | server prices | MPS | YES | requestId+fingerprint in-save receipts, replay echoes | none | none |
| Bank interest | `api/bank/claim-interest.ts` | server clock, 24h window, rate from stored `villageUpgrades.bank` clamped 0–50, principal cap 10M (`api/_bank-interest.ts:36-76`) | none | server | one locked write (`:62-75`) | YES (credit + `lastBankInterestAt` same write) | cooldown stamp | none | none (exemplary) |
| Bank transfer | `api/bank/transfer.ts` + `_transfer.ts` | self-only, 20/min | n/a | own-money move; wealth-conserving by construction | MPS | YES | none (no nonce) | retry double-applies (conserving; UX only) | P3 |
| Crafting | `api/craft/forge.ts` + `_forge.ts` | server tables, catalog gates | none | server | MPS | YES (receipt in same write) | `redeemedCrafts` requestId (last 100) | none | none |
| Named forging | `api/craft/named.ts` + `_named.ts` | server cost 1000 | **server crypto randomInt, sealed 20-min token** | built only from sealed roll | MPS; token del post-commit | YES | token = receipt id, `redeemedNamedForges` (last 50) | none | P3 (free re-rolling before paid forge = stat-fishing; design call) |
| Player trade | `api/player/trade.ts` + `_trade-core.ts` | self, allowlisted currencies, caps, 10% burn | n/a | validated debit; conservation asserted | **TWO whole-save writes** (`:117`, `:119`), sorted nested locks | **NO** | optional client nonce (24h NX), written only on success | **retry of a half-committed trade re-debits** | **P2** |
| Cafeteria | `api/player/cafeteria.ts` | server meal table | none | server | MPS | YES | none | retry re-buys a meal (trivial) | P3 |
| Events/daily/achievements | `events/claim.ts`; `player/daily-login.ts`; `achievements/sync.ts` | save latch / date stamp / server catalog + save counters | none | fixed/sealed | MPS / WKL | YES | latch / `lastLoginRewardDate` / append-only server-preserved ledger | none | ach: P2/P3 (eligibility counters client-inflatable, one-time, bounded) |
| Exams / Story | `exams/pass.ts`; `story/settle.ts` | save counters + village state / server combat binding | none | none (level hold) / sealed STORY_REWARDS | MPS (story inside binding lock) | YES | `examsPassed` / `redeemedStoryBattles` replay-echo | none | P3/none |
| War/village claims | `war/claim-reward.ts`; `village/claim-war-crate.ts`, `claim-daily-agenda.ts`, `claim-map-control.ts` | server war record / territory scan | none | fixed server | MPS / WKL | war+crate YES; agenda/map-control NX day-marker before save write | `claimedWarCrateIds` / NX day-markers | none (marker-burn = loss) | P3 |
| Clan mission/exchange | `clan/mission/claim.ts`; `clan/exchange/purchase.ts` | server-recomputed progress / server catalog | server cache rolls | sealed tables | clan+player WKL | reserve→commit economic receipt / debit+grant one write; treasury refund + LOSS audit | weekly receipt / eventId dedup | none | P3 |
| Hunter rank-up | `hunter/rank-up.ts` | materials re-verified + consumed | none | rank only | MPS | YES | `redeemedHunterRanks` actionId, server-preserved | none | none |

## The mission-claim "409-clobber refetch" race — exact characterization (VERIFIED)

The race is **not** in the claim handler. `claim-mission.ts:219-506` runs
entirely under `withKvLock('save:<name>', {failClosed:true})`; stamp and payout
are fields of one `kv.set` (`:474-478`); `bumpSaveVersion` forces stale
autosaves to 409; the client's `refetchAfterSaveConflict`
(`App.tsx:4463-4482`, fired `:4500-4505`) reapplies the server snapshot that
already contains the payout; `adoptSaveVersion` (`App.tsx:4510-4512`) keeps the
version ref monotonic. No stamp-without-payout, no double-pay.

What remains open is the **upstream Arena→queue handoff**: an Arena win writes
`pendingCombatMissionClaims` locally and `queueCombatMissionClaim`
(`shinobij.client/src/lib/mission-combat-claim.ts:18-39`, 4 attempts) persists
it durably. If all 4 POSTs fail (~6s offline) AND any background writer bumps
`_saveVersion`, the next autosave 409s → `applyServerSnapshot` full-replace
discards the never-persisted local flag → **the win is lost and the player
re-fights**. Loss-only, never a duplicate. The mirrored trap (durable flag,
expired token) self-heals via `clearStalePendingCombatClaim`
(`claim-mission.ts:162-171`, applied `:282-287`). Two P3 slivers: the combat
token `kv.del` at `:298` precedes the payout write at `:478` (crash loses the
claim; re-fight recovers), and the field/hunt progress-receipt del
(`:479-481`) is best-effort — a failed del plus the UTC-date-scoped receipt
could allow a next-day re-claim without redoing progress (rare-failure-dependent).

## Paths paying from client-supplied amounts/outcomes (worst first)

1. **Hollow Gate extraction haul** — `hollow-gate/settle.ts` pays
   `min(client haul, maxHaulForDepth)`; a tampered client always claims the
   depth ceiling. Deliberate, bounded, entry-anchored. P2.
2. **Hollow Gate PvE combat outcome** — `combat-settle.ts` trusts
   `outcome:'win'` for pve-mode encounters (binding pins identity/node/one-use;
   reward server-tabled). Documented design; ties to the client-side fighter
   build (combat audit Pipeline C). P2.
3. **PvP casual local grants** — `pvp/claim-rewards.ts:479-511`:
   non-ranked/non-baseRewards rewards are client-self-applied behind an NX gate
   that **fails open** on KV error. P2.
4. **Achievements eligibility** — amounts server-cataloged, but some
   eligibility counters are client-inflatable save fields (one-time, bounded). P2/P3.
5. **Legacy E/D combat missions** — client "I won", clamped ≤25xp/20ryo/1scroll
   (`api/_release-flags.ts`). By design. P3.
6. **World explore / open-chest eligibility** — bare client claim of a
   tile/chest, bounded by fail-closed daily caps (150/23). P3.

Closed: legacy client-value inputs on report-ai-fight (MAX-clamped), the
retired Miraa client-attested path (410).

## Stamp-consumed-without-payout windows (all loss-only; none can mint)

- **Ranked-season podium is no longer in this category**: its reset, reward,
  and receipt are atomic in one player-save write, with durable-plan retry.
- Towers/Spire, HG combat-settle, weekly-boss: NX receipt before save write,
  rollback in catch — a hard process-kill strands the receipt (permanent for
  the towers first-clear NX).
- Miraa report: token consumed → credit write fails → winnings lost (logged;
  "debit before credit" by intent).
- claim-daily-agenda / claim-map-control: NX day-marker before save write →
  marker-burn loses the day.
- **Card Clash AI is the inverse** — payout before session `settledAt` mark
  (`ai-move.ts:153-160`): the codebase's only duplicate-direction window
  (5–50 ryo; daily bonus date-stamp-protected).
- **Player trade (P2)** — `trade.ts:117-119`: sender debited before recipient
  credited, no escrow/journal (`_economy-tx` NOT used here, unlike treasury
  transfers); failure between writes permanently burns the sender's funds with
  no receipt of the attempt, and a retry of exactly that failure re-debits.
  The one two-party settlement outside the economy-tx pattern.

## Idempotency patterns in use (5 distinct dialects)

1. **In-save receipt in the payout write** (gold standard — atomic by
   construction): `serverSettlementReceipts` requestId+fingerprint
   (`api/_settlement-receipts.ts`; shop, sell, PvP), `redeemed*` lists
   (ai-fight, expeditions, encounters, battles, gauntlet, story, hollow-gate
   runs, chests, explores, hunter ranks, crafts, named forges), date receipts,
   boolean latches.
2. **Server-minted single-use token**, consume gated on delete rowcount
   (`api/_single-use-token.ts:11-16`): raids, miraa, ai-fight, expeditions,
   combat-claim, pet battles, gauntlet, HG. Consume-before-payout is this
   pattern's loss-window class.
3. **Separate NX kv key**: `pvp:rewarded:*`, `missions:raid-reported:*`,
   `ranked:season:rewarded:*`, tower receipts, `hg-combat-paid`, weekly-boss
   credit, day-markers — the pattern responsible for every strand/loss window.
4. **Reserve→commit economic receipt** (`api/_economic-receipt.ts`):
   clan/mission/claim — write-fail leaves a replay-blocking pending receipt (fail-safe).
5. **State-machine gating**: pet training lease cleared in payout write, evolve
   tier checks, latches; eventId-keyed clan-point awards safe under retry.

The recurring hardening opportunity is migrating pattern-3 users to pattern-1 —
as `pvp/claim-rewards` already did, explicitly citing the lost-Elo bug the old
separate-key receipt caused (roadmap P0-2).

## Test-coverage assessment

Helper cores are well tested (`_tower-store`, `_reward-settlement`,
`_settlement`, `sunscar`, `_bank-interest` parity sweep >100 cases,
`_transfer` conservation asserts, `_forge`, `_named`, `_trade-core`,
`_explore`, `_chest` + pool parity, `_encounter`, gauntlet sim). **Gap:**
handler-level end-to-end tests against a fake KV are absent for most claim
paths — atomicity/ordering properties are enforced by code shape, not test.
Roadmap P0-2 adds partial-failure simulation tests. `player/trade.ts` has no
test covering the two-write settlement, lock nesting, nonce replay, or
partial-failure behavior.

## Historical failure classes — verdicts

| Class | Verdict |
|---|---|
| Rewards vanish after refresh | **ALREADY FIXED ON CURRENT MAIN** — version bump + sanitizer re-assertion + `refetchAfterSaveConflict` (`_save-version.ts:96`, `App.tsx:4463`); world-map rewards server-settled (commit 0b55e8adc) |
| Befriended pets not surviving refresh | **ALREADY FIXED** — sealed encounter token + MPS + sanitizer strips client-added pets (`[name].ts:1329-1373`); caveat: empty-roster legacy carve-out |
| Ancient Chest partial settlement | **ALREADY FIXED** — loot+counter+receipt one atomic write (`open-chest.ts`) |
| Exploration counters not advancing | **ALREADY FIXED** — server-owned `serverExplores*` (`explore.ts`, MPS) |
| Exam eligibility reading stale progression | **ALREADY FIXED** — `examsPassed` server-frozen (`:1530`); exams/pass recomputes |
| Mission claim stamps consumed without rewards | **FIXED in-handler** (atomic write); **STILL EXPOSED upstream** — the Arena→queue handoff loss window (loss-only) |
| Retry duplicates a reward | **Mostly closed**; residual: Card Clash AI 5–50 ryo window; no-nonce trade double-move (conserving) |
| Stale save removes a reward | **ALREADY FIXED** — version guard + sanitizer |
| Different endpoints, different idempotency | **CONFIRMED** — five dialects (above); consolidation = P0-2 |
| Client timers/RNG controlling server outcomes | **Mostly closed** — remaining: HG pve outcome, HG haul, casual-PvP local grants, E/D missions (all bounded/deliberate) |
