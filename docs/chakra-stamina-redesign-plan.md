# Chakra / Stamina Combat Resource Redesign — Plan

**Status:** PLAN ONLY (no code changed). Behind a feature flag when built.
**Goal:** replace the percentage-of-max cost model with **concrete, level-scaling numbers**. A big
chakra/stamina pool that visibly grows with level, jutsu costs shown as real numbers (never a "%"), a fight
that lasts **~20 rounds early and stretches to ~30 near cap**, identical in **PvE and PvP**.

---

## 1. Problem (confirmed in code)

Players run dry around round 10–11. Three independent traces confirm why.

**Pools are level-derived and span 50×.** `maxChakra = maxStamina = 100 (L1) → 5000 (L100)`, capped at 5000,
purely `f(level)` plus item bonuses — no separate trained stat.
[`api/_xp-engine.ts:90`](../api/_xp-engine.ts), [`shinobij.client/src/lib/stats.ts`](../shinobij.client/src/lib/stats.ts).

**PvE cost = a percentage of max.** [`shinobij.client/src/lib/jutsu-scaling.ts:18-110`](../shinobij.client/src/lib/jutsu-scaling.ts):
AP→percent (`20→2%`, `40→3%`, `60→5%`) charged to **both** chakra **and** stamina. Stored `chakraCost`/`staminaCost`
are only a `> 0` on/off flag; the magnitude is the percent.

**PvP cost = a flat number** (sealed `jutsu.chakraCost`, e.g. 100 or 250) off both bars. [`api/pvp/move.ts:1488`](../api/pvp/move.ts).
**PvE and PvP disagree on cost today** — a parity bug.

**No in-combat regen in either engine.** `// No chakra or stamina regen during PvP` ([`move.ts:1091`](../api/pvp/move.ts));
PvE never adds any. Out of combat it is +1/sec.

**Why round 10–11:** the biting rotation is *one big hit + one utility* per round = `5% + 3%` of **each** bar → ~12 rounds,
and because it's a percentage, **leveling changes nothing.**

### Root causes
1. **Percentage cost** makes progression irrelevant to endurance and feels abstract — the model we're removing.
2. **No regen** turns every fight into a countdown to a dead state.
3. **Every move bills both bars**, so the two-bar split is cosmetic.
4. **PvE (percent) vs PvP (flat)** divergence.
5. Dead fields: `chakraCostReducePerLvl` / `staminaCostReducePerLvl` exist but are never used.

---

## 2. Constraints (decided)

- **Pool grows with level and looks big** — up to ~5,000–10,000 at cap, for RPG flavor and progression.
- **Costs are concrete numbers, never shown as a percentage.**
- **Fight length ~20 rounds early → ~30 near cap** (endurance stretches modestly as you level).
- **PvE and PvP identical** (one formula, both engines).
- **Split the bars by discipline** — Ninjutsu/Genjutsu spend **chakra**; Taijutsu/Bukijutsu + basics spend **stamina**.
- **Chakra/stamina are combat-only** — nothing outside a fight spends them (owner-stated); every fight starts full.
- **Easy** to reason about, **balanced**, **save-safe**.

---

## 3. The design

### 3a. Big, level-scaling pool (combat-only, refills each fight)
Keep chakra/stamina scaling with level, but **make the numbers big** — e.g. **~1,000 at L1 → ~10,000 at L100**
(final curve/cap sim-tuned; ~10× the old level-1 number, ~2× the old cap). This is the number the player sees; it
grows all career. Because chakra/stamina are combat-only, every fight simply starts at full pool.

### 3b. Concrete per-jutsu costs that scale with level (shown as numbers, never "%")
Each jutsu displays a real cost that climbs as you grow — "Signature jutsu: ~200 chakra" at mid-game — charged to
**one** bar (by discipline). The cost scales **slightly slower** than the pool, which is what makes endurance
stretch from ~20 to ~30 rounds. Illustrative (sim-tuned), on the jutsu's discipline bar:

