# Pet Arena — player-controlled battles

Pet Arena has an **Enter player-controlled battles** entry for unrated sparring.
The **Pet Colosseum ranked queue** uses the same command system. Two signed-in
players build four-pet squads, share a sparring code or find a ranked opponent,
inspect each other's sealed team sheets,
choose private leads, then lock two simultaneous orders each round. The existing
cinematic arena plays only the server's committed script.

This is the implemented first slice of the [balance plan](pet-battle-balance-plan-2026-10-10.md),
ruleset `pet-tactics-v1` (an internal version identifier, not the product name).
Sparring is unrated. New ranked matches update both participants' Pet Elo only
after the committed battle ends. Neither path spends currency or battle items,
and loan pets do not mutate owned-pet progression. Everyone can choose the same
12 loan species. Retained ranked receipts keep their original sealed authority.
Beastfront remains AI-driven on its separate Warfront resolver and offline ladder.
The integration is local; no deployment is claimed.

## Competitive rules

| Decision | Implemented rule |
| --- | --- |
| Squad | Four distinct species; two active slots and two reserves. |
| Builds | Four distinct equipped moves from each species' eight-move pool; separate weak basic and fixed species signature. At least one repeatable attack; at most one control move and one off-element attack. Two authored presets per species. |
| Stats | Level-50 competitive profiles with separate physical/special axes. Allocate exactly 49 points, at most 25 in an attribute. Rarity has no damage multiplier. |
| Allocation | Vitality adds 0.6% HP per point; Power adds 0.6% offensive stats and preserves that damage investment through the bounded species formula; Guard adds 0.4% defenses per point and one passive stamina per ten points; Agility adds 0.4% speed per point. |
| Items | Equal-access Reserve Cell, Ward Charm or Focus Lens. No consumables or owned gear. |
| Preview | Both full move/stat/trait/item sheets are public. Lead choices stay private until both lock or the 45-second preview deadline. Unlocked leads default to the first two squad pets. |
| Planning | One action per active pet; edit both locally, review and lock together. Orders are immutable and private. The other seat sees readiness only. |
| Clock | 45 seconds, shared start for both players. After a round, both playback acknowledgements open planning together; a 35-second upper bound prevents indefinite playback stalls. Reconnect preserves the same deadline and accepted orders. |
| Missing orders | Guard when affordable, otherwise Rest. Three consecutive missed rounds concede; if both reach three together, draw. No AI takes over a player seat. |
| Rotation | Switches precede attacks; the incoming pet inherits the slot and forfeits an attack. Hostile aim stays bound to that slot. Earlier KOs leave later attacks aimed at an empty slot; reserves reinforce at round end. |
| Defense | Guard, Perfect Guard and Intercept resolve in the defensive phase before attacks. Guard starts at 12 stamina/50% block; repeated uses cost more, up to 30, and block only 30% then 15%. Perfect Guard has a three-round cooldown. Intercept takes the partner's single-target attacks at 70% damage. |
| Resources | 100 stamina; field recovery 8 plus Guard allocation, bench recovery 12 plus Guard allocation, Reserve Cell adds 4 on the bench. Rest adds 30, Scout adds 5 more, and heals nothing. Moves require sufficient stamina. |
| Signatures | Full meter, three completed field rounds, earliest round four, and 30 stamina; one team signature per round. Damage signatures target one slot. Unprepared damage is capped at 60% target maximum HP; Rally, Expose or matching Sky permits up to 75%, before defense. Species also have healing, shield and power-boost signatures. |
| Meter | First cast earns 15 passive while active, at most 10 for a useful action and 10 from normalized direct damage received, capped at 35 per round. Bench pets earn no meter or holds. After casting, meter comes only from combat. |
| Support | Expose enables focus fire; Rally enables pressure; Aegis absorbs direct damage; Mend restores HP; wounds halve healing; Purify clears harmful conditions. Sky replaces the previous weather. Buffs do not stack. |
| Control | Bind denies one action. A faster Purify can rescue a queued action. Independent control immunity survives cleanse and cannot be displaced by another condition; no repeat bind for three following rounds. |
| Endings | Knockout of all four pets, concession, or inactivity. From round 18, attrition affects field and bench and healing decays. Round 30 compares remaining team HP fractions; exact ties draw. |

Server-authored damage ranges describe the current public matchup before Guard,
protection, shields or a switch. They do not expose an opponent's selected action
or promise the target will remain in place. All health changes, move legality and
outcomes come from the server.

