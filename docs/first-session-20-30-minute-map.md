# First Session: 20–30 Minute Core Inside the Full Academy Journey

Current-state implementation map for the first playable session. This refines
the broader proposals in `early-progression.md` and `onboarding-tutorial.md`
around the companion-led Academy flow that now exists in the game.

## Scope correction

The current tutorial is intentionally deeper than a conventional 8–10 minute
walkthrough. It includes character identity, an authored introduction, companion
choice, two training systems, loadout building, equipment, combat, recovery,
reward claiming, persistent objectives, and world travel.

The **20–30 minute target is therefore the core Academy chapter**, not a deadline
for consuming every line and completing every post-Academy action. A fast player
can reach the handoff in that window. A player who reads the story, compares
jutsu, inspects gear, and studies combat should comfortably take **30–45
minutes** without being treated as slow.

## Goal

By the end of the guided Academy chapter, a new player should understand and
have personally used the core loop:

> prepare a build → fight → claim a reward → start long-running growth → choose
> the next objective

The session should end with a training timer running, a clear next goal, and at
least one optional activity the player wants to try. It must not change combat
math, rewards, existing unlock requirements, or veteran saves.

## Experience rules

1. **One guide owns “what next.”** While Academy coaching is active, the
   companion coach is the only next-action prompt. The broader Logbook pin
   returns after the tutorial.
2. **One primary action at a time.** The player may still leave or skip, but the
   current action is visually dominant.
3. **Progressive emphasis, not hard feature locks.** Initially de-emphasize
   advanced destinations instead of making existing systems inaccessible.
4. **Teach through real state changes.** Steps complete through the same saved
   actions used by normal play, not tutorial-only “Next” buttons.
5. **The first fight is representative and won.** It teaches targeting, AP,
   equipment, and the battle log without changing the normal combat engine.
6. **The handoff matters as much as the tutorial.** Completion must lead into a
   real E-Rank mission or story choice, not an unfiltered wall of facilities.

## Phase and pacing map

| Target time | Phase | Existing player actions | What the phase proves |
|---|---|---|---|
| 0:00–5:00 | Identity | Create shinobi; choose village, bloodline, portrait, and account identity | “This is my character and build foundation.” |
| 5:00–9:00 | Bond | Experience the intro and choose a companion | “This world has tone, stakes, and a guide I chose.” |
| 9:00–18:00 | **Prepare** | Start stat training; train a non-bloodline jutsu; equip four jutsu; equip kunai and vest | “I know how long-term growth and a battle kit work.” |
| 18:00–27:00 | **Prove Yourself** | Win the Academy spar; recover in the Cafeteria; claim the Academy Trial | “I can fight, recover, and turn success into rewards.” |
| 27:00–36:00 | **Find Direction** | Open the Logbook; visit a numbered sector; return to the village | “I know where goals live and how to leave and return safely.” |
| 30:00–45:00, when ready | **Choose Your Path** | Follow the Awakening Stone story into Central Hub, awaken an element, then choose E-Rank field work or the village story | “The tutorial is over, but I have a reason to keep playing.” |

The ranges overlap deliberately. A decisive player may complete preparation in
five minutes and reach the handoff around minute 25. A reader may still be in
the spar or reward loop at minute 30. The success measure is comprehension and
forward momentum, not tutorial speed.

## Existing depth that must remain

The pacing layer must preserve these real lessons rather than collapsing them
into explanatory text:

1. Bloodline jutsu and a separately trained technique are different.
2. Starting a stat timer demonstrates background progression.
3. Learning a jutsu and equipping it are separate actions.
4. Backpack ownership and equipped gear are separate states.
5. The Academy spar teaches AP, targeting, jutsu use, Wait, and the battle log.
6. Damage has an aftermath, so the Cafeteria has a clear purpose.
7. Winning and claiming a mission reward are separate parts of the loop.
8. The Logbook replaces companion instructions with persistent progression.
9. Sector travel teaches both going out and returning safely.
10. Elemental awakening and the mission/story choice begin player-directed play.

