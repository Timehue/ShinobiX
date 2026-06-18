# PvE AI — smarter, bracket-aware, full turn-economy rebuild

**Status:** PLAN ONLY (no code written). Authored 2026-06-18.
**Scope:** Standard PvE enemy AI only. **PvP, ranked, and endless are explicitly out of scope** and must stay byte-identical. This changes enemy *decisions* and *loadouts* — **never** AP costs, damage formulas, tag %s, cooldowns, durations, or the bracket stat curve.

---

## 1. Goal

Make PvE enemies (a) actually use the 100-AP / multi-action turn system, (b) read what the
player is doing and act on it, (c) carry a deliberate mix of **40 AP** and **60 AP**
jutsu so a turn reads as real shinobi decision-making, and (d) at the top bracket
("peer", level 91+) wield **40 AP legendary weapons**. Difficulty should differ by
*behavior* across the brackets you already set, not just by bigger numbers — and fights
should be fun: readable, telegraphed, answerable.

## 2. What exists today (verified in code)

- **Decision code:** `enemyTurn()` in [Arena.tsx](../shinobij.client/src/screens/Arena.tsx) (~3507), driven by a rule
  list (`buildBasicCombatAiRules` in [combat-ai.ts](../shinobij.client/src/lib/combat-ai.ts)) + a scorer
  (`highestPowerAiJutsu` → `smartAiJutsuPick`).
- **Rule conditions are player-blind:** `always | specific_round | distance_lower_than |
  distance_higher_than | hp_lower_than` ([creator-ai.ts](../shinobij.client/src/types/creator-ai.ts)). Boss "patterns"
  fire by round number, not by what you do.
- **The scorer reads player *state*** (HP, buffs, shields, armor, Pierce, amp stacks) but
  **only at enemy level ≥ 30**; below that it's a power-sort. Nothing reads player
  *behavior/history*.
- **The enemy takes exactly ONE action per turn.** Every branch of `enemyTurn()` ends with
  `finishEnemyAiAction(); return;`, which resets both sides to 100 AP and flips the turn.
  A typical enemy spends one 40–60 AP move and **throws away the other ~40–60 AP**, while the
  player gets a full 100-AP / up-to-5-action turn. The enemy plays handicapped.
- **No use of:** Clear (strip player buffs), Cleanse (remove own debuffs), proactive defend,
  items, **weapons** (`CreatorAi` has only `jutsuIds` — no weapon field), Push/Pull tactics,
  telegraphing, boss phases, or behavioral adaptation.
- **Brackets** ([pve-difficulty.ts](../shinobij.client/src/lib/pve-difficulty.ts)): easy 1–30 / medium 31–50 / hard 51–90 /
  peer 91+, by *encounter* level. They scale stats, hit caps, mercy floor, mastery — but
  **not intelligence** (a hard cliff at level 30).

## 3. The turn-economy model the AI must learn

The catalog ([data/jutsu.ts](../shinobij.client/src/data/jutsu.ts)) is effectively four building blocks:

| Block | AP | Shape | Examples |
|---|---|---|---|
| **Attack** | 40 | single `Damage` tag, EP 30–35 — efficient bread-and-butter | Static Fang (35), Charged Senbon (35), Granite Elbow (35), Tide Spear (33), Neural Flash (32) |
| **Utility / defensive** | 40 | EP 0–27, 1–2 tags — shields, reflect, move, debuff appliers (forced to element-only `type:"Any"` by `normalizeJutsu`) | Mist Veil Flow (Shield+DDT), Flash Step Counter (Reflect), Iron Sand Burst (Wound), Ashen Mind Lock (Buff Prevent) |
| **Signature** | 60 | EP ~30 + one strong tag — control/pressure/pierce | Paralysis Theater (Stun), Buried Memory Field (Seal), Thunderclap Lance (Pierce), Blazing Dragon Arc (IDT), Inferno Hallucination (IDG), Torrent Chain Slash (Siphon) |
| **Reposition** | 20 | Flicker (Move) | starter-universal-flicker |

A real 100-AP turn is built from these: `Stun(60)+Attack(40)`, `Shield(40)+Attack(40)+Flicker(20)`,
`BuffPrevent(40)+Signature(60)`, `Weapon(40)+Signature(60)` (peer). The whole point of giving
each AI "proper 40 and 60 AP options" is so the multi-action loop has clean fills.

