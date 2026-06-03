# Early-Progression Redesign

Design doc for improving the new-player experience in Shinobi Journey, from
account creation through the Genin gate (the first session and the path to
"hooked"). Companion to `docs/professions.md`.

> **Status:** proposal / not yet implemented.
> **Scope:** levels 1–20, first ~3 sessions.
> **Key assumption (per direction):** design as if the `×45` XP "testing"
> multiplier is gone — i.e. balance the *real* base curve
> (`CHARACTER_XP_GAIN_MULTIPLIER = 1`). See §1.
> **Start here:** [`early-progression-layout.md`](./early-progression-layout.md)
> is the consolidated master layout (the banded journey + the "no new systems"
> guarantee). This doc holds the underlying rationale + numbers.
> **See also:** [`onboarding-tutorial.md`](./onboarding-tutorial.md) (detailed
> FTUE/tutorial plan) and [`competitor-early-game.md`](./competitor-early-game.md)
> (how comparable games handle early progression).

---

## 0. Why this doc exists

A code audit of the early game found two compounding problems:

1. **The early curve is invisible.** `CHARACTER_XP_GAIN_MULTIPLIER = 45`
   (`shinobij.client/src/constants/game.ts:27`) multiplies *real* XP gain — it
   feeds `effectiveCharacterXpGain` (`api/_xp-engine.ts:131`) → `progressAfterXp`
   (`shinobij.client/src/lib/stats.ts:147`), and the Training UI even labels it
   "Testing XP: 45x" (`shinobij.client/src/screens/Training.tsx:58`). With it on,
   one D-rank mission (~80 XP × 45 = 3,600 effective) vaults a fresh character to
   ~level 9–10, and the level-20 Genin gate is ~4 missions away. The rank
   ceremonies and exam gates never land.
2. **There is no onboarding at all.** No tutorial, no guided first quest, no
   first-time flags, no contextual tooltips, no in-game glossary. After a
   one-time lore screen the player lands on the Village with **15 equal buttons**
   and no "do this first." This is the single most-cited D1-churn driver in the
   research (see §Sources).

Removing the multiplier (the stated assumption here) fixes #1's *symptom* but
exposes the real work: the base early experience needs a proper FTUE, a
combat-readiness fix, a gentler jutsu economy, and an always-visible "next
goal." This doc designs that.

---

## 0b. Locked design decisions (owner review)

These are settled and constrain everything below:

- **Stamina is NOT a content gate.** Pacing/throttling is done by the **daily
  caps** on missions, hunts, and exploration (`DAILY_MISSION_LIMIT`,
  `DAILY_HUNT_LIMIT`, `game.ts:57-60`), not by a stamina bar. Stamina/chakra stay
  as *in-battle tactical* resources only. → drop stamina-refill / instant-stamina
  ("Chronosphere") onboarding ideas; the daily-cap reset is the come-back-tomorrow
  hook.
- **Awakening keeps its RNG.** The random element roll is a deliberate, kept
  feature. Do **not** convert it to a "choose your element / guaranteed" pull.
  The existing free rolls (Lv 2 / Lv 20, `AWAKENING_FREE_LV2/LV20`) remain the
  no-pressure first taste; the outcome stays random.
- **Academy Students are PvP-protected.** New players (Academy rank = level
  1-14) cannot be attacked in PvP. See [`onboarding-tutorial.md`](./onboarding-tutorial.md)
  for scope.
- **Jutsu "mastery" = the per-jutsu `mastery.level` (0-50)**, driven by battle
  use (+20 XP/cast), not ryo training. Any "master your starter jutsu" objective
  is a soft teach-by-doing goal, not a hard gate. See `onboarding-tutorial.md` §1.7.

---

## 1. Guiding principles (research-backed)

