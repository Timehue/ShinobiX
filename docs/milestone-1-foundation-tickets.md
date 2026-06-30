# Milestone 1 — Foundation · Ticket Set

**Game:** Shinobi Journey · React+Vite client + Vercel-style TS handlers under one Express `server.ts` · Supabase one-table KV (`api/_storage.ts`) · Railway + cPanel.

**Design pillar:** Foundation = balanced PvP. Power is a *ceiling, not a speed* — never bought/grinded/RNG'd. Anti-tamper serves the pillar; rewards stay power-neutral. P0.2 is anti-**tamper**, not a rarity nerf: legit faucets stay; the window only blocks minting past it.

**Out of scope (dependency only):** P0.1 — server-side ceiling enforcement (bloodline budget / rank / pet jutsu-power / custom-item budget). See `docs/p0.1-ceiling-enforcement-spec.md`.

**Standing requirements (every ticket):**
- Backend/API → `npm test` from repo root (route-parity `server-routes.test.ts`, combat parity `_combat-formula-parity.test.ts`).
- Frontend → `npm run lint` in `shinobij.client/`.
- Any `api/`/`server.ts` change → `npm run build` and commit BOTH `dist/` (root + `shinobij.client/dist/` force-added) — cPanel serves committed dist verbatim.
- New endpoint → create `api/**` handler AND `route()`-register in `server.ts`; keep CORS `_utils.ts` ⇄ `server.ts` synced.
- Never break saves; never pay out from client-supplied amounts.

---

## Dependency & value ordering

| # | ID | Title | Diff | Gate |
|---|----|-------|------|------|
| 1 | **P0.4** | Fail-closed currency/war locks + mentor reorder | M | ship freely |
| 2 | **P0.3a** | PvP EP clamp alignment + amp-tag dedup | S | ship freely |
| 3 | **P0.2a** | Per-minute material-currency window | M | ship freely |
| 4 | **P0.6** | Heartbeat slim | S | ship freely |
| 5 | **TD.1** | Cut/park dead code | S | ship freely |
| 6 | **P0.5** | Central Hub discoverability | S | ship freely |
| 7 | **P0.2b** | Daily AI-fight XP/ryo cap (server-auth) | M | flag |
| 8 | **P0.2c** | Mint-token high-value PvE/HG drops + war crate | L | depends P0.2a + P0.4 |
| 9 | **HEAL** | Mastery-ramp heal/shield | M | NEEDS sign-off |
| 10 | **P0.3b** | Wound-stack cap + optional control cap | M | NEEDS sign-off; re-eval AFTER P0.1 |

P0.4 / P0.3a first (pure tamper-defense, zero balance change). P0.2a establishes the window pattern P0.2b/c lean on. Discoverability/heartbeat/dead-code independent and cheap. HEAL and P0.3b are balance-gated, last.

---

## P0.4 — Fail-closed currency/war RMWs + mentor reorder
- **Description:** Add `{ failClosed: true }` to currency/war read-modify-writes that run fail-open; reorder `mentor.ts` to mark-claimed before (or atomically with) crediting.
- **Why:** `withKvLock` defaults fail-open (`_lock.ts:19-21`; gate `:116-118`; option `:48`) — on contention it runs `fn` unlocked → lost/duplicate increments. CLAUDE.md requires `failClosed` on currency paths. `mentor.ts` credits then marks → crash window for double-claim.
- **Player benefit:** Currency/war state can't silently lose/dupe under load; mentor reward can't be re-farmed via retry. Fairness = pillar.
- **Files (verified — each lock currently has NO failClosed):** `api/jutsu/train-with-seals.ts:97` (key `save:${player}` :91; debit :145, persist :150); `api/jutsu/speedup.ts:68` (key :62; debit :112, persist :120); `api/missions/report-pet-event.ts:190` (key :102; credit :235-238, persist :243; token already del :150); `api/clan/war/report.ts:114` (key `clan-war:${warId}` :112; set :198,:220); `api/clan/war/challenge.ts:70` (key :66; mutations :143,:184,:227,:256,:325,:362,:396); `api/clan/war/tilecards.ts:179,266,274,288`; `api/village/sector-card.ts:244,250,264` (NOTE: finalize at :155 ALREADY failClosed :168 — leave it). `api/clan/mentor.ts:140-158` — reorder so `entry.claimed` persists before/atomic-with credit; if a credit returns false (sensei save missing :148) do NOT mark claimed.
- **Difficulty:** M. **Deps:** none.
- **Risk:** No save/balance change. Behavior: under contention these now THROW `LockContendedError` instead of running unlocked — verify each maps to a clean 409/429 retryable response. Mentor reorder must preserve "credit only if both saves exist."
- **Rollback:** per-file remove the arg; low blast radius.
- **Testing:** mock lock-acquire failure → each endpoint throws/returns contended, NO write; mentor crash-after-credit-before-mark reproduces double-claim in old order, not new; `npm test` green; manual happy-path debit once.
- **Done:** all eight RMWs fail-closed (sector-card finalize untouched); mentor atomic; contended path clean error, no partial write; dist rebuilt.