## 4. Constraints (hard)

- No rewrite — extend `smartAiJutsuPick` / `buildBasicCombatAiRules` / the band helpers.
- Client-only. No `api/` change, no Supabase/schema change. PvE combat already runs client-side; rewards stay gated by their existing server-authoritative paths.
- **Decisions & loadouts only — never the math.** AP, damage, tag %s, cooldowns, durations, the band stat multipliers/caps/mercy-floor all stay identical.
- PvP / ranked / endless gated out via the existing `isStandardPve` flag.
- Determinism-friendly: variety from turn/state hashing, not `Math.random()`.
- New tactics logic lives in a new `lib/combat-ai-tactics.ts` (keep Arena.tsx from growing); band policy stays in `pve-difficulty.ts` next to the existing easy-band helpers.

---

## 5. Phases

### Phase 0 — Multi-action enemy turn loop (FOUNDATIONAL)
Without this, "40 and 60 AP options" are meaningless because the enemy only acts once.
Convert `enemyTurn()` from "pick one action → end" into a **budget loop**: the enemy spends
its `enemyTurnAp` across up to 5 actions, deducting each action's AP, until it can't afford the
cheapest move (mirror the player's `pveMinActionCost` auto-end). Apply Lag/Overclock/Stun
**per action** like the player, not as a flat budget cut.
- **Safety:** `pveGuardedEnemyHit` / `enemyTurnDealtRef` already accumulate damage across
  *"one or more chained enemy actions"* — so the easy/medium per-turn caps already bound this.
  Only hard/peer feel the full multi-action pressure, by design.
- **Files:** Arena.tsx (`enemyTurn`, `finishEnemyAiAction` split into per-action vs end-of-turn).

### Phase 1 — Perception + short memory (the "read the player" layer)
New `lib/combat-ai-tactics.ts` → `buildPlayerRead(state)`, computed each enemy turn:
- **State:** HP%, AP, shield up?, active buffs/amp stacks, active DoTs, stunned/sealed/low-AP.
- **Memory (new):** rolling window of the player's last 3–4 actions stored on Arena battle
  state — `lastAction` (attacked/healed/shielded/buffed/cleansed/cleared/kited/threw), favored
  jutsu type & element, aggression ratio, and a "just powered up" flag.
- **Files:** new `lib/combat-ai-tactics.ts`; small player-action log in Arena.tsx.

### Phase 2 — Reactive rule vocabulary + new actions (incl. `use_weapon`)
Additive extensions to [creator-ai.ts](../shinobij.client/src/types/creator-ai.ts) (old rules keep working):
- **Conditions:** `player_hp_lower_than`, `player_has_shield`, `player_has_buff`,
  `player_low_ap`, `player_used` (last action), `self_has_debuff`.
- **Actions:** `clear_player_buffs` (the unused **Clear**), `cleanse_self` (the unused
  **Cleanse**), `shield_up`/`defend`, `reposition`/`kite`, and **`use_weapon`** (Phase 5).
- Teach `aiRuleMatches()` + the `enemyTurn()` loop to evaluate/execute them.
- **Files:** creator-ai.ts, combat-ai.ts, Arena.tsx.

### Phase 3 — Band intelligence ladder (the core "fit my brackets" fix)
Replace the binary level-30 smart flip with a per-band competence profile in
[pve-difficulty.ts](../shinobij.client/src/lib/pve-difficulty.ts) (`pveAiCompetence(level)`), layered on top of the stat bands you set:

| Band (level) | Reads state | Reads behavior | Counterplay (Clear/Cleanse/defend) | Pick quality | Telegraph | Weapons |
|---|---|---|---|---|---|---|
| **Easy 1–30** | HP + shield only | No | No | Sometimes 2nd-best (readable) | Always, long wind-up | No |
| **Medium 31–50** | Full | No | Occasional (reacts to your shield/heal) | Mostly optimal | Yes | No |
| **Hard 51–90** | Full | Light (targets weakness) | Yes (strips key buffs, punishes greed) | Optimal | Yes, short tell | No |
| **Peer 91+** | Full | Yes (counters turtle/burst/kite) | Aggressive | Optimal + setups | Minimal | **Yes (40 AP legendary)** |

The scorer now runs at every level, but its aggressiveness, which reactive tools it may use,
and telegraph/weapon behavior are gated by band. This gives easy→peer a *behavior* slope.

### Phase 4 — Loadout pass: adapt every AI to the 40/60 model
Rebuild the 7 archetype templates so each fills a multi-action turn (target shape: ~2× 40 AP
attack, 1–2× 60 AP signature, 1× 40 AP utility/defensive, Flicker). Current audit found
**Balanced is 3:1 lopsided, Hunter has only 4 jutsu, Defender has almost no offense.**

Recommended starting loadouts (IDs from the verified catalog; tune in playtest):

| Loadout | 40 AP attacks | 60 AP signatures | 40 AP utility | Reposition |
|---|---|---|---|---|
| **Balanced** | Static Fang, Tide Spear | Blazing Dragon Arc (IDT), Mud Coffin Bind (Stun) | Mist Veil Flow (Shield+DDT) | Flicker |
| **Control** | Neural Flash | Paralysis Theater (Stun), Buried Memory Field (Seal) | Ashen Mind Lock (Buff Prevent), Mist Memory Snare (Clear Prevent) | Flicker |
| **Burst** | Static Fang, Charged Senbon | Inferno Hallucination (IDG), Blazing Dragon Arc (IDT) | Cinder Rush (Wound) | Flicker |
| **Bruiser** (melee) | Granite Elbow, Spark Jab Chain | Raikou Knee Strike (Stun), Boulder Heel Drop (IDG) | Ripple Guard Form (Shield) | Flicker (close gap) |
| **Defender** | Charged Senbon | Moonlit Tide Dream (DDT), Tidal Shoulder Throw (DDG) | Mist Veil Flow (Shield+DDT), Flash Step Counter (Reflect) | Flicker |
| **Hunter** (fix → 6) | Granite Elbow, Windmill Shuriken Line (Wound) | Tidal Shoulder Throw (DDG) | Iron Sand Burst (Wound), Hidden Current Guard (Shield) | Flicker |
| **Boss** | Static Fang | Paralysis Theater (Stun), Blazing Dragon Arc (IDT), Torrent Chain Slash (Siphon) | Mist Veil Flow (Shield), Ashen Mind Lock (Buff Prevent) | Flicker |

Then per-archetype *behavior* (not just stats): defender turtles + counters, control chains
disables but leaves a counterplay gap, burst telegraphs nukes, bruiser closes & pressures,
boss uses the full reactive toolkit. **Files:** combat-ai.ts (`aiJutsuLoadout`,
`buildBasicCombatAiRules`).

### Phase 5 — Peer weapons (40 AP legendary)
`CreatorAi` has **no weapon field today**, so this is a small, additive seam:
1. Add `weaponId?: string` to `CreatorAi` ([creator-ai.ts](../shinobij.client/src/types/creator-ai.ts)).
2. Add `enemyUseAiWeapon(item, ap)` in Arena.tsx mirroring `enemyUseAiJutsu` — synthesize the
   weapon as a Bukijutsu (`effectPower: item.weaponEp`, `ap: item.apCost ?? 40`,
   `isUtility:false`), run the **existing** `calculateDamage` + post-damage tag pipeline, set
   the weapon cooldown. (Same path the player weapon action already uses — no new math.)
3. The Phase-3 band gate attaches a weapon **only in the peer band**, so it's systemic:
   static peer enemies *and* re-leveled foes (missions, Hollow Gate) that land at 91+ gain one.

All legendary weapons are 40 AP melee (hand), 27 EP, with a strong post-damage tag — a clean
extra 40 AP turn-option:

| Weapon ID | Effect | Use on |
|---|---|---|
| `frostfang-oathblade` | Shield 300 | tanky finale bosses (kage) |
| `tempest-fang-blade` | Reflect 30% | anti–glass-cannon peer duelists |
| `black-lotus-dagger` | Lifesteal 30% | attrition bruisers (Hollow Gate Warden @ peer) |
| `elderbranch-katana` | Absorb 30% | damage-wall tanks |
| `embercoil-scythe` | Lifesteal 30% | Worldstorm Dragon (boss) |

(No 40 AP *thrown* legendaries exist — thrown legendaries are 20 AP; peer weapon use is melee,
woven as `Weapon(40)+Signature(60)`.)

### Phase 6 — Fun layer: telegraphing, personality, phases
- **Telegraph signature/weapon moves** (AP ≥ 60, reusing `pveIsBurstJutsuAp`): in easy/medium
  the AI winds up one turn with a clear combat-log + UI tell ("⚡ The Warden gathers chakra…"),
  giving the player a turn to Shield/Cleanse/kite. Highest-leverage "fun" change; bands already
  prevent one-shots so this is pure readability/counterplay.
- **Boss phases:** at ~40% HP a boss shifts pattern (telegraphed), so the back half of a fight
  reads differently from the front.

### Phase 7 — Validation
- Extend `scripts/arena-ai-stats.ts` into a behavior sim: new AI vs scripted player archetypes
  (aggressive / turtle / kiter / combo-burst) across all four bands; measure **win-rate,
  kill-time, reactions triggered (Clears, telegraph answers), AP spent per turn**. Target
  per-band win-rates become tuning anchors (e.g. easy ~10–20% enemy win, peer ~50%).
- Guard tests: easy never Clears your first buff; peer adapts; telegraph fires for AP ≥ 60;
  weapon attaches only in peer band; enemy never exceeds 100 AP / 5 actions.
- `npm test` (root) + `npm run lint` (client). Rebuild + commit `dist/` only at ship time
  (cPanel rule); Railway self-builds.

---

## 6. AI roster — per-encounter adaptation

Bands are by encounter level. Weapons attach in the peer band only.

| AI | Level | Band | Loadout | Notes |
|---|---|---|---|---|
| Mist Sentinel | 8 | easy | defender | telegraphs, no counterplay |
| Ember Duelist | 18 | easy | burst | telegraphs nukes long |
| Exam Proctor | 25 | easy | balanced | readable teaching fight |
| Frost Sealer | 32 | medium | control | reactive seals, leaves a gap |
| Rogue Ninja | 47 | medium | bruiser | closes + pressures |
| Shadow Weaver | 48 | medium | control | occasional Clear |
| Central Champion | 70 | hard | boss | full counterplay, phase at 40% |
| Hunt: Wild Boar / Forest Hawk / Frost Wolf / Ash Lizard | 5–22 | easy | hunter/burst | telegraphed, forgiving |
| Hunt: Shadow Panther / Ironback Bear | 38/42 | medium | control/defender | reactive |
| Hunt: Ember Drake / Moon Serpent / Ancient Chakra Beast | 65/68/88 | hard | boss/control | punishing, phases |
| **Hunt: Worldstorm Dragon** | 92 | **peer** | boss | **weapon: embercoil-scythe** |
| Story bosses | 4–100 | by level | per village | kage finale (100) is peer → **weapon: frostfang-oathblade** |
| Hollow Gate Warden | re-leveled ±15 of player | varies | boss | gains **black-lotus-dagger** when re-leveled into peer |
| Combat-mission foes | re-leveled to player | varies | per rank | S-rank for a maxed player = peer → gains a weapon |

---

## 7. What does NOT change
AP costs, damage math, tag percentages, cooldowns, durations, the bracket stat
multipliers/hit-caps/mercy-floor, PvP (`api/pvp/*`), ranked, and endless. Enemies just make
**better-timed, bracket-appropriate choices** with **better-shaped loadouts**, and at the top
bracket add a 40 AP weapon to the rotation.

## 8. Suggested sequencing
P0 (multi-action turn) → P1 (perception) → P2 (reactive rules) → P3 (band ladder) → P4 (loadout
pass) land together as the "reads the player + fits brackets + proper 40/60 options" milestone.
P5 (peer weapons) and P6 (telegraph/personality/phases — prioritize telegraph early, it's cheap
and high-impact) are the "feel" milestone. P7 validates and tunes throughout.

## 9. Open tuning notes
- Final loadout IDs in §5 Phase 4 are a starting point — confirm via the §Phase 7 sim + a feel check.
- DDA (auto-difficulty within a band) was considered and **dropped per owner**: brackets stay fixed as set.
- Multi-action turns make hard/peer notably harder; expect to retune the §Phase 7 win-rate targets, not the formulas.