| Principle | Source |
|---|---|
| **Time-to-first-fun is seconds, not minutes.** First session caps all downstream retention; deliver a representative, *won* action in <60s before any shop/settings. | DoF "core loops"; Solsten D1/D7/D30 |
| **Teach by doing, with progressive disclosure.** Reveal one system at a time, in context; tutorials <5 min and skippable. | Game Developer FTUE; UXPin progressive disclosure |
| **Always show the next thing.** "No clear goal/feedback" is the top D1 churn cause; a never-empty to-do panel addresses it directly. | Game Developer FTUE; Schreiber L7 |
| **Front-load fast level-ups, then taper — no early grind walls.** Many small wins beat one big one; power gained too slowly = churn. | Schreiber, Game Balance Concepts L7 |
| **Layer variable-ratio excitement on reliable progression.** Guaranteed XP/levels + "maybe this one" loot drops. | Hopson, Behavioral Game Design |
| **Don't end/interrupt the first session abruptly.** Generous early energy; route low-stamina players to a free parallel activity, not a wall. | Mobile Free To Play, energy systems |
| **No premium pressure early; one meaningful, funded first upgrade.** Curate the first shop view; don't show a wall of unattainable items. | GameAnalytics FTUE tips |
| **Daily quests are this genre's habit anchor.** Surface a simple scaffold from Day 1, not gated deep. | Naruto Web Game daily-missions writeup |
| **Rank-ups as ceremonial gates** that celebrate + raise the ceiling + unlock the next system. | Naruto Web Game |

---

## 2. The base curve, validated (multiplier = 1)

XP needed per level is linear: `xpNeeded(L) = L × 100` (`stats.ts:100`).
Cumulative XP to *reach* a level from level 1 is `100 × (L−1)L/2`.

| Reach level | Cumulative XP | D-rank missions (~83 XP) | Notes |
|---:|---:|---:|---|
| 2 | 100 | ~1.2 | first level-up almost immediate ✅ |
| 5 | 1,000 | ~12 | ~first session |
| 10 | 4,500 | ~54 | |
| 15 (Genin) | 10,500 | ~127 D / mix | C-rank unlocks here |
| 20 (Genin exam gate) | 19,000 | +~40 C-rank | hard XP cap until exam |
| 30 (Chunin) | 43,500 | — | |
| 39 (Chunin exam gate) | 74,100 | — | |
| 50 (Jonin) | 122,500 | — | |

**Verdict:** the *raw* early curve is actually fine once the multiplier is off —
L1→L5 in ~12 missions is solid first-session dopamine, and the linear ramp
tapers naturally. The early-game problem is **not** the XP math; it's everything
around it. So this redesign keeps the curve and fixes the experience.

### Reward references (base, exact)

- **Missions** (`App.tsx:3255–3274`): D 80–90 XP / 60–75 ryo · C 200–240 / 160–190
  · B 420–520 / 340–420 · A 900–1100 / 750–900 · S 2000–2400 / 1800–2100 (+1 Fate
  Shard). Daily caps: 20 missions + 20 hunts (`game.ts:57–60`).
- **Stat training** (`Training.tsx:46–51`): 15m=20 XP/5 stam · 1h=70/15 ·
  4h=220/35 · 8h=375/60. One training active at a time.
- **Starting state** (`App.tsx:2660`): L1, 100 ryo, 100/100/100 HP·chakra·stamina,
  20 unspent stat points, gear `[rustfang-kunai, shinobi-vest]`,
  `equippedJutsuIds: []`, `jutsuMastery: []`, `elements: []`, no profession.

---

## 3. Target first session (FTUE), minute-by-minute

> **Detailed plan:** see [`onboarding-tutorial.md`](./onboarding-tutorial.md) for
> the full tutorial state model, step script, the auto-learn-bloodline-jutsu
> mechanic, and the phased build order.

The goal: a guided ~10-minute arc that ends with the player leveled a few times,
in a fight they won, with one upgrade chosen and a clear next goal.

