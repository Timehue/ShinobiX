# Hired war mercenaries: source coverage and offline pressure

This follow-up covers the five **War Resource** bands: Ronin75, Reaver80,
Shadow85, Oni95 and Warlord100. It does not change the retired Honor Seal
instant-damage hire, Tower squad recruits, human war opponents or sleeper-camp
KO settlement. A name alone does not opt a fighter into this policy.

## Authoritative route trace

- `api/village/war-merc.ts`: quotes and hires `WR_MERC_TIERS`, with the same
  prices, comeback/Barracks discounts, band sizes, leases and war binding.
  Its read-only tier/context projection now includes the actual combat role.
- `api/_merc-roam.ts` and `api/sector/merc-roam.ts`: synthesize visible hostile
  bands from active leases, validate the encountered band and resolve through
  `deployOneMerc` / `deployMercVillageWar`. Roster entries expose the same role.
- `api/_merc-auto.ts`: manual deploy, roaming engage and autonomous live-target
  deployment share `claimAndResolveMerc`, then `resolveMercBattle` in
  `api/towers/_merc-fighters.ts`. Player snapshots still hydrate from the real
  saved loadout. Save/war locks, village checks, claim/refund order, target
  cooldown, instance checks, sector score weights and village HP floors remain
  unchanged. The current route only targets saved human characters; it has no
  mercenary-versus-mercenary combat route.
- Sleeper camps are a separate existing hospital/relocation settlement. They
  do not run this fight, spend a band member or receive these combat changes.

These are **headless automatic battles on both sides**. Their participation
model is preserved. The player prepares a loadout, chooses deployment/tier and
war participation; there is no live dodge/interrupt prompt in this adapter.
Adding one would require an interactive session, presence, timeout and war
settlement design beyond this focused patch. The public combat-profile fields
are additive API preparation information; this patch does not claim that an
existing client renders every new field. Returned internal combat logs include
a preparation description. No rewards or participation rules change.

## Concrete combat correction

The old mercenary had4300–5000HP,1400CP/1000SP and five hand-authored attacks
with seven-round cooldowns. Its catalog IDs sometimes carried different tags
and both resource costs. Equipped weapons were never chosen by the Tower AI.

The new builder uses shared level HP/CP/SP, two learned natures (Earth/Wind),
9/10/11/12/12 catalog techniques, rank-capped mastery, real cooldowns and shared
one-bar costs. There is no mastery baked into EP, bloodline multiplier, item
damage multiplier or player-state scaling. The Ronin equips the legal22EP
Elderbranch Katana; higher bands equip the legal25EP Worldsplitter Katana.
The catalog weapon's single offense bonus is applied once, like player
hydration. Existing0.35 raw armor remains; HP equals the ordinary player-level
pool rather than an inflated boss pool.

Distinct preparation threats are real catalog mechanics: Ronin uses Wound,
Poison and damage focus; Reaver adds a Siphon rotation; Shadow adds a second
Wound attack; Oni adds a Reflect stance; Warlord adds Absorb instead. Existing
status durations, expiry, Clear, Cleanse, range and resource rules resolve
normally. Veteran NPC Clear/Cleanse decisions read public current statuses,
never hidden input. All five live tiers are beyond the onboarding hit ceiling.

The Tower chooser selects a hand-weapon action **only** for an AI actor with no
human owner and the server-sealed hired-war profile. A40AP weapon can pair with
a60AP jutsu. Other NPCs, human-controlled Tower actors, headless saved human
defenders and PvP formulas keep their existing policy. In particular, the
saved human defender's existing automatic policy still does not choose weapons
or react like an attentive human. Do not interpret these probes as an optimal
live player policy or as a live-account test.

## Reproduction and evidence interpretation

`scripts/war-mercenary-pressure-benchmark.ts` compares the archived current-main
`a31087565df43d4b34f81f5b5bdb5acf5841b724` mercenary builder with this adapter,
using the same current Tower executor, identical legal sealed defender and
seeds0/1/2. The old builder lacks the new explicit opt-in and retains its old
automatic policy. This isolates the intended adapter changes after the owner
gear update. [The final JSON](war-mercenaries.json) has60 rows,
`complete: true` and `unchanged: true`; all22 recorded source/fixture hashes
were rechecked against the final local files with zero mismatches. The runner
fails if a source changes during measurement.