The command menu uses portrait selectors for the active pair, element-colored
move cards with costs and availability reasons, and explicit target cards showing
remaining HP. Guard/Rest and reserves have separate categories. The selected
action panel explains effects and conditional damage; both orders remain local
until the shared lock. Mobile keeps the timer, pet selectors and lock control
available while scrolling actions. Battle intel opens in a keyboard-dismissible
dialog, keeping expanded team sheets away from the playfield.

The command surface uses original blue-black ink/slate material artwork, the
project's display/body fonts, enlarged curated pet poses and painted elemental
crests. Support actions have distinct effect glyphs. The health plates share the
same restrained material palette; complete trait/item descriptions remain in
Battle intel. Both friendly planning cards show labeled HP and energy bars with
current/maximum values. The duplicate friendly health row is absent during
planning; it returns over the arena during playback to show live resource changes.
The renderer measures only the command surface, so the arena meets the menu
without an empty reserved band. A small mobile lens shift clears the overhead controls. The background
has quiet central material and subtle edge markings, without a fixed ornamental
frame. These overrides apply only to player-controlled Arena battles.
Artwork provenance and the final generation prompt are in the
[asset notes](../shinobij.client/src/assets/pet-arena/README.md).

## The 12-pet slice

| Pet | Element | Role | Signature purpose |
| --- | --- | --- | --- |
| Cinder Cub | Fire | Striker | Physical burst |
| Ripple Seal | Water | Medic | Active-team healing |
| Gale Chick | Wind | Scout | Physical burst |
| Spark Pup | Lightning | Scout | Physical burst |
| Pebble Tortoise | Earth | Sentinel | Active-team shields |
| Ember Wolf | Fire | Balanced | Special burst |
| Tidal Selkie | Water | Caster | Special burst |
| Storm Hawk | Wind | Caster | Special burst |
| Bolt Fang | Lightning | Striker | Physical burst |
| Granite Tortoise | Earth | Balanced | Special burst |
| Abyssal Leviathan | Water | Sentinel | Active-team healing |
| Eclipse Kitsune | Wind | Balanced | Active-team power boost |

The presets are legal alternatives, not a claim that both builds have equal
competitive win rates. Trait and kit roles deliberately differ across species;
rarity is presentation, not an advantage purchased with progression.

## Authority and integration

- [Roster and stable moves](../shared/pet-tactics-roster.ts) own prototype content.
- [Shared contract](../shared/pet-tactics-contract.ts) owns wire types.
- [Engine](../api/_pet-tactics/engine.ts) owns deterministic combat and public ranges.
- [Session lifecycle](../api/_pet-tactics/session.ts) owns preview, private locks,
  common deadlines, playback acknowledgement and transcript projection.
- [Authenticated endpoint](../api/pet/tactics.ts) mounts at `/api/pet/tactics`, uses
  uncached `pet:tactics:*` KV records, and fails closed under the distributed room
  lock. Admission also serializes active-room pointers. Authenticated identity,
  not body names, selects the seat. The persisted record seals the ruleset.
- [Arena host](../shinobij.client/src/components/PetTacticsArena.tsx) owns build and
  order UI. [Existing renderer](../shinobij.client/src/components/PetShowdownBattle.tsx)
  owns presentation. It neither selects enemy orders nor resolves damage.
  Ranked search and unresolved fights lift an active signal through Pet Ladder
  to App's navigation/encounter guards. Cancelling search releases it. Fullscreen
  state also reaches App's chrome and music handling; both clear on builder return.
  Cinematic planning projections exclude expired conditions/weather.
- [Runtime registry](../shared/runtime-mode-registry.ts) records the prototype's
  separate authority, sparring policy and ranked settlement policy.
- [Ranked admission and terminal authority](../api/_pet-tactics/ranked.ts) own
  matchmaking, durable admission repair and the new `pet-arena-player-v1` control
  marker. [Ranked queue](../api/pvp/pet-ranked-queue.ts) sends all new joins here.
  [Pet Ladder host](../shinobij.client/src/components/PetLadderQueuePanel.tsx)
  mounts the player's command UI; retained proofs use their historical replay.
  Historical replay recovery has no new-match admission or lineup builder.
  Returning to an idle queue or finding a player-controlled room mounts the
  command host instead.
- [Rating settlement](../api/pet/battle-result.ts) reads the actual committed
  terminal, writes a durable two-save intent, and applies both ratings with
  protected in-save receipts. Premature reports are refused; client outcomes
  cannot pick the winner. [The historical AI resolver](../api/pet/_ranked-duel.ts)
  explicitly rejects player-control tokens.