1. **0:00 — Create.** Name + village + bloodline, each with a one-line
   *mechanical* blurb (today they're flavor-only). Show a starting-stat preview.
2. **0:30 — First win.** Drop straight into a scripted, winnable first encounter
   (or a "spar at the Academy" step) using a **pre-equipped starter jutsu** (see
   §4). The player acts, wins, sees XP + a level-up animation. This is the
   <60-second fun.
3. **2:00 — First choice.** A guided pointer to equip a 2nd jutsu (free unlock,
   §4) and spend a couple of the 20 starting stat points. Teaches the loadout +
   stats by doing.
4. **4:00 — First mission.** Breadcrumb to "Hunt the Wild Boar" (D-rank, L1).
   Completing it grants XP/ryo and **unlocks the player's profession choice +
   the daily-quest scaffold** (§6) as a celebrated moment.
5. **7:00 — First upgrade.** Point at the (curated, §7) shop with enough ryo for
   one meaningful purchase.
6. **9:00 — Set the hook.** "Next Goals" panel (§5) now shows: *Reach Genin
   (Lv 15) · Win 3 battles · Complete a daily quest.* Session can end with a
   reason to return (a stat-training timer running, a daily reset coming).

Everything in this arc is **opt-in/skippable** (a "Skip intro" affordance), and
each step is gated only by the previous one — progressive disclosure, not a
locked theme-park.

---

## 4. Combat readiness — the silent first-session wall

**Problem.** A new character has `equippedJutsuIds: []` and `jutsuMastery: []`.
The loadout screen only lists jutsu with `mastery.level ≥ 1`
(`App.tsx:27011`), and equipping anything else errors with *"Train this jutsu to
level 1 first"* (`App.tsx:26717`). The escape hatch — the Jutsu Training Hall
unlocks each jutsu's **level 1 free + instantly** (`Training.tsx:339`) — is
completely undiscoverable. So out of the box the player is *a ninja who can't
fight* and nothing tells them why.

**Design.**
- **Seed a starter loadout in `createCharacter`** (`App.tsx:2660`): grant the
  bloodline's signature jutsu (and the universal "Flicker") at `mastery.level: 1`
  and pre-equip 1–2 of them. Element gating already allows bloodline + no-element
  jutsu without an awakened element (`lib/bloodline.ts:84–89`), so this is safe.
- Keep the free-first-level unlock, but **surface it**: an empty-loadout state
  that says "Unlock your first jutsu free →" linking to the Hall.
- This is mostly mechanical (no reward-rate change) — see Phase 1.

---

## 5. "Next Goals" — extend the existing Logbook, don't build a new panel

**Important:** ShinobiX already has a quest-log — the **Logbook**
(`App.tsx:26219`). It renders rank exams as requirement checklists with progress
bars, "Ready to pass" states, and self-claim buttons (`App.tsx:26441-26460`), via
a reusable `renderRequirement` row. So the "always-show-the-next-thing" home
exists — it just **starts empty until level 11** (the first exam, Genin, has
`unlockLevel: 11`). The gap is the Academy phase (levels 1-10).

The fix is to **extend the Logbook**, not add a parallel component:
- **Add an "Academy Training" checklist** (a pre-Genin entry shown from level 1)
  that breadcrumbs the FTUE: equip your bloodline jutsu → win your first battle →
  awaken your element → train a stat → run your first D-rank mission → (at L13)
  choose your path. Reuse the exact `renderRequirement` row the exams use.
- **Data source:** existing character counters — `totalMissionsCompleted`,
  `totalAiKills`, `totalStatsTrained`, `equippedJutsuIds`, `level`, `profession`,
  `ownedElements` (same fields the exam checklist already reads). No schema change.
- **Compact "next goal" pin** on the Village screen / mobile HUD that surfaces the
  single most relevant Logbook item (e.g. "You're ready to pass the Genin Exam!")
  so the player doesn't have to open the Logbook to know what's next.
- **Progressive disclosure:** completing a goal reveals the next system; rank
  promotions (Genin/Chunin) are the unlock gates (§8).

Mostly UI, reads existing state — no API, no balance impact.

---

### 5a. Academy Training checklist — concrete draft

A new Logbook entry shown from level 1, in the **same row format as the rank
exams** (`renderRequirement`, `App.tsx:26451`). It is a *soft* guidance checklist
(no XP gate, no `examKey`) and is the persistent backbone of the tutorial
step-script (`onboarding-tutorial.md` §3).

Shape — mirrors `ExamLogbookMission` (`App.tsx:26264`) without the
`examKey`/level-cap:

```ts
const academyChecklist = {
  title: "Academy Training",
  unlockLevel: 1,
  requirements: [ /* ExamRequirement[]: {label, progress, target, detail?, aiId?} */ ],
};
```

Requirements — each maps to a field the character already has (no new counters):

| # | Goal (label) | `progress` | `target` | `detail` hint | teaches |
|---|---|---|---|---|---|
| 1 | Awaken your first element | `ownedElements.length` | 1 | `ownedElements[0] ?? "Awaken at the Awakening Stone (free at Lv 2)"` | awakening (RNG element) |
| 2 | Equip your jutsu loadout | `equippedJutsuIds.length` | 4 | "Open Jutsu Loadout" | loadout (start with 3 auto-equipped → add the 4th) |
| 3 | Win your first battle | `totalAiKills` | 1 | "Fight in the Arena or a hunt" | combat — the guaranteed first win |
| 4 | Train at the grounds | `totalStatsTrained` | 5 | "Train a stat at the Training Grounds" | stat training |
| 5 | Complete your first mission | `totalMissionsCompleted` | 1 | "Accept a D-rank mission below" | mission loop |
| 6 | Sharpen a jutsu (mastery Lv 3) | `max(jutsuMastery.level)` | 3 | "Using a jutsu in battle levels it" | jutsu growth → bridges to Genin |

Footer (not a checkbox): *"Next: the **Genin Exam** unlocks at Level 11."*

Lifecycle:
- **Show** while `rankFromLevel(level) === "Academy Student"` (level < 15) and not
  yet dismissed/claimed.
- `complete = requirements.every(r => r.progress >= r.target)` — identical to the
  exam logic (`App.tsx:26443`).
- One-time **"Claim Academy reward"** button when complete → sets
  `onboarding.academyClaimed = true` (the only new save field; the save merge
  preserves unknown character fields, `_utils.ts:44`). An optional small ryo /
  starter-item reward here is a minor balance touch — flag if added.
- A compact **HUD pin** surfaces the first incomplete requirement so the player
  sees "what's next" without opening the Logbook.

Notes:
- Targets are deliberately **small and first-session reachable** in either
  XP-multiplier world (§0b). Five of six are action counts (multiplier-
  independent); #4 (`totalStatsTrained`) is XP-derived but the target is low
  enough to clear quickly regardless.
- #2's target assumes auto-learn pre-equips **3** jutsu (`onboarding-tutorial.md`
  §1.3). If you pre-equip all 4, change #2 to "Open your loadout" or drop it.