The fixtures come from `closeFightSave` and pass `closeFixtureAudit` before
combat: matched-level optimized75/80/85/95/100;100 current-forge twelve-slot
sustain;100 fifteen-slot legacy33EP stress;100 narrow; and the same100 stress
defender against lower75/85 bands. The stress capacity is supported by its
explicit Patreon entitlement. Exact acquired items, jutsu, mastery, stats and
assumptions are retained in the JSON audit. None is an exact Rill replay: Rill's
custom techniques, other gear rolls and bloodline passives remain unknown.

HP loss and HP recovery are observed separately at action and turn boundaries;
shield removal during attacks is separate from removal/expiry outside attacks.
These are finite differences, so damage/healing within one action can cancel:
the reported losses/recovery are lower bounds, **not gross damage totals**.
Minimum/final HP are net outcomes, not a claim of raw incoming damage. Actual
action lists and retained runtime logs support inspection. The deterministic
headless policy currently makes these seeds repeat the same outcome; three
seeds are replay checks, not three independent random samples.

## Acceptance and matched results

For this paid optional headless challenge, the prepared100 stress control
should have a viable win with meaningful damage pressure (roughly25–60%
minimum HP and8–18 rounds), and weaker preparations should carry real defeat
risk. This is an empirical calibration band for this declared fixture, not a
target the runtime enforces. The same build should have a comfortable win over
the lowest75 band. Special anti-sustain bands need not be a monotonic ladder
against every build; low-level random relief is a different encounter source.

All seeds0/1/2 repeat the figures below. HP values refer to the defender's actual
health, with a10000 cap at100. The lower75/80/85/95 historical optimized fixtures
have eight slots; the100 optimized control has twelve. Those lower-level losses
do not establish that a full-capacity prepared build cannot win.

| Defender / mercenary | Before outcome, rounds, minimum/end HP | After outcome, rounds, minimum/end HP |
| --- | --- | --- |
|75 optimized /75 Ronin|Win,7,2324/2374|Defeat,10,0/0|
|80 optimized /80 Reaver|Win,10,1630/1673|Defeat,9,0/0|
|85 optimized /85 Shadow|Win,7,3120/3167|Defeat,10,0/0|
|95 optimized /95 Oni|Win,7,4750/4811|Defeat,12,0/0|
|100 optimized12 /100 Warlord|Win,6,7257/7325|Win,13,2638/3117|
|100 sustain12 /100 Warlord|Win,5,8081/8081|Defeat,13,0/0; merc176HP|
|100 stress15 /100 Warlord|Win,5,9431/9699|Win,14,3440/3899|
|100 narrow /100 Warlord|Win,6,6681/6681|Defeat,13,0/0; merc1813HP|
|100 stress15 /75 Ronin|Win,4,9502/9502|Win,11,6101/6101|
|100 stress15 /85 Shadow|Win,5,9431/9699|Win,12,2319/2461|

The after Warlord/stress fight records7638 observed HP loss,1537 observed HP
recovery,750 shield removed during attack actions and750 removed outside attack
actions. Its final3899HP is therefore net loss6101, not7638 raw incoming damage.
The before case records569 observed HP loss and268 recovery, with343 attack
shield removal and407 outside-attack shield removal. The after sustain12 defeat
records11965 observed HP loss and1965 recovery; its almost-dead opponent shows
a close damage race rather than an automatic immunity to sustain. The supplied
JSON includes the per-action measurements and their cancellation limitation.

In that same stress matchup the old NPC performs two jutsu and eight movement
actions in five rounds, with no weapon swing; the new NPC performs twelve
jutsu (including stances), two weapon swings, six basics, two Clears, one
Cleanse and four moves over fourteen rounds. The old NPC still has675SP/1075CP
when defeated, so resource exhaustion did **not** explain this short baseline.
Shared pools correct legal endurance; the measured rotation, setup and public
status counters explain additional offensive turns. Observed HP loss plus
attack-time shield loss per reported round rises from182.4 to599.1; this is an
observed lower-bound pressure measure, not gross direct damage or a promised
per-turn amount. Ordinary player-level HP gives those cooldown tools time to
matter without an arbitrary boss HP multiplier.

The85 Shadow's extra Wound pressure is especially effective against this
sustain rotation; it leaves less HP than the100 Warlord despite its smaller
pool. This is a measured matchup limitation, not evidence of a universal tier
win-rate ordering. An attentive human policy, different prepared build, exact
Rill custom kit, live-account play and an interactive mercenary battle remain
outside these automatic-route results.

Scoped validation: **65/65 tests passed** across the mercenary builder/policy,
roaming authority, hire quotes, war-instance ownership, automatic deployment
and AI-side sector scoring suites. Final-head full repository/CI validation
belongs to the containing PR. No live account, purchases, rewards or production
data were changed.
