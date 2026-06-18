# Hollow Gate Shrine — Gameplay Loop & Redesign (WORKING DRAFT)

Status: **SHIPPED** — Phases 1, 2, 3 + icon art are all live on `main` (see Build
status below). What remains is a balance-tuning pass once playtested. This doc
captured the design and now records what was built + the tunable knobs (§Balance).

Recent related work: the Shrine Keeper infinite-farm bug and the
heal-and-resume exploit were fixed in commit `1e3d656d` (no balance changes).
That fix is the reason the no-heal rule and the Torch/Threat meters are now
actually enforceable — which is what makes this redesign worth doing.

## Build status
- ✅ **Phase 1 COMPLETE** — economy + feel foundation:
  - `0742ea48` (1A): Torch-as-clock (fights no longer refill Torch) + fair death
    (entry currency snapshot → 50% claw-back, keeps XP/pets/uniques, forfeits
    Key) + `hollowShards` scaffold (field, per-save cap, combat-strip) +
    unit-tested `lib/hollow-gate-run.ts`.
  - `e67de6fd` (1B): depth-scaled Hollow Shard drops wired into chests (F1=3…F5=7),
    sealed-door Ancient Chests (7…15), and the Warden (40), shown in logs/modals.
  - NEEDS AN OWNER PLAYTEST — Torch drop/drain + shard drop rates are starting
    values; tune once felt (all localized — easy to adjust).
- ✅ **Phase 2A shipped** (`68b364d9`): retired `pet_battle`/`tile_game` walk-on
  tiles (ambush still spawns those); added the **Shard Vein** tile (💎).
- ✅ **Phase 2B shipped** — branching wings functional:
  - `3aa466c8` (2B-1): `lib/hollow-gate-wings.ts` hub+wing generator (treasure /
    beast / trial), guaranteed cut-vertex topology, wing tagging, self-checks +
    legacy fallback. Now the PRIMARY floor type.
  - `ba8d0c18` (2B-2): `wingEntryEffect()` movement gating — sealed wings blocked,
    first detour entry commits + seals the other, trial always open (no softlock).
    Visibility unchanged (room-flood already fogs unentered wings).
- ✅ **Icon art**: 13 bespoke shrine icons generated (gpt-image-1) + published to
  the live image store + pushed to main; Shard Vein atlas role wired.
- ✅ **Phase 3A shipped** (`7cf07620`): in-run consumables — Reignite Torch,
  Skeleton Key, Hollow Ward, Diviner's Eye, Sanctify Loot (`lib/hollow-gate-shards`
  + `HollowGateShardBar`).
- ✅ **Phase 3A-2 shipped** (`4cdbde77`): Second Wind revive wired across all
  three death paths (battle KO + trap tile + locked-door trap).
- ✅ **Phase 3B shipped** (`9ab60710`): Shrine Attunement tree — permanent shard
  upgrades (Seasoned Delver, Reiki Reserves, Cartographer, Greedy Hands, Extra
  Dive) via `lib/hollow-gate-attunement` + a World Map Enter/Attune menu.
  Server-clamped in api/save.
- ✅ **Key Forge shipped** (`65e0d9db`): the Attunement panel forges Hollow Gate
  Keys from shards (now 80 each), closing the self-sustaining loop.
- ↩️ **Wings reverted to random maze** (`0b47ecfa`): per owner preference the
  floors are random again, NOT the fixed hub+3-wing structure. The wing
  generator (`hollow-gate-wings`) is kept but off by default; the wing UI/
  mechanics no-op on these floors. Everything else in the redesign works unchanged.
- ✅ **Random maze carver + BSP variety** (`8481bd34`): each floor rolls ~1/3
  hand-authored layout, ~1/3 a recursive-backtracker maze (`hollow-gate-maze`:
  winding passages + ~14% loops + carved rooms + dead-end loot), ~1/3 a
  randomized BSP floor (split depth 3-4, per-run corner-cut %, 1-3 loops).
  Corridor vision is distance-capped (6) so the maze keeps its fog.