- #1 and #6 deliberately mirror Genin-exam requirements, so Academy play feeds
  directly into the next milestone (no wasted effort).
- Pure UI + existing counters + one boolean flag. **No API, no cPanel route, no
  balance change** (unless you attach the optional reward).

---

## 6. Daily quests & login habit

**Problem.** A daily-mission system exists (`api/missions/daily.ts`,
`api/missions/_pool.ts`) but `loadOrIssueDailyMissions` requires a profession
(`daily.ts:28`), and new players start with none. There is **no daily login
bonus** at all. The genre's proven habit anchor is gated off exactly when it
matters most.

**Design.**
- **A small, profession-agnostic "new shinobi" daily set** available from Day 1
  (e.g. win 1 battle, complete 1 mission, train once) feeding the Next-Goals
  panel. Reuse the existing daily-issue/reset plumbing rather than inventing new
  storage.
- **A simple daily login streak** (escalating but modest ryo, capped) — closure +
  a return reason; *not* premium pressure.
- ⚠️ **Deployment note:** any new daily endpoint must be registered in
  `server.ts` for cPanel as well as living under `api/` for Vercel (CLAUDE.md
  parity rule), and the client call path must match the handler file path (see
  the route-parity memory).

---

## 7. Economy, shop curation & monetization optics (early)

**Problems.**
- **Jutsu cost cliff.** First level is free, but level 1→2 costs
  `2500 + level×500` = **3,000 ryo** + 10 min (`Training.tsx:300–304`), while
  D-rank missions pay ~65 ryo → ~46 missions for *one* jutsu level. Power is
  effectively frozen at level 1 for a long time. This is a textbook early grind
  wall and is independent of the XP multiplier.
- **Shop wall.** The Grand Marketplace is visible to new players but everything
  is Lv 40+/Fate-Shard priced (`Shop.tsx`), and Fate Shards are essentially
  unearnable before ~Lv 50. A new player sees a cash shop full of things they
  can't get.
- **Hospital dead-time.** A KO sends non-healers to a forced 60-second wait or a
  2,500-ryo skip they can't afford (`Hospital.tsx:20`). Not a currency drain, but
  a momentum stop at the worst moment.

**Design (proposals — balance-sensitive, need sign-off).**
- **Gentle early jutsu curve:** make the first ~3–5 jutsu levels cheap/fast
  (e.g. flat low ryo, sub-minute) so the "train your jutsu" fantasy is reachable
  in session 1–2; preserve the steep curve later. Tune in the proposed-numbers
  table (§9).
- **Curate the first shop view:** show new players a small set of affordable,
  useful ryo items; collapse/lock the Grand Marketplace behind a level so it
  isn't a wall of unattainables (progressive disclosure, avoid choice paralysis).
- **Soften hospital for low levels:** shorter timer (or a free first revive)
  under, say, Lv 10.
