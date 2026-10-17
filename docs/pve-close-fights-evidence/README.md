# PvE close-fight follow-up to PR421, on gear PR424

This follow-up starts from main `a31087565df43d4b34f81f5b5bdb5acf5841b724`. It does not reuse the pre-gear-overhaul acceptance numbers as current balance evidence. All combat measurements are offline synthetic fixtures and real production constructors/resolvers. No live account, credential, purchase, reward, or production save was changed.

## Acceptance and interpretation

The validation bands below judge a distribution, not a target that the AI reads or forces. The NPC never reads hidden player input, current-health-based scaling, future decisions or a desired ending HP.

- Protected early fights and weaker rolls remain relief. Matched lower-level fixtures must preserve the original resolver outcomes; trained endgame weaker encounters should usually finish quickly and comfortably.
- Near-level veteran ordinary encounters should cause real health pressure against a prepared strong build. For the explicit level100-versus94 control, a useful target is a median minimum HP of roughly35–75% with real damage to health, accessible wins, and materially worse results when repeatedly ignoring counters. Individual favorable matchups may be easier; skill and preparation should help.
- Dangerous/elite and purpose-built special NPCs should demonstrate defeat risk for limited or careless builds and legal winning routes for prepared builds. Ordinary encounters should generally finish within6–14rounds; special solo fights should generally finish within8–20rounds. A living deadline loss is reported separately from death.
- Final story Kage retains the exclusive192-preview/8-beam apex chooser. The same acquired player kit must provide a winning route for all four villages. This is a highest-policy claim, not a promise that every build finds every other encounter easier.
- Cooperative world/clan encounters are contribution attempts against shared health. Judge participation, survival, banked contribution, preparation and responses to warnings. Do not equate a successful slice, a deadline, or a survivable score attack with killing the whole shared boss.
- The weekly boss is an unlimited-health20-round score attack. Judge actual health pressure, score and counterplay; no solo kill is possible or required.

HP damage, shield damage, applied healing, minimum/final HP, net recovery, AP use, cooldown dry turns and fight length are recorded separately. Resolver events can net simultaneous damage and healing within an action, so applied-healing/damage fields are observed telemetry, not a reconstruction of an unobserved gross formula.

## Actual scope

| Source | Classification and implementation |
| --- | --- |
| Explore and natural bandits/rival miners | Existing receipt-owned35/45/15/5 ordinary mix and regional levels remain. Weaker and<=60 ordinary training stays intact. Veteran standards learn Seal mastery40 at61 and battle mastery50 at86; dangerous reaches50 at86. At61+, fixed legal catalog equipment and fuller role rotations supply meaningful40+60AP turns. |
| Night ninjas, including the roster name Tsukika | `ordinaryWandererEncounter` is shared by preview and authoritative start. Above protected levels, the rolled tier advances once: weaker→standard, standard→dangerous, dangerous/elite→elite. Region ceilings, identity, nighttime spawn, base rewards and early roads remain. Tsukika is a night-roster identity, not a separate world-boss profile. |
| Kagero nemesis, hostile patrols, bounty hunters, Bandit Warlord finale, riftspawn, questbook bosses, story reckonings, crisis combat | Explicit server source opt-in at61+. Legal role allocation, trained rotations, counter blade and readable recovery replace the old sparse kit/attrition shell. Named nonboss HP is110% of level curve; boss-loadout HP120%, with raw armor capped.35. No human opponent or similarly named unrelated profile receives this flag. |
| Final story Kage | Original14,000HP and armor remain. Each village keeps its identity and learns a12-slot legal catalog rotation plus a cooldowned counter blade. Apex remains exclusive. Earlier chapters retain their authored progression path. |
| World-event bosses, clan bosses, weekly boss | Source adapters preserve each participation model. Details, boss-specific mechanics, source levels, metrics and limitations are in `boss-source-audit.md` and its matched JSON. |
| War-hired mercenaries | The five WR tiers feed the actual manual, roaming and autonomous headless Tower war routes. Details and tier/mixed-route evidence are in `war-mercenaries.md`. Hire terms, ownership and war accounting remain authoritative. |

