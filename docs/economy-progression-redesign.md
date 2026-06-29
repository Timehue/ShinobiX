# Economy, Progression & Drop-Rate Redesign — Master Plan

> **Status:** PLAN ONLY — no code changes. Balance-sensitive; everything here
> needs sign-off before implementation (CLAUDE.md hard rules).
> **Goal (owner direction):** a **daily-active** player goes **level 1 → 90 in
> ~90 days**, with **early levels very fast and late levels slow**. Design the
> *real* curve as if the testing multiplier is gone (**`CHARACTER_XP_GAIN_MULTIPLIER`
> = 1**); the `×3` is removed as part of rollout. This pass touches **every**
> earn-and-spend system: XP, stat points, ryo, all premium currencies, and all
> drop rates (pets, fate shards, evolution stones, expeditions, black market,
> hunts, cards).
> **Live players:** re-pace **forward**, keep current level/stats (no wipe).
> **Monetization:** Patreon/premium left as-is; design as if it doesn't exist.
> **Companion docs:** [`early-progression.md`](./early-progression.md),
> [`competitor-early-game.md`](./competitor-early-game.md),
> [`economy-telemetry-plan.md`](./economy-telemetry-plan.md),
> [`professions.md`](./professions.md).

---

## 0. TL;DR — the five levers

1. **XP curve → steeper.** Replace the linear-per-level `xpNeeded(L) = 100·L`
   with a **quadratic-per-level** curve `xpNeeded(L) = 6·L²` (cumulative is cubic).
   Income grows ~linearly with level, so a requirement that grows quadratically
   makes *time-per-level rise* → fast early, slow late. (SHIPPED coefficient is **6**,
   re-fit to the REAL faucets — an early draft used `3`, which a recompute showed was
   ~2× too fast; see §3 banner + the appendix.) The curves cross at ~L17: below it
   cheaper than today (faster early), above it more expensive (slower late).
2. **Income → shaped & capped.** Remove the `×3`. Keep per-activity base XP
   roughly as-is but **cap the two uncapped character-XP faucets** (Endless Tower,
   exploration) with daily soft-caps/diminishing returns, so daily income per
   level band is *predictable* — that predictability is what makes a 90-day target
   hold.
3. **Ryo economy → de-inflate.** **Bank interest is the #1 inflation risk**
   (up to ~1.25M ryo/day passive today). Cut it hard and add wealth-scaling sinks.
   Keep sinks slightly ahead of faucets ("taut"). *(Correction: the "Golden Apple
   mispriced 20 ryo" item below was a FALSE premise — it's a `legendary` Grand
   Marketplace item sold in **Fate Shards**, never ryo, so it's not a ryo lever;
   left as-is per the "leave premium as-is" direction. See §8.3.)*
4. **Drops → rarity standard + pity.** Keep the existing rarity tiers but pin them
   to published-style odds, add **pity / bad-luck protection** (black market,
   mythic pets), and re-time fate-shard income so pet evolution gates (L50, L90)
   line up with the 90-day arc.
