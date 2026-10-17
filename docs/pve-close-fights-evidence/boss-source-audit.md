# Boss source audit and controlled combat evidence

This is offline encounter evidence, not live-account testing. The companion
`boss-source-audit.json` records the synthetic owned saves, independent fixture
audit, source hashes, exact seeds and every result. No handler, reward settlement,
storage mutation or production save is used by the probe.

The final capture completed all 270 cases: thirty deterministic weekly cases,
144 matched world cases and 96 matched clan cases. It started at candidate
`1bfd26e12050a4573e85467c0089ccab8333f47e`; all eighteen recorded source hashes
are unchanged through completion and match the final files. The JSON has
`complete: true` and an empty `sourceChangedDuringProbe` list. Its SHA-256 is
`d9982f9001c48d1760ab5fdf67dccd3dcaf4d4734701b76d7e2ea30c655802c3`.

## Source boundaries and intended participation

| Source | Actual runtime | Intended result |
| --- | --- | --- |
| Explore ninja attacks; natural bandit/nightblade/miner | Solo-PvE, sealed ordinary receipt | Near-level trained threats; weak rolls and protected roads remain relief. |
| Nemesis, bounty hunter, robber-chain warlord, questbook/reckoning/rift bosses | Solo-PvE, explicit named source | Authored solo challenges; source seals and progression stay authoritative. |
| Final story Kage | Solo-PvE, exclusive final-kage seal | Highest solo story policy; preparation, victory, defeat and retry remain story progression. |
| Current hunt targets/packs | Tower combat embedded in a Solo lifecycle | Authored single/pack/wave hunt; ordinary Solo planner evidence does not certify these formations. |
| Weekly Boss | Solo-PvE score attack | Unlimited enemy health; 20 rounds or player defeat; three attempts per spawn. Damage earns contribution, not a boss kill. |
| Roaming world bosses | Tower, 1–3 players | Bank verified contribution against shared event HP; 20-round timeout and wipes can still contribute. A full trio launches immediately, smaller parties after 30 seconds. |
| Clan boss operations | Tower, 1–4 players | Chip the clan's persistent weekly pool in bounded assaults; the final slice can be cleared. Five attempts per member; solo fallback after two minutes. |

The roaming and clan bosses retain their authored level 80; they do not follow
the current player's HP, build or level. The optimized fixture is level 100.
Weekly built-in source levels are listed below. No claim is made that the
level-80 cooperative bosses are level-100 peer encounters.

| Source | Built-in name | ID | Authored level |
| --- | --- | --- | --- |
| World | Chicxulub | `hollow-beast` | 80 |
| World | Murogane | `hollow-gate-bull` | 80 |
| World | Donkaku | `hollow-maze-minotaur` | 80 |
| Clan | The Oni Warlord | `oni-warlord` | 80 |
| Clan | Abyssal Leviathan | `abyss-leviathan` | 80 |
| Clan | The Fallen Kage | `fallen-kage` | 80 |
| Clan | Ancient Stone Golem | `stone-golem` | 80 |
| Weekly | Ashen Dragon | `ashen-dragon` | 72 |
| Weekly | Moonshadow Oni | `moonshadow-oni` | 76 |
| Weekly | Frostfang Warlord | `frostfang-warlord` | 80 |
| Weekly | Stormveil Beast | `stormveil-beast` | 84 |
| Weekly | Deathsgate Revenant | `deathsgate-revenant` | 90 |

## Focused changes

New weekly attempts explicitly seal `weekly-boss-v1`. The exact weekly kind and
weekly guard are both required; ordinary/planner exclusions and the global
planner rollback remain meaningful. Old unsealed attempts keep their runner.
The profile keeps its authored signature and adds a bounded catalog curriculum,
legal mastery, shared level resource pools and a fixed level-gated catalog weapon.
The unlimited score target, 20-round budget, 8%-per-hit/15%-per-turn ceilings,
four-round guard/open cycle, attempts, score accounting and rewards are unchanged.