- **One funded first upgrade:** consider a small onboarding gift so the player
  *spends* and feels a win early (no premium pressure).

---

## 8. Rank ceremonies & progressive disclosure

Make Genin (15) / Chunin (30) the emotional high points *and* the
system-unlock gates: a celebratory rank-up moment that (a) congratulates, (b)
notes the ceiling raised, and (c) reveals/unlocks the next system. Today rank is
just a recomputed title (`rankFromLevel`, `stats.ts:130`). Tie feature
visibility (Clan, Ranked, deeper jutsu) to these milestones so the Village stops
showing 15 equal options to a Lv 1 player.

Also: **warn before the exam gates.** XP hard-stops at Lv 20 and Lv 39
(`App.tsx:2060`) with no prompt. Add a heads-up at Lv 19/38 and a clear "Take the
Genin Exam" call-to-action so players never silently hit an invisible cap.

---

## 8b. Exams & professions (existing systems — keep & extend)

Both are already built and are core early-progression spines. Audit + changes:

**Exams (the Logbook checklists, `App.tsx:26283-26332`):** keep the model — it's
the genre-proven rank-up-as-checklist (the genre leader/Ninpocho). Changes:
- **Add a jutsu-mastery requirement to the Genin exam** — e.g. "raise a jutsu to
  mastery level 3" (combat-driven, ~8 casts). Today the Genin checklist teaches
  stats/missions/AI/explore/awaken but **nothing about the jutsu system**. Ties to
  the auto-learn feature (`onboarding-tutorial.md` §1) and matches the genre.
- ⚠️ **Re-tune requirement counts for the chosen XP multiplier.** "Train 1000
  stats" is calibrated to ×45: `statPointsEarnedFromXp` (`App.tsx:2031`) runs the
  amount through `effectiveCharacterXpGain`, so stat points scale with *effective*
  XP. Drop the multiplier and the same training yields ~45× fewer stat points —
  "1000 stats" becomes hundreds of sessions. The exam counts (esp. stats) must be
  re-derived whenever the multiplier changes. (Decision tie-in: §0b.)
- **Make pass-ups ceremonial.** Passing is currently a JS `alert()` + cap removal
  (`App.tsx:26455`). Reuse the profession-picker VN framing for Genin/Chunin
  promotions, and make them the progressive-disclosure unlock gates (§8).

**Professions (VN picker at Level 13, `choose.ts:10`):** all three are
substantially built. Pet Tamer "Phase 2" (training-speed + expedition bonuses)
**is wired** (`App.tsx:10228`/`10269`, `api/missions/report-pet-event.ts:149`), so
`docs/professions.md` is **stale** where it calls Phase 2 deferred. Healer
(rank-scaled heal XP / per-target cooldown 300→90s / hospital timer / worldwide
vision @10, `professionLogic.ts:73-78`) and Vanguard (seals, level-gap, anti-alt,
daily caps, Rank-8 discount) are complete too. Early-game changes:
- **Move the unlock to the Genin promotion (level 15), not a floating Level 13.**
  At 13-14 you're still Academy rank; with Academy PvP-protection, Vanguard has no
  PvP outlet and Healer few targets, so 2 of 3 professions are dormant until
  Genin. Tying it to Genin makes rank-up the ceremony that reveals the path
  (progressive disclosure) and keeps the Academy phase about basics. Sequence:
  Genin ceremony → picker.
- **Value is conditional per profession** (Vanguard→PvP, Healer→others' injuries,
  Pet Tamer→pets). The picker should say what each needs to shine; a new Genin
  with no pet will find Pet Tamer feels dead — consider a starter pet or flagging
  it as pet-focused.
- **Add a one-time early respec** (free until ~Chunin). The choice is permanent
  but the player hasn't tried PvP/healing/pets yet; research says irreversible
  early choices need a safety valve. (professions.md defers swap to v2; an
  early-only respec is the lighter middle ground.)
- **Surface the active profession's next mission/rank in the Logbook** — today
  it's a separate screen (`DailyProfessionMissions.tsx` + `api/missions/daily.ts`);
  fold it into the unified "next thing" home alongside exams + the Academy list.

---

## 9. Proposed numbers (for approval)

> Everything here is balance-sensitive and affects live saves; **do not change
> without sign-off** (CLAUDE.md). Listed as the redesign baseline.