5. **One progression model, two dials, built for feel.** Unify **players AND AI**
   onto **one stat budget that maxes at L100** (§6), with **leveling = pace** and
   **stat budget = power** as *independent* dials (fast levels, smooth power, no
   mid-game sag — better than the reference's coupled model). Add per-rank stat
   caps (anti-twink) and the **seamless-gameplay layer** (§10A): combat *is*
   progression, rank-ups are power spikes, no dead time (idle timers + daily reset),
   legible "XP→stats→power" UI.

Everything below is the detail and the numbers. **The spine is lever 5** — the
unified, decoupled progression model — with 1–4 supplying the curve and economy it
runs on.

---

## 1. Current system — measured baseline (firsthand)

All cited from the live code (not the older docs, which predate the `×3` value).

### 1.1 Leveling
| Thing | Value | Source |
|---|---|---|
| Level cap | **100** (90 is a milestone, not the cap) | `constants/game.ts:24`, `api/_xp-engine.ts:22` |
| XP to go L→L+1 | **`xpNeeded(L) = 100·L`** (linear per level) | `lib/stats.ts:100`, `api/_xp-engine.ts:70` |
| Cumulative to reach L | `50·L·(L−1)` → **reach 90 = 400,500**, reach 100 = 495,000 | derived |
| Global XP multiplier | **`×3`** (testing accelerator; to be removed) | `constants/game.ts:27` |
| Elder "training" focus | +10% XP on top | `lib/progression.ts:23` |
| Exam gates (hard XP stop) | **L20 (Genin)**, **L39 (Chunin)**; Jonin+ free to 100 | `constants/game.ts:126` |
| Rank bands | Academy <15 · Genin 15–29 · Chunin 30–49 · Jonin 50–79 · Special Jonin 80+ | `lib/stats.ts:134` |

### 1.2 Stat points — *coupled to cumulative XP, not to level*
- 12 stats, base 10 each, cap **2,500** each → **29,880** total points to max
  everything; **29,860** of those come from XP. (`constants/game.ts:25`, `lib/stats.ts:142`)
- `statPointBudget = 20 + floor( cumulativeXP / 495,000 × 29,860 )`
  (`lib/stats.ts:145`). **Critical consequence: the XP curve IS the stat-point
  curve.** Change one and the other moves automatically. (See §6.)
- Pools by level (separate from stat points): HP `500 + 100·(L−1)` cap 10k;
  Chakra/Stamina `100 → 5,000` linear to L100 (`lib/stats.ts:118`).

### 1.3 Character-XP faucets (the only things that level you)
> Pet expeditions do **NOT** give character XP — they give Tamer *profession* XP
> + ryo + drops. So leveling comes only from the list below.

| Source | Base XP (×1) | Cap / throttle | Source |
|---|---|---|---|
| Combat missions E→S | 15 / 25 / 75 / 150 / 300 / 700 | once-per-day each; lvl-gated (1/5/15/30/50/70); 20/day cap | `_mission-catalog.ts:58` |
| Fetch missions D→S | 90 / 240 / 520 / 1100 / 2400 | shares mission cap; lvl-gated | `_mission-catalog.ts:83` |
| Hunts (10) | 80 → 2000 | **separate** 20/day cap; lvl-gated | `_mission-catalog.ts:70` |
| Stat training | 20 / 70 / 220 / 375 (15m/1h/4h/8h) | one timer at a time; stamina cost | `screens/Training.tsx:52` |
| Exploration | `20 + floor(sector/5)` per tile | **150 tiles/day** | `WorldMap.tsx:1295` |
| PvP win | 100 (Swift pet 125; Death's Gate ×2) | repeat-opponent decay 1→0.5→0.25→0.1/hr | `api/_xp-engine.ts:233`, `_reward-farm.ts:34` |
| Endless Tower | `(15 + 2·level)·factor·milestone`, **+8%/wave compounding** | **UNCAPPED** ⚠️ | `lib/endless-tower.ts:21` |
| Story bosses | 120 → 10,000 (one-time per milestone) | one-time | `data/storylines.ts:19` |
| Hollow Gate chests | `50 + sectorEq·2` | dungeon RNG | `lib/hollow-gate-dungeon.ts:924` |
| Weekly boss | share of `hpMax·0.25` | top-damage, 72h cycle | `api/weekly-boss.ts:220` |

**Throttle model:** there is **no global energy bar**. Pacing is per-activity
daily caps + per-mission once-a-day idempotency. Stamina is an in-battle/training
resource, not a content gate (locked decision, `early-progression.md §0b`).

### 1.4 Ryo economy
**Faucets:** missions/fetch/hunts (ryo ≈ 0.8–0.9× their XP) · daily login
`500 + 100·L` cap 8,000 (+5 fate shards / 7-day streak, `_daily-login.ts`) ·
village daily agenda +750 · PvP +75 · wanderer gifts `(30+5L)×0.6–1.5` (3/day) ·
map-control `sectors×100` · **pet expeditions `(90·hours·typeMult + petLevel·6)
× tamer × first × mastery`** (12/day, the main Tamer faucet) · weekly boss ·
**bank interest** (see ⚠️ below).

**⚠️ Bank interest is the dominant faucet.** Rate = `0.25%/bank-upgrade-level`,
max 50 levels = **12.5% _per day_**, on a **10M ryo principal cap**
(`_bank-interest.ts:32`). That's **up to ~1,250,000 ryo/day, passive, decoupled
from effort** — 200×+ a day of missions. Research (Koster, Cook, Torn, EVE) is
unanimous: a compounding/percentage interest faucet is the worst-behaved faucet
there is. The 10M principal cap helps but 12.5%/day is still enormous.

**Sinks (good, keep):** 10% trade burn (`_trade-core.ts`), black-market gamble
(50k/pull, 10/day, ~45% EV — net sink), hospital skip (2,500), jutsu training
costs, shop items, treats. **(Retracted "mispricing":** an earlier draft flagged
the Golden Apple as "20 ryo → 2,000 pet XP, underpriced 60×." That was WRONG — it's
a `legendary` item, and `Shop.tsx` only lists legendary/mythic in the **Grand
Marketplace at Fate Shards**, so its `cost: 20` is 20 *Fate Shards*, not ryo. It was
never a ryo faucet; left untouched per the premium-as-is direction.)*

### 1.5 Premium / special currencies
`ryo` (primary) · `fateShards` (premium; buys evolution stones & legendary/mythic
gear) · `honorSeals` (Vanguard PvP; jutsu speedups/seal-training) · `boneCharms`
(common crafting) · `auraStones` / `auraDust` (crafting) · `mythicSeals` (rare; no
real faucet yet). (`_mission-catalog.ts:30`, `_economy.ts` draft type.)

### 1.6 Drops & RNG (current)
- **Wild pets:** 1% per explore, split Standard 0.50 / Rare 0.30 / Legendary
  0.18 / Mythic 0.02; yard cap 5; starters/evos not wild-spawnable
  (`lib/pet-balance.ts:871`). At 150 explores/day ≈ **1.5 pet rolls/day**.
- **Fate shards:** expeditions 5–10% (`FATE_RATE` scout/forage .05, ruins .10) ·
  L70 hunts guaranteed +1 · black-market trinket(22%)=1–3 / jackpot(1%)=25 ·
  wanderer gift 25%=1 · login streak 5/7d · map-control.
- **Evolution stones:** **not dropped** — bought with fate shards (Awakening 150,
  Ascension 400). Pet evo gates: **L50 → L90**.
- **Black market** (the only gacha): 50% scraps · 22% trinket · 15% haul · 8%
  relic · 4% fortune · 1% jackpot. **No pity anywhere in the game.**
- **Cards (Card Clash):** deterministic catalog, earned not rolled — out of scope.

---

## 2. Research-backed design principles (sourced)

| Principle | Why it matters here | Source |
|---|---|---|
| **Fast-early/slow-late in *real time* needs requirement-growth > income-growth.** Same rate → flat time/level (WoW); requirement faster → slow late. | Today income grows ~linearly and requirement grows linearly → ~flat pace. Must steepen the requirement. | Aversa leveling-derivative; PavCreations |
| **For a bounded level cap, use polynomial (B≈2–3), not exponential.** Exponential late-values "skyrocket… nearly impossible," and the coefficient is hard to find. | Pick quadratic-per-level (cubic cumulative) — Pokémon/WoW shape, not RuneScape's geometric. | Game Developer "XP thresholds"; Bulbapedia |
| **Time-to-max = total requirement ÷ daily income.** Pace the daily caps to hit the target; make the last stretch deliberately slow. | This is exactly how we back-solve 90 days. | Fortnite/Valorant battle-pass math |
| **Gate the no-lifer with capped daily resources; pay the absent player a catch-up multiplier.** Cap should be ≥ ~1 day's regen so once-daily play is near-optimal. | We already cap most faucets; need to cap the *uncapped* ones and consider a rested-XP-style catch-up. | Torn energy, Genshin resin, WoW rested XP |
| **Faucet ≈ sink, kept "taut" (sinks marginally ahead); match math-class.** A balance-scaling faucet (interest) needs a balance-scaling sink. | Drives the bank-interest cut + wealth-scaling sinks. | Koster AGC; Cook (Lost Garden); EVE MER |
| **Pity / bad-luck protection is now expected, not optional.** Every disclosed gacha has a hard floor + dup protection. | Add pity to black market and mythic-pet rolls. | Genshin 0.6%/90-pity; Hearthstone 40-pack; Overwatch |
| **Rarity split rule-of-thumb:** legendary ~0.5%, epic ~5%, plus a guaranteed floor. | Sanity-check our pet/drop odds against this. | WintermuteDigital; Overwatch disclosed |

---

## 3. The pacing model — back-solving 90 days

> **⚠️ SUPERSEDED NUMBERS — read this first.** The sub-sections below (3.1–3.3) were
> the initial exploration using coefficient **3** and a *synthetic* income model
> `D(L)=120·L+900`. The capstone review found that model ~2× too low vs the REAL
> faucets (field/hunt missions are once-each per day — `claim-mission.ts:168` — and
> combat repeats via Arena; recomputed from the actual catalog). At coeff 3 an
> engaged daily-active player hit L90 in ~60 days, not 90. **SHIPPED: coefficient
> `6`** (owner-chosen "engaged daily-active = ~90 days"), which against the real
> faucets gives ~90–110 days for that player (hardcore ~72, casual ~150+), strongly
> slow-late (back half ≈ 2.6× the front). The authoritative numbers are in the §14
> appendix and the real-faucet pacing guardrail in `stats.test.ts`. Treat 3.1–3.3
> below as the method/rationale, not the final numbers.

### 3.1 The resulting pace (computed, not hand-allocated) — *coeff-3 draft, superseded*
Running `xpNeeded=3L²` against the income model (§3.2) gives this **computed**
cumulative pace — strongly front-loaded, reaching L90 at ~day 87:

| Reach L | ~Cum. day | Felt pace in band | Gate / milestone |
|---:|---:|---|---|
| 10 | ~0.5 | many levels/day (trivial) | — |
| 20 | ~3 | ~3 levels/day | **Genin exam @20 — the real week-1 goal** |
| 30 | ~8 | ~1.5 levels/day | — |
| 39 | ~14 | ~1 level/day | **Chunin exam @39** |
| 50 | ~24 | ~0.9 level/day | Jonin @50 |
| 60 | ~36 | ~0.8 level/day | — |
| 70 | ~51 | ~0.7 level/day | — |
| 80 | ~68 | ~0.6 level/day | Special Jonin @80 |
| 90 | **~87** | ~0.5 level/day | **TARGET ✅** |
| 100 | ~109 | ~0.45 level/day | endgame long-tail (post-target) |

**Half the levels (1→50) take ~24 days; the back half (50→90) takes ~63.** That's
the fast-early/slow-late shape, *computed*, not wished for. Two things make the
ultra-fast early game (L20 by ~day 3) feel earned rather than trivial: (1) the
**exam gates** at L20/L39 hard-stop XP, so the Genin/Chunin exams — not the XP bar —
are the actual early milestones; and (2) **stat power grows on its own smooth dial**
(§6), so blitzing levels doesn't hand a 3-day-old character endgame stats. **Dials:**
the `3` coefficient and the flat training floor set early speed; L90 holds ~85–90
days across sensible values. L90→100 (~22 more days) is the endgame chase.

### 3.2 Daily income model (daily-active player, ×1)
Daily character-XP has **two components**:

- **Flat floor ≈ 900/day** — *idle training* (the dominant piece: one overnight 8h
  = 375 XP + a couple of waking-hour sessions ≈ 600–900 XP/day, **flat at every
  level** since timer XP doesn't scale) + daily login + new-shinobi dailies.
- **Level-scaling ≈ 120/level** — missions/fetch/hunts (higher tiers unlock and
  pay more), PvP, exploration.

> **`D(L) ≈ 120·L + 900`** character-XP per day

| L | D(L)/day | | L | D(L)/day |
|---:|---:|---|---:|---:|
| 5 | 1,500 | | 50 | 6,900 |
| 10 | 2,100 | | 60 | 8,100 |
| 20 | 3,300 | | 70 | 9,300 |
| 30 | 4,500 | | 80 | 10,500 |
| 40 | 5,700 | | 90 | 11,700 |

Consistent with a hand-count of clearable missions+hunts+**idle training**+
explore+PvP at each band. The **flat training floor is intentionally a big share
early** (≈45% of D at L10, ≈8% at L90) — that is *why* the early game blitzes and
the late game grinds, on top of the steeper requirement curve. Solving `Σ
xpNeeded(L)/D(L) = 90` against this `D(L)` confirms **`xpNeeded(L)=3·L²` → ~86–90
days to L90** (the coefficient is robust to the training floor; nudge to ~3.1 for
exactly 90). §7 lists the per-activity numbers.

### 3.3 The requirement curve that yields ~90 days
With `t(L) = xpNeeded(L) / D(L)` and `Σ t(L) = 90`, solving against
`D(L)=120L+400` gives **`xpNeeded(L) ≈ 3·L²`**.

> ## Proposed: `xpNeeded(L) = round(3 · L²)`  (multiplier = 1)

| Reach L | xpNeeded(L) (this level) | Cumulative to reach L | t(L) ≈ days/level |
|---:|---:|---:|---:|
| 2 | 12 | 3 | ~0.02 |
| 5 | 75 | 90 | ~0.07 |
| 10 | 300 | 855 | ~0.19 |
| 20 | 1,200 | 7,410 | ~0.43 |
| 30 | 2,700 | 25,665 | ~0.67 |
| 40 | 4,800 | 61,620 | ~0.92 |
| 50 | 7,500 | 121,275 | ~1.17 |
| 60 | 10,800 | 211,630 | ~1.42 |
| 70 | 14,700 | 339,885 | ~1.67 |
| 80 | 19,200 | 512,840 | ~1.92 |
| **90** | **24,300** | **716,895** | **~2.17** |
| 100 | (capped 0) | 985,050 | — |

Cumulative `reach(L) = (L−1)·L·(2L−1)/2`. **Total to 90 ≈ 717k base XP; to 100 ≈
985k.** Σ t(L) over 1→89 ≈ **~90 days** for the reference player. ✅

**Why this shape is right:**
- vs **today** (`100·L`): the curves **cross at L≈33**. Below 33 the new
  requirement is *lower* → **early game is faster than today**. Above 33 it's
  *higher* → **late game is slower**. Exactly the brief, and it eases migration
  (early levels get cheaper, not harder).
- **`3` is the master dial.** Want the average player at ~75 days and the
  committed daily-active at ~90? Nudge the coefficient (≈2.5–3.5) or bend `D(L)`.
  Hardcore (tower-grinding) naturally lands ~60–70 days; casual ~150+. These fall
  out of the same formula — no separate curves.
- Optional **piecewise variant** for finer control (e.g. flatten 1→20 even more
  to nail the "blitz to Genin" feel, steepen 80→100): `xpNeeded(L) =
  round(3·L² · bandFactor(L))`. Start with the pure `3L²`; only add band factors
  if playtest pacing demands it.

### 3.4 Where the exam gates land
Genin gate @20 ≈ **day 8**, Chunin gate @39 ≈ **day ~23**. Both land *after* the
fast early game, so the gate is a ceremony, not a wall — and the pre-gate XP
"hard stop" (`api/_xp-engine.ts:213`) bites for at most a few hours of overflow.

---

## 4. Implementation of the XP change (no behavior surprises)

- Change `xpNeeded` in **both** `lib/stats.ts:100` and `api/_xp-engine.ts:70`
  (parity-pinned; the route/formula parity tests will need updating in lockstep).
- The `progressAfterXp` level-up loop and `totalXpBeforeLevel`/`statPointBudget`
  helpers are formula-agnostic (they call `xpNeeded`) — they keep working, but
  **`TOTAL_XP_TO_MAX_LEVEL` must be recomputed** from the new curve
  (`lib/stats.ts:105`) or the stat-budget ratio breaks.
- `_xp-engine.test.ts` and `_combat-formula-parity.test.ts` assert current values
  — update together.
- **This is one of the changes that needs `npm run build` + committed `dist/`**
  (cPanel serves committed `dist/` verbatim).

---

## 5. Removing the `×3` (rollout-coupled)

Per owner direction the `×3` comes out when the rest is finalized. Sequencing:
1. Land the new `xpNeeded = 3L²` curve **with `CHARACTER_XP_GAIN_MULTIPLIER`
   still 3** would *double-count* — so the multiplier drop and the curve change
   ship **together** (or the curve is expressed in already-×1 numbers and the
   multiplier is set to 1 in the same commit).
2. **Re-pace forward, keep levels** (owner choice): existing characters keep
   stored `level`/`xp`/`stats`. Because stat budget is a *ratio* of cumulative XP
   to the (new) max, recomputing `reconcileCharacterStatBudget` after the curve
   change will re-derive each player's unspent points against the new total.
   **Verify no one goes negative** (already-allocated > new budget): clamp
   `unspentStats = max(0, …)` is already there (`lib/stats.ts:165`), so worst case
   is "0 unspent until you earn more," never a rollback of spent stats.
3. **Migration safety check (do before shipping):** for the current top players,
   compute new budget vs allocated. If the steeper early curve lowers low-level
   budgets enough that a mid player is suddenly "over-allocated," they simply stop
   gaining new points until they out-earn it — acceptable, but **call it out in
   patch notes**. (See §6 for the alternative that avoids this entirely.)

---

## 6. Unified XP → stat model (players + AI), maxed at 100

> Owner direction: tie XP gain into stat allocation for **players AND AI**, and at
> **level 100 everyone is maxed on stats** (all 12 stats at the 2,500 cap = 29,880
> total).
>
> **Reference model (the genre leader, studied for this).** Its design is precisely
> the model we want, and we already half-implement it:
> - **`experience` IS the stat-point budget** — they grow 1:1; every stat point
>   gained also adds 1 to experience, and **level is just a derived checkpoint** of
>   that cumulative experience (never spent/reset). At the level cap a player has
>   earned *just enough* experience to fully max all stats. → "maxed at 100" is
>   guaranteed *by construction*, not bolted on.
> - **Players and AI run the SAME stat engine** (`scaleUserStats`): an AI is
>   authored as *focus weights + a level*, and the engine distributes that level's
>   experience budget across the 12 stats — identical to a player who allocated the
>   same budget. (We do NOT do this — our AI use a separate formula. This is the
>   gap to close.)
> - **Per-rank stat caps** (Student/Genin/Chunin…) bound each stat by rank, so a
>   low-rank can't dump everything into one stat — the exact parallel of our
>   existing per-rank *jutsu* caps (§6.5).
> - Stats grow by **flat training** (interval-based, level-independent, daily-capped)
>   and by **combat** (XP auto-distributed into the stats actually used in the
>   fight). Both add to experience 1:1.
>
> We adopt this wholesale: keep our "budget = cumulative XP" coupling, **put AI on
> the same budget**, and add per-rank stat caps.

### 6.0 How it actually works today (one pipe: XP)
**Everything funnels through `gainXp`** (`App.tsx:1045`). Every mission, hunt, PvP
win, exploration tile, and **idle training session** grants XP, which both
(a) advances level and (b) grows the stat-point budget. **Idle training is the
primary stat-allocation action:** `completeTraining` (`Training.tsx:79`) earns XP,
then *immediately spends the newly-earned budget points into the chosen stat*
(`statPointsEarnedFromXp` → `gainXp` → `reconcileCharacterStatBudget`). Missions
etc. grow the budget into the **unspent pool** the player allocates manually.

Today the budget is `statPointBudgetForProgress = cumulativeXP / maxXP × 29,860`
(`lib/stats.ts:145`) — **stat power is pinned to the XP curve's shape**, and AI use
a *completely separate* `aiStatsForLevel` linear formula (`lib/ai-stats.ts:28`)
that tops out at ~22,760 (≈76% of cap) at L100. Two problems:
1. Under the cubic XP curve the player budget goes **badly back-loaded** — L50 ≈
   **12% of max** (~3,700 pts) — so a L50 player is far weaker than a same-level AI
   (~45–55% of cap). Same-level fights become lopsided.
2. AI aren't actually maxed at 100 (only the `peer` ×1.3 band multiplier hides it).

### 6.1 The fix — one budget curve, level-driven, XP-continuous
Define a single canonical **`statBudgetAtLevel(L)`** = total stat points on first
reaching level L, calibrated so **`statBudgetAtLevel(100) = 29,880`** (every stat
at 2,500). Recommended shape: **linear per level** (≈ +302 pts/level) so power
tracks level smoothly and "maxed at 100" is *explicit*, not an emergent accident of
the XP ratio.

Keep the budget **continuous in XP** — so idle training still drips stat points
*between* level-ups — by interpolating on in-level progress:

```
statPointBudgetForProgress(level, xp) =
    statBudgetAtLevel(level)
  + (statBudgetAtLevel(level+1) − statBudgetAtLevel(level)) × (xp / xpNeeded(level))
```

This is the **smallest possible change** to the existing function: every caller
(`statPointsEarnedFromXp`, `reconcileCharacterStatBudget`, the whole training loop)
keeps working verbatim — only the budget's *shape* changes. It **decouples stat
pacing from the leveling curve**: leveling stays fast-early/slow-late
(`xpNeeded=3L²`) while stats accrue ~linearly with level (L50 ≈ 50% of cap, not
12%).

**This is the idle-training point, made load-bearing.** Training XP is *flat*
(8h = 375 at every level). Against tiny early requirements (L5 = 75) a single
overnight session levels a newbie several times AND, via the continuous budget,
hands them a real chunk of stats — the early power+dopamine spike. Against late
requirements (L90 = 24,300) the same session is a sliver of a level but still drips
its proportional stat points. Idle training is therefore **intrinsically
fast-early/slow-late** as both a leveling and a stat faucet — it reinforces the
curve instead of fighting it.

### 6.2 AI on the same budget
Rebuild `aiStatsForLevel(level)` to distribute **exactly `statBudgetAtLevel(level)`**
across the 12 stats by archetype — keep its existing role-weighting (primary
offense, defense lift, generals) but **normalize the weights to sum to the
budget**. Then a level-L AI = a level-L fully-allocated player; at L100 both are
all-2,500. The PvE difficulty bands (`pve-difficulty.ts`, easy 0.7 … peer 1.3)
stay as the **difficulty** knob layered on top — but **retune them**: the peer
×1.3 existed to compensate for the old ~76%-of-cap base; with a true full-budget
base, peer → ~1.0 and the sub-peer bands sit below 1. This makes player↔AI parity
exact at every level and keeps onboarding bands forgiving.

### 6.3 Allocation UX — unchanged, just powered by the new budget
- **Idle training:** auto-allocates earned budget into the chosen stat (as today).
- **Manual allocation** of the `unspentStats` pool (as today).
- **Admins:** `maxedStats()` (as today).
- **Migration ("re-pace forward, keep levels"):** reshaping `statBudgetAtLevel`
  re-derives every live player's `unspentStats` via `reconcileCharacterStatBudget`.
  The existing `max(0, …)` clamp (`lib/stats.ts:165`) guarantees **no one loses
  *spent* stats** — a player whose new budget is below what they've already
  allocated simply earns 0 unspent until they out-level it. Because the new linear
  budget is *more* generous than today's quadratic ratio at low/mid levels, almost
  no live player loses ground; high-level players are already near max either way.

### 6.4 Decision — budget shape
The reference keeps budget **coupled to experience** (so its stat curve inherits
the leveling curve's quadratic-cumulative shape — back-loaded, ~20% of max at the
midpoint). Because **AI share the budget**, that back-loading is *not* a balance
problem — a L50 player and a L50 AI sit at the same %. So shape is a **feel** call:

- **Keep coupled (reference-exact):** stat power tracks cumulative XP. Simplest,
  most faithful. Under our steeper `3·L²` curve this is *more* back-loaded (~12% at
  L50) — fine for balance (AI match), but the absolute numbers stay small for the
  first half.
- **Decouple to a gentler `statBudgetAtLevel(L)` (linear-ish), XP-continuous via
  the §6.1 interpolation:** stat power grows smoothly (~50% at L50) while leveling
  stays fast-early/slow-late. *Recommended if we adopt the steep `3·L²` leveling
  curve*, so characters don't feel statless for half the journey.

Either way: **players and AI use the identical function**, it hits **29,880 at
L100**, `MAX_STAT=2500` is unchanged, and idle training keeps dripping points via
the in-level interpolation.

### 6.5 Per-rank stat caps (new — from the reference, anti-twink)
Add a **per-rank ceiling on each individual stat**, mirroring our existing
per-rank *jutsu* cap (`jutsuLevelCapForLevel`, `constants/game.ts:54`). The
reference uses Student 20k / Genin 60k / Chunin+ 450k per stat (≈4–13% of its
single-stat max at the low ranks). Our equivalent, as a fraction of `MAX_STAT`
(2,500), e.g.:

| Rank (level) | Per-stat cap (suggested) | Rationale |
|---|---:|---|
| Academy (<15) | ~250 | can't one-stat-twink the protected onboarding band |
| Genin (15–29) | ~600 | matches the Genin jutsu-level cap tier |
| Chunin (30–49) | ~1,200 | mid power |
| Jonin (50–79) | ~2,000 | near-max |
| Special Jonin (80+) | 2,500 (full) | endgame, uncapped |

This is **save-safe** (clamp the *value the combat formula reads*, like the jutsu
cap already does — never the stored stat), applies identically to **players and
AI**, and prevents a low-level character (or authored low-level AI) from pumping
one stat to the cap and one-shotting peers. Tune the numbers with the budget shape.

### 6.6 Concrete spec (pseudocode — drop-in for the real functions)
```
// constants/game.ts — unchanged: MAX_LEVEL 100, MAX_STAT 2500, base stat 10
TOTAL_BUDGET_AT_CAP = 12 * (MAX_STAT - 10)   // 29,880
BASE_BUDGET         = STARTING_STAT_POINTS   // 20
XP_COEFF            = 3                       // the leveling "master dial" (§3)

// --- LEVELING (the TIME dial) — lib/stats.ts + api/_xp-engine.ts (parity-pinned) ---
xpNeeded(L) = L >= MAX_LEVEL ? 0 : round(XP_COEFF * L * L)

// --- STAT BUDGET (the POWER dial) — ONE function, players AND AI ---
statBudgetAtLevel(L):
    Lc = clamp(floor(L), 1, MAX_LEVEL)
    return BASE_BUDGET + round((Lc - 1)/(MAX_LEVEL - 1) * (TOTAL_BUDGET_AT_CAP - BASE_BUDGET))
    // L1 -> 20, L50 -> 14,798, L100 -> 29,880 (= every stat at 2,500). LINEAR (recommended).

// continuous WITHIN a level so idle training drips points between level-ups —
// replaces the cumXP-ratio body of statPointBudgetForProgress (lib/stats.ts:145)
statPointBudgetForProgress(level, xp):
    base = statBudgetAtLevel(level)
    next = statBudgetAtLevel(level + 1)
    frac = level >= MAX_LEVEL ? 1 : clamp(xp / xpNeeded(level), 0, 1)
    return min(TOTAL_BUDGET_AT_CAP, round(base + (next - base) * frac))
    // every caller (statPointsEarnedFromXp, reconcileCharacterStatBudget, the
    // training loop) is untouched — only the SHAPE of the budget changed.

// --- PER-RANK single-stat cap (anti-twink) — combat-read clamp, never stored ---
perRankStatCap(level):                    // starting values; co-tune w/ budget + exam gates
    Academy(<15)=350 · Genin(15-29)=700 · Chunin(30-49)=1300 · Jonin(50-79)=2100 · SpJonin(80+)=2500

// --- AI: SAME budget, distributed by archetype, then per-rank clamped ---
aiStatsForLevel(level, jutsus):
    budget = statBudgetAtLevel(level)               // identical to a maxed-for-level player
    w      = archetypeWeights(primaryJutsuType(jutsus))  // 12 weights, sum = 1 (role-shaped)
    cap    = perRankStatCap(level)
    for k in STAT_KEYS: stats[k] = min(MAX_STAT, 10 + round(budget * w[k]))
    return clampEachToRankCap(stats, cap)           // optional: re-spread capped overflow
    // PvE difficulty band (easy 0.7 … peer 1.0) is applied AFTER, by the encounter.
```
This is small: `xpNeeded` swaps formula; `statPointBudgetForProgress` swaps its
body (same signature, all callers intact); `aiStatsForLevel` is rebuilt to read the
shared budget; one new `perRankStatCap` used in the combat formula. The `×3`
removal and `TOTAL_XP_TO_MAX_LEVEL` recompute ride along (§4, §5).

### 6.7 Worked player↔AI parity check
Parity is **exact by construction** — a level-L AI draws the *same total budget* a
level-L fully-allocated player has. Spot-check (linear budget):

| Level (rank) | Shared budget | Per-stat cap | Player (ninjutsu focus) | AI (ninjutsu archetype) |
|---|---:|---:|---|---|
| 20 (Genin) | 5,751 | 700 | ninOff/Def 700+700, rest ~435 ea | ninOff 700, int/will 700, rest lifted/base — **same 5,751 total** |
| 50 (Jonin) | 14,798 | 2,100 | 3–4 stats at ~2,100, rest ~875 | primary+generals high, defenses lifted — **same 14,798** |
| 90 (Sp.J) | 26,863 | 2,500 | near-max everywhere (~2,239 avg) | same — **same 26,863** |
| 100 | 29,880 | 2,500 | **all 2,500 (maxed)** | **all 2,500 (maxed)** |

So a same-level PvE fight is a true mirror; the **only** intentional asymmetry is
the PvE difficulty band (easy 0.7 … peer 1.0) for onboarding. The per-rank cap
stops *either side* from dumping the whole budget into one stat and one-shotting.
At L100 both are fully maxed — your requirement, guaranteed.

---

## 7. Income retune — make `D(L)` real and *predictable*

The point is **not** to rewrite every reward (CLAUDE.md: small changes). With the
`×3` gone, the existing base XP values *already* roughly produce `D(L)≈120L+400`.
The required work is (a) verify the band income, (b) **cap the uncapped faucets**
so the curve can't be blown past, (c) a couple of targeted nudges.

### 7.1 Cap the two uncapped character-XP faucets ⚠️
- **Endless Tower** (`lib/endless-tower.ts`) compounds +8%/wave and is uncapped —
  a grinder can earn far past `D(L)`, collapsing the 90-day target. Add a **daily
  character-XP soft cap** (e.g. tower XP beyond ~1× the band's `D(L)` decays to
  10–25%, like the genre's anti-grind DR). Keep tower *ryo*/material rewards
  uncapped if desired — only the character-XP needs the brake.
- **Exploration** (150 tiles/day): already capped by tile count; verify
  `20+sector/5` × 150 ≈ a sane fraction of `D(L)` (it is — ~3–5k max). Leave.

### 7.2 Per-activity targets after `×3` removal (daily-active, ×1)
| Activity | Keep base XP | Notes |
|---|---|---|
| Missions / fetch / hunts | as-is | already lvl-gated & once/day; the backbone of `D(L)` |
| **Idle stat training** | base XP as-is (flat) | the early-game engine + the main stat-allocation action (§6); one-timer-at-a-time + stamina is the throttle. Flat XP = self-tapering leveling faucet |
| PvP | as-is | repeat-decay already prevents farming |
| Exploration | as-is | tile cap is the throttle |
| **Endless Tower** | **add daily XP soft-cap** | §7.1 — the one real change |
| Story/Hollow/Weekly boss | as-is | one-time / event cadence |

### 7.3 Catch-up — CUT (redundant with the existing idle layer)
A WoW-style offline-accruing "Training Rest" XP multiplier was considered and
**dropped** (owner decision). The game already rewards absence three ways — **idle
training timers** (set one, log off, collect the XP next login), **pet expeditions**
(accrue offline), and the **daily-cap reset** (a returning player has fresh
mission/hunt caps). A rested multiplier would double-dip on absence (idle XP + a
boost on active play), could pull semi-active players *past* the 90-day target, and
adds a new system to tune — against the locked "daily caps do the pacing, not
energy/rested systems" rule. And the "one-at-a-time idle training banks only ~8h of a
long absence" is **not a gap to close** — it's intentional: one-at-a-time forces a
return to start the next timer (a re-engagement touchpoint), and auto-queue was
rejected (it would enable ~16h of zero-interaction progression). Net: **no catch-up
mechanic** — over-rewarding absence isn't a goal; revisit only if *measured*
casual-retention data demands it.

---

## 8. Ryo economy retune

### 8.1 Bank interest — the priority fix ⚠️
12.5%/day on 10M = ~1.25M/day passive is the game's largest, least-earned faucet.
**Recommended:**
- **Cut the max daily rate** from 12.5% to **~2–3%/day** (drop per-level step from
  0.25% to ~0.05%, or cap the effective rate). 2% on 10M = 200k/day — still
  meaningful, no longer economy-dominating.
- **Keep the 10M principal cap** (good; it's the flat ceiling best-practice wants).
- Optional second guardrail (Torn-style): **diminishing rate on large balances**
  so the wealthiest don't compound fastest.
- This is **live-save sensitive** — existing rich players see daily income drop.
  Frame in patch notes; it does not touch stored balances, only future interest.

### 8.2 Sinks — keep taut, scale with wealth
- **Keep** trade burn (10%), black-market EV sink, hospital, jutsu costs.
- **Add a wealth-scaling vanity sink** (cosmetic-only, no power): high-ryo cosmetic
  mounts/pet-skins/titles priced in the millions, to soak top-end ryo without
  pay-to-win or mudflation (WoW Brutosaur / RuneScape Richie model). Pure sink,
  safe for balance.
- **Match math-class:** the (now smaller) interest faucet scales with balance, so
  pair it with the wealth-scaling vanity sink, not just flat fees.

### 8.3 Targeted fixes
- **Golden Apple: NOT a ryo issue (retracted).** It's a `legendary` Grand
  Marketplace item priced in **Fate Shards** (`Shop.tsx` lists legendary/mythic at
  `currency="fateShards"`), so its `cost: 20` is 20 Fate Shards — never a ryo
  faucet. A Phase-3 attempt to reprice it to 1,500 was reverted (1,500 Fate Shards
  ≈ 10× an evolution stone = unbuyable). Left at 20 Fate Shards per the
  "leave premium as-is" direction; any premium pet-feed tuning is a separate pass.
- **Daily login** `500+100L` cap 8,000: fine; keep. It's a modest return-hook
  faucet, not an inflation driver.
- **Expedition ryo** is the main Tamer faucet; leave the formula but re-verify
  total/day against the new economy once interest is cut (it becomes relatively
  more important, which is healthy — effort-based beats passive).

### 8.4 Ryo pacing intent
A daily-active player should comfortably afford their **expected** spends at each
band (jutsu training, treats, gear, an occasional fate-shard top-up) from active
play, with bank interest a bonus not a salary. Validate with the telemetry layer
(§11) — target **faucet ≈ sink, sinks marginally ahead**.

---

## 9. Drop rates & rarity — standardize + add pity

### 9.1 Pets (wild encounters)
Current 1%/explore split (Std .50/Rare .30/Leg .18/Myth .02) is reasonable and
matches the "legendary ~0.5%, epic ~5%" rule loosely. Changes:
- **Add mythic bad-luck protection:** a soft-pity counter so a player who has
  explored heavily without a Mythic gets a rising Mythic chance (Genshin-style
  ramp), or a guaranteed Rare+ every N encounters. Prevents the 1-in-5,000
  feel-bad with no floor.
- **Yard cap 5** interacts with a ~1.5 rolls/day faucet — fine, but consider a
  release/storage flow so hitting the cap doesn't void rolls (a silent faucet
  loss). Flag, not urgent.

### 9.2 Fate shards — time them to the evolution arc
Evolution gates: **pet L50 → Awakening Stone (150 fate)**, **pet L90 → Ascension
Stone (400 fate)**. Total 550 fate for one full starter line.
- Target fate income for a daily-active player: **~3–5 fate/day** (hunts 1–2 +
  expedition 5–10% + wanderer 25% + login streak). → first evolution ~**day
  30–50**, second ~**day 110–180**. That straddles the 90-day arc nicely (one evo
  inside the journey, one as an endgame goal). **Verify** the actual blended rate
  hits ~3–5/day after the `×3`/economy changes; nudge `FATE_RATE` or hunt counts
  if low.
- Keep fate shards **earnable** (no hard paywall) — Patreon untouched per
  direction.

### 9.3 Black market (the only gacha) — add pity
50/22/15/8/4/1% with **no pity**. Add **hard pity**: guarantee a "relic+" (or 1
fate shard) within N pulls (e.g. 20), and dup/again protection on the jackpot, per
genre standard. Keep the ~45% EV (it's a healthy ryo sink) but make the floor
humane.

### 9.4 Expedition drops
`BONE .25–.40 / AURA 0–.01 / FATE .05–.10` × tamer/first/mastery. Fine; these are
the Tamer's bread-and-butter. Re-verify the *fate* portion against §9.2's target
once rates settle. No structural change.

---

## 10. Pet systems — fit to the arc

- **Pet leveling:** `petXpNeeded(L)=max(100,100·L)` (max L100) — pets level on a
  *linear* curve, faster than the player. That's fine: a pet hitting L50 (evo gate
  + PvE unlock) should land mid-journey. Verify pet L50 ≈ player day ~30–45 at
  treats+training+expedition cadence; if pets outrun the fate-shard income for the
  Awakening Stone, players hit "ready to evolve but can't afford the stone" — tune
  fate income (§9.2), not the pet curve.
- **Treats/training retire at max** (already shipped) — good, no infinite sink.
- **Evolution stays stone-gated** (no RNG) — predictable, keep. The pacing knob is
  fate-shard income, not the stones.
- **Tamer half-rate for non-Tamer maxed pets** (shipped) — keep; it's a correct
  profession incentive.

---

## 10A. Player experience & seamless gameplay (the "better way" upgrades)

> Owner: *everything is on the table if the research shows a better way for player
> experience and seamless gameplay.* These are the changes that go beyond
> rebalancing numbers — they make progression *feel* good. Ordered by impact.

### PX-1. Two clean dials — leveling (pace) vs power (stats) — the design's spine
The single best structural decision: **decouple TIME from POWER.** Leveling
(`xpNeeded=3L²`) is the *dopamine/pace* dial — fast early, slow late. The stat
budget (linear, §6) is the *power* dial — smooth, maxed at 100, **shared by players
and AI**. This is *better than the reference*, which couples them (so its fast-early
leveling would also dump stats fast, or — at its gentle curve — leave a mid-game
sag). Decoupling gives us **fast early levels AND a smooth power curve with no
mid-game stat desert**, while keeping the reference's best parts (one engine for
players+AI, maxed-at-100 by construction, per-rank caps). Everything else here
hangs off this.

### PX-2. Combat-driven stat growth — CUT (doesn't fit our model)
The reference grows stats by combat because *stats ARE experience* there — no
separate allocation step. **Our model is different and already clean:** XP → a
level-capped budget → allocated by the player via **idle training** (control) or the
unspent pool. Combat already feeds that budget (combat XP grows it). The only thing
"combat-driven growth" would add is *auto-allocating* combat's budget into whatever
jutsu types you swung with — which **removes the deliberate allocation the idle-
training loop provides** (the same re-engagement loop we chose to protect by
rejecting auto-queue). So it's redundant with our budget+training system and works
against the game's control-based identity. **Cut.** The "seamless" goal is met by
the unified budget (combat XP → budget → allocate) without an auto-allocator. Easy
to revisit if the training loop is ever deprecated.

### PX-3. Rank-up = a real, earned power spike
Per-rank stat caps (§6.5) + the level-budget mean a character accumulates budget it
can't fully spend until the cap lifts. **Passing the Genin/Chunin exam instantly
converts that banked budget into spendable stats** — a visible jump in power the
moment you rank up. This turns the exam ceremonies (`early-progression.md §8`) from
a title change into a mechanical reward, and gives the slow mid/late game a
satisfying *staircase* (plateau → exam → spike) instead of a flat grind. Co-tune
the caps so the banked amount is a *treat*, not a frustrating lockout.

### PX-4. No dead time — already handled by design (mostly)
The genre's #1 silent killer is "15 minutes, then locked out" (Torn) and the
post-tutorial cliff (KoL). Our antidote **already exists**: an idle training timer
running, a pet expedition accruing offline, and daily caps that reset as the
come-back hook. Crucially, **stat training stays one-at-a-time on purpose** — that
forces a return to start the next session, which is a deliberate re-engagement
touchpoint. **Do NOT auto-queue it** (owner decision): batching timers would let a
player set-and-forget for ~16h with zero interaction — the "logged-out but
progressing" hole we're trying to avoid. So PX-4 is *not* a new system; the only
additive, non-conflicting tweaks are onboarding-flavored: make the **first** training
timer very short (instant first claim) and frame offline accrual as "your training
kept working while you were away." The player should never open the game to *nothing
to collect and nothing to start* — and today they don't.

### PX-5. Catch-up — CUT (redundant with idle training; see §7.3)
A rested-XP multiplier was dropped: the idle-training timers + offline pet
expeditions + daily-cap reset already give absent players a catch-up path, so a
rested pool would double-dip on absence and add tuning surface for marginal gain.
The narrow gap (one-at-a-time idle training caps a long absence at ~8h) is covered
by **auto-queuing stat training** under PX-4 instead. Revisit only on measured
casual-retention data.

### PX-6. Legible progression — kill the top churn driver
"No clear goal/feedback" is the most-cited D1 churn cause. Surface the model the
player is actually in: a **stat-budget fill bar toward max** ("you've earned X /
29,880 of your power"), **days/sessions to next level**, the **next rank-up unlock**
and what it grants, and an always-visible **next goal** (extend the existing
Logbook, `early-progression.md §5`). Show that *experience → stats → power* is one
flow, not three mysterious bars. Pure UI; huge perceived-quality return.

### PX-7. Seamless difficulty — never faceroll, never walled
The unified player/AI budget (§6) + the PvE onboarding bands (`pve-difficulty.ts`)
mean content is *always* tuned to where you are: easy band protects new players
(hit/turn caps, mercy floor), peer band at 90+ reads like a real duel. No level
where you suddenly over- or under-power the content — the difficulty curve is as
seamless as the progression curve.

**Net player-experience arc:** create → guided first win in <60s (the early curve +
flat training make you level several times session 1) → a clear next goal always on
screen → daily it's *fast* to feel progress (early) → ceremonial rank-up power
spikes → a long, legible, never-idle endgame chase to a fully-maxed L100. Fast
where it should be exciting, slow where it should be aspirational, seamless
throughout.

---

## 11. Validation, telemetry & guardrails

- **Build the economy telemetry layer** (`economy-telemetry-plan.md`) *before or
  with* this rollout — it's the only way to see faucet-vs-sink balance and catch
  inflation early (EVE MER model). Track: ryo created vs destroyed/week, fate-shard
  faucet rate, wealth-vs-level outliers, money in circulation.
- **Balance CI gates** (`balance-ci-gates-plan.md`): add a test that *simulates*
  the reference player's daily income against the curve and asserts "days-to-90 ∈
  [80, 100]" — so a future reward tweak can't silently break the 90-day target.
- **Re-tune is continuous, never solved** (research consensus) — ship with the
  dials (`xpNeeded` coefficient, `D(L)` reward rates, interest rate) documented so
  they're easy to nudge from telemetry.

---

## 12. Sequenced rollout

**Phase 0 — Instrumentation (safe, ship first).** Economy telemetry + the
days-to-90 simulation test. No balance change. Gives a baseline week of data.

**Phase 1 — Curve + multiplier (the core, ship together).** `xpNeeded=3L²` in
both `stats.ts` + `_xp-engine.ts`; `CHARACTER_XP_GAIN_MULTIPLIER → 1`; recompute
`TOTAL_XP_TO_MAX_LEVEL`; pick stat-budget shape (§6.4); update parity/engine tests;
`npm run build` + commit `dist/`. Patch notes: "early game faster, late game
slower; existing levels kept."

**Phase 1b — Unify the stat engine (§6.2 / §6.5).** Rebuild `aiStatsForLevel` to
distribute the player `statBudget(level)` by archetype; retune the PvE difficulty
bands (peer ×1.3 → ~1.0); add per-rank stat caps mirroring the jutsu cap. This is
what actually delivers "XP→stats for players *and* AI, maxed at 100." Update the
combat-parity tests; rebuild + commit `dist/`.

**Phase 2 — Income shaping.** Endless-Tower daily XP soft-cap; verify band income
hits `D(L)`.

**Phase 3 — Ryo de-inflation.** Bank-interest cut (DONE: 12.5%→0.5%/day). Golden
Apple "reprice" RETRACTED (it's a Fate-Shard item, not ryo — §8.3). Wealth-scaling
vanity sink deferred (additive content).

**Phase 4 — Drops & pity: CUT.** Pity systems dropped (owner: "no pity system").
With the existing rarity odds judged reasonable, the drop-rate work needs no further
change. Fate-shard faucet timing is premium → left as-is per direction. (Nothing to
ship here.)

**Phase 5 — Seamless-gameplay layer (§10A): UI-only, remaining.** Rank-up power
spike (PX-3 — mechanic AUTOMATIC from the per-rank caps; only a celebration moment
remains); short first-timer + offline-accrual framing (PX-4; auto-queue REJECTED,
§10A); progression-legibility UI (PX-6). PX-5 rested-XP **CUT** (§7.3). Pure UI/UX —
no curve/balance change — best built with the app running (visual iteration).

**Phase 6 — Combat-driven stat growth: CUT** (PX-2) — redundant with our
budget+training allocation model and removes player control; doesn't fit our
control-based identity (§10A PX-2). Not shipping.

**Optional / as-needed.** Wealth-scaling vanity ryo sink (needs a cosmetic/display
to be effective; the bank-interest cut already de-inflates, so this is polish, not
required); economy telemetry layer (`economy-telemetry-plan.md`) to *measure* the
de-inflation; piecewise curve band factors — all only if playtest/telemetry call
for them.

Each phase: run `npm test` (API) + `npm run lint` (client); rebuild + commit
`dist/` for any `api/`/`server.ts`/curve change; keep Railway + cPanel in parity.

---

## 13. Decisions — RESOLVED (built on branch `claude/beautiful-mclean-656dcc`)

> **Status:** #1–6 SHIPPED + reviewed, #7–9 CUT, #10 is the only remaining work (UI).
> The mechanical/economic/XP/stat/drop redesign is complete; details per item below.

1. **XP coefficient: SHIPPED `6·L²`** — re-fit to the REAL faucets after the capstone
   review found `3` was ~2× too fast (daily-active hit L90 in ~60d, not 90). At `6`:
   engaged daily-active ~90–110d, hardcore ~72d, casual ~150+. Tune the `6` to shift.
2. **Unify AI onto the player stat budget (§6.2): SHIPPED** — `aiStatsForLevel`
   distributes the same `statBudget(level)`; player↔AI matched at every level, both
   max at L100.
3. **Stat-budget shape (§6.4): SHIPPED `linear`** (smooth power, no mid-game sag).
4. **Per-rank stat caps (§6.5): SHIPPED** (anti-twink, players + AI; the rank-up
   power spike falls out of this).
5. **Endless-Tower XP cap (§7.1): SHIPPED** (daily soft-cap; tower stays the best
   ryo/material farm, just not an XP bypass).
6. **Bank interest (§8.1): SHIPPED** — cut 12.5% → 0.5%/day (deeper than the doc's
   first-draft 2–3%, which still paid a salary). ~1.25M/day → ~50k/day for a whale.
7. **Pity systems: CUT** (owner: "no pity system"). Existing rarity odds kept as-is.
8. **Combat-driven stat growth (PX-2): CUT** — redundant with our budget+training
   allocation and removes player control; fits the reference's model, not ours
   (§10A PX-2).
9. **Catch-up — rested XP (PX-5): RESOLVED → CUT.** Redundant with idle training +
   offline expeditions + daily-cap reset (§7.3). The one-at-a-time idle limit is
   intentional (a re-engagement touchpoint) — **auto-queue also rejected** (it would
   enable ~16h of zero-interaction progression). No catch-up mechanic.
10. **Legibility UI (PX-6):** confirm extending the Logbook with the
    XP→stats→power view + next-rank-unlock (pure UI, high ROI).

---

## 14. Appendix — the curve at a glance

**Leveling (time):** `xpNeeded(L) = round(6·L²)` (SHIPPED) · `cumulative(L) =
(L−1)·L·(2L−1)` · days from the REAL faucet model (engaged daily-active; mirrored in
the `stats.test.ts` pacing guardrail). **Stats (power, §6):** shared by players + AI,
**maxed 29,880 at L100**, SHIPPED shape = *linear* `= 20 + round((L−1)/99 × 29,860)`
(decoupled from the XP curve — unchanged by the coefficient).

| L | xpNeeded | cumulative XP | statBudget (linear, SHIPPED) | ~day reached |
|---:|---:|---:|---:|---:|
| 10 | 600 | 1,710 | 2,735 | ~1 |
| 20 | 2,400 | 14,820 | 5,751 | ~3 |
| 30 | 5,400 | 51,330 | 8,767 | ~11 |
| 39 | 9,126 | 114,114 | 11,481 | ~20 |
| 50 | 15,000 | 242,550 | 14,799 | ~39 |
| 60 | 21,600 | 421,260 | 17,815 | ~54 |
| 70 | 29,400 | 671,370 | 20,832 | ~76 |
| 80 | 38,400 | 1,004,880 | 23,848 | ~92 |
| **90** | **48,600** | **1,433,790** | **26,864** | **~112** |
| 100 | — | 1,970,100 | 29,880 | ~136 |

*(Computed against the REAL faucets (engaged daily-active), not the old synthetic
model. Strongly slow-late: L1→50 ≈ 39 days, L50→90 ≈ 73 days. Exam gates (Genin @20 ≈
day 3, Chunin @39 ≈ day 20) sit right where the early blitz would otherwise run away.
The stat budget is LINEAR + decoupled (maxed 29,880 at L100), so it's unaffected by
the coefficient; AI parity + per-rank caps (§6.5) are the load-bearing stat changes.
Tune the `6` coefficient to shift overall pacing.)*

---

## 15. Migration & patch notes (communicate to live players)

This redesign changes values that **existing saves already hold**, so live players
will see retroactive shifts on their next login. Nothing corrupts a save (the
reconcile is non-destructive — levels read verbatim, spent stats never reduced,
unspent floored at 0), but the felt experience changes. Send these as patch notes
before/with the deploy so the changes read as intentional, not as bugs.

**What players will notice (in plain terms):**

1. **Stat points feel more generous mid-game.** The stat budget is now a clean
   *linear* curve to a full 29,880 at L100 (every stat hits 2,500). Most existing
   characters gain **unspent stat points** to allocate on login — a one-time
   windfall. Nobody loses already-spent stats.
2. **A combat cap now applies per rank (anti-twink).** Below Special Jonin, the
   stat *value combat reads* is clamped to your rank band (Academy 350 / Genin 700 /
   Chunin 1,300 / Jonin 2,100; Special Jonin+ uncapped at 2,500). Your stored stats
   are untouched — the cap only affects the number used in a fight, and it **lifts
   the moment you rank up**. Players who had poured everything into one stat at a low
   rank ("twinks") will feel a retroactive combat nerf until they rank up; that's the
   intended fix, and it's the source of the new **rank-up power spike**.
3. **Bank interest is much lower.** Cut from ~12.5%/day to ~0.5%/day (≈96% lower).
   The bank is a safe store of value again, not a salary — earning ryo now comes from
   *playing*. This was the game's #1 inflation faucet.
4. **Early levels re-paced.** With the `×3` testing multiplier removed and the curve
   re-fit, sub-L34 levels take a bit longer per bar but still blitz; the back half is
   deliberately the long haul (L1→50 ≈ 39 days, L50→90 ≈ 73 days for an engaged
   daily-active player). Total 1→90 ≈ ~90–110 days as intended.
5. **Endless Tower XP has a daily soft-cap.** The Tower is still the best ryo/material
   farm; it's just no longer a way to skip the XP curve. Cash-out XP past the daily
   cap is heavily reduced, not zero.

**Coupled rollout note:** the `×3` removal (`CHARACTER_XP_GAIN_MULTIPLIER = 1`) and
the curve re-fit must ship **together** — shipping the `×6` curve while `×3` is still
live would roughly halve the intended time-to-90. The parity test pins the multiplier
at 1, so this can't silently regress.

**Deploy reminder:** Railway self-builds from source (live host = correct on merge).
cPanel serves committed `dist/` verbatim, so the **client `dist/` must be rebuilt +
committed** before any cPanel deploy or it will serve the old curve.
