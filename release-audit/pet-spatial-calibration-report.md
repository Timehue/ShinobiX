# Spatial progression calibration

Accepted local execution evidence: 592 matrix executions and 96 trace executions. Both files report `stale: false` with matching start/end selected-source fingerprint `9e294bd1b7fe808002a6b3afc6fdb8820ba271b9e71fd7bea1076c13fa7e79e2`.

Only `pet-spatial-calibration-final-matrix.json` and `pet-spatial-calibration-final-trace.json` are final acceptance measurements. Earlier candidate and diagnostic files are historical investigation evidence.

## Method and limits

The matrix contains 148 scenarios under retained and progression rules, with sides swapped: 16 species spanning all four roles and rarities; all unlock boundaries; balanced and four legal specialist Growth Point builds; 16 elemental pairings; equipped builds; and mixed 2v2 teams. Canonical species bases and authoritative growth are used, traits removed to isolate progression, and no consumables. Its seed 7 coverage does not estimate general win rates; swapped neutral mirrors can duplicate an execution. The separate trace uses seeds 1, 7, and 42 across four species, both versions and sides, including explicitly labelled diagnostic contact runs.

The fingerprint covers the cinematic runtime, shared loadout resolver, shared ability progression, shared spatial power projection, shared mastery helper, and authoritative pet growth source. The deterministic script records its source fingerprint again after execution and rejects changed source as stale.

## Final measured result

| Rules | Matrix runs | Clock decisions | Elimination at limit | Median seconds | Median hits | Median longest hit gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy-v1 | 296 | 84 | 0 | 61.87 | 19 | 15.07 |
| progression-v3 | 296 | 9 | 0 | 50.77 | 16 | 9.17 |

| Scenario group | Retained clock decisions | Progression clock decisions | Progression median seconds |
| --- | ---: | ---: | ---: |
| Unlock boundaries | 30/112 | 4/112 | 51.33 |
| Other rarity representatives | 18/72 | 0/72 | 48.20 |
| Specialist builds | 12/32 | 2/32 | 51.97 |
| Element pairings | 4/32 | 0/32 | 46.53 |
| Mixed 2v2 teams | 19/32 | 3/32 | 61.50 |
| Equipped builds | 1/16 | 0/16 | 47.10 |

Strict three-seed trace excludes diagnostic contact rows: progression 0/24 clock decisions, median 59.9 seconds; retained 8/24, median 71.3 seconds. Mixed progression teams finish in a median 61.5 seconds with 32 landed hits, compared with retained median 75 seconds and 28 hits. Maximum observed progression control is four total actor-seconds per fight. Scheduled DoT observations count visible HP-loss ticks rather than status frames; simultaneous healing can hide a tick.

## Corrected defects and preserved behavior

Earned techniques used authored power on a different scale from the free ordinary strike. A shared projection now gives each offensive tier a fixed budget, restrained authored variation and exactly one level-50/75 mastery multiplier. Support effects and offensive riders retain their separate bounded budgets. This projection does not read defender HP.

An affordable selected melee art could be starved by the longer-range free strike. Progression AI approaches the earned art with a two-second non-closing timeout and a 1.5-second ordinary-pressure fallback. Explicit commands and guarded stance retain their intent.

Centre separation of 2.4 exceeded resting strict melee contact reach of 2.1. Progression lunge expiry uses the existing 0.6 body-edge tolerance with its facing test and genuine dodge rejection; out-of-pocket attacks still miss. Retained replays keep the original branch.

After a knockout, original-slot initiative could hand a beat to an empty lane while its living target listened to another lane. Compact progression parties now resolve one live contested lane for both turn reads and recovery handoffs. Intact two-lane openings remain unchanged. The captured opposite-slot-survivor fixture starts earned attacks before the global stall override; retained arbitration still reproduces its original zero-attempt interval.

Tiny alternating gains around cover reset the non-closing detector forever. Compact progression parties now require cumulative 0.1 distance progress within the existing two-second window. A blocked episode can yield once only if every living owner remains idle, currently unable to fire or approach, with no command, exit, or owner projectile; the recipient must have a ready attack and a real clear firing or walkable approach angle. Current recovered angles and pending cooldowns retain ownership. Both blocked sides cannot manufacture a handoff or a through-cover hit. This is scoped to compact progression parties; retained, 1v1 and formation arbitration retain their earlier behavior.

## Remaining clock decisions

`capped` records reaching 75 seconds; `clockDecisions` separately excludes any actual team elimination on that tick. The accepted final matrix has nine true clock decisions and zero eliminations at the limit.

| Scenario | Side swapped | Level | Size | Hits | Heal amount | Longest hit gap | Matching retained decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| standard-3-boundary-10 | false | 10 | 1 | 13 | 195 | 14.40 | true |
| standard-3-boundary-10 | true | 10 | 1 | 13 | 195 | 14.40 | true |
| standard-3-boundary-20 | false | 20 | 1 | 20 | 848 | 13.40 | false |
| standard-3-boundary-20 | true | 20 | 1 | 20 | 848 | 13.40 | false |
| standard-3-build-power | true | 75 | 1 | 14 | 300 | 17.87 | true |
| standard-3-build-guard | true | 75 | 1 | 14 | 300 | 17.87 | false |
| rare-1-team-rare-2 | true | 75 | 2 | 27 | 0 | 13.50 | false |
| rare-2-team-rare-3 | false | 75 | 2 | 30 | 2628 | 6.70 | true |
| rare-3-team-legendary-0 | true | 75 | 2 | 36 | 1860 | 7.67 | true |

The remaining single-pet rows are Forest Hawk support fixtures. The level-20 diagnostic without healing ends at 57.9 seconds instead of reaching the limit; normal support is bounded, but its timing changes the tail. The three remaining team rows contain 27, 30 and 36 hits. The cover/ownership corrections reduced the two former long-gap support-team rows to maximum hit gaps of 6.7 and 7.67 seconds; their remaining tails include bounded sustain and the available 75-second scoring window. These exact cases remain visible for release assessment. This evidence demonstrates a substantial improvement and finite outcomes; it does not claim zero stalls or broad PvP balance confidence.

## Verification against the final shared source

- 99/99 focused cinematic, command replay, effects, shared loadout, spatial power and generated-mirror checks passed.
- 27/27 assigned Warfront authority, lifecycle, carry-health and counterplay checks passed.
- Client and server regressions cover body-edge contact, real dodges, distance misses, blocked approaches, opposite-slot collapse, 2v1 handoff, intact openings, cover oscillation, no pingpong, and active action/exit/projectile/recovered-angle/cooldown ownership.
- The original retained counterplay cohort remains exactly 17 opening-contact changes and seven winner flips. A separate 20-case level-75 canonical species/growth cohort passes the same strategic floors of at least 12 opening changes and five winner flips, with immutable public opening evidence.
- Fresh Warfront authority now forces eligible progression kits and stamps their version before storing them. Its regression injects a save-supplied legacy marker and checks stable eligible IDs on both frozen teams, then verifies the actual commanded clock and settlement result. Historical receipt fixtures explicitly retain their original kits and assertions.
- Celestial Lion lifecycle coverage verifies its level-two ordinary art, advanced unlock at ten, signature unlock at twenty, rejection of a fully prepared forged early signature, and unchanged owned XP/level after previews.

Independent source review found no blocker in the tier projection or narrowed ownership changes. All executions were local deterministic simulation and synthetic isolated authority fixtures. No production player data or logged-in game was used.