| Action | AP | Cost @ L1 | Cost @ L100 | Bar |
|---|---|---|---|---|
| Signature (damage) | 60 | ~50 | ~350 | discipline |
| Utility | 40 | ~25 | ~175 | discipline |
| Flicker / move-jutsu | 20 | ~12 | ~90 | discipline |
| Basic attack | 40 | ~25 | ~175 | stamina |
| Basic heal | 60 | ~25 | ~175 | chakra |
| Clear / Cleanse | 60 | 0 | 0 | — |

Under the hood this is a level-scaled cost formula/table (not a percent surfaced to the player). **Open decision:**
scale cost by **caster level** (simplest, works with any loadout) vs by **jutsu rank/tier** (higher-rank jutsu cost
more, old jutsu become cheap spammable filler — more genre-authentic but needs rank-tagged jutsu). Recommend
caster-level for v1.

### 3c. Split by discipline (build identity)
- **Ninjutsu, Genjutsu → chakra.** **Taijutsu, Bukijutsu → stamina.** Basic attacks / thrown weapons → stamina.
- **`Any` / utility → the caster's specialty bar**, resolved by reusing the existing `stampLegacyJutsuType()`
  logic (nin/gen→chakra, tai/buki→stamina; fallback stamina). This keeps a single-discipline fighter's damage +
  utility landing on the *same* bar, so the ~20-round math holds symmetrically for chakra- and stamina-mains.
  60-AP "Any" legacy signatures are already stamped to a concrete type before combat, so only 40-AP "Any"
  utilities hit this path. A single `resolveJutsuDiscipline(jutsu, specialty)` helper does the routing.

Each jutsu hits a **single** bar, so a focused attacker leans on one bar while a **hybrid** kit spreads load across
both and lasts longer — the reward for diversifying, and the reason two bars exist.

### 3d. Regen (concrete, level-scaled, both bars)
**~25/turn at L1 → ~175/turn at L100** (sim may adjust). Makes the ~20–30 a soft floor, not a cliff: even from
empty you can afford a cheap action every turn or two, so a depleted fighter is **never locked out** — they pivot
to their off-discipline, basics, or wait.

### 3e. Optional mastery discount (not a percentage-of-max)
Reuse the already-computed `costMultiplier` in `scaleJutsuByLevel` (today only on `healthCost`) to shave a mastered
jutsu's flat cost, reviving the dead `*CostReducePerLvl` fields. Additive; can ship later.

### 3f. The 20 → 30 math
Aggressive same-discipline rotation (signature + utility on the primary bar, minus regen), each fight starting full:

| | Pool | Signature cost | Aggressive net/turn | ≈ Rounds |
|---|---|---|---|---|
| **L1** | ~1,000 | ~50 | ~50 | **~20** |
| **L50** | ~5,500 | ~200 | ~200 | **~28** |
| **L100** | ~10,000 | ~350 | ~350 | **~29** |

Endurance climbs over your first ~50 levels then holds around ~30. Stamina (barely touched by a chakra main) lasts
the whole fight, so past ~20–30 rounds you pivot to your off-discipline or basics — **no dead-end, identical in
PvE and PvP, and the big number keeps growing all career.**

---