New cooperative encounters use catalog attacks and readable setup/cooldown
windows, plus existing Tower roles and counterplay. Sparse legacy boss stat
sheets left most of twelve stats at zero. Only these explicitly sealed boss
actors now spend the legal `aiStatsForLevel` budget at their own authored level
using their actual kit. HP, armor, source level and participation are unchanged;
there is no new damage multiplier or shared combat formula change. Adds retain
their authored stats. Resources use shared level pools and mastery uses the
existing rank cap. Clan global/per-mode mastery rollback switches remain honored.

World encounters keep the distinct regen, bulwark and phase-aegis defenses and
their native nova/slam/volley warnings. The generic public Tower signature is
deliberately omitted so it cannot replace those authored attacks. The existing
guard-only band seal enables visible-buff Clear/Cleanse; it applies neither an
HP band nor a stat band. Clan operations opt into the existing Tower signature,
miss exposure, charge/pillar and pylon-disruption mechanics. Their pool slice,
round deadline, regeneration cap and rewards remain intact.

These adapters add no new percentage-HP damage exception. Existing world
nova/slam/volley and Tower telegraphed signatures remain authored mechanics;
catalog jutsu still use the shared EP/mastery formulas. The final story Kage
keeps its exclusive highest solo planner policy.

## Acceptance interpretation

The score attack should require active play to retain both survival and score;
finishing all twenty rounds is not guaranteed for one fixed all-purpose policy.
Cooperative bosses should expose meaningful defeat risk when warnings and
counters are ignored, with attentive play or Hollow Shard preparation improving
survival at a measurable contribution cost. These level-80 contribution sources
are not forced into a fixed ending-HP band against level-100 teams. Surviving
with more health after strong preparation is an intended reward. The paired
observations below test these expectations rather than treating every timeout
as a loss or demanding a wipe from every optimized trio.

## Fixtures and policy

The primary stress fixture reuses `closeFightSave(100, 'stress')` and
`closeFixtureAudit`: all stat caps, acquired Earth/Wind, fifteen subscriber slots,
catalog mastery 50, a labeled observed-legacy 33-EP blade with synthetic named
Heal/Shield rolls and five explicit 2% lifesteal armor rolls. It is a strong
sustain stress test, not an exact Rill replay. Unknown custom techniques,
bloodline identity/passives and other gear rolls are not invented. No companion
or consumables are included. A twelve-slot catalog Crimson/Ashen Dragon control
is retained as complementary evidence.

Both variants receive the same fixture, policy and seed. Before uses the actual
immutable `a31087565` builders and engines; after uses the current source.
Attentive play uses public-state counters, BFS escape from marked tiles, setup,
injury-dependent sustain, add focus and legal resolver previews of immediate
damage. Rotation play retains offensive setup and direct attacks but ignores
marks, Clear, Cleanse and active healing. These are bounded policies, not optimal
players or coordinated role-specialist teams. Flicker is excluded as an attack.

The world matrix tests one and three players, zero and maximum Hollow Shard
preparation, and both policies. Two-player raids and four-player clan parties
are not sampled. Three seeds are 71041, 71178 and 71315. Weekly decisions contain
no randomness; all five built-ins are tested directly with active and wait-only
policies, comparing the old runner, planner-only and final kit separately.

## Metric limits and historical capture

Weekly health damage, shield damage and applied healing come from observed
authoritative event facts; net HP loss and minimum HP are separate. State-delta
loss is also retained: status damage or healing that nets within an event can
limit reconciliation of event facts. These values are not interchangeable.

Tower has no equivalent numeric event journal. Health loss/recovery are separate
per-action/per-boundary observed lower bounds when damage and healing net within
one resolver call. Enemy-action shield loss is separate from expiry/boundary
shield loss. `netBossHpRemoved` includes regeneration; world
`bankableTeamDamage` comes from the actual contribution tracker and is reported
separately. A world `winner: enemy` can mean the 20-round contribution timeout,
so survivor counts distinguish timeout from wipe.

The nested immutable `baseline` capture preserves the initial 80-case diagnostic.
Its team policy could select sanitized EP-1 Flicker as an attack and used weaker
escape logic; it is superseded for acceptance. The final top-level matched rows
use corrected identical policies and actual before/after engines. Historical
captures are not silently substituted for final source-hash verification.

