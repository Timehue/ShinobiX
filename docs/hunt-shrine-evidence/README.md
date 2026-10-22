# Hunt and shrine combat, 2026-10-18

Base: `33e0490311dc2edd9cd7f8425e5c8fe0d7e0ef28` (`origin/main`).

## Diagnosis and scope

Hunt formations are built in `api/solo-pve/_hunt-combat.ts` and run the embedded
Tower engine. They bypass the Solo planner used by road encounters. The Tower
chooser ignored targeted zero-damage utility, did not use Flicker as movement,
and withheld the catalog's 60-AP attacks for two easy-band opening rounds. All
targets are releveled to the player; contract ranks did not change that chooser.

Hollow Gate shrine fights are built in `api/hollow-gate/_encounter.ts` with kind
`hollow-gate`. They ran the legacy Solo loop, including its priority Basic Heal.
Their distinct kits and existing floor director remain in place.

## Changes

- New single/wave hunts and level-31+ simultaneous packs seal `hunt-v1` on enemy actors, including pending waves. The hunt-only
  chooser previews ordinary legal actions through Tower `applyAction`. It scores
  actual damage, utility, and useful movement; no player loadout is inspected.
- D contracts and levels 1–15 use one-step choices. C/B use two steps; A/S use
  three. A decision previews at most 96 resolver calls, retaining three search
  states. Rank comes from the authoritative mission requirement.
- All easy-band tactical hunts approach/prepare on round 1, begin basic attacks
  on round 2 and retain the original round-3 heavy opening. The log discloses
  both timings and existing Cleanse/Clear counters. Medium+ bands retain round 1.
  Rank changes planning depth, rather than creating a level-16 burst cliff.
- Easy simultaneous packs (levels 1-30) retain their existing chooser and round-3
  heavy opening. Several enemies already chain turns in these encounters;
  applying the stronger utility chooser compounded pressure in low-level probes.
- New shrine sessions seal `shrine-v1`, opting only that host into the existing
  legal Solo planner. Basic Heal is a lifetime choice budget: once for ordinary,
  ambush and beast encounters, twice for elite/boss. A pure healing/defensive
  technique prevents another such choice in the same and next round. Damage
  techniques, Clear/Cleanse, movement and finishers remain available. The
  opening log discloses the support budget and counters.
- Hunt admission rechecks live combat and hostile choices after asynchronous
  replies. A synchronous hunt reservation blocks ambient presentation before
  React commits. Existing encounters/owed receipts remain intact; a hunt that
  loses admission can be retried from its durable server trail.

HP, stat curves, armor, rewards, AP costs, cooldowns, catalog EP, mastery and
damage guards are unchanged. There is no second scaling pass. Public Towers,
roads, weaker road rolls, PvP and old unsealed sessions retain their policies.
Shrine planner rollback uses the existing `DISABLE_PVE_AI_PLANNER` switch.

## Deterministic balance evidence

Run `node --import tsx scripts/hunt-shrine-balance.ts <output.json>`.
`balance.json` contains 80 paired comparisons: levels 5/17/50/100, two catalog
builds, four hunts, shrine ordinary/elite/final-floor boss, and the three hostile
shrine wanderer kits. Each pair has identical fighter stats, HP, mastery, skills,
resources, board and seed; only the chooser changes. Regression tests assert
those invariants and legal resources, support budgets, finishing intent,
deterministic termination, range, seals, cooldowns, HP gates and scope isolation.

The offense fixture uses six damaging techniques. The sustain fixture uses four
damaging techniques plus Absorb/Reflect/Lifesteal support. Both include catalog
Siphon techniques. Level 17 uses INT 640 and Genjutsu offense 570 before gear.
Lower levels wear Cloth Robe; levels 40+ wear a six-piece Bulwark set. The player
uses a fixed cast rotation, not an optimal planner; it does not Clear, Cleanse,
Basic Heal, use items, or strategically kite. No bloodline, pet or relic is added.
Hunt minimum HP is sampled between commands; shrine minima include enemy events.
These original profiles are synthetic engine stress comparisons, not normal
progression allocations: the level-17 profile spends 5,090 raw stat points,
versus `earnedForLevel(17) = 3,273`. Use the exact-budget matrix below for ordinary
hunt accessibility. Actual Buster/Rill saves were not imported.

Run `node --import tsx scripts/hunt-shrine-balance.ts docs/hunt-shrine-evidence/formation-balance.json --formations-only`
for 32 additional paired comparisons: three-enemy simultaneous packs and sequential
waves, Hawk/Lizard, both builds and all four levels. Easy simultaneous packs have
identical before/after outcomes and pressure. These fixed-rotation fixtures already
lose those packs under the old chooser; this change does not claim to fix their
existing difficulty. Level-5 sequential waves remain wins in both builds.

`--no-sustain` writes 40 additional single/shrine pairs using eight catalog
skills: six damaging techniques, a pure offensive debuff and Flicker. It has no
Heal, Siphon, Lifesteal, Absorb, Reflect, Shield, Increase Heal or Decrease Damage
Taken technique. See `no-sustain-balance.json`. All level-5/17 single hunts,
ordinary/elite shrine and wanderer fixtures still win; the final-floor boss
already loses in both. An earlier candidate's level-17 Frost Wolf win ended at
42 HP; that candidate was rejected after the progression-budgeted checks below.
No skill's catalog tags, costs, mastery or effect power are modified to make
these fixtures. The original offense/sustain reports remain reproducible.