No change to PvP damage formulas, player mastery, rank caps, AP costs, common jutsu EP/tags, cooldowns or rewards is made to fix PvE. Named stat bonuses remain sealed by existing progression; the ordinary early-region ceiling and server-owned receipt/identity checks remain authoritative.

The fixed veteran counter weapon is the catalog Worldsplitter Katana (25EP,40AP,range4,CD5,Reflect35) at its actual level gate; the ordinary defensive specialist instead retains the same-tier Absorb blade. Lower veteran gear follows actual catalog level requirements. NPC item-stat bonuses are not added a second time: the NPC already has its authored level allocation. Weapon damage and tags use the existing shared resolver exactly once. Clear, avoiding the stance and waiting for recovery remain responses.

## Fixtures and limits

`pve-close-fights-benchmark.ts` reuses the independently validated progression fixtures, and records complete fixture audits, exact seeds, actual rolled levels and source SHA256 hashes. Every before fight uses archived **current main**, the same player build, policy, level and opening as after. Named-before reconstruction is the exact old `runtimeProfile` helper with generic allocation; it is not an invented weaker enemy.

- `trained`: mastery30 with an acquired two-nature kit and moderate B-rank multiplier.
- `specialist`: mastery40 with coherent specialist allocation and legal progression gear.
- `optimized`: rank-capped mastery and stats, acquired Earth/Wind, legal catalog gear, twelve slots at100.
- `narrow`: the conservative eight-slot control; limitations remain visible rather than declaring every restricted build viable.
- `sustain`: twelve catalog Earth/Wind techniques at mastery50, Ninjutsu, full capped stats, S-rank1.20, a **current-forge legal27EP Heal/Shield blade**, and five explicitly synthetic legal2%lifesteal legendary armor pieces. No unknown bloodline or custom technique is invented.
- `stress`: the same synthetic sustain fixture with a valid15-slot subscriber entitlement, three additional learned catalog techniques, and the **observed legacy33EP blade value** below the shared36EP ceiling. This is not a current forge roll. All fifteen techniques use50mastery, which is deliberately stronger training than Rill's four observed mastery2 customs. Armor/passive assumptions remain synthetic.
- `rookie`: a Buster-inspired level17 cloth/mastery1 control with319unspent points. Exact live stat allocation is unknown, so this is not a Buster replay.

Rill's exact custom definitions, all armor rolls and bloodline/passives were not captured. These controls are meaningful pressure/sensitivity evidence, not proof of the exact live account's outcome. Parent browser playtests remain separate. Group telemetry has additional per-action netting limits documented with that evidence.

## Battle log

The rolling log now distinguishes the current round from the retained display: `Round10 ·5 retained rounds ·56 retained events ·Partial view`. The summary wraps and stays visible on phones. The complete-observed-action journal/export, bounded storage, account isolation and seven-day expiry were not rewritten. Regression tests cover the round header, retained view, account isolation, export and expiry.

## Reproduction

Use Node matching `.nvmrc` and installed lockfile dependencies. Archive baseline `api/`, `shared/`, `scripts/` and `package.json` from the exact main SHA above to a separate directory. Expose this checkout's node_modules through `NODE_PATH` for the archived CommonJS baseline.

```powershell
$env:NODE_PATH = Join-Path (Get-Location) 'node_modules'
node --import tsx scripts/pve-close-fights-benchmark.ts --baseline-root ../pve-current-main --levels 100 --fixtures optimized,sustain,stress --difficulties weaker,standard,dangerous,elite --output endgame.json
node --import tsx scripts/pve-close-fights-benchmark.ts --baseline-root ../pve-current-main --levels 100 --fixtures sustain,stress --difficulties standard --enemy-level 94 --policies planner,reckless --output near94.json
node --import tsx scripts/pve-close-fights-benchmark.ts --baseline-root ../pve-current-main --levels 100 --fixtures optimized,sustain,stress --difficulties final-kage --seeds 0,1,2,3 --named --output special.json
```

Only reports marked `complete:true` with unchanged final source hashes establish final acceptance. Earlier local probes informed tuning but are not final certification. Validation results and review outcomes are recorded below after the final-source runs.