- ✅ **Phase 2B-3 shipped** (`2dc385f1`): wing readability + HUD polish — floors/
  doors tinted by wing, hub doors labelled with their destination glyph
  (🏆/🐺/⚔ — informed choice), HUD shows banked shards + a death "at-risk"
  indicator, and the intro VN explains wings / torch / shards / death. New pure
  `wingThemeAt` (tested).
- ⏳ **Remaining (optional):** Phase 4 — a balance-tuning pass on the starting
  constants once the loop has been playtested.
- ⚠️ **Strongly recommend an owner playtest now** — Phases 1+2 changed the loop
  substantially (torch economy, fair death, shards, wing structure). Validate the
  feel + tune the starting numbers before layering on UI/sinks.

---

## 1. Current loop

### 1a. Macro loop (between runs)
- **Unlock:** the seated Kage spends `HOLLOW_GATE_UNLOCK_COST` = 10,000 Honor
  Seals (one-time, village-wide, one-way). Server-gated to seatedKage/admin in
  `api/_village-state-validate.ts`. The shrine then appears on the World Map for
  everyone in the village.
- **Entry:** consumes 1 **Hollow Gate Key** item (`hollow-gate-key`). Key
  sources today: in-run chests (~30%/chest) and the Kage-liberation story finale.
- **Daily cap:** `DAILY_HOLLOW_GATE_CAP` = 2 runs/day (client-side only;
  `dailyHollowGateRuns`, reset at UTC midnight).
- **Exits:** clear the F5 Warden (auto-extract + bonus) · step on the Leave tile
  (extract, forfeit remaining floor) · die (hospitalized, run + Key forfeit).

### 1b. Micro loop (inside a run)
- Grid `HOLLOW_GATE_SHRINE_W × H` = 15×11, fogged. Hand-authored layouts with a
  BSP fallback (`lib/hollow-gate-dungeon.ts`). Spawn room, a Descend/Boss
  "Target" tile, a Leave tile.
- **Resources:** HP (no healing in the shrine), Torch of Reiki (0–10), Threat
  (0–100), in-run Keys (open `locked` tiles).
- **Per step:** reveal tile · Torch drains 1 at ~33%/step (~30 steps of light) ·
  Threat `+HOLLOW_GATE_THREAT_PER_STEP` (=7), ×2 when Torch=0 · fire the tile
  event if unresolved. Ambush at Threat `HOLLOW_GATE_THREAT_AMBUSH` (=100).