## P0.3a — PvP EP clamp alignment + amp-tag dedup
- **Description:** Lower PvP session jutsu `effectPower` clamp 600 → ~60 (match the legit max); dedupe stackable amp tags per cast.
- **Why:** Save clamps bloodline EP to 50 (`[name].ts:783`) but session re-clamps to 600 (`session.ts:196`) → a forged session can seal ~12× legit EP into `resolveBaseDamage` (`move.ts:545-569`). Session is the authoritative seal. Also `sanitizeJutsuList` caps tag count at 10 (`:210`) but doesn't dedupe by name → two `Increase Damage Given` both apply (`move.ts:634`).
- **Player benefit:** removes a damage-injection vector + a stacking exploit.
- **Files:** `api/pvp/session.ts:196` — set bound to the true legit max. **Decision:** save clamp 50 is *bloodline-specific*; standard jutsu EP can exceed 50 (`epAtMax = effectPower+10`). **Confirm the highest legit `effectPower` across `shinobij.client/src/data/` jutsu before picking ~60** so legit maxed jutsu aren't clipped. Same review for weapon EP clamp `session.ts:288`. `session.ts:202-229` (`sanitizeJutsuList` tag block, after slice(10) :206-210) — add per-name dedup for stackable amp tags (`CAPPED_AMP_TAGS` from `_tags.ts`), keep first. Mirror in weapon-tag block `:301-309`.
- **Difficulty:** S. **Deps:** none.
- **Risk:** new EP ceiling MUST be ≥ highest legit EP or maxed players lose damage (regression). Dedup behavior-preserving for honest single-tag loadouts.
- **Testing:** forged EP 600 → sealed at ceiling; 2 identical amp tags → one; legit max jutsu/weapon NOT clipped (pull real max from data); `npm test` incl. parity.
- **Done:** session EP ceiling matches legit max (no clip); amp tags deduped (jutsu + weapon); tests prove injection+stack neutralized; dist rebuilt.

