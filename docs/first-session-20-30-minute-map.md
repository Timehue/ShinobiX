# First Session: 20–30 Minute Core Inside the Full Academy Journey

Current-state implementation map for the first playable session. This refines
the broader proposals in `early-progression.md` and `onboarding-tutorial.md`
around the companion-led Academy flow that now exists in the game.

> **Evidence note (2026-09-24):** the 20–30 minute core and 30–45 minute full
> session ranges below are planning hypotheses, not measured player outcomes.
> The beta report now shows step reach counts grouped by the UTC date the
> Academy started. This supports same-start-day reach comparisons, but it does
> not measure elapsed time, explain why a player stopped, or make an immature
> cohort a reliable completion rate. First-time observation is still needed to
> diagnose confusion; timing claims need a separate measurement design.

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

### Phase 1 — clarity, mobile fit, and a measurable baseline

- Keep one next-action owner. **Implemented.**
- Group the nine current coach beats into Prepare / Prove Yourself / Find
  Direction. **Implemented.**
- Label only one action Up next; label the remaining route Later.
  **Implemented.**
- Add the staged post-Academy awakening/mission/story handoff.
  **Implemented.**
- Group the broader destination menu into Now / Up next / Explore later.
  **Still proposed.**
- Record once-per-player Academy starts and canonical step reaches, grouped by
  UTC start date. **Implemented.** Cohorts are counts only; the report does not
  retain player identifiers or individual timelines.
- Reduce the first-run storage notice's mobile height without hiding its copy,
  learn-more link, or dismiss action. **Implemented and checked at phone and
  desktop widths.**

No player-save schema, gameplay, or economy change is required for this
presentation work. Aggregate funnel metrics are an additive server-side change.

### Phase 2 — first-time player observation

- Observe 5–8 people who have not played the game, using the live build on both
  phone and desktop where possible. Treat this as formative evidence, not a
  population estimate.
- Ask each person to narrate what they think the current goal is, then let them
  play without coaching. Record the first point where they hesitate, miss a
  target, misunderstand a reward, or choose an unintended route.
- For each issue, capture the exact screen/step, intended action, observed
  action, severity, and a screenshot or short recording. Fix repeated or
  progression-blocking issues first; leave preference differences as feedback.
- Re-run the same tasks after each change. Keep the coach/checklist state
  resumable across refresh and login, and retain a visible way to review help.

### Phase 3 — shared objective configuration

- Move coach/checklist/Logbook labels and target counts into one typed config.
- Keep completion selectors pure and unit-tested.
- Add resume tests for refresh/logout at every step.

### Phase 4 — optional pacing changes, requires owner sign-off

- Consider a first-only training duration shorter than 15 minutes.
- Consider a first-only affordable shop purchase.
- Consider whether the triggered story scene should wait until after the
  two-choice handoff.

These affect pacing or economy and should not be bundled with the presentation
work.

## Funnel and acceptance checks

The current privacy-preserving metric records one Academy start date and one
reach count per canonical step per player. It does not include raw player names,
per-player event sequences, or elapsed-time records. The report includes later
step reaches for cohorts started within the selected date window, reading only
the 120-day metric-retention period. Cohort measurement starts with new events;
historical step reaches are not assigned a guessed start date. A storage outage
can also undercount because these reports are best-effort telemetry.

Use the counts to compare reach within the same start-day group once it has had
time to progress. Do not call an incomplete/recent cohort a completion rate,
and do not set conversion targets before a baseline exists. Do not infer why a
player stopped from a missing step. The current save-transition observations
also rely on client-owned onboarding step/sector fields, so treat them as UX
signals rather than anti-cheat evidence.

Next measurement questions:

- How many new Academy starts reach the spar, claim the Academy Trial, and
  complete the guide, by start day?
- Which stages show repeatable confusion in first-time observation?
- Do players understand the first post-Academy choice without the companion?
- Is the 20–30 minute core actually reached in that time? Answer only after
  designing and reviewing an aggregate timing method; current telemetry cannot
  answer this.
- No screen simultaneously presents two different “next” actions.
- Refreshing or logging out/in cannot move a player backward or skip a required
  real action.

## Research basis

The plan uses these sources as guidance, not as proof that a specific duration
or conversion target is correct:

- [Apple: Onboarding for Games](https://developer.apple.com/app-store/onboarding-for-games/)
  recommends short, clear steps that build on demonstrated competency, active
  play, early self-directed play, optional skipping, contextual reminders, and
  measurement of engagement and retention.
- [GDC: Prime, Teach, Observe](https://www.gdcvault.com/play/1020512/Prime-Teach-Observe-Tutorializing-Innovative)
  describes priming, helping players internalize mechanics, and iterating based
  on observation.
- [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/)
  recommends simple language, player-paced prompts, interactive tutorials,
  readable text, contextual guidance, visible objectives, and clear interactive
  affordances.
- [Nielsen Norman Group: Onboarding Tutorials vs. Contextual Help](https://www.nngroup.com/articles/onboarding-tutorials/)
  reports that unsolicited walkthroughs can interrupt users, recommends
  contextual help that is dismissible and recallable, and stresses user
  research to determine when help is useful. This is general usability research,
  so apply it as a hypothesis to validate in the game rather than a game-specific
  rule.
