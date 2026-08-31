# Hollow Warfront — the Rite

Status: **live specification.** Supersedes `hollow-warfront-three-lane-rebuild.md`,
which describes the retired lane war.

Mode fantasy: **four pets a side, all fighting at once, best of three clashes.**

## Why this replaced the lane war

Warfront shipped twice as a lane war, and the capture-scroll Tactical Arena
before it. All three failed the same way, and the diagnosis was already written
down after the first one:

> Root disease: capture-only scoring divorces the watched thing (combat, ~90% of
> screen-time) from the winning thing.

Warfront inherited that structure with different nouns. `wfVerdictScore` counted
downed towers and **nothing else** — a player could win every fight on screen and
lose the match. The response each time was to add a system (stances, doctrines,
omens, mutators, hazards, Warden Favor), none of which was visible from an
orthographic camera fitted to a 70 × 39 plate, where a pet is ~2% of screen
height.

The Rite removes the divorce. **Pets standing decides the clash; clashes decide
the match.** Every second on screen moves the result.

## Rules

- Both sides field **four pets simultaneously** in a **formation**: lanes 0–1 are
  the FRONT line and meet the enemy first; lanes 2–3 are the back line.
- A clash runs until one side is wiped or the engine's cap. **More pets standing
  takes the clash**; equal counts fall to total health remaining.
- **Best of three.** First to two clashes wins.
- **Wounds carry, then both sides regroup**, and the side that lost regroups
  harder (`RITE_REGROUP` / `RITE_LOSER_REGROUP`). Regrouping restores health
  only — never power — so it cannot turn a weaker band into a stronger one.
- **The fallen return wounded, not dead** (`RITE_DOWNED_RETURN_HP`), and they
  regroup too. Permadeath makes clash two a 4-v-1 formality — the exact
  "foregone conclusion" a previous Warfront pass burned a commit failing to fix.

  Be precise about what this means in practice: **a clash starts near-fresh.**
  The regroup compresses everyone back toward full, so the wound a band carries
  is a real edge rather than a sentence. That compression is not a side effect —
  it IS the mechanism that keeps a best-of-three live, and the numbers below show
  what happens without it.
- **One re-form per Rite.** After the opening clash the match PAUSES and you may
  move a pet forward or back, seeing each survivor's health as you decide. This
  is a genuine mid-match decision, not a pre-commitment: the panel gates the
  handoff, so nothing advances until you answer.
- A band must carry **three distinct elements** (`RITE_MIN_ELEMENTS`).

### How the re-form stays honest

The UI shows you clash one, takes your decision, then **recomputes the whole
match** around the new plan. That is safe because the engine applies a reform
only to clashes *after* the one it is attached to, so re-running
`runWarfrontRite` with the same bands, seed and opening formation reproduces
clash one byte for byte. A test pins it — otherwise the fight you just watched
could silently change underneath you.

### Bonds

Four pets standing near each other are still four individuals. Every pet
contributes to its whole band by **role** — Defender and Sage give health,
Tracker and Assassin give attack — and contributes **half again** when it shares
the recipient's element. Role spread decides what you get; element spread decides
how much. Bonds are capped so a lucky band cannot make a clash a formality.

## The engine was already squad-capable

A clash runs on the shipped, harness-validated cinematic engine through
`runPetSquadDuelCinematic` — an **additive** entry point added to
`pet-duel-cinematic.ts`. Nothing existing was modified, so every Pet Coliseum
path stays byte-identical.

The engine only *looked* capped at two a side. In fact:

- `simulate()` always took a **fighter array**, not a pair.
- `_partyMode` switches itself on at `fighters.length > 2`.
- The ally-separation rule loops over **every** teammate, despite its "(2v2)"
  comment — it was never pair-specific.

The two-per-side limit lived entirely in the public entry points, because that
was all the Coliseum needed.

## Measured balance

`scripts/warfront-rite-harness.mts`, real 130-pet pool, 90 matches:

| Metric | Result | Target |
|---|---|---|
| Blue-seat win rate | **53.3%** | 42–58% |
| Idle fighters | **0.0%** | ~0% |
| Clash median | **30.9s** | — |
| Match median | **75.5s** | — |
| Clashes hitting the 75s cap | **0.9%** | low |
| Drawn matches | **0.0%** | low |
| First-clash loser still wins | **20.0%** | >15% (25% is the ceiling) |
| Formation changes the winner | **54.4%** | ≫0% |
| Stronger band wins | **87.8%** | 70–95% |

**0% idle fighters** is the one that mattered most: it proves the cinematic AI —
tuned for one or two fighters a side — genuinely holds at squad scale rather than
leaving half the board standing around.

### Pacing was tuned, not guessed

Eight fighters pool four times a duel's health, so inherited Coliseum pacing
produced a 70-second slog that timed out with half the board alive:

| `RITE_SQUAD_HP_SCALE` | clash median | hit the cap | KOs of 8 |
|---|---|---|---|
| 1.00 | 70.0s | 45.8% | 3.3 |
| 0.45 | 49.9s | 8.3% | 4.1 |
| 0.22 | 37.3s | 5.0% | 4.6 |
| **0.18** | **32.1s** | **2.5%** | **4.7** |
| 0.15 | 28.3s | 0.0% | 4.7 |

### The comeback problem, and the fix

Carrying wounds without a regroup made the mode a best-of-three in name only:
**77.5% 2-0 sweeps, and only 10% of matches won by the side that lost clash one.**
The loser simply walked into clash two wounded and lost again. Regrouping — with
the beaten side recovering more — moved that to **~50% sweeps and 20% comebacks**,
against a **25% theoretical ceiling** for perfectly independent clashes.