## Navigation disclosure

Do not delete or truly lock existing destinations in the first pass. Add an
Academy “focus mode” presentation:

### During companion coaching

- **Now:** the current coached destination.
- **Up next:** exactly one immediate upcoming action.
- **Explore later:** a collapsed group containing everything else.
- Direct links and the Skip action remain available.

The focused sequence is:

`Training → Jutsu → Profile → Inventory → Spar → Cafeteria → Mission Hall → Logbook → World Map`

### After Academy completion

Replace the coach with a compact, staged handoff:

1. If the Level 2 awakening is available, recommend **Visit the Awakening
   Stone** while keeping **Take an E-Rank mission** available. The existing
   Awakening Stone scene introduces the destination before Central Hub opens.
2. Once the player owns an element, offer **Take an E-Rank mission** or
   **Continue the village story**.

The existing next-goal pin owns this handoff, then falls back to ordinary
Logbook objectives when the player dismisses it or completes the Academy
checklist. Shop, Pets, Character, Bank, and Tavern remain available, but are
secondary to the handoff choices.

### Later rank emphasis

These are presentation milestones, not new authorization gates:

- **Academy:** training, jutsu, gear, rookie missions, story, first companion.
- **Genin:** clans, broader world activity, pet progression, card play.
- **Chunin+:** ranked competition, wars, advanced economy and leadership.

If a future feature is genuinely locked, its card should explain the exact
existing requirement and link to the relevant Logbook objective.

## Copy/state alignment

All surfaces should use the same vocabulary:

- “Academy spar” is the tutorial fight.
- “Combat mission” is an Arena/hunt/E-Rank result counted by normal AI-kill
  progression.
- “Academy Trial” is the one-time onboarding mission reward.
- “Train a new jutsu” means learning a technique outside the four automatically
  learned bloodline jutsu.
- “Equip your loadout” means four equipped techniques.

Copy should be generated from shared objective configuration where practical,
so the companion bubble, checklist, Mission Hall, and Logbook cannot drift.

## Safety and rollout

### Phase 1 — presentation only

- Keep one next-action owner. **Implemented.**
- Group the nine current coach beats into Prepare / Prove Yourself / Find
  Direction. **Implemented.**
- Label only one action Up next; label the remaining route Later.
  **Implemented.**
- Add the staged post-Academy awakening/mission/story handoff.
  **Implemented.**
- Group the broader destination menu into Now / Up next / Explore later.
  **Still proposed.**
- Add funnel telemetry.

No save schema, gameplay, economy, or server changes.

### Phase 2 — shared objective configuration

- Move coach/checklist/Logbook labels and target counts into one typed config.
- Keep completion selectors pure and unit-tested.
- Add resume tests for refresh/logout at every step.

### Phase 3 — optional tuning, requires owner sign-off

- Consider a first-only training duration shorter than 15 minutes.
- Consider a first-only affordable shop purchase.
- Consider whether the triggered story scene should wait until after the
  two-choice handoff.

These affect pacing or economy and should not be bundled with the presentation
work.

## Funnel and acceptance checks

Record one event at each boundary without player-entered text:

- account created
- starter committed
- training started
- extra jutsu trained
- fourth jutsu equipped
- starter gear equipped
- spar started / won / abandoned
- Academy Trial claimed
- Logbook opened
- sector visited / returned
- element awakened
- first post-Academy choice

Initial acceptance targets:

- At least 90% of created accounts successfully commit a starter.
- At least 80% of starter-committed players begin the spar.
- At least 75% finish the companion tutorial.
- Median companion-commit through Academy Trial claim is under 25 minutes.
- Track full sector-return completion separately; do not optimize it by removing
  tutorial depth.
- No step has more than a 10-point abandonment jump versus the previous step.
- No screen simultaneously presents two different “next” actions.
- Refreshing or logging out/in cannot move a player backward or skip a required
  real action.
