# Leveling / Stat / Training Redesign Plan

**Status:** PLAN ONLY — no code written. Synthesized from (a) a read-only map of
our current system and (b) a code-level teardown of TheNinjaRPG (TNR), our
open-source competitor at `studie-tech/TheNinjaRPG`.

**The complaint that started this:** *"our stat/xp level-up system isn't very
good right now, the idle trainer doesn't even earn stats."*

---

## 0. TL;DR

Our stat growth is chained: **training → XP → level → stat *budget* → stats.**
The budget (`statBudgetAtLevel`) is *linear* while the XP curve (`6·L²`) is
*quadratic*, so at any decent level a training session's 20–375 XP is a rounding
error against a level (15,000+ XP) and unlocks **≈0 budget points**. That is
exactly why the trainer prints "~0 stat points" — it's honestly reporting that
training barely moves the budget. The "CHOOSE STAT" picker is nearly decorative
because the budget it feeds is generic and near-frozen.

TNR does the opposite and it works: **training *is* the stat engine.** You pick a
stat, real time elapses (fully offline/idle), and on collection the gain is added
**directly to that stat**, bounded only by a **per-rank cap**. Leveling doesn't
hand out stat points at all — it raises the caps + your HP/CP/SP pools + unlocks
content.

**Direction locked (user, 2026-07-01):** (1) **full two-axis decouple** — training
is the stat engine, leveling raises caps/pools/content; (2) **keep the USER STATS
panel, fed by a combat-earned point pool**; (3) **combat also grows the stats you
actually used** (both combat channels — see §4 / §5.4). **All remaining decisions
resolved (§9):** respec refunds *all* earned points into an allocatable pool for
re-spending (50 Shards, nothing lost); training keeps a modest XP trickle
(combat/missions primary); **pacing locked to ~90 days to fully cap** (§5.1) with
**near-flat per-hour tiers** (20–23/hr, gentle slope, ~1.15× spread). The plan is
implementation-ready.

**Recommendation:** adopt TNR's **two-axis** model, adapted to our numbers and
our stricter balanced-PvP pillar:

- **Axis A — Rank/Level (the "how far" axis):** XP from combat/missions raises
  your **per-rank stat caps**, your pools, and unlocks jutsu ranks / content.
  This stays the slow, long-term axis.
- **Axis B — Stats (the "my build" axis):** **idle training** (time) + **combat
  use** fill your 12 stats *toward* the current per-rank cap. Training accrues
  offline and is the primary engine. This is the axis we fix.

Balance is preserved because the **ceiling is a universal, reachable per-rank
cap** — not something you can grind *past*. We calibrate so filling to your
current rank cap is **fast** (days), and *ranking up* is the long game. That
keeps intra-bracket PvP skill-based (everyone sits at cap quickly) while giving a
satisfying long-term climb.

Everything new that grants stats becomes **server-authoritative** (a
`training-start` → `training-complete` sealed-token pair, mirroring our existing
`expedition-start`/`report-pet-event` pattern), because we're turning training
into a real power source and must not trust the client for it.

---

## 1. What's wrong today (diagnosis)

Current end-to-end (file refs from the code map):

| Piece | Where | Behavior |
|---|---|---|
| 12 stats (4 general / 4 offense / 4 defense) | `types/combat.ts:13`, `lib/stats.ts:20` | stored, base 10, hard-capped 2500 |
| Combat per-rank caps | `constants/game.ts:65` | Academy 350 · Genin 700 · Chunin 1300 · Jonin 2100 · Sp.Jonin 2500 — applied **at combat time only** (save-safe) |
| XP curve | `lib/stats.ts:100` (`xpNeeded = 6·L²`), MAX_LEVEL 100 | quadratic; ~90 days L1→L90 for a daily player |
| Stat **budget** | `lib/stats.ts:148` (`statBudgetAtLevel`) | **linear** 20 @ L1 → ~28,700 @ L100 (≈ enough to cap all 12 at endgame) |
| Manual allocation | `screens/Profile.tsx:130` (`addStat`) | client-side; spend budget points into a stat |
| Respec | `screens/Profile.tsx:156` | 50 Fate Shards → reset all stats → refund budget |
| Training | `screens/Training.tsx:60`+ | pick stat + timer (15m/1h/4h/8h), spend stamina, earn XP; on complete `gainXp()` then auto-allocate the *budget unlocked* into the chosen stat |
| The "~0" | `App.tsx:960` (`statPointsEarnedFromXp`) | returns *"how many budget points does this XP unlock?"* — ≈0 at mid/high level |