## 4. Why not the simpler alternatives (recorded so we don't relitigate)
- **Percentage of max** — abstract "%", and it holds rounds constant so leveling never helps. Rejected (this is what we're removing).
- **Fixed flat budget (e.g. 100)** — gives a perfect constant 20 rounds and trivial balance, but the number can't grow with level. Rejected: owner wants a big, growing RPG number.
- **Truly flat costs on the big pool** — concrete and simple, but a 10,000 pool ÷ a small flat cost = *hundreds* of rounds at cap; chakra stops mattering. Rejected: endurance must stay bounded (~30).
- **Chosen: big growing pool + concrete costs that scale slightly slower than the pool** — the only shape that gives *all* of {big growing number, concrete non-% costs, ~20→~30 rounds, PvE=PvP}.

---

## 5. Unification — one source of truth
Put the pool curve, the level-scaled cost table/formula, the split-by-discipline rule, and the regen in **one shared
module** (extend `lib/jutsu-scaling.ts`, then port it verbatim into the server the way `_xp-engine.ts` is
parity-pinned). Add a parity test asserting PvE and PvP compute the **same cost and regen** for the same jutsu +
level. Fixes today's flat-vs-percent divergence and prevents future drift.

Touch points:
- **Battle start** — both bars start at full level-scaled pool: [`api/pvp/session.ts:847-849`](../api/pvp/session.ts)
  (`makeFighter`) and the Arena init in [`shinobij.client/src/screens/Arena.tsx`](../shinobij.client/src/screens/Arena.tsx).
  (Also fixes a latent bug: PvE currently starts the *player* at **current** chakra but the enemy at **full**.)
- **Cost deduction** — deduct the concrete cost from the one discipline bar in both `move.ts` and `Arena.tsx`.
- **End of turn** — add the level-scaled regen in both engines' `endTurn`.
- **Enemy AI** — same regen + single-bar gating (it already checks both bars).
- **UI** — show the concrete per-jutsu cost (and its bar) on the jutsu card; drop the "%" display.

---

## 6. Edge cases & rules
- **Item `+maxChakra`/`+maxStamina` bonuses stay meaningful** — they enlarge the (now combat-relevant) pool, i.e. a
  few extra casts. No repurposing needed (unlike the fixed-budget version).
- **Out-of-combat chakra/stamina machinery is vestigial.** Since chakra/stamina are combat-only and every fight starts
  full, the +1/sec roaming regen, hospital 50% refill, and out-of-combat potion restore do nothing meaningful. Leave
  inert under the flag; a follow-up can delete them.
- **In-combat potions** restore concrete pool points (scaled to the new big numbers).
- **Thrown weapons** → stamina; **Flee / Move** stay AP-only, unchanged.
- **AP is untouched** — still 100/turn, the within-turn action cap. Chakra/stamina is the cross-turn budget; keeping
  both is what makes each round a real decision.

## 7. Rollout
1. Shared pool/cost/regen module + server port + **parity test**.
2. **Feature flag** (e.g. `combatResourcesV2`), default **off**; both engines branch on it.
3. **Server-authoritative** — recompute costs/regen/pool server-side; never trust client amounts.
4. **Tune in the sim** — `scripts/pvp-formula-sim.ts` already models a chakra pool + regen term; lock the pool curve,
   cost table, and regen to measured ~20→~30-round targets before flipping the flag. Wire into the balance-CI gates.
5. **Tests** — `npm test` (route + engine parity) and client `npm run lint`.
6. **cPanel** — rebuild + commit `dist/` (root and client) in the same change; Railway self-builds.

## 8. What deliberately stays the same (balance guardrails)
- Damage formulas, EP, tags, cooldowns, AP costs, targeting, turn resolution — **unchanged**.
- AP economy — **unchanged**.
- No schema/save changes (pool is derived from level like today; just a bigger curve).

## 9. Open decisions
1. **Pool curve & cap** — set to ~1,000 → ~10,000 (owner: 5k–10k is plenty); final shape sim-tuned.
2. **Cost scaling knob** — by caster level (rec, v1) vs by jutsu rank/tier.
3. **Final numbers** — cost table + regen, locked in the sim to hit ~20→~30 rounds.
4. ~~`Any`/utility default bar~~ **Resolved:** route `Any` to the caster's specialty via the existing
   `stampLegacyJutsuType` logic (fallback stamina); only 40-AP utilities hit this path.
5. **Mastery flat-discount (3e)** — ship now or later.
6. **Show/keep the now-cosmetic out-of-combat bar** as flavor, or hide it.