## Ordinary hunt accessibility

Frost Wolf is an ordinary repeatable C-rank hunt, unlocked at level 15/Hunter
Rank 1, not an elite. The earlier round-2-heavy candidate created a real
level-16 difficulty cliff. Restoring round-3 heavies helped, but developing
level-20 builds still lost because Flicker enabled extra early basic attacks.
The final preparation round removes that opening chain while keeping useful
utility, movement and later pressure. No combat number or shared guard changed.

Run `node --import tsx scripts/hunt-accessibility-balance.ts docs/hunt-shrine-evidence/accessibility-balance.json --expanded`.
The file contains 1,035 paired comparisons across levels 15/16/17/18/20/30/31/50,
three actual hunt-run seeds, gear, mastery and action choices. Raw allocations
exactly conserve `earnedForLevel` and obey `statCapForLevel`; mastery is capped,
with developing mastery-10 probes. Builds cover balanced/focused Ninjutsu,
focused Genjutsu with only two non-Siphon attacks (a sparse-kit stress case),
and six mixed attacks with raw INT 640/Genjutsu 570 and the remaining legal
points distributed. The matched build is used only through level 20.

Gear is either the original robe/Bulwark stress gear or five standard level-5
Reinforced shop pieces (1,245 ryo), hydrated normally. There are no event item
variants, bloodlines, pets, relics or items. All hunts have a neutral opening;
live trail quality can instead corner or enrage the target. The three policies
are damage order, offensive debuff plus reverse damage order, or visible
counterplay. Counterplay adds legal Clear for active shields/defense, Cleanse
for harmful statuses, and universal Basic Heal below 45%, taking a legal
finisher first. The loadouts contain no healing/Siphon skills; only the first
two policies are strict no-heal tests. Accepted counters are counted in JSON.

All Reinforced counterplay cases at levels 15-20 win: Frost Wolf 96/96, Ash
Lizard 24/24, Wild Boar 24/24, including developing mastery. At level 17,
Reinforced complete-kit capped builds end at 582-1,212 HP across the tested
choices. Developing level-17 balanced/focused/matched builds end at 564-582 HP
with simple visible counterplay; they use Clear once and no Basic Heal.
Developing level-20 counterplay wins remain tight at 72-100 HP for those three
builds (legacy 234-255 HP); this is a remaining live-play acceptance concern.
Some damage-only/sparse-kit choices still turn narrow legacy wins into losses.
Level-30 developing and level-31/50 fixtures already lose under both choosers.

Multiple seeds often produce identical deterministic outcomes. These are
controlled comparisons, not statistical win rates or live player replicas.
All before/after builds copy the new start warning; the legacy comparison
removes only the policy seal, so copied warning text is not legacy evidence.
Representative live Buster/Rill and final Warden playtests remain necessary
before deployment or broader tuning.

## Integration audit

Actual hunt starts run through world mission authority, `ai-fight-start`, the
generic Solo encounter seal, `attachHuntCombat`, and the embedded Tower runner.
New target and stage-0 formation missions use this route. Legacy stage-1/2 chain
continuations keep the existing Solo standard runner; generic/Apex fights retain
their existing `raidAi` runner. There is no additional stat/mastery scaling step.

Shrine shinobi ordinary, elite, final boss, ambush, beast and hostile wanderer
starts seal the shrine policy. Pet Showdown and card engines remain separate;
switching an untouched pet encounter to shinobi builds a fresh sealed session.
Actions, state reads and resume restore persisted sessions, rather than rebuilding
their actors or replenishing support budgets. Old unsealed sessions stay unchanged.

Stored-session regressions cover every live/pending hunt actor across levels
5/17/30/31/100 and all formations, shrine counter persistence through an actual
action and duplicate move token, and old-session preservation. Independent checks
also exercised real start/action/state/resume handlers against isolated JSON memory
storage (12 hunt cases and all five shrine kinds). Rewards, completion receipts,
flee/abandon, expiry and cleanup retain their existing authorities.

All level-100 fixtures already lose under the legacy chooser. Their paired
results measure behavior and pressure, not max-level win-rate acceptance.
These fixtures are not Buster/Rill save replays. The recorded live Warden was
untested; the offline final-floor boss is covered. Production profile data and
the complete player builds were not imported. A representative live playtest
with those actual builds is still needed before deployment or broader tuning.

## Validation

Independent review found and fixed a ranged-reach scoring error and a warning
timing mismatch. The fresh final integration audit found no blocking defect:
repository runs passed 98/98, 94/94, 10/10 and 76/76 tests, plus 17/17 custom
real-handler round trips. This review includes the easy-pack exception and checks
scope isolation, AP/resources, mastery/scaling, persistence, retries and cleanup.
The final preparation candidate passed a separate independent 36-test run and
the full accessibility matrix review. The regression suite explicitly covers
developing level-20 counterplay, not only a fully trained level-17 build.

Final full-suite, build and browser results are recorded in the PR. The first
full unit run exposed two integration guards (test-fixture location and map
line budget); both were corrected without relaxing either guard. No production
data, credentials, schema, or deployment settings were changed.