**Four concrete problems:**

1. **Training is yoked to the level budget, so it can't actually grow stats.**
   Because budget is linear and XP is quadratic, a session's XP unlocks ~0
   budget → ~0 stat. The stopgap "give training extra budget" would break the
   `budget-maxes-at-L100` invariant (power creep past the universal ceiling), so
   the budget and training structurally *fight each other*. This is the root
   cause, and it can't be fully fixed without decoupling the two.

2. **The "CHOOSE STAT" picker is meaningless.** It routes the near-zero budget
   points into a stat. There's no sense of "I trained Speed, my Speed went up."

3. ~~**The idle trainer isn't actually idle.**~~ **CORRECTED (verified in code,
   Stage 1):** `activeTraining` *does* already persist — `buildPlayerSavePayload`
   includes it (App.tsx:3787) → `pushSaveToServer` → the server stores it (only
   stripped from the `?combatOnly=1` opponent projection, api/save/[name].ts:101)
   → `pullSaveFromServer` full-GETs it (App.tsx:3937) → restored on boot/refresh
   and cross-device (App.tsx:3367, 4929). It survives refresh + device switch, and
   `endsAt` is absolute so it accrues offline. The earlier "React-state-only / lost
   on refresh" finding was **wrong**. The *real* remaining gaps here are UX, not
   persistence: no live countdown in the Active-Training box, and a small
   fast-refresh race (the ~3s autosave debounce could drop a session started and
   abandoned within a few seconds).

4. **Leveling feels hollow.** A level-up grants a slice of *generic* budget, not
   a stat-specific choice. There's no "pick your growth" moment, no cap/pool
   fanfare tied to ranking up. Two different progression feelings (grow my build
   vs. climb ranks) are mashed into one linear budget bar.

> The current linear-budget model (`economy_progression_redesign`, live on `main`)
> was a *recent, deliberate* choice, so we treat this as an evolution of it, not a
> repudiation — and §10 keeps a minimal-change fallback that preserves the budget
> if you'd rather not move off it.

---

## 2. How TheNinjaRPG does it (reference, read from their source)

Source: `studie-tech/TheNinjaRPG` — `app/src/libs/train.ts`,
`app/src/server/api/routers/train.ts`, `app/src/libs/profile.ts`,
`app/drizzle/constants.ts`.

- **Same 12 stats** (4 general + 4 offence + 4 defence). Each stored separately,
  floor 10, **per-rank hard caps** (Student 20k → Genin 60k → Chunin+ 450k
  combat / 200k general). No global budget — caps are per-stat.
- **Training = time-based, offline-accruing, direct-to-stat.** Pick a stat + a
  speed tier; a clock runs in real time; on `stopTraining` the gain is computed
  from elapsed time and added **to that stat *and* to experience together**:
  ```
  energySpent    = min(floor(energyPerSecond(tier) · seconds), 100)   // fills to 100 over the tier
  trainingAmount = factor · energySpent · trainEfficiency(tier) · trainingMultiplier(tier)
  stat        += trainingAmount
  experience  += trainingAmount
  ```
  | Tier | Full duration | efficiency | base mult | full-session gain (factor 1) |
  |---|---|---|---|---|
  | 15 min | 900 s | 100 | 0.01 | **100** |
  | 1 hr | 3600 s | 90 | 0.04 | 360 |
  | 4 hr | 14400 s | 80 | 0.16 | 1280 |
  | 8 hr | 28800 s | 70 | 0.32 | 2240 |
  | 12 hr | 43200 s | 60 | 0.48 | 2880 |
  | 24 hr | 86400 s | 50 | 0.96 | **4800** |

  Shorter tiers are **more efficient per real-world hour**; longer tiers give more
  per session (idle-friendly) but less per hour. `factor` folds in village/clan/
  shrine/war/event boosts. **No diminishing-returns curve** — the only brakes are
  the per-rank cap, a **64 trainings/day** limit, and **escalating captchas**.
