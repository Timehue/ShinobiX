# Tactical Arena — deeper utility-AI rewrite

Turning the tactical pet-arena AI (`shinobij.client/src/lib/pet-arena-sim.ts`) from
four independent one-tick-greedy agents into a **coordinated squad with cheap
lookahead and per-role personality** — without breaking determinism, the renderer
event contract, or the public `runPetArenaMatch(blue, red, seed)` signature.

The arena is **preview-only** (server-authoritative lobby, sealed seed → identical
replay, **no rewards**), so AI changes carry **zero balance/reward risk** — the only
hard constraint is **determinism**: seeded LCG, IEEE-safe math (`sqrt`/`round`/`min`/
`max` only — no `sin`/`cos`/`pow`/`Math.random`/`Date`), positions quantized 1/256/tick.

## Key design facts (learned from the code)

- **Win condition = scroll captures only** (race to `WIN_SCORE=5`); **kills do not
  score**. Combat is purely instrumental — clear the path / defend the carry. This
  means "make the AI fight better" only improves the match if it **converts to
  captures**; over-tuned defense actively *prevents* matches resolving (see R1 lesson).
- Decision machine: `decide()` → `candidates()` (scored intents per role) → argmax +
  sticky `COMMIT_MARGIN`. Re-decides every `DECISION_TICKS` (~0.53 s), reuses the plan
  between. Existing nudges: `PHASE_ADJ` (scoreboard rubber-band) + `TRAIT_ADJ` (pet
  personality). Movement: BFS + string-pull + stuck-watchdog (`moveToward`) — **proven,
  do not touch**; the rewrite only changes the *goal* handed to it.
- Two-phase tick: all pets `tickDecide` on the frozen board, then `tickExecute` in an
  order that alternates each tick (fairness). The blackboard is built once per tick
  here, also on the frozen board.

## Stats harness (how we measure — Claude is blind to the 3D scene)

`scripts/arena-ai-stats.ts` (run: `node --import tsx scripts/arena-ai-stats.ts`) —
60 seeds × 4 configs, prints per config:
- `len` match length (s) · `caps` captures/match · `kills` defeats/match
- `focus` avg ticks a pet spends <30% HP before dying (**lower = team collapses on a
  wounded target faster**)
- `carry` avg ticks a carrier holds the scroll (**lower for the defender = peels land**)
- `draws` share hitting the time cap (proxy for "match won't resolve")

Capture a **baseline before each phase**, compare after. `scripts/` is excluded from the
server build, so the harness ships nothing.

## Phases (each shippable behind the existing preview flag)

### R1 — Team blackboard ✅ DONE (uncommitted)
Built once/tick in `buildSquad` (pure, deterministic):
- **callTarget** — the ONE enemy each team should collapse on (carrier > nearly-dead >
  high-value role, distance-discounted). Adds `CALL_TARGET_BONUS` (20) to offensive
  `huntC`/defender-frontline candidates. **Gated to open fighting** (`!scrollOpen &&
  !scrollSoon`) so it never pulls a tracker off a winnable scroll race (captures are the
  only score).
- **peel** — `assignPeels`: each defender is assigned its own threat (carrier hardest,
  then diving assassin, then close tracker), greedy + nearest-defender-wins + no double-
  assignment. Scores sit just above the old generic intercepts (62 carrier / 56 assassin)
  — directs *coverage*, doesn't consume the defender's whole brain.

**Lesson (encoded as a test):** a prototyped team-wide **fallBack** ("group up when
out-powered") cascade was **cut** — it turned near-even matches into 5-min turtle draws
(draws ~doubled). Because only captures score, *better symmetric defense lowers the score
rate*. The local-outnumber regroup already covers piecemeal feeding.

**Results (60 seeds, baseline → R1):**
| config | focus (collapse) | carrier hold (peel) | draws | captures |
|---|---|---|---|---|
| 4v4 mirror | 92.6 → 91.9 | 186 → **160** | 17% → **12%** | 6.8 → **7.4** |
| 4v4 slight-edge | 94.3 → **87.0** | 147 → **141** | 7% → 12% | 5.8 → 5.7 |
| 4v4 double-assassin | 77.5 → **72.0** | 132 → 135 | 2% → 3% | 4.7 → 4.8 |

Tests: `pet-arena-sim.test.ts` +2 (determinism fuzz over seeds/comps incl. the 2-defender
peel path; "never turtles a near-even match"). Full suite 719✓, lint 0 errors, tsc clean.

### R2 — Cross-role action layer ✅ DONE (uncommitted) · neutral/foundational
Shared **PEEL** block (any role can answer a blackboard peel) + `PEEL_SCORE` weight table
(personality hook for R5), and `assignPeels` now covers a carrier with the nearest non-
defender when no defender is free. **Verified strict parity** for every defender-having
config (mirror/edge/2v2 identical to R1) — the change only touches *defenderless* teams.
**Behavioral delta ≈ 0** by design: the offense's `hunt` already chases carriers, so dive-
vs-poke spacing barely moves carry time on the open arena. Kept as a clean, zero-regression
foundation (shared-action pattern + weight table); not a watchability win on its own.

### R3 — Cheap lookahead ⚠️ ATTEMPTED → REVERTED (sage pre-shield is a wash)
Tried a Sage that pre-shields a focused ally before a gank lands. **Reverted:** it spends
the mend cooldown on an 18% shield, so the stronger reactive heal (22% HP + shield) isn't
ready when an ally actually drops — a net loss. Broad version raised draws/carry; carrier-
only version was neutral but still dipped the 2v2 def+sage win rate (100%→97%). The reactive
heal is already well-tuned. (`effHpAfter`/`ttk` projection and a TTK-weighted callTarget
remain unexplored if R3 is revisited.)

> **FINDING (after R1-R3):** R1's blackboard (call-target + assigned peels) was a clear
> win. But **three** subsequent "deeper AI" ideas were washes or negatives — fallBack
> (turtling), cross-role peel (≈0), sage pre-shield (cooldown-trade loss). The arena AI is
> **already well-tuned**; marginal returns on more *decision* logic are low. The likely
> remaining gains are in **movement** (R4 — retreat vectors, anti-suicide; a different
> failure mode that doesn't trade a cooldown) and especially in **VFX/presentation** (the
> user's other ask — bloom is one import away, see `docs/anime-fight-plan.md`). Recommend
> banking R1+R2 and pivoting there rather than forcing more decision-layer logic.

### R4 — Movement intents
Retreat *vector* (away from nearest pursuer, not just toward base) so chases read as
chases; lane-bias approach (flanks/pincers vs center scrum); approach-safety gate so a
lone assassin won't path into a ≥2-defender blob.

### R5 — Personality hooks
Structured per-role weight vectors + optional per-pet trait modifiers layered on top.

## Deploy note
Pure client change to `pet-arena-sim.ts` (preview-flagged). When committing for cPanel,
rebuild + commit `shinobij.client/dist` (Railway self-builds). Not needed while iterating.