## Measured weekly results

All values below use the same audited fifteen-slot sustain stress fixture.
Weekly combat is deterministic, so the five built-ins are compared directly
instead of inflating the case count with repeated identical seeds. Active play
uses the same policy in all three variants; waiting is a separate inactivity
control, not evidence of a competent rotation.

| Boss | Old runner: end HP / score | Final kit: rounds / end HP / score | Final minimum HP | Wait-only defeat round |
| --- | --- | --- | --- | --- |
| Ashen Dragon | 90.27% / 36,131 | 20 / 27.00% / 29,753 | 26.74% | 13 |
| Moonshadow Oni | 88.77% / 36,137 | 20 / 26.60% / 29,753 | 26.34% | 13 |
| Frostfang Warlord | 80.27% / 35,977 | 19 / 0% / 22,549 | 0% | 12 |
| Stormveil Beast | 79.93% / 35,977 | 19 / 0% / 22,549 | 0% | 12 |
| Deathsgate Revenant | 79.45% / 35,977 | 19 / 0% / 22,549 | 0% | 12 |

The planner-only intermediate does not solve sustain pressure: active ending HP
is 78.63-91.79%. The complete curriculum supplies the pressure. Ashen's final
event facts record 13,055 HP damage, 900 shield damage and 6,955 applied
healing, versus a 7,300 net HP loss. Those event facts alone omit 1,200 of the net
loss, so they must not be presented as complete damage accounting. Frostfang,
Stormveil and Deathsgate defeat this bounded policy; the evidence does not prove
that a specialized or better policy cannot finish twenty rounds. All old
wait-only controls survive twenty rounds; all final wait-only controls die.

## Measured world counterplay

Each table entry combines seeds 71041, 71178 and 71315. Survival counts are
individual players alive at terminal state, out of three solo or nine trio
observations. All final attentive trios reach the twenty-round contribution
deadline; partial casualties are shown rather than hidden by a team average.

| Boss | Players | Shards | Old attentive survival | Final attentive survival | Final rotation survival | Final attentive end HP range |
| --- | --- | --- | --- | --- | --- | --- |
| Chicxulub | 1 | 0 | 3/3 | 0/3 | 0/3 | 0% |
| Chicxulub | 1 | 60 | 3/3 | 3/3 | 1/3 | 65.01-71.63% |
| Chicxulub | 3 | 0 | 9/9 | 8/9 | 0/9 | 0-100% |
| Chicxulub | 3 | 60 | 9/9 | 9/9 | 8/9 | 81.72-100% |
| Murogane | 1 | 0 | 3/3 | 0/3 | 0/3 | 0% |
| Murogane | 1 | 60 | 3/3 | 3/3 | 1/3 | 78.57-91.07% |
| Murogane | 3 | 0 | 9/9 | 9/9 | 0/9 | 35.65-93.90% |
| Murogane | 3 | 60 | 9/9 | 9/9 | 8/9 | 79.22-100% |
| Donkaku | 1 | 0 | 3/3 | 0/3 | 0/3 | 0% |
| Donkaku | 1 | 60 | 3/3 | 3/3 | 1/3 | 25.03-32.82% |
| Donkaku | 3 | 0 | 9/9 | 7/9 | 0/9 | 0-98.02% |
| Donkaku | 3 | 60 | 9/9 | 9/9 | 7/9 | 78.17-100% |

Across the entire matched world matrix, attentive player survival changes from
72/72 to 60/72, and rotation survival from 54/72 to 26/72. The difference is not a
gear swap: both policies use the same saved fixture. Attentive play escapes
marked tiles, Clears visible defenses and Cleanses harmful statuses. Ignoring
those mechanics wipes every unprepared trio, while attentive trios retain
survivors. Strong preparation appropriately restores safer outcomes against
bosses twenty levels below these players.