## P0.2a — Per-minute rolling window for material currencies
- **Description:** Extend the existing 60s gain window to `fateShards, boneCharms, auraStones, auraDust` (+ `hollowShards, mythicSeals, honorSeals`), 429 over a generous per-minute cap. Today only ryo/stat/xp have a window.
- **Why:** `CURRENCY_CAPS` (`[name].ts:136-149`) is per-save-cycle only → mint the per-cycle max every ~3s autosave. The per-minute window (`:191-194`, logic `:1550-1604`) has no currency dimension (`GainsWindow` = `{startedAt,ryo,stat,xp}` :196). Materials feed power.
- **Player benefit:** can't mint a power-material pile past the legit rate; legit play unaffected (speed is fine).
- **Files (all `[name].ts`):** `GainsWindow` :196 → add `currency: Record<string,number>`; `freshWindow()` :219-220 → `currency:{}`; new `MAX_CURRENCY_PER_MINUTE` near :191-194 (set GENEROUSLY above best legit faucet, e.g. `CURRENCY_CAPS[x]×~10`); window block :1554-1604 → per-currency delta `max(0, in-ex)` like ryo (:1558-1560), accumulate, 429 over cap, persist at :1602.
- **Difficulty:** M. **Deps:** none (establishes pattern for P0.2b).
- **Risk:** anti-tamper, not a rarity nerf — caps MUST sit above the highest legit faucet or you 429 honest players. `auraDust` already clip-prone (`:140-142`) — be generous. Old windows without `currency` read as `{}` via `?? freshWindow()` (:1574) — backward-safe.
- **Rollback:** env flag `DISABLE_CURRENCY_WINDOW`, default on.
- **Testing:** stream N saves minting cap → 429 once cumulative exceeds; single legit save passes; window resets after `GAIN_WINDOW_MS`; stored window w/o `currency` doesn't crash; extend `api/save/_sanitize-*` tests.
- **Done:** each material currency per-minute-capped, generous enough no legit faucet trips; backward-compatible; flag-guarded; minting loop blocked; dist rebuilt.

## P0.6 — Heartbeat slim
- **Description:** Drop the `allPlayers` full-roster field from the heartbeat response; return only sector-scoped `sectorMates`. The 60s roster poll owns the global list.
- **Why:** `heartbeat.ts` builds `sectorMates` (:126-128) AND `allPlayers` (whole online store :130), returns both (:134). Client already polls `/api/player/roster` every 60s (`App.tsx:3029,3066`, owner) and only uses heartbeat `allPlayers` as a 12s-throttled redundant merge (`App.tsx:2770-2772`); field already optional (`:2729`).
- **Player benefit:** lower per-beat payload/CPU; smoother presence at scale; no roster regression.
- **Files:** `heartbeat.ts:130` delete `allPlayers` build; `:132-138` remove from response (keep sectorMates/pendingAttacker/pendingChallenges/pendingHeal). Client cleanup (recommended): remove the `App.tsx:2770-2772` merge branch (+ `lastRosterMergeAt` if unused), drop `allPlayers?` type at `:2729`. Confirm `/api/player/roster` unchanged.
- **Difficulty:** S. **Deps:** none.
- **Risk:** newly-online players appear in others' global roster within ≤60s (poll) instead of ≤12s — acceptable per existing design note (`App.tsx:3059-3065`); sector presence unaffected. Keep client tolerant of missing `allPlayers` (don't make it required) so an old build doesn't break.
- **Rollback:** one-line re-add; optional `HEARTBEAT_FULL_ROSTER=1`.
- **Testing:** response lacks `allPlayers`, has `sectorMates`; roster still populates; online dots fresh ≤60s; sector overlay unaffected; lint+test.
- **Done:** heartbeat sector-scoped only; global roster sole source = 60s poll; no required `allPlayers` dependency; dist rebuilt.

## TD.1 — Cut/park dead code
- **Description:** Delete confirmed-dead modules; PARK one future lever; don't touch load-bearing.
- **Files (verified, note deviations):**
  - **DELETE `shinobij.client/src/data/village-biomes.ts`** — dead. Only hit is a stale comment (`App.tsx:9185`); the live lookup is `villageBiomeMap` from `./data/storylines` (`App.tsx:432`, used :1654,:5700,:5846-5847) — different module. Remove the stale comment too.
  - **DELETE `components/ui/index.ts` barrel + `BackButton`/`Pill`/`SectionHeader`/`Tabs`** — no importers (live pills are `VillagePill`/`FestivalPortrait` from `components/Pills`). **CAUTION: keep `ui/Button.tsx`** — imported directly by `PatchNotesModal.tsx:22` (not via barrel). Verify nothing imports the barrel path `components/ui`.
  - **DELETE `api/towers/_floor-validate.ts`** — runtime-dead but **imported by `api/towers/_floor-catalog.test.ts:4`** (used :57-88). Deletion requires removing/retargeting that test too — don't delete the `.ts` alone or `npm test` breaks. If unwanted: delete both; else leave both.
  - **PARK (do NOT delete) `api/_war-tax.ts`** — future war-economy lever (only importer is its own test). Add a one-line header marking it parked/unwired so audits stop flagging it.
  - **DO NOT TOUCH `professionLogic.ts`** — intentional canonical spec.