Unsettled ranked rooms, proofs and discovery pointers have no TTL. Expiring the
old reservation cannot dodge a result or open another match. A write-ahead
admission record repairs either missing seat without resetting commands. After
settlement, the room transcript has a 24-hour retention period; acknowledgement
releases only the participant's matching completed pointer. App adopts the
server's versioned character before returning to the ranked builder.

Accepted command retries compare canonical batches, independent of JSON key
ordering. Concurrent duplicate requests cannot resolve twice. A rejected late
action still persists a deadline transition. Public views allowlist fields and
never serialize a rival's private orders, unannounced leads, seed or RNG.

## Reproduce the checks

From the repository root, after installing locked dependencies:

```powershell
node --import tsx --test api/_pet-tactics/engine.test.ts api/_pet-tactics/session.test.ts api/pet/tactics.test.ts
node --import tsx --test api/pet/ranked-player-control.integration.test.ts
node --import tsx scripts/pet-tactics-balance-audit.mts
node --import tsx scripts/pet-tactics-matchup-audit.mts
node --import tsx scripts/pet-tactics-qa-server.mts
```

The last command starts a loopback-only server. In another terminal:

```powershell
node shinobij.client/scripts/verify-pet-tactics.mjs
# Ranked queue, human commands, versioned saves and both Elo receipts:
$env:PET_ARENA_QA_RANKED = '1'
node shinobij.client/scripts/verify-pet-tactics.mjs
```

Use an installed Playwright browser; set `PLAYWRIGHT_BROWSERS_PATH` to its cache
when the machine's default browser cache differs. The harness exposes Alice/Bob
only, signs local player authentication and uses isolated memory storage. It
serves the actual production queue, command, watch and settlement handlers plus
the production UI. It is not mounted by the production server.
The script uses real DOM choices in separate desktop and mobile browser contexts,
locks both seats, reloads one after locking, plays to a terminal result and captures
screenshots. It does not simulate a human playtest.

Evidence is saved under [prototype audit artifacts](audits/pet-tactics-prototype/):
`balance-report.json`, `ranked-browser-report.json`, desktop/mobile builder and
battle captures, and the result capture. `ranked-command-preview-report.json`
records the final material/background preview independently of match settlement.
Server and production client builds pass, as
do 137 selected combat/ranked/runtime/route/Beastfront regression tests, including
22 combat/lifecycle/endpoint tests and five production-handler ranked tests.
The browser check verifies enemy plates and friendly resource cards fit the
desktop and mobile viewport, the arena meets the command deck without a reserved
band, resources update after a round, and locked orders survive a reload.
The latest full ranked automated duel completed 14 player-commanded rounds and
a server knockout win. Alice/Bob finished at 1012/988 Elo, each with exactly one
receipt and save version two. Currency and owned pets were preserved. There
were no browser errors or asset failures. An additional 25 camera, playback,
HUD, timer and postprocessing regression tests pass. Earlier unrated evidence
remains identified separately in the audit notes.
The balance audit uses public-state heuristic
policies, paired seats/seeds and 960 matches. Its roster combinations repeat;
its descriptive intervals are not certification of a competitive meta. The 480
unprepared damage-signature samples contain no full-health KOs, and the earliest
observed signature is round four.

The [expanded integration/balance review](audits/pet-tactics-prototype/review-2026-10-10.md)
adds 12,528 randomized, paired and controlled-substitution matches plus 24,192
signature probes across allocation extremes and setup/Guard states. It records
source hashes, balance findings and remaining tuning watch items. These are
controlled simulations, not optimized human builds or final meta certification.

## Remaining release gates

1. Human two-player sessions comparing builds, lead choices, focus fire, defensive
   reads and mistakes. Confirm several useful builds and counterexamples per pet.
2. Broader randomized squads and held-out opponents, allocation/item sweeps,
   species matchup coverage, sustain/control loop checks and latency playtests.
3. Production KV/two-worker/redeployment verification and operational rollout.
   Pure persisted-state and fresh-handler recovery are tested locally; a live
   database or deployment failure drill has not been performed here.
4. Expand authored move pools and budgets to the full roster, add teaching NPC
   encounters, and migrate the remaining legacy casual entry points. Ranked
   admission and settlement now use committed human rounds. Historical autoplay
   receipts must remain on their sealed authority; new player-controlled matches
   cannot be rated through the headless resolver.

The prototype provides playable counterplay and validation infrastructure. It is
not yet full-roster balance certification or a finished production-quality launch.