Survival has a contribution tradeoff. On Chicxulub seed 71041 with sixty shards,
an attentive solo survives twenty rounds at 71.28% HP and banks 21,209 damage;
rotation banks 31,540 but dies in round seventeen. The attentive observation
separately records 11,263 HP-loss lower bound, 8,391 recovery lower bound and
2,925 shield loss during enemy actions. These do not become an aggregate damage
percentage. Donkaku's prepared attentive solos bank 14,850-15,620 and survive;
rotation banks 31,540-43,298 with only one survivor across three seeds.

## Measured clan counterplay

All old attentive and rotation runs clear the 24,000-HP assault slice. The
following final results combine the same three seeds; a surviving solo that
reaches the deadline banks partial pool damage without clearing its slice.

| Boss | Players | Attentive slice clears / survivors | Rotation slice clears / survivors | Attentive end HP range | Rotation minimum HP |
| --- | --- | --- | --- | --- | --- |
| Oni Warlord | 1 | 1/3 / 3/3 | 0/3 / 0/3 | 56.85-91.30% | 0% |
| Oni Warlord | 3 | 3/3 / 9/9 | 3/3 / 9/9 | 75.21-100% | 64.70% |
| Abyssal Leviathan | 1 | 0/3 / 3/3 | 0/3 / 0/3 | 58.32-82.90% | 0% |
| Abyssal Leviathan | 3 | 3/3 / 9/9 | 3/3 / 9/9 | 88.29-100% | 23.95% |
| Fallen Kage | 1 | 0/3 / 3/3 | 0/3 / 0/3 | 45.07-75.60% | 0% |
| Fallen Kage | 3 | 3/3 / 9/9 | 3/3 / 9/9 | 86.96-100% | 38.57% |
| Ancient Stone Golem | 1 | 0/3 / 3/3 | 0/3 / 0/3 | 50.31-65.54% | 0% |
| Ancient Stone Golem | 3 | 3/3 / 9/9 | 3/3 / 9/9 | 77.66-100% | 22.76% |

The source kit now makes ignoring counters dangerous even with strong sustain:
all twelve rotation solos die in rounds 14-18, while all twelve attentive solos
survive their 18-20-round assault windows. The Oni Warlord attentive solo banks
18,209-24,000 damage; Abyssal Leviathan 12,968-13,541; Fallen Kage 15,007-19,407;
and Ancient Stone Golem 17,742-19,950. Damage banks and survival are separate
success dimensions. One attentive Oni solo clears; the others preserve health
by spending actions on mechanics and recovery.

Optimized level-100 trios still clear all four level-80 slices under both
policies. This is an explicit limitation, not evidence of trio wipe risk on
clan bosses. Counterplay substantially improves their worst health margins,
but three maxed damage dealers can finish the bounded slice before a wipe.
The old trios clear in 5-7 rounds; final trios take 7-11. No four-player party,
level-80 peer fixture or coordinated support composition was measured. World
raids supply the demonstrated unprepared-trio wipe comparison; clan results
support solo risk, recovery, contribution tradeoffs and preserved group access.

## Regression coverage

The focused kit, weekly policy, world-constructor and clan-constructor tests pass
14/14. They check legal budgets/catalog attacks, unchanged HP/armor/level,
native warnings, exact weekly policy gating, guard ceilings and both global and
clan-specific mastery rollback switches. Existing weekly authority, retry,
recovery, generation, vitals and reward tests pass 32/32. These source tests
complement the parent change's final full-suite CI; offline combat probes do not
execute handlers or settlement.

## Reproduction

Use Node matching `.nvmrc` and an immutable source archive of current-main
`a31087565` at `../pve-current-main` (or pass `--baseline-root`). Expose the
repository dependencies to the immutable archive without modifying its sources:

```powershell
$env:NODE_PATH = Join-Path (Get-Location) 'node_modules'
node --import tsx scripts/pve-boss-source-probe.ts --fixture stress --seeds 3
```

The JSON includes before/after source hashes and flags any measured source that
changes during execution. Final interpretation must use a complete capture with
an empty `sourceChangedDuringProbe` list. This evidence does not certify encounter
rewards by simulation; the existing receipt/retry/reward regression suites cover
those invariants independently.
