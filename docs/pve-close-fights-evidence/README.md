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

Only reports marked `complete:true` with unchanged final source hashes establish final acceptance. Earlier local probes informed tuning but are not final certification.

## Final matched results

The five primary reports contain **880 before/after rows**. `summary.json` verifies every recorded source hash, completed encounter and fixture audit. Its **285 protected/weak pairs have no deterministic outcome, health, resource, damage or duration changes**. Seeds and individual outcomes remain in the JSON rather than only in aggregate counts.

| Same prepared fixture and policy | Current-main before | After | After duration |
| --- | --- | --- | --- |
| Level100 versus94 standard, current-forge sustain12, seeds0–4 | 5/5 wins; median minimum92.3%HP | 5/5 wins; median minimum65.2%HP | 7–11 rounds |
| Level100 versus94 standard, legacy33EP stress15, seeds0–4 | 5/5 wins; median minimum87.3%HP; all finish full | 5/5 wins; median minimum61.1%HP; minimum46.4–67.5%, finish67.4–78.4% | 7–11 rounds |
| Same two near94 fixtures, repeated-attack policy without counters | 10/10 wins | 0/10 wins; all die | 6–9 rounds |
| Stress15, ordinary weaker rolls, seeds0–4 | 5/5 wins; median minimum94.1%HP | Identical outcomes and telemetry | 3–7 rounds |
| Stress15, ordinary standard rolls, seeds0–4 | 5/5 wins; median minimum86.1%HP | 5/5 wins; median minimum46.8%HP | 6–12 rounds |
| Stress15, elite rolls, seeds0–4 | 5/5 wins; median minimum78.6%HP | 5/5 wins; median minimum31.5%HP | 7–13 rounds |
| Same stress15, four final story Kage | 4/4 wins; median minimum74.4%HP | 4/4 wins; median minimum17.6%HP | 10–12 rounds |

The twelve-slot sustain fixture also beats all five elites and all four final Kage; its minimum HP ranges are33.3–58.5% and5.1–39.6%, respectively. The catalog optimized control beats all elites but loses one Kage matchup. This demonstrates preparation and matchup sensitivity, not guaranteed victory. Final Kage keeps14,000HP and its exclusive apex chooser.

Near94 stress15 has mean **5,292 reported event HP damage**,1,059 shield damage and2,971 reported applied healing after, compared with1,799/708/1,879 before. Mean final HP changes from100% to72.3%. These event measures are lower-bound telemetry, separate from net health loss: simultaneous healing, reflection/recoil, status ticks and same-event recovery prevent reconstructing gross incoming damage by simply adding healing to final HP loss. For seed0,5,167 event HP damage minus3,439 reported healing is1,728, while the authoritative net loss is2,706HP: the978HP reconciliation gap is not silently attributed to enemy direct damage or lifesteal. Minimum/final HP are authoritative state measurements. Do not describe shield loss as health pressure.

Explicit named bruiser/defender/boss profiles also have winning routes with the same prepared kit. Stress15 wins all six tested named openings at10–12 rounds, with minimum4.0–15.0%HP. Their old armor/HP shell could instead produce15–26-round attrition. Shorter recoverable fights come from legal effective offense and counter windows, not extra HP. These constructor probes do not claim every identity/reward branch or a live account was played.

The progression matrix intentionally retains narrower eight-slot fixtures at levels17/25/50/75. Its level75 `optimized` row is the same eight-slot kit as `narrow`, not a claim to test full available capacity. Limited trained/specialist builds can lose near-level standards; the prepared-capacity sensitivity is recorded separately. No claim is made that every legal build should defeat every encounter.

## Review and validation

Independent source review found and resolved two regressions during this change: an unscoped weapon candidate on real ANBU garrison copies, and a clan-boss mastery rollback omission. Challenge weapons now require a server builder seal; player hydration removes forged seals and garrison copies remain excluded. A matched real garrison replay established the local regression before the fix (three moves versus a1,120HP weapon hit), and focused tests cover the repaired path.

The independent final review passed44 focused tests with no failures/skips. The implementation review passed55 scope/authority/weapon tests and the server build. The mercenary suite passed65 checks plus3 final builder/policy checks, including equality between the instrumented probe and the actual production headless resolver. Desktop/phone presentation Playwright passed6/6. Final CI is linked from the draft PR; it must be green on its final commit before merge is considered. No merge is authorized by this work.