- **Tiles:** `battle` / `elite` (Arena fight) · `pet_battle` (PetArena "Hollow
  Beast") · `trap` (−`HOLLOW_GATE_TRAP_DMG_PCT`=33% max HP, no heal, lethal) ·
  `chest` (ryo/xp/aura/bone + 30% Key + 2 Torch) · `shrine` (Torch→full + hidden
  chamber) · `tile_game` (Card Clash) · `locked` (1 Key → 50% chest / 25% trap /
  25% pet rare→mythic) · `npc` Shrine Keeper (heal 33% / refill Torch / gift Key)
  · `descend` (next floor; carry Keys+Torch, +4 Torch) · `boss` (F5 Warden).
- **Battle reward (Arena):** normal ≈140 XP / 380 ryo / 5 dust; ambush ≈220 /
  900 / 10; boss ≈600 / 2400 / 30, all ×`(1 + 0.2·(floor−1))`
  (`HOLLOW_GATE_BOSS_FLOOR_REWARD_MULT`).
- **Surviving any fight → Threat 0 AND Torch 10.**  ← key defang point.
- **Floors:** F1–4 = descend staircase; F5 = Warden. `HOLLOW_GATE_MAX_FLOOR`=5.
- **F5 clear bonus:** Honor/charm/shard package + 1 Dungeon Legendary Fragment +
  1 Veil of the Hollow, then auto-extract.
- **Rewards apply to the character live;** the only ceiling is the global
  per-save gain cap in `api/save/[name].ts` (ryo +1M, soft currencies +50/cycle).

---

## 2. Why it needs changing

1. **Resource meters are defanged.** Every surviving fight resets *both* Threat
   and Torch, and fights are frequent (4–7 + elites + ambushes per floor). The
   "manage your light in the dark" tension never materializes.
2. **All-or-nothing variance.** One lost fight (or a trap at low HP, no healing)
   ends a 5-floor run and burns the Key. Brutal tax on a single bad roll.
3. **Rewards fight the economy.** Payouts are mostly soft currencies the save
   layer caps at +50/cycle, so big hauls clip; there is no dungeon-unique
   economy. The only unique pulls are locked to the single F5 clear.
4. **Exhaustive sweep, not choices.** Random tile placement makes optimal play
   "reveal everything, grab it, descend." No risk/reward decisions.
5. **Cadence mismatch.** Long, high-variance run behind a scarce Key + 2/day cap
   = low frequency, high punishment.
6. **Shallow pet & meta hooks.** Pet battles are side content (no capture); each
   run is isolated; no depth record or milestone goals.

---

## 3. Design goals

- A real **greed decision**: push deeper vs. bank what you have.
- Make **Torch** a meaningful clock and **death** fair (not all-or-nothing).
- Give the dungeon its **own economy** so it stops fighting the save caps.
- Add **agency** (path choices) and a **chase** (depth, unique drops).

---

## 4. Proposed loop (phased) — subject to the decisions in §5

### Phase 1 — feel & safety (contained, no engine rewrite)
- **Torch is the clock.** Fights reset Threat (earned breather) but NOT Torch.
  Torch refills only from chests/Shrine/Keeper. Now depth is gated by light.
- **Death = lose the Key, keep half your haul, keep your pets.** Track this
  run's loot as a running tally (`run.earned`). On death: forfeit the entry Key
  (as today), **claw back 50% of the currencies/items earned this run**, but keep
  **all befriended pets** and **all XP** in full. Removes the all-or-nothing
  feel-bad without checkpoints, and keeps the 5-floor length intact.
  - *Detail to confirm:* claw-back applies to ryo / aura / bone / fate shards /
    Hollow Shards and dropped gear; Dungeon Legendary Fragments + Veil are
    likely "keep in full" (rare), XP + pets keep in full. Hollow Shards spent
    on a Second Wind (below) are already gone, so they're not double-counted.
- **Hollow Shards** — a **Hollow-Gate-ONLY** currency (NOT a save-capped global
  currency), dropping more with depth, with sinks that exist *only inside the
  Gate loop* (see §7). No general-economy spend. Confirmed first sink: a
  **Second Wind** (in-run revive / "second life").
- **Pets stay from the normal pool.** No dungeon-exclusive pets — the locked-door
  encounters keep pulling from the shared `petPool` (current behavior).

### Phase 2 — structure & depth
- **Branching wings**: spawn opens 2–3 themed doors (Treasure / Beast / Trial);
  pick one; the Trial wing holds the descend. Agency + replayability.
- **Depth meta**: persistent "Deepest Floor" record, one-time milestone rewards,
  depth-scaled unique drops.
- **Pet capture**: a defeated Hollow Beast can yield a dungeon-exclusive pet.

### Phase 3 — tuning & polish
- 3-floor punchy run (boss F3) OR keep 5 with checkpoints; raise daily cap to
  match. Once-per-run "resurrect for X Hollow Shards" sink. Extract/death summary
  showing banked vs. lost.

---

## 5. Decisions

DECIDED (this round):
1. **Cadence / run length** — ✅ **Keep 5 floors as-is** (epic, rare, high-stakes).
2. **Death stakes** — ✅ **Lose the entry Key; keep 50% of loot; keep all pets
   found.** (Plus XP in full.) Implemented via a run loot tally + claw-back, not
   per-floor checkpoints.
3. **Reward identity** — ✅ **Both currency + unique items, depth-gated.**
   ❌ No dungeon-exclusive pets. ✅ Hollow Shards = Hollow-Gate-only economy
   with dungeon-internal sinks (see §7).

DECIDED (shard round):
4. **Hollow Shard sinks** — ✅ In-run **survival** (Second Wind, Reignite Torch,
   Sanctify Loot) + in-run **tactics** (Skeleton Key, Diviner's Eye, Hollow Ward)
   + the permanent **Shrine Attunement** tree. ❌ Vault Floor 6 / Warden
   upgrades (cut). ❌ Mend Seal (cut).
5. **No-heal rule** — ✅ **Keep strict.** No mid-run heal valve (Mend Seal cut);
   Shrine Keeper's 33% remains the only in-run heal, as today.

6. **Branching wings** — ✅ **Adopt now.** Each floor = a spawn hub opening into
   2–3 themed doors (Treasure / Beast / Trial); the Trial wing holds the
   descend/Warden. Generation rewrite (§8).
7. **Tiles** — ✅ **Remove `pet_battle` + `tile_game` walk-on tiles** (kept in the
   type union for legacy saves). Those encounter types still occur via the
   threat **ambush** roll, so combat variety is preserved without dedicated
   tiles. ✅ Add a **Shard Vein** tile (findable Hollow Shard cache). Keep
   `trap`/poison, `chest`, `shrine`, `story`, `locked`, `npc`, `descend`,
   `boss`, `exit`. (§8)

CLAW-BACK SCOPE (default unless changed): keep **XP, pets, and unique items**
(Dungeon Legendary Fragment / Veil) in full; claw back **50% of ryo, aura
dust/stones, bone charms, fate shards, Hollow Shards, and dropped gear**. Keeps
Second Wind / Sanctify Loot meaningful without gutting a hard-won unique drop.

---

## 6. Implementation touch points (for when we build)
- Generation / tiles: `shinobij.client/src/lib/hollow-gate-dungeon.ts`,
  `lib/hollow-gate-bsp.ts`, `data/hollow-gate-atlas.ts`.
- Driver / rewards: `App.tsx` — `enterHollowGateShrine`, `moveHollowGatePlayer`,
  `resolveHollowGateTile`, `startHollowGateBattle`, `onHollowGateBattleWin`,
  `completeArenaStoryBattle` (hollowGate branch), `leaveHollowGateShrine`.
- Run state type: `types/character.ts` `HollowGateShrineRun` (add banked-loot /
  checkpoint fields here).
- Nav lock: `lib/screen-guards.ts` (`isUnresolvedBattle`).
- Persistence / anti-cheat: `api/save/[name].ts` (whitelist + per-save caps —
  any new currency like Hollow Shards needs a cap entry).
- Weekly hook: `api/missions/_weekly-board.ts` (`hollowGateWardenKills`).

> Note: App.tsx is at its line-budget ceiling — new logic should land in
> `lib/` modules (e.g. a `lib/hollow-gate-run.ts` for the loot tally / shard
> economy), not in App.tsx.

---

## 7. Hollow Shards — sink brainstorm  **[DECIDE which make the cut]**

Design rule (per owner): shards are **earned only in the Gate** and **spent only
on the Gate**. Drop scaling with depth (deeper floors = more shards) so pushing
the full 5 floors is the way to bank them. Below, the menu — grouped by where
they're spent.

### A. In-run consumables (tactical — spent mid-delve, from a held shard pool)
- **Second Wind** ✅ (confirmed) — on death, revive once and continue the run
  (e.g. 50% HP, Threat reset). Escalating shard cost per use in a run; can be
  pre-armed at entry or triggered on the death screen. *The "second life."*
- **Reignite the Torch** — instantly refill Torch to full. Pairs with the
  "Torch is the clock" change; your emergency against the dark.
- **Hollow Ward** — reset Threat to 0 and suppress the next ambush (skip a fight
  you're too hurt to take).
- **Skeleton Key** — open one `locked` door without an in-run Key.
- **Diviner's Eye** — reveal the floor map (or just the Descend / Leave / locked
  tiles) — buy your way out of blind sweeping.
- **Sanctify Loot** — lock in your current haul so the 50% death claw-back
  can't touch it (raise retained % for loot earned so far). Insurance.
- **Mend Seal** — the *only* sanctioned mid-run heal, shard-priced so it stays a
  real cost (gates against trivializing the no-heal rule). Only if we want a heal
  valve at all.

> CHOSEN tiers: A (survival + tactics) and B (Shrine Attunement). Vault Floor 6
> / Warden upgrades and Mend Seal are CUT. Cosmetics (C) optional/later.

### B. Permanent "Shrine Attunement" (meta — spent between runs, persists)
A small upgrade tree bought with shards; everything dungeon-internal.
- **Deeper Reserves** — start each run with higher Torch / a higher Torch cap.
- **Seasoned Delver** — start with 1 in-run Key, or a free Second Wind charge.
- **Cartographer** — Descend tile revealed at floor start.
- **Greedy Hands** — raise base death-retention above 50% (e.g. 60/70%).
- **Extra Dive** — +1 daily run (raise the cap for this account).
- **Key Forge** — unlock crafting Hollow Gate Keys from shards (gates the
  self-sustaining entry loop behind a one-time meta purchase; keys stay
  Gate-only so this respects the "shards only touch the Gate" rule).
- **Vault Key / Warden's Bane** — pay shards at the Warden to open a bonus
  **Vault floor (F6)** of premium loot, or permanently boost Warden rewards.

### C. Prestige / cosmetic (optional pure sinks)
- Shrine title, torch/aura VFX skin, a World-Map shrine cosmetic. Pure shard
  drains for bragging rights; zero balance impact.

**Chosen set:** Second Wind + Reignite Torch + Sanctify Loot + Skeleton Key +
Diviner's Eye + Hollow Ward (tier A), plus the Shrine Attunement tree (tier B:
Deeper Reserves, Seasoned Delver, Cartographer, Greedy Hands, Extra Dive, Key
Forge). Vault Floor 6, Warden upgrades, Mend Seal, and cosmetics are out/parked.

---

## 8. Tile changes

REMOVE as placed tiles (keep the string in the `HollowGateTileKind` union for
legacy saved-run compatibility, exactly like `pet_event` was retired):
- `pet_battle` — Hollow Beast walk-on tile. Pet duels still occur via the
  **ambush** roll (shinobi / pet / tile-seal), so the encounter type survives.
- `tile_game` — Card Clash walk-on tile. Same — still reachable via ambush.
- Their pre-encounter modals in `resolveHollowGateTile` go away with the tiles;
  the ambush paths (`triggerHollowGateAmbush`) keep their own flows.

ADD:
- **Shard Vein** (`shard_vein`) — a findable Hollow Shard cache (depth-scaled
  payout, e.g. ~floor×small). Introduces the new currency as a map reward and
  gives the Treasure wing something to hold. Optional 2nd new tile (parked):
  **Reiki Font** (a Torch interaction node) if we want more Torch decisions.

KEEP: `trap` (poison), `chest`, `shrine`, `story`, `locked`, `npc` (Keeper),
`descend`, `boss`, `exit`, `empty`, `wall`.

WING CONTENT BIAS (with §8 branching): Treasure wing → chests + shard veins +
traps; Beast wing → ambush-pet-leaning + elites; Trial wing → elites + the
descend/Warden. Player picks one wing per floor (others stay sealed for that
floor) — that's the per-floor agency.

---

## 9. Phased build plan

Guiding constraints: PvE-only (no ranked/PvP determinism touched); rewards stay
client-applied + save-cap-bounded; new logic lands in `lib/` (App.tsx is at its
line budget); preserve saved-run resume; run `npm test` + client `lint`/`tsc`
each phase; rebuild/commit nothing to `dist/` from the worktree (Railway
self-builds; cPanel isn't live).

### Phase 1 — Core loop & economy foundation (no generation change)
**Goal:** the feel changes land first, decoupled from the riskier gen rewrite.
- **New module `lib/hollow-gate-run.ts`** — owns: the run loot tally
  (`earned` by currency/item), `applyLoot()` helper, `clawBackOnDeath()` (50%
  per §5 scope), and the Hollow Shards in-run pool.
- **Torch-as-clock:** remove the `torch:10` resets in `onHollowGateBattleWin`
  (boss/ambush/regular branches) and any battle-win torch refill; keep the
  Threat→0 reset. Leave chest/Shrine/Keeper torch refills. Re-tune starting
  torch / drain if testing shows runs starve.
- **Loot tally + claw-back:** route every reward grant in `resolveHollowGateTile`
  and the hollowGate branch of `completeArenaStoryBattle` through `applyLoot()`
  (still applies to the character live, but also tallies). On a Hollow Gate
  death (the `continuePendingArenaStoryBattle` hospitalized branch + trap-death),
  call `clawBackOnDeath()` and keep pets/XP/uniques.
- **Hollow Shards currency:** add `hollowShards?: number` to `Character`
  (`types/character.ts`); whitelist + a **generous per-save cap** in
  `api/save/[name].ts` `CURRENCY_CAPS` (anti-tamper backstop; dungeon-only spend
  limits blast radius) and add to `COMBAT_STRIP_CHAR_FIELDS`. Shard drops on
  chests / locked / Warden, depth-scaled.
- **Tests:** unit-test `lib/hollow-gate-run.ts` (tally, 50% claw-back, uniques
  kept). Build/lint/test green.

### Phase 2 — Branching wings (generation rewrite)
**Goal:** per-floor agency. Highest-risk change — isolated in the generator.
- Rework `lib/hollow-gate-dungeon.ts`: a floor = spawn **hub** + 2–3 sealed
  **wing** doors (Treasure / Beast / Trial). Picking a wing opens it; the others
  stay sealed for that floor. Trial wing contains the descend/Warden.
- Hand-authored hub+wing layouts + a BSP fallback that guarantees a hub with N
  wing stubs. Update reachability validation (hub→chosen-wing→descend) and the
  visibility flood for the hub/wing model.
- Apply §8 tile changes (drop `pet_battle`/`tile_game` placement; add
  `shard_vein`; wing-biased content).
- **Tests:** generator invariants (every wing reachable from hub; descend gated
  behind the Trial wing; no orphaned tiles). Legacy saved-run resume still loads.

### Phase 3 — Shard sinks + UI
**Goal:** spend the currency; surface the whole loop.
- **In-run consumable panel** (new component, e.g. `components/HollowGateShardBar`)
  — Second Wind (arm), Reignite Torch, Sanctify Loot, Skeleton Key, Diviner's
  Eye, Hollow Ward; each shows shard cost, disabled when unaffordable.
- **Shrine Attunement screen** (new screen/component) reached from the World Map
  shrine node / village; nodes persist on `Character` (e.g.
  `hollowGateAttunement`): Deeper Reserves, Seasoned Delver, Cartographer,
  Greedy Hands, Extra Dive, Key Forge. Server-validate the spec like
  `masterySpec` (anti-tamper) in `api/save/[name].ts`.
- **Key Forge** crafting (shards → `hollow-gate-key`).
- Wire effects: starting torch/keys, Cartographer reveal, Greedy Hands raises the
  claw-back retention, Extra Dive raises `DAILY_HOLLOW_GATE_CAP`.

### Phase 4 — UI polish, tuning, deploy
- **Run HUD:** Torch as a depleting bar (now load-bearing), Threat, in-run Keys,
  **Hollow Shards (run pool)**, and a **loot tally** ("secured vs at-risk").
- **Wing-door selection** UI at floor start (themed labels/icons).
- **Death screen:** "You fell — lose your Key and 50% of your haul." with a
  **[Revive — Second Wind: X shards]** option and a kept-vs-lost summary.
- **Extract / F5-clear summary:** full haul + shards + depth record.
- **Diviner's Eye** clears fog; remove the now-dead `pet_battle`/`tile_game`
  pre-modals.
- Balance pass (shard drop rates, sink costs, torch drain, attunement costs);
  Monte-Carlo via a `scripts/` harness if needed. Final test/lint/tsc; commit.

### UI surfaces touched (summary)
Run HUD (torch/threat/keys/shards/loot tally) · wing-door picker · shard
consumable bar · death/revive modal · extract & clear summaries · Shrine
Attunement tree screen · Key Forge · World-Map shrine node entry (Attunement +
shard balance). Removed: `pet_battle` / `tile_game` tile pre-modals.

### Sequencing note
Phases 1 → 2 → 3 → 4, each independently shippable. Phase 1 delivers the feel
win without the gen risk; Phase 2 is the big isolated rewrite; Phase 3 makes
shards matter; Phase 4 is polish/tuning. Recommend a build/test/owner-look gate
between each.

---

## 10. Balance knobs (Phase 4 — tunable, first-cut values pending playtest)

Every Hollow Gate number lives in a named constant — tune from feel, no engine
changes needed. None of the pre-existing combat reward / trap-damage / XP values
were touched.

**Run resources** (`App.tsx`, admin-tunable `let`s):
- `HOLLOW_GATE_THREAT_PER_STEP` = 7 · `HOLLOW_GATE_THREAT_AMBUSH` = 100 ·
  `HOLLOW_GATE_TRAP_DMG_PCT` = 0.33 · `HOLLOW_GATE_MAX_FLOOR` = 5.
- Torch: starts 10, drains 1 at ~33%/step, +2/chest, full at shrines/Keeper,
  +4 on descend. Fights no longer refill it (the clock). `DAILY_HOLLOW_GATE_CAP`
  = 2 (+ Extra Dive attunement).

**Shard income** (`lib/hollow-gate-run.ts` `hollowShardDrop`): chest 2+floor
(F1=3…F5=7) · shardVein 3+2·floor (5…13) · lockedChest 5+2·floor (7…15) ·
boss 15+5·floor (F5=40). A full 5-floor clear nets ~250 shards. (Generous on
purpose for a new system — trim here first if the economy feels too fast.)

**In-run consumable costs** (`lib/hollow-gate-shards.ts`): Reignite 6 · Skeleton
Key 8 · Sanctify 14 · **Hollow Ward 14** · **Diviner's Eye 16** · **Second Wind
30**. (Bolded ones were nudged up this pass — the strong run-savers should be
deliberate.)

**Attunement** (`lib/hollow-gate-attunement.ts`): node cost = `baseCost × (rank+1)`
— Seasoned Delver 30 (×2) · Reiki Reserves 30 (×2) · Cartographer 40 (×1) ·
Greedy Hands 45 (×3) · Extra Dive 120 (×1) · Key Forge 150 (×1). **Key Forge
craft `KEY_FORGE_COST` = 80/key** (nudged from 60). Death loot retention =
0.5 + 0.1·Greedy-Hands (cap 0.8).

**Save caps** (`api/save/[name].ts`): `hollowShards` +200/save cycle;
`hollowGateAttunement` ranks clamped 0–3 (anti-tamper).

First-cut tuning rationale (this pass): kept income generous to reward depth;
raised the strongest sinks (Ward / Diviner / Second Wind / Key Forge) so they're
choices, not reflexes. All other values are starting points — adjust to feel.