| Lever | Current | Proposed | Rationale |
|---|---|---|---|
| `CHARACTER_XP_GAIN_MULTIPLIER` | 45 | **1** (or a modest 2–3) | Restore a real early curve; §2 shows base curve is healthy |
| Starting equipped jutsu | 0 | **1–2 bloodline + Flicker at mastery 1** | Removes the silent combat wall (§4) |
| Jutsu level 1→2 cost | 3,000 ryo / 10 min | **~150–300 ryo / <1 min for levels 1→~5**, steep curve after | Kill the early grind wall (§7) |
| Hospital timer (Lv < 10) | 60 s / 2,500 skip | **~15–20 s, or free first revive** | Protect new-player momentum (§7) |
| Daily quests | profession-gated | **new-player set from Day 1** | Habit anchor (§6) |
| Login bonus | none | **modest capped streak** | Return reason (§6) |

⚠️ **Live-save impact of dropping the multiplier:** existing players keep their
stored level/XP but earn slower *going forward*. Decide whether to (a) apply
globally, (b) grandfather current players, or (c) phase down (45→10→3→1). This is
an open decision (§11).

---

## 10. Implementation plan (phased)

**Phase 1 — Safe, no balance change (ship first):**
- Next-Goals panel — new component + wire into Village + mobile HUD (§5).
- Seed starter jutsu in `createCharacter`; empty-loadout "unlock free" CTA (§4).
- Village empty-state / "Recommended for new players" cluster; visually defer
  Clan/PvP/Ranked for low levels (§8 progressive disclosure).
- Creation-screen blurbs for bloodline/village + stat preview (§3).
- Exam-gate heads-up at Lv 19/38 (§8) — pure UI.
- Files: `App.tsx` (createCharacter), `screens/Village.tsx`,
  `screens/CharacterCreator.tsx`, new `components/NextGoals.tsx`,
  `components/MobileStatusHUD.tsx`. Run `npm run lint` (client).

**Phase 2 — Balance-sensitive (needs sign-off + save review):**
- Set `CHARACTER_XP_GAIN_MULTIPLIER` (`constants/game.ts:27`) and mirror any
  curve assumptions in `api/_xp-engine.ts`.
- Gentle early jutsu cost curve (`Training.tsx:300`).
- Hospital low-level softening (`screens/Hospital.tsx`).
- Run `npm test` (API) — `_xp-engine.test.ts` asserts the current multiplier and
  will need updating in lockstep.

**Phase 3 — Systems (server work):**
- New-player daily quests + login streak. Touches `api/missions/_pool.ts`,
  `api/missions/daily.ts` (+ possibly a new endpoint). **Must** add cPanel route
  in `server.ts` and keep the client call path matching the handler path
  (parity). Run `npm test`.
- Rank-up ceremony moments (§8).
- Onboarding funnel instrumentation: log the last onboarding step before
  drop-off (cheap, highest diagnostic ROI).

**Cross-cutting constraints:** preserve existing saves; keep Vercel/cPanel
behavior consistent; keep CORS/headers in sync if any new header is introduced
(none planned); colocate any new tests as `*.test.ts`.

---

## 11. Open decisions

1. **XP multiplier target:** 1, or a modest 2–3× for early-game feel? And how to
   handle live players (global / grandfather / phased)?
2. **First-fight framing:** a scripted intro encounter vs. simply pre-equipping a
   jutsu and breadcrumbing to the first mission?
3. **Daily login bonus:** in scope now, or defer to a later monetization pass?
4. **Profession timing:** keep the permanent choice at first-mission, or add a
   brief description / one-time respec to de-risk it?
5. **Onboarding flags on the `Character` type** (`hasSeenIntro`,
   `completedFirstMission`, …) — acceptable to add to the save shape?

---

## Sources

- John Hopson, *Behavioral Game Design* (Game Developer/Gamasutra, 2001) — reward
  schedules.
- Ian Schreiber, *Game Balance Concepts, Level 7* — advancement, progression,
  pacing.
- Solsten, *The True Drivers of D1/D7/D30 Retention*.
- Game Developer, *Best Practices for a Successful FTUE*.
- GameAnalytics, *10 Tips for a Great FTUE in F2P Games*.
- Deconstructor of Fun, *Mid-Core Success Part 1: Core Loops*.
- UXPin / LogRocket — progressive disclosure.
- Mobile Free To Play, *Understanding and Eliminating Energy Systems*.
- Naruto Web Game, *Daily Missions System* — genre daily-quest & rank-up patterns.