- **Two XP channels:** training auto-invests into the trained stat; **combat/
  quests** grant `earnedExperience`, a *separate manual pool* you later
  `distributeStats` into the stats you choose (cap-clamped). Combat XP is
  **ELO-style** (reward scales with opponent strength) and is distributed across
  the stats you *actually used* in the fight — so your build grows toward how you
  play.
- **Leveling grants no stat points.** It raises the level/rank caps, recomputes
  pools (`HP/SP/CP = 100 + 50·(L−1)`), and gives skill-tree points (Chunin+).
- **Ranks** gate caps, jutsu letter-ranks, jutsu slots, and skill-tree access.
- **Everything is server-authoritative**, offline-accruing (gain computed from
  `startedAt` deltas), and written to an audit `trainingLog`.

The load-bearing idea we're copying: **decouple stat growth from level.** Level
sets the *ceiling*; training-time + combat-use *fill toward it*.

---

## 3. Design principles we must keep (ShinobiX pillars)

1. **Balanced PvP is the foundation. Power is gated by *skill*, never bought,
   grinded, or RNG'd.** The endgame ceiling is universal and reachable; nobody
   out-*powers* you, they out-*play* you. (This is stricter than TNR and shapes
   our calibration — see §6.)
2. **Never trust the client for rewards/currency/stats.** New stat sources must
   be server-authoritative (recompute or sealed-token). We are *upgrading* the
   anti-cheat posture here, not loosening it.
3. **Don't break existing saves.** Live game — but note: we're **pre-launch with
   a full wipe pending**, which loosens migration caution (schema/field changes
   are acceptable). Balance sign-off is still required.
4. **Small, incremental, flag-gated.** Ship behind an env/feature flag, keep the
   old path working until the new one is signed off.
5. **Retention comes from cosmetics / collection / sinks, not power.** Respec-as-
   a-Fate-Shard-sink stays; we don't invent new power you can buy.

---

## 4. Recommended model — "Two Axes"

Split progression into two clean, independent axes (this is the whole redesign):

### Axis A — Rank / Level  ("how far can I grow")
- **Source:** XP from combat, missions, exams (unchanged sources).
- **Grants on level/rank up:**
  - **Raises the per-rank stat cap** (Academy 350 → Genin 700 → … → 2500). These
    caps already exist in `game.ts`; we make them the *actual ceiling* stats fill
    toward, not just a combat-time clamp.
  - **Raises HP / Chakra / Stamina pools** (already recomputed on level-up).
  - **Unlocks content:** jutsu ranks, exams, areas — as today.
- **Feel:** the long climb. Ranking up visibly lifts your ceiling and pools — a
  real milestone, not a slice of a budget bar.
- **Level curve `6·L²`:** keep, or gentle-tune (§7). It's fine once it no longer
  double-duties as the stat gate.

### Axis B — Stats  ("grow my build")
Stats fill *toward the current per-rank cap* from **two** sources:

- **B1 — Idle training (primary engine).** Pick a stat + timer; the gain lands
  **directly on that stat**, computed from *elapsed real time*, accruing fully
  offline. This is the fix. Bounded by the per-rank cap. (Formula §5.1.)
- **B2 — Combat use (INCLUDED, TNR-style, both channels).** Each won fight yields
  `earnedStatPoints` (ELO-scaled by opponent strength; recomputed server-side from
  the real session). It splits two ways:
  - a **used-stat share** that **auto-grows the stats you actually used**
    (offense/defense of the jutsu types you fought with + the generals they scale
    off) — "play the way you build";
  - a **free share** that drops into a **manual pool** shown in the USER STATS
    panel, to place on any stat by hand.
  The split ratio is a tunable (§7). This is what keeps *playing the game*
  progressing your build, not just idling.