- **Difficulty:** S. **Deps:** none.
- **Risk:** only "delete something referenced" — mitigated (Button kept, floor-validate test handled, war-tax parked).
- **Testing:** `npm run lint` + `npm run build` (tsc) succeed (no unresolved imports); `npm test` green; grep confirms no remaining refs.
- **Done:** dead modules removed; Button/professionLogic/_war-tax retained; floor-validate test handled; build+lint+test green; dist rebuilt.

## P0.5 — Central Hub discoverability
- **Description:** Add a Central entry to RightMenu + MobileNav and a Central marker on the Village map. Today reachable only via World Map "C" landmark.
- **Why:** only path is `WorldMap.tsx:1045` landmark → `setScreen("centralHub")` (:2469). Canonical route id `"centralHub"` (`types/core.ts:47`; `screens/CentralHub.tsx`).
- **Files:** `RightMenu.tsx` ~:98-124 — add a button `navigate("centralHub")` matching the pattern at :99 (Tavern) with a `react-icons/Gi*` glyph. `MobileNav.tsx` ~:130-152 — add a `.mobile-menu-btn` using `go("centralHub")` (NOT raw navigate, so the drawer closes; `go` ~:66-69). `Village.tsx` ~:50-66 — add `{ name:"Central", img:<icon>, screen:"centralHub" as Screen, x:"NN%", y:"NN%" }`, non-overlapping coords, rendered :91-99.
- **Difficulty:** S. **Deps:** none.
- **Risk:** none gameplay. UI: village marker must not overlap others / break mobile — verify at a real mobile viewport.
- **Testing:** all three routes → CentralHub renders; mobile drawer closes; marker no-overlap at ~380px + desktop; lint clean; `App.size.test.ts` unaffected (changes outside App.tsx); dist rebuilt.
- **Done:** Central reachable from RightMenu, MobileNav, Village map; mobile intact; tests green; dist rebuilt.

## P0.2b — Daily AI-fight XP/ryo cap (server-authoritative)
- **Description:** Enforce a daily cap on XP/ryo (and per-fight materials) from AI fights, made server-authoritative. Today reward is client-computed/applied with no cap.
- **Why:** `Arena.tsx:2394-2443` computes XP :2394, ryo :2395, seals :2396, dust :2397, shard/charm substitutes :2420/:2425, builds `winCharacter` :2416-2439, persists :2443; `dailyAiKills` :2435 is counted but never gated. Raids go through `report-raid` (cap 60/day) but AI fights don't. Violates "never trust the client for rewards."
- **Player benefit:** AI grinding can't exceed the designed faucet; rewards server-validated.
- **Files:** grant `Arena.tsx:2394-2443`. Pattern: `raid-start.ts` (mints token, `MAX_RAID_STARTS_PER_DAY=30` :34, token :99-108) → `report-raid.ts` (validates+atomically deletes token :102-116, daily cap :26+:176-203, pays under lock :205-248). New `ai-fight-start`/`report-ai-fight` pair OR extend the raid path. **Register in `server.ts`** + CORS.
- **Difficulty:** M. **Deps:** reuses P0.2a window; mint-token pattern exists. Shares the Arena grant site with P0.2c — sequence adjacently.
- **Risk:** balance-sensitive — add a CEILING, don't change rates; the per-fight values (:2394-2397) stay identical under cap. Use raid's daily-reset convention. Mint start-token at battle start to hide latency.
- **Rollback:** flag `aiFightServerAuth.v1` (default OFF); flag-off = current behavior byte-identical.
- **Testing:** Nth report past cap → capped/zero; counter resets at boundary; client applies SERVER reward when flag on; flag-off identical; route-parity + lint; CORS synced; dist rebuilt.
- **Done:** AI-fight XP/ryo/materials server-validated + daily-capped behind a flag; rates unchanged under cap; route registered; rollback flag; dist rebuilt.