Excluding the FALLEN from the regroup was then tried, on the intuition that
healing a downed pet back to ~90% makes going down meaningless. The harness
rejected it outright: sweeps jumped to **88.3%** and comebacks fell to **8.3%**,
because a side that lost two or three pets walked into the next clash with them
stranded at 45% against a near-whole opponent. Intuition said the fallen should
stay hurt; measurement said the mode dies if they do.

## Authority

Unchanged in shape from the lane war, which is why it survived the rewrite:

- `api/pet/warfront-start.ts` seals both bands, the server seed, and an
  **automatic baseline** (the Rite at the default formation) into a single-use
  `pet:battle-token`. The baseline sets the settlement clock.
- The client posts only `warfrontPlan: { formation, reformAfterClash, reform }`.
  No outcome, no reward, no clash result.
- `api/pet/battle-result.ts` re-runs `runWarfrontRite` from the sealed bands, the
  sealed seed and that plan, and pays from **its own** winner. A malformed or
  tampered plan is rejected by `isValidRitePlan` and falls back to the sealed
  baseline — never to a client-asserted result.
- ⛔ `battle-result.ts` may **not** import `pet-duel-sim.js`; a guard test
  (`_ranked-duel.test.ts`) forbids it. Use `RiteResult.totalSeconds`.
- `api/_pet-sim/pet-warfront-rite.ts` is the generated server mirror.

## Presentation

- **Eight rigs on screen**, so the models, the toon shader and the VFX are
  finally above the resolution of the shot.
- **The camera tracks the living cloud** and tightens as pets fall, so the end of
  a clash becomes a close two-body shot without a scripted cut. Framing uses
  `fitDistance` from `lib/showdown-camera` — a hand-tuned distance put the lens
  inside the near fighter.
- **The camera orbits perpendicular to the battle line.** On a fixed axis, the
  moment the two lines interleave along the view direction they read as one mass.
- **Team identity is the hardest read** with eight interleaved bodies, so each pet
  stands on a filled team-coloured pool with a bright rim and takes a team rim
  light from below. Element colour moved to a dimmer overhead light so it
  flavours the body without competing with whose side it is on.
- **Four-light rig** — ambient, warm key, cool fill, back rim — or a dark-furred
  pet reads as a black blob against the void.
- **The front line stays marked in the HUD** during the fight, so the player can
  see whether their formation read paid off.

### Two rendering rules carried from the post-mortem

1. **Never hand the renderer an integer tick.** The lane war floored its clock,
   took the *floor* snapshot, then ran an exponential low-pass filter to chase
   the resulting 30 Hz staircase — which alternates fast and slow frames at 60fps
   and lags 2–3 frames behind truth. That was the "jittery". The Rite passes a
   **fractional** tick through a ref and interpolates between the two bracketing
   snapshots (`sampleActor`), with no smoothing anywhere.
2. **React never re-renders during a clash.** The clock is a ref; the HUD mutates
   the DOM from one rAF loop; the stage reads the same ref inside `useFrame`. The
   lane war re-rendered a 1,109-line component 30× a second.

## Files

| Piece | Path |
|---|---|
| Engine (clashes, formation, bonds, regroup) | `shinobij.client/src/lib/pet-warfront-rite.ts` |
| Squad entry point (additive) | `pet-duel-cinematic.ts` → `runPetSquadDuelCinematic` |
| Server mirror | `api/_pet-sim/pet-warfront-rite.ts` (generated) |
| Interpolation, event bucketing, action focus | `shinobij.client/src/lib/pet-warfront-rite-presentation.ts` |
| Match screen | `shinobij.client/src/components/PetWarfrontRite.tsx` |
| 3D stage | `shinobij.client/src/components/PetWarfrontRiteStage3D.tsx` |
| Styles | `shinobij.client/src/styles/pet-warfront-rite.css` |
| Balance harness | `scripts/warfront-rite-harness.mts` |
| Mode art + generator | `src/assets/warfront-rite/`, `scripts/gen-warfront-rite-art.mjs` |
| e2e | `shinobij.client/e2e-warfront/rite.spec.ts` |
| Dev preview | `/petvfx.html?rite=1` |

## The lane war is retired as a MODE

Nothing a player can open launches the three-lane war any more:

- the arena lobby launches the Rite;
- **co-op** launches the Rite as a `spectator` — no formation panel and no
  re-form, because a shared replay cannot take one client's decisions and still
  be identical on every machine;
- its mode card, its orphaned art and its design doc are deleted.

A contract test (`pet-arena-settlement.test.ts`) asserts that neither the arena
screen nor the co-op lobby can reach `PetWarfrontMatch`, so this cannot quietly
regress.

### Why the lane sim still exists

**The Pet Ladder's tactical ladder runs on it.** `api/pet-ladder/_core.ts` calls
`runWarfrontMatch` to resolve ranked ladder matches, and `screens/PetLadder.tsx`
renders `PetWarfrontMatch` as the replay viewer. That is server-authoritative
ranked play with existing standings, so the engine cannot simply be swapped —
doing so would invalidate every result already on the ladder.

So the lane war survives as **the tactical ladder's engine**, not as a mode.
`pet-warfront-sim.ts`, `PetWarfrontMatch.tsx` and `PetWarfrontStage3D.tsx` each
carry a header saying exactly that, the ladder no longer calls itself "the
warfront" in player-facing copy, and `/petvfx.html?warfront=1` is retained as the
QA harness for that replay.

Migrating the tactical ladder onto the Rite is the remaining cleanup, and it is
what would pay back the build-size ceiling raised in
`scripts/check-build-size.mjs`.