**The manual "USER STATS" allocation panel is KEPT**, repurposed from "spend your
level budget" to **"spend combat-earned points."** The "points available" badge
now reflects the B2 free-share pool; the ADD buttons place them (cap-bounded);
Respec refunds them (semantics §9). This gives build agency on top of the idle
training auto-fill, and preserves a UI players already know. (Training auto-places
into the chosen stat; combat's free share is hand-placed here.)

---

## 5. Concrete mechanics

### 5.1 Training gain formula — calibrated to ~90 days to cap

**Target (user, 2026-07-01): a dedicated daily player fully caps all 12 stats in
~90 days.** Full cap = 12 × (2500 − 10) ≈ **30,000 stat points**. We use a
**near-flat per-hour rate with a gentle slope** — shorter tiers are only *slightly*
more efficient per hour, kept much closer together than TNR's 100→50 spread. That
gives the tiers a little character without making any one a trap, and keeps pacing
governed by *time trained* (protecting the 90-day anchor, no spam / captcha meta).

```
elapsedFrac = clamp(elapsedSeconds / tierSeconds, 0, 1)     // offline-safe, caps at full tier
base        = RATE_PER_HOUR[tier] · tierHours               // per-hour rates close together, gentle slope
boosted     = base · (1 + trainingBonusPct/100)             // reuse getTrainingXpBonus()
gain        = round(boosted · elapsedFrac)
applied     = min(gain, perRankCap(rank) − currentStat)     // never exceed the current rank cap
stat[chosen] += applied
```

- **`RATE_PER_HOUR` by tier (base, no bonuses):** 15 min = **23/hr** · 1 hr =
  **22/hr** · 4 hr = **21/hr** · 8 hr = **20/hr** → per full session **≈6 / 22 /
  84 / 160**. Top-to-bottom spread is only **~1.15×** (vs TNR's 2×): shorter tiers
  give a mild edge for babysitting, the idle 8 hr tier stays fully viable.
- **Why it self-balances:** long idle tiers win on *coverage* (they run while you
  sleep); short tiers win slightly on *rate* but you can't run them while away — so
  neither dominates. A set-and-forget 8 hr idler and a babysitting 15-min grinder
  land within a few days of each other over a season. No tier is a trap or a spam
  meta.
- **The 90-day math:** assume a dedicated daily player keeps training running
  **~16 effective hours/day** (an 8 hr overnight tier covers sleep; a couple of
  daytime sessions fill the rest, with slack for restart gaps). 16 h × 20/h =
  **320 pts/day** → 30,000 ÷ 320 ≈ **94 days** to a *full 12-stat* cap. A focused
  build (the ~6 stats you actually use) hits its **competitive ceiling in ~45
  days**; the completionist tail is the remainder.
- **Cohort spread (all converge to the same cap):** hardcore ~22 h/day coverage →
  ~60 days; casual ~8 h/day → ~150 days. Faster play never buys *more* power, only
  *sooner* — bounded ≤ ~1.5× casual. Combat adds a small, capped bonus (§5.4),
  pulling very active fighters to ~75–80 days.
- **`trainingBonusPct`:** reuse `getTrainingXpBonus()` (village/elder/clan/doctrine
  "Town Hall XP Bonus"). Invested players finish a bit sooner — a *village-
  investment / convenience* reward, still cap-bounded, never extra ceiling.
- **No rank-scaling, no stat-value diminishing returns.** A near-flat rate against
  the fixed 30,000-point total *is* the ~90-day curve; the per-rank cap is the only
  brake (lower ranks simply fill their smaller caps proportionally sooner).
- **Rank should slightly *lead* stat-fill** so players are rarely cap-blocked: the
  existing ~90-day-to-L90 XP curve already roughly matches, and the 2500 cap
  unlocks around L80 (~day 75) — just before training tops a stat off to it.
- **Training keeps a modest XP trickle** (roughly current values) so idle players
  still rank up and unblock higher caps — but **combat/missions stay the primary
  XP**, leaving the already-tuned leveling pace unchanged. Training XP now feeds
  level → caps/pools/content (not the retired budget).

### 5.2 Idle / offline accrual (the actual "idle trainer" fix)

- **`activeTraining` already persists to the server save** (verified — see §1.3).
  It survives refresh + device switch and `endsAt` is absolute so it accrues
  offline. The Stage-2 server-auth rework must **keep** this working; it does not
  need to *add* persistence. (It will move the sealed params — `stat, tier,
  startedAt, capSnapshot` — onto a server-minted token, but the round-trip already
  exists.)
- **Remaining polish (small, safe, no reward change):** add a **live countdown**
  in the Active-Training box (mirror `JutsuTrainingHall`'s existing `now`-tick +
  `formatTrainingTime`), gate the Complete button on `now ≥ endsAt`, and do an
  **immediate save flush on start** (reuse `pushSaveToServer`, same pattern as the
  Arena win-claim flush) to close the ~3s fast-refresh race.
- **Gain is computed from server time on collect** (Stage 2), from `startedAt` →
  now, clamped to the tier duration. Leaving it past the tier wastes nothing and
  gains nothing extra (TNR behavior). Truly idle: start it, close the tab, collect
  later.
- **Optional throughput:** a village/clan upgrade that unlocks a **2nd concurrent
  training slot** (we already have precedent: the `jutsu-training-queue` 2nd-slot
  system). Good long-term sink + throughput lever without raising per-session
  power.

### 5.3 Server-authoritative endpoints (anti-cheat, required)

Turning training into a real power source makes it a cheat target, so it must
move server-side using our **existing sealed-token pattern** (see
`docs/auth-and-anti-cheat-patterns.md`; mirrors `expedition-start` →
`report-pet-event` and `raid-start` → `report-raid`):

- **`POST /api/training/start`** — validates the player can train (awake, in
  village/sector, under the daily cap, has stamina), debits stamina, mints a
  **single-use token** sealing `{ stat, tier, startedAt, rankCapSnapshot,
  bonusSnapshot, dailyCount }`, and records the active training on the save.
- **`POST /api/training/complete`** — requires the token, atomically deletes it
  on use, recomputes `applied` **server-side** from sealed values + server
  elapsed time, applies the gain **under `withKvLock` on the player's save** with
  `{ failClosed: true }`, writes a `trainingLog` audit row, returns the new stat.
  Cancel = same math with `elapsedFrac < 1` (prorated), no stamina refund.
- **Daily cap** (analog of TNR's 64/day) to bound throughput; optional
  soft-throttle instead of captchas.
- **Wiring:** both handlers must be imported + `route()`-registered in
  `server.ts` (no auto-routing), and `dist/` rebuilt + committed for cPanel
  (Railway self-builds). Add colocated `*.test.ts` + a route-parity entry.

> This is a genuine anti-cheat *upgrade*: today allocation is client-side, guarded
> only by per-save clamps (`api/save/[name].ts`: 500/stat, 1000/save). Sealed
> server-side training closes that gap for the new primary power source.

### 5.4 Combat-use stat growth (Axis B2, INCLUDED — both channels)

On a won fight, compute `earnedStatPoints` server-side from the real `PvpSession`
/ battle receipt (we already cross-validate PvP sessions and emit combat
receipts), **ELO-scaled by opponent strength** so farming weak targets pays a
floor. Then split it:

```
earned      = min(eloScaled(BASE_FIGHT_STAT, myPower, oppPower), dailyRemaining())
usedShare   = round(earned · USED_STAT_RATIO)      // 0.6
freeShare   = earned − usedShare
// auto-grow the stats actually used, weighted by usage, cap-clamped:
for stat in usedStats(session):  stat += round(usedShare · weight(stat)) [clamped to cap]
// remainder → manual pool surfaced in the USER STATS panel:
character.unspentStats += freeShare
```

- **`usedStats(session)`** = the offense/defense of the jutsu types thrown + the
  generals those scale off (reconstruct from the receipt, server-side).
- **`USED_STAT_RATIO = 0.6`** — 60% auto-grows the stats you used, 40% drops into
  the panel pool for free placement. This one dial reconciles both combat
  decisions (1.0 = pure auto-to-used, 0.0 = pure manual pool).
- **`BASE_FIGHT_STAT ≈ 8`, ELO-scaled to ~2–16 pts/win.** PvE/arena pay less;
  **ranked pays 0** (skill-pure, as TNR does).
- **`DAILY_COMBAT_STAT_CAP ≈ 60 pts/day`** — combat is a *bonus*, not the anchor.
  Capped at ~20% of training's ~320/day so it **cannot break the 90-day target**;
  heavy fighters finish ~10–15 days sooner, not months.
- **Cap-clamped** to the per-rank ceiling like everything else — combat can't push
  a stat past its rank cap either.

### 5.5 What stays the same
- The 12-stat model, the combat formulas, jutsu, AP costs, cooldowns — **untouched**.
- Per-rank *combat* caps stay; we're just also using them as the training ceiling.
- Stamina as a training throttle (regen +1/s, ~83 min to full) — keep.
- Respec as a Fate-Shard sink — keep (semantics per §9).
- Pools scaling with level — keep.

---

## 6. Balance guardrails (why this stays balanced-PvP-safe)

The pillar says power must never be *grinded*. Idle training is time-spend, so we
neutralize the "grinder out-powers you" risk structurally:

1. **Universal, reachable ceiling.** The per-rank cap is the same for everyone and
   fully reachable. Grinding gets you *to* the cap, never *past* it. At the cap,
   PvP is 100% skill + build + jutsu — unchanged from today's endgame.
2. **Fast fill, slow climb.** Calibrate so filling a stat to the *current rank
   cap* is fast (days of casual idle), while *ranking up* (Axis A, XP-gated by
   exams/content) is the long axis. Result: within any PvP bracket, almost
   everyone is at cap → matches are skill, not "who idled more." The long-term
   progression lives in ranks/content, which are gated by exams, not raw grind.
3. **Per-rank caps prevent twinking.** A low-rank can't train a stat above their
   bracket cap (already enforced at combat time; now also the training ceiling),
   so no smurf spikes.
4. **Server-authoritative + daily cap + stamina.** No skipping the (short) grind
   by cheating; no infinite same-day spam. The grind can't be *bought* either —
   no cash-for-stats path is introduced.
5. **Cosmetics/collection/sinks remain the retention hooks**, not power. Respec
   and the 2nd-slot upgrade are Fate-Shard / progression sinks, not power buys.

Net: the *shape* of endgame PvP is identical to today (everyone capped, skill
decides). We only change *how you get to cap* — from an opaque budget bar to a
tactile "train the stat, watch it climb" loop that actually works while idle.

---

## 7. Calibration plan (numbers are provisional)

The constants in §5.1 are a **starting point**, not final. Tune them the way we
tune PvP (there's precedent: `scripts/` balance sims):

1. **Set targets:** e.g. "fill one stat 10→rank-cap in ~3–5 days of 2–3 casual
   sessions/day"; "a full 12-stat build at your rank in ~2–4 weeks"; "ranking
   up remains the ~months-long axis." Pick these explicitly with the user.
2. **Write a sim** (`scripts/train-pacing-sim.mjs`) that plays forward a casual
   vs. hardcore schedule against `tierBase`, `rankScale`, stamina regen, and the
   daily cap, and reports days-to-cap per rank and per-stat. Iterate constants
   until the targets hold and hardcore ≤ ~1.5× casual (grind advantage bounded).
3. **Cross-check XP pacing** so Axis A (ranks) still lands ~the intended timeline
   after training-XP is reduced/removed.
4. **Freeze constants in one module** (e.g. `lib/training-config.ts`) shared by
   client display + server math, parity-tested like `_xp-engine.ts` today.

---

## 8. Staged rollout

**Decision (2026-07-01): default ON** (not flag-gated) — pre-launch + wipe pending
makes migration risk low. Implementation progress:

- ✅ **Stage 1 — idle correctness:** persistence already worked; added the live
  countdown polish (Training.tsx). Lint-clean.
- ✅ **Stage 2+3 core (client) — DONE, DEFAULT ON, verified:** training now grows
  the chosen stat **directly** at the calibrated rate (`lib/training-config.ts`,
  15m/1h/4h/8h → +6/22/84/160, gentle 23→20/hr slope), bounded by the per-rank cap
  (`statCapForLevel`); leveling no longer grants a stat budget
  (`reconcileCharacterStatBudget` now preserves a stored `unspentStats` pool, not
  budget-derived — parity/AI functions `statBudgetAtLevel` etc. left intact);
  respec refunds every earned point into the pool (Profile.tsx, no reset-to-base
  loss); XP trickle kept. Tests: `training-config.test.ts` (new) + updated
  `stats.test.ts`; **full suite 1988/1988 pass**, client lint clean.
- ✅ **Stage 2 server-auth — DONE, verified:** `api/training/start` mints a
  single-use token sealing the chosen stat's gain (from the tier + a **clamped**
  client bonus) + a daily mint cap (96/day); `api/training/complete` time-gates,
  atomically consumes the token, and returns the sealed gain (with `cancel`
  proration). Client (`Training.tsx`) redeems it and applies the server amount,
  with a **graceful local fallback** (sanitizer-bounded) if the server is
  unreachable — no lockout. Server mirror `api/_training-config.ts` pinned by
  `api/_training-parity.test.ts`; both endpoints `route()`-registered in
  `server.ts` (route-parity test green). **Full suite 1990/1990, server tsc
  clean, client lint clean.** (Amount integrity = sealed token + save clamps;
  full amount-authority would need mirroring the village-bonus formula
  server-side — deferred as disproportionate for a sanitizer-bounded, wipe-pending
  system.)
- ✅ **Stage 4 — combat-use growth (PvE/AI), DONE, verified:** a won AI fight now
  grants a small, **hard-daily-capped** (`DAILY_COMBAT_STAT_CAP = 60`) stat reward,
  split `COMBAT_USED_STAT_RATIO = 0.6` — auto-grown (round-robin) into the stats
  the player has invested in (server proxy for "how you fight"), remainder into the
  unspent pool. Pure helper `api/_stat-growth.ts` (tested, 7 cases); wired into the
  return-only `report-ai-fight.ts` (reads save, locks a shared `combat-stat-count`
  daily budget, returns `statGrowth`); client applies it via `applyStatGrowth`
  (lib/stats.ts) in `Arena.tsx`. Cap-clamped per rank; unusable points roll to the
  pool. **Full suite 1997/1997, server tsc + client lint clean.**
- ✅ **Stage 4 (PvP casual) — DONE, verified:** non-ranked PvP wins now grant a
  small, daily-capped stat reward into the **unspent pool** (ranked = 0, skill-pure)
  via `api/pvp/claim-rewards.ts`, sharing the `combat-stat-count` budget. Pool-only
  (not auto-to-used) so the server-written amount rides the existing
  `summary.unspentStats` → `applyServerBaseReward` mirror with no stat clobber.
- ✅ **Server parity fix (required):** the client budget decouple had left the
  SERVER `api/_xp-engine.ts` `reconcileCharacterStatBudget` on the old budget model,
  so `creditPvpWinBase` would have re-injected budget-based `unspentStats` on every
  PvP win. Fixed to two-axis (mirrors the client) + updated `_xp-engine.test.ts`.
- ✅ **Committed** to branch `claude/hungry-austin-9aed71` (07ed4747), source only —
  full build passes. **dist NOT committed** (churn-prone; Railway self-builds from
  source; cPanel needs a deliberate both-dists rebuild + commit before deploy).

**REDESIGN COMPLETE.** All stages shipped + verified (full suite 1997/1997).
- ⚠️ **dist NOT rebuilt** — Railway self-builds; cPanel needs a client dist
  rebuild + commit before deploy.

--- (original staged plan, for reference) ---

Original intent was flag-gated (`trainingStatEngine.v1`, default OFF); superseded
by the default-ON decision above:

- **Stage 1 — Idle correctness (small): MOSTLY ALREADY DONE.** Verified that
  `activeTraining` already persists to the server save and restores on
  refresh/device (§1.3). No persistence code needed. Only *optional* polish
  remains: live countdown + immediate save flush on start (§5.2). Can be done
  anytime or folded into Stage 2.
- **Stage 2 — Decouple training → direct stat gain (server-auth):** add
  `training/start` + `training/complete`, `training-config.ts`, `trainingLog`
  audit; behind the flag. "CHOOSE STAT" now actually grows the chosen stat.
- **Stage 3 — Axis A cleanup:** stop leveling from granting the generic budget;
  make level/rank raise caps + pools + content only. Repurpose/retire the USER
  STATS panel per §9. Migrate existing characters' allocated stats (wipe pending
  makes this low-risk).
- **Stage 4 — Combat-use growth (Axis B2):** optional; grow used stats on won
  fights, server-recomputed from the real session.
- **Stage 5 — Sinks/throughput:** 2nd training slot via village/clan upgrade;
  finalize respec semantics.
- **Per stage:** run `npm test` (root) + `npm run lint` (client); rebuild + commit
  `dist/` for cPanel; keep CORS/route parity in sync.

---

## 9. Decisions

**Resolved (2026-07-01):**
1. ✅ **Full two-axis decouple** (§4). (Not the §10 minimal fallback.)
2. ✅ **Keep the USER STATS panel, fed by a combat-earned point pool** (§4 / §5.4).
5. ✅ **Combat-use growth (B2) is IN** — both channels: auto-grow used stats +
   free share to the panel pool (§5.4).

**Resolved (2026-07-01 — "do what's best for the game + ~90 days to cap"):**
3. ✅ **Respec returns ALL earned stat points into an allocatable pool.** For 50
   Fate Shards, every point you've trained/earned is refunded to the unspent pool
   (stats drop to base) and you **re-allocate as you wish** (cap-bounded). Nothing
   is ever lost — only rearranged — so a respec can't nuke 90 days of training.
   Keeps the Shard sink; makes training's stat pick a soft, reversible commitment
   (no permanent mistakes). This is the whole point of the kept USER STATS panel:
   both combat's free-share pool and a respec's refund flow through it.
4. ✅ **Keep a modest training-XP trickle; combat/missions stay the primary XP.**
   Idle players still rank up (caps keep unlocking → training never permanently
   stalls); active players rank faster. The existing ~90-day leveling curve is left
   intact.
6. ✅ **Pacing locked — ~90 days to a full 12-stat cap** for a dedicated daily
   player (§5.1); ~45 days for a focused competitive build; hardcore ceiling ~60
   days, casual ~150; grind advantage bounded ≤ ~1.5×. A `scripts/` sim verifies
   the constants before ship, but they already hit the target by construction.

**All design decisions are resolved — the plan is implementation-ready.**

---

## 10. Fallback: minimal fix if you want to keep the budget model

If you'd rather not move off the recently-shipped linear budget, the smallest
change that makes the trainer *feel* like it earns stats:

- **Stop deriving training's stat gain from `statPointsEarnedFromXp`.** Give each
  timer tier a **flat, cap-bounded stat gain** into the chosen stat (revive the
  currently-unused `statGain: 1/3/8/14` field in `Training.tsx:60`, recalibrated).
- **Draw those points against the level budget ceiling** (don't grant *extra*
  budget), so `budget-maxes-at-L100` is preserved and there's no power creep.
- **Persist `activeTraining`** (Stage 1) so it's actually idle.

**Caveat:** because the budget is the ceiling and a leveled player has usually
*spent* their budget, training still can't push past what your level allows — so
for an already-allocated character it will *still* often read ~0. This fallback
buys a better low-level feel and true idle persistence, but it does **not** solve
the root cause. The two-axis model (§4) does. This is why the decouple is the
real recommendation.

---

## Appendix — file / function reference map

**Ours (to change / read):**
- Stats & math: `shinobij.client/src/lib/stats.ts` (`xpNeeded:100`,
  `statBudgetAtLevel:148`, `reconcileCharacterStatBudget:177`), mirrored server
  `api/_xp-engine.ts`.
- Budget-from-XP (the "~0"): `shinobij.client/src/App.tsx:960`
  (`statPointsEarnedFromXp`), `gainXp:996`.
- Training UI + reward: `shinobij.client/src/screens/Training.tsx` (timers `:60`,
  `startTraining:67`, `completeTraining:87`).
- Allocation + respec: `shinobij.client/src/screens/Profile.tsx` (`addStat:130`,
  `respecStats:156`).
- Per-rank caps: `shinobij.client/src/constants/game.ts:65` (`perRankStatCap:91`).
- Training bonuses: `shinobij.client/src/lib/village-upgrades.ts:99`
  (`getTrainingXpBonus`).
- Save-side clamps: `api/save/[name].ts` (per-save 500/stat, 1000/save).
- Types: `shinobij.client/src/types/combat.ts:13` (Stats), `:144` (ActiveTraining).
- Anti-cheat pattern to copy: `docs/auth-and-anti-cheat-patterns.md`;
  `expedition-start`/`report-pet-event`, `raid-start`/`report-raid`.

**TNR (reference, `studie-tech/TheNinjaRPG`, branch `main`):**
- `app/src/libs/train.ts` — tier efficiency/multiplier, energy.
- `app/src/server/api/routers/train.ts` — the `stopTraining` mutation.
- `app/src/libs/profile.ts` — level curve, caps, pools, soft-cap.
- `app/drizzle/constants.ts` — `USER_CAPS`, `MAX_STATS_CAP`, tier list, daily cap.