## P0.2c — Mint-token high-value PvE/Hollow-Gate drops + war crate
- **Description:** Move highest-value PvE/HG material/item drops + the war crate from client-authoritative writes to server mint-token (`*-start` seals reward → report consumes token + pays sealed values).
- **Why:** all high-value drops granted client-side: HG shrine chest `App.tsx:6752-6755`, shard vein :6771, locked chest :6954-6958, tablet :8346, relic :8363-8364, tile seal :8757; hunt/dungeon boss :5984-5988, base hunt :5917, story/Kage boss :6052; Endless Tower :5368-5369; achievement :1892. War crate: `Arena.tsx:2426` appends `LEGENDARY_WAR_CRATE_ID` on raid win (`recordVillageWarRaid` :2414); claim in `lib/world-state.ts` (~:840-843); catalog `data/starter-items.ts:186` (crate), :180 (dungeon-key).
- **Player benefit:** power materials can't be fabricated; legit faucets + their speed untouched.
- **Files:** grant sites above + pattern `raid-start.ts`/`report-raid.ts`. New `*-start`/`report-*` endpoints, each `route()`-registered + CORS, crediting under `withKvLock(...,{failClosed:true})` (P0.4).
- **Difficulty:** L. **Deps:** P0.4 (fail-closed payout); shares Arena grant site with P0.2b. Independent of P0.1.
- **Risk:** high save-care — pay exactly once, never lost on failed round-trip (token sealed at drop, consumed on report, survives for retry; idempotent like raid). DO NOT change drop rates/odds — move the RNG server-side verbatim or leave it; this changes WHO is authoritative, not odds. Batch round-trips. War crate (single item append) is lowest-risk → first.
- **Rollback:** per-surface flags (`pveDropServerAuth.v1`, `hollowGateDropServerAuth.v1`, `warCrateServerAuth.v1`), default OFF; one surface at a time.
- **Testing:** token minted on drop, consumed once; double-report pays nothing; failure-injection → token survives → retry pays once; odds unchanged (statistical); war crate once per win; route-parity + CORS + lint; dist rebuilt.
- **Done:** listed drops + war crate pay from server-sealed tokens behind per-surface flags, exactly-once/loss-free; odds unchanged; routes registered; dist rebuilt.

## HEAL — Mastery-ramp heal/shield to the existing 750 cap · NEEDS SIGN-OFF
- **Description:** Ramp Heal/Shield by jutsu mastery (mirroring damage) from a reduced floor up to the UNCHANGED 750 cap, hard-capped at 750, in BOTH engines, parity-pinned. Net: weaker low-mastery heal-spam; identical max-mastery ceiling.
- **Why:** damage scales `epAtMax × masteryFrac` (`move.ts:545-546`, consts :65-66) but Heal/Shield are flat `HEAL_FLAT(750)×healBoost` (`move.ts:615`), `SHIELD_FLAT(750)` (:616); PvE mirrors flat (`Arena.tsx:2685,2692`, enemy :3370,:3375). Untrained heal already does full 750 → early heal-spam dominates.
- **Player benefit:** less low-mastery heal-spam; rewards investment; max-level balance unchanged.
- **Files:** PvP `move.ts:615` (Heal), :616 (Shield) — apply `masteryFrac` (already in scope, `masteryLevel` passed to `resolveTagStatuses` :810, used :614), hard-cap at 750, update log lines. PvE `Arena.tsx` player :2682-2688/:2691-2694, enemy :3368-3370/:3375 — mirror identically. Constants `HEAL_FLAT`/`SHIELD_FLAT` (`move.ts:122-123`), `HEAL_FLAT_PVE`/`SHIELD_FLAT_PVE` (`lib/combat-math.ts`); ramp reuses pinned `MASTERY_MIN_DAMAGE_FRAC`/`JUTSU_MAX_LEVEL`. Parity `_combat-formula-parity.test.ts` (pins HEAL/SHIELD :77-78, MASTERY :199-203) — add an assertion both engines apply the ramp.
- **Difficulty:** M. **Deps:** balance sign-off (user-approved in principle; M1/M2 boundary).
- **Risk:** balance change by design (early heals weaker). DECISION: reuse `MASTERY_MIN_DAMAGE_FRAC(0.3)` floor or a heal-specific floor — get explicit sign-off. Max-mastery MUST stay exactly 750 (regression-guard). Apply symmetrically to player AND enemy or PvE skews.
- **Rollback:** flag `healMasteryRamp.v1` (default OFF) → flat 750 byte-identical.
- **Testing:** both engines mastery50 → 750; mastery0 → floor; monotonic; PvE player==enemy symmetry; parity test extended; goldens updated only at sub-max; `npm test` + lint; dist rebuilt.
- **Done:** ramp to unchanged 750 in both engines behind sign-off flag; parity guarded; max-mastery byte-identical; signed off; dist rebuilt.

## P0.3b — Wound-stack cap + optional hard-control cap · NEEDS SIGN-OFF; RE-EVAL AFTER P0.1
- **Description:** Cap Wound stacking on a target; optionally cap hard-control density (≤1 Stun, ≤1 Seal) per loadout. **Budget enforcement (P0.1) may make the control cap redundant — re-evaluate after P0.1.**
- **Why:** Wound is a stacking DoT — applied per-cast (`move.ts:763`), ALL stacks tick (`applyDoTs` sums every Wound :851-856); per-application magnitude is rank-capped (`WOUND_HARD_CAP_PCT=60`) but stack COUNT isn't → casts compound. PvE mirrors (`Arena.tsx:2907-2912`/:3387-3394; ticks :3975,:4086). Hard-control density compounds lockdown.
- **Player benefit:** caps bleed/lockdown → fewer unwinnable matchups; healthier PvP. Balance restriction → sign-off.
- **Files:** Wound cap `move.ts:763` (apply) + :851-856 (tick) — max-stack or max-total clamp; mirror PvE `Arena.tsx:2907-2912,3387-3394` + ticks :3975/:4086. Control cap at seal in `sanitizeJutsuList` (`session.ts:187-247`) — count Stun/Seal jutsu, keep ≤1 each. Parity: pin any new Wound constant in `_combat-formula-parity.test.ts` (alongside `WOUND_CAP_BY_RANK` :59-70).
- **Difficulty:** M. **Deps:** **P0.1** — per-account budget may bound control density; do Wound cap independently, DEFER the control cap until P0.1 specced.
- **Risk:** balance change — pick caps carefully, apply symmetrically PvP+PvE+enemy. Control cap could invalidate legit 2-Stun loadouts → drop extras at seal time, don't reject saves.
- **Rollback:** flags `woundStackCap.v1`, `controlDensityCap.v1` (default OFF).
- **Testing:** N Wounds → ticking total clamped both engines (player+enemy); 2 Stun/2 Seal loadout → one each, single-control unchanged; parity pins new constant; goldens updated where cap changes outcomes; lint; dist rebuilt.
- **Done:** Wound capped symmetrically with parity pinned; control cap explicitly deferred/re-evaluated vs P0.1 (if kept, drops extras at seal, no save reject); signed off; dist rebuilt.

---

### Cross-cutting
- **P0.2b + P0.2c overlap** on `Arena.tsx:2416-2439` + raid token plumbing — sequence adjacently.
- **P0.4 is a prerequisite** for P0.2b/c payout RMWs (credit under failClosed).
- **Brief corrections (verified):** (1) `_floor-validate.ts` is test-referenced — deleting needs the test handled; (2) PvP EP clamp → ~60 (confirm vs jutsu data), not blanket 50 (save-side 50 is bloodline-specific); (3) `village-biomes.ts` confirmed dead (live lookup is `villageBiomeMap` from `storylines`).
- **`_combat-formula-parity.test.ts` is the load-bearing guard** for HEAL and P0.3b — any constant touched in `move.ts` must match the client mirror or `npm test` fails by design.
