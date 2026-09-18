# Authored ordinary C/B/A/S missions

Implemented against HEAD `2f8b49bf3`, September 18, 2026. The supplied `ce4172a5` snapshot was a reference, not a reset target. Existing dirty guidance, mentor, artwork, profession and UI work was preserved. No production deployment or player-record change was performed.

## Scope and authority

| Mission | Opponent / profile suffix (`builtin-ai-…`) | Admission / encounter level | Raw / banded HP |
|---|---|---:|---:|
| `combat-c-patrol` | Ember Duelist / `ember-duelist` | 15 / 18 | 580 / 435 |
| `combat-b-escort` | Frost Sealer / `frost-sealer` | 30 / 35 | 1,526 / 1,297 |
| `combat-a-hunt` | Shadow Weaver / `shadow-weaver` | 50 / 55 | 3,416 / 3,142 |
| `combat-s-crisis` | Central Champion / `central-champion` | 70 / 75 | 6,146 / 5,654 |

All HP, stats, specialty, armor, encounter levels and difficulty bands are unchanged. The mission templates historically use Ninjutsu, Genjutsu, Taijutsu and Bukijutsu respectively; those stat allocations are deliberately preserved, including the weaker off-school attacks. Every selected technique is already in that opponent's shared authored profile. The shared profiles themselves are unchanged, so hunts, wandering opponents and other appearances retain their existing kits.

The production chain is `Missions.tsx` → registered `/missions/combat-start` → real player authentication and `_eligibility` → `missionEnemyTemplate` → `resolveAiProfileJutsu` and rule validation → `buildSoloPveAiEncounter` → durable session/binding/active pointer → `/solo-pve/action` → canonical action planning and resolution → physical outcome settlement → queue/claim mission reward authority.

`_authored-mission-kits.ts` is the sole authority for these four mission programs. Templates omit embedded `jutsu`, preventing the former signature array from shadowing `jutsuIds`. Every required move has a specific rule reference: losing a catalog entry fails sealing instead of silently manufacturing a signature. Built-in definitions still take precedence over admin collisions; custom IDs still use the existing approved admin resolver. This pass does not change content publication or fetch production admin data.

A server-sealed `missionTactics` flag makes these new mission programs own their priorities instead of being preempted by generic healing/Clear/Cleanse. The runner checks both the flag and encounter kind. Existing sessions lack the flag and retain their old policy. New sessions retain their sealed moves, pools, descriptions and rules across content changes and recovery; starts recover the durable row before building a replacement.

The mission runner uses the existing bounded rules and canonical cast planner. Illegal preferred casts fall through, including Elemental Seal and AP modifiers. Ordinary movement must be legal and reduce distance. A legal basic strike, approach or Wait terminates the program. Candidate scoring is cached only within a single mission decision and discarded after each action. There is no database access, network call or external AI in decisions.

## Kits and actual priorities

### Ember Duelist: paid movement and commitment

- `starter-universal-flicker` — Flicker, 20 AP, range 5: paid approach to melee when farther than one tile.
- `starter-tai-earth-1` — Granite Elbow, 40 AP, range 4: Increase Damage Taken and Ignition. Ignition is a damage-taken amplifier here, not invented burning damage.
- `starter-tai-fire-2` — Meteor Axe Kick, 60 AP, range 4: direct Taijutsu attack and the canonical Drain effect.

Priority: Flicker while outside melee → Elbow if Increase Damage Taken is absent → Kick if legal → basic → ordinary approach → Wait. The opening can spend **20 + 40 + 40** on movement, setup and a basic strike. Starting a later turn in range permits **40 + 60** instead. Moving never grants free AP. Easy-band suppression of 60 AP attacks in rounds 1–2 remains intact.

Responses: prepare protection before the approach, manage distance to consume its movement budget, or spend damage to end the exchange before its heavy attack is available. A rapid two-round win remains valid. Full-HP admission fixtures frequently kill it before the heavy turn; suitable later board states explicitly demonstrate the heavier combination. HP probes of 800/1,000/1,200 raw HP were rejected: prolonging this mission merely to force a demonstration was unnecessary once its opener used its AP meaningfully.

### Frost Sealer: protection with a cooldown gap

- `starter-gen-fire-1` — Lantern Fear, 40 AP: Decrease Damage Taken and Increase Heal on itself. No dedicated Heal/basic-heal action is in its program.
- `starter-gen-lightning-2` — Paralysis Theater, 60 AP: damage and Decrease Damage Given. It does **not** stun.
- `starter-gen-earth-2` — Buried Memory Field, 60 AP: a second pressure attack with Siphon.

Priority: protect while Decrease Damage Taken is absent → weaken the player's attacks while that mark is absent → Memory Field → basic → approach → Wait. The ordinary seven-turn jutsu cooldown prevents continuous protection. Siphon heals from an actual landed hit, using the capped damage and respecting maximum HP; it does not steal chakra or stamina. Its attack still needs the normal resources and cooldown. No basic-heal loop was added.

Responses: prepare offensive/defensive setup during the protected window, or commit after protection expires; Clear removes its positive statuses, while Cleanse removes the negative mark on the player. They are different choices and cost real AP. Clearing every effect immediately is often less efficient than continuing to attack. This is the largest difficulty increase of the four, despite unchanged stats.

### Shadow Weaver: distance and a visible casting tax

- `starter-gen-water-2` — Moonlit Tide Dream, 60 AP: damage and Poison.
- `starter-gen-earth-2` — Buried Memory Field, 60 AP: damage with Siphon while the target is poisoned, also a legal fallback after Cleanse.

Priority: basic attacks if the player is adjacent → Poison if absent → Memory Field → basic → hold when AP is below 60 → approach → Wait. Memory Field follows the status setup when legal and remains available after Cleanse. It holds position after a ranged cast. When casts are unavailable at the start of a fresh turn it closes for ordinary attacks. There is no invented retreat/pathfinding action. Closing first consumes its turn on basic attacks and suppresses the ranged sequence.

Responses: close with ordinary movement or an available movement technique; Cleanse before paying for more jutsu; use protection; or accept the bounded poison cost to finish. Poison uses the existing exertion formula and armor/status mitigation. It is not an enemy-turn direct hit and is not represented as if the direct-hit cap applied to it.

### Central Champion: exposure, payoff, and a limited close response

- `starter-nin-earth-1` — Stone Needle Volley, 40 AP: flat Shield plus Increase Damage Taken on the player.
- `starter-buki-water-2` — Torrent Chain Slash, 60 AP: its main attack and Siphon.
- `starter-tai-lightning-2` — Raikou Knee Strike, 60 AP: damage plus Reflect, used only within one tile.

Priority: close-range Knee if legal → Volley when the exposure mark is absent → Chain Slash → basic → approach → Wait. A Knee spends 60 AP, leaving room for the 40 AP setup but not another heavy. All three jutsu have real cooldowns and finite pools. It reads current position and effects, never queued input or a future move, and never swaps its kit to counter the player.

Responses: keep casting distance to avoid triggering Knee; prepare protection and spend damage through its long cooldown gaps; Clear an active Reflect when the avoided return damage justifies the AP. **Clear does not erase its flat Shield.** Repeatedly charging into melee without answering Reflect is a losing policy in the minimum-admission fixtures. Damage, proactive protection, and cleanup policies remain viable with all four tested disciplines.

## Local resource changes

The approved NPC definitions seal **both** listed resource costs: 125 chakra + 125 stamina for these 40 AP utilities, 250 + 250 for these 60 AP attacks, and 25 + 25 for Flicker. Assuming that the NPC paid a player-only one-bar scaling formula would produce an unaffordable kit. No costs or regeneration formulas were edited.

| Mission | Old chakra / stamina | New chakra / stamina | Affordability reason |
|---|---:|---:|---|
| C | 192 / 192 | 500 / 750 | Paid approach, setup, basics, and later legal heavy; retained resource weakness |
| B | 260 / 260 | 750 / 750 | Protection + first heavy costs 375 per bar; second heavy remains possible on following turn |
| A | 340 / 340 | 750 / 500 | Two heavy casts over separate turns, then cooldown/basic pressure |
| S | 420 / 420 | 500 / 1,000 | Finite mixed sequence; chakra remains the limiting pool |

Existing level-based regeneration remains unchanged. Exhausted-state tests reach movement/basic/Wait safely. No HP, offense, defense, armor or scaling increase compensates for the selected kit. Mission-only descriptions correct misleading source flavor about paralysis, a soothing tide, shields and reflection without editing any player jutsu definition.

## Reproducible measurements

`scripts/mission-encounter-sim.ts` runs the production builder and engine. `mission-encounter-evidence/baseline-profiles.json` captured the old templates before implementation. The comparison regenerates both sides from that snapshot with identical fixtures, weather, positions, resources and policies.

There are **384 deterministic complete fights**: 4 missions × 3 progression points × 4 offensive disciplines × 4 policies × before/after. Progression points are admission, admission +8, and admission +25 (capped at 100). Fixtures spend the actual earned-stat budget, use canonical level pools, half of the allowed mastery ceiling, ordinary Academy techniques and the starter kunai/vest. There is no bloodline, pet, premium entitlement, rare gear or consumable. These combat paths do not sample randomness; paired seeds would add no independent samples. This is simulation evidence, not a human playtest or population win-rate estimate.

The policies share each fixture's loadout: legal damage first; proactive Stone Eye Mirage protection; visible-status Clear/Cleanse; or closing distance first. Each attempted action goes through the canonical engine. Rejected **player policy proposals** are recorded separately and never committed. Enemy illegal-condition fallthrough is tested with sealed elements, cooldowns, exhausted pools, AP modifiers and blocked boards; the runner exposes no separate runtime rejection counter. Action counts, final resources, observed status names and enemy action distributions are retained in the JSON evidence. No wait-only idle turn appeared in the ordinary damage-policy runs.

| Mission | Damage policy before → after, all progression points | Admission HP before → after | Wins before → after |
|---|---|---|---|
| C | 2 → 2 rounds | 1,900 → 1,693–1,826 / 1,900 | 12/12 → 12/12 |
| B | 2–3 → 3–5 rounds | 2,380–2,813 → 1,003–1,422 / 3,400 | 12/12 → 12/12 |
| A | 4–7 → 4–6 rounds | 798–3,271 → 1,998–2,686 / 5,400 | 12/12 → 12/12 |
| S | 7–10 → 7–12 rounds | 0–580 → 1,521–2,629 / 7,400 | 11/12 → 12/12 |

Pacing acceptance was tied to that baseline: preserve C's short clear, allow B at most two extra damage-policy rounds for its defensive sequence, keep A within its previous envelope, and allow S at most two extra rounds with improved survival. Later progression still clears these fixed-level enemies more easily. The report includes losses and inefficient response policies; it does not assert that tactical cleanup always beats burst damage. `adaptation-summary.txt` and `comparison.json` retain exact outcomes, rounds, action counts, HP/chakra/stamina, consumables, enemy actions and idle information for every comparison.

Concrete admission-level response comparisons (same loadout and initial state in each row):

| Opponent / player discipline | Damage-first result | Response result |
|---|---|---|
| Ember / Bukijutsu | 2 rounds, 1,826 HP | Proactive guard: 2 rounds, 1,867 HP; a small benefit, with additional setup resource cost |
| Frost / Ninjutsu | 4 rounds, 1,195 HP | Proactive guard: 3 rounds, 2,708 HP |
| Shadow / Ninjutsu | 4 rounds, 2,686 HP | Close first: 4 rounds, 4,368 HP; cleanup: 5 rounds, 2,818 HP |
| Champion / Ninjutsu | 10 rounds, 2,243 HP | Proactive guard: 9 rounds, 3,794 HP; cleanup: 10 rounds, 2,535 HP |

These comparisons are pinned in a focused engine test. Ember's short fight offers the smallest adaptation benefit; expending 60 AP on automatic cleanup makes that fight worse. That limitation is retained rather than disguising a lower-rank repeatable mission as a long teaching fight.

## Cost and presentation

The final benchmark uses 60 measured turns per mission/variant, alternating adjacent and four-tile states after five warmups; then five batches of 16 independent action-service sessions with injected in-memory storage. This exercises bounded concurrent-session work on one process, not production database scalability.

| Mission | Enemy-turn p50 before → after | p95 before → after | Initial session bytes before → after |
|---|---:|---:|---:|
| C | 0.48 → 6.55 ms | 46.65 → 73.09 ms | 4,817 → 6,289 |
| B | 0.56 → 1.81 ms | 7.45 → 13.97 ms | 4,814 → 6,355 |
| A | 0.30 → 0.74 ms | 10.92 → 19.68 ms | 4,821 → 5,955 |
| S | 0.34 → 1.23 ms | 2.62 → 7.72 ms | 4,790 → 6,333 |

These Windows Node 24.15 measurements ran on a shared development machine with other work and have noisy tails; the repository pins Node 22. The 16-session batches took 15–271 ms after the change. New initial sessions add about 1.1–1.5 KB for real moves/rules. Action requests have the same schema. Combat event history retains its existing 80-event bound, though status-rich snapshots and longer fights can enlarge terminal session payloads. Raw timings and sizes are in `benchmark.json` and `comparison.json`.

The client continues using the existing opponent identity/portrait resolution, statuses, action logs, mobile controls and HUD. No runtime client AI/catalog copy was introduced. The only client-side file added is a browser test. All four encounters were checked in the built Express app at 1366×768 and 390×844 using normally registered player tokens. The tests enter through Mission Hall's Combat tab, perform real actions, inspect resolved move names and live status chips, load the correct bundled battlefield sprite, check horizontal overflow, and switch/scroll mobile controls. The isolated image registry has no published custom portraits: the correct initials fallback was verified; live published portrait artwork was not queried or visually certified. Existing compact name ellipses remain, with the full names in combat state and logs.

## Validation and changed files

- 1,126 wider tests passed across missions, Solo PvE, shared combat, PvP, physical settlement, difficulty, approved content, and first fights.
- 18 final focused tests passed after the runner change, including mounted registration, normal player admission, authority rejection, old/new session preservation, actual wins/loss/flee, timeout, persistent vitals and reward replay.
- 74 client/onboarding/layout/mission-wiring/catalog/route contracts passed.
- `npm run build:server`, `npm run build:client`, `npm run verify:dist`, `npm run sizecheck`, and `npm run test:mission-eligibility` passed. Sizecheck reports its existing product-size warning while passing its budget; Vite reports its CommonJS/native-loader advisory.
- All eight desktop/mobile browser checks passed; the transcript is `mission-encounter-evidence/browser-tests.log`. Representative screenshots: [Ember desktop](mission-encounter-evidence/desktop-ember.png), [Shadow mobile log](mission-encounter-evidence/mobile-shadow.png), [Champion mobile controls](mission-encounter-evidence/mobile-champion-controls.png). This is automated browser validation plus screenshot inspection, not a human combat playtest.

Production edits: `api/missions/_authored-mission-kits.ts` owns content; `api/_authoritative-pve.ts` selects it; `api/solo-pve/_ai-encounter.ts` seals the opt-in and corrected descriptions; `api/solo-pve/_engine.ts` scopes priority, legal fallthrough and one-decision candidate caching. `_first-fights-onboarding.test.ts` only retires the obsolete assertion that C must remain generic; its tutorial behavior tests remain. The two new mission test files cover behavior and the production-mounted journey. The simulation, browser test, this document and evidence provide reproducibility.

Follow-up wiring review, September 18: retraced Mission Hall → mounted start → template/catalog resolution → durable session → authored action → physical settlement → queued claim → reward. The session store retains the optional policy flag and program; the client adapter carries the sealed enemy, statuses, resources and logs; only `combat-start` uses the mission template in production. No additional wiring defect or code correction was found. Fresh runs passed **227 tests** (189 mission/engine/recovery/claim/adapter/route checks plus 38 catalog/difficulty/seal checks), **all eight desktop/mobile browser cases**, the server build, distribution verification, and the edited-source whitespace check. Transcripts are the five `mission-encounter-evidence/wiring-recheck-*.log` files. Production services and custom portrait artwork remain outside this local verification.

Release preparation, September 18: public production health matched `main` commit `c3788d5e3d74c76ba2b88acf37f71f8e9dbcac3a`. An isolated checkout of that commit plus this mission change passed **1,128 combat regression tests**, **39 client/route contracts**, **all eight desktop/mobile mission browser cases**, the complete production build, distribution and size checks, and mission eligibility. The corresponding `live-main-*.log` files retain the results. The concurrent `e4f4e0f5c` update changes CI and documentation only and is retained in the release. The CI workflow now runs the eight authored-mission browser cases on desktop and mobile against its compiled release artifact, alongside its existing live Express checks. These are pre-deployment results; the public health check alone does not certify live authenticated combat.

No E/D kit, Academy spar, story fight, five-fight tutorial, player combat formula, player jutsu, reward, unlock, daily limit, persistent-vitals rule, consumable/companion rule, UI layout, camera, audio, artwork, animation, PvP or unrelated-mode profile was changed. Generic fallbacks still serve other encounters and pre-existing sessions. Production-authored content was not queried, and no live server restart or human playtest is claimed; continuity was verified by cold serialized storage reads under changed content and the existing recovery regressions.

Reproduce from the repository root (the browser command runs from `shinobij.client` after both builds):

```text
node --import tsx scripts/mission-encounter-sim.ts
node --import tsx scripts/mission-encounter-sim.ts --report
node --import tsx scripts/mission-encounter-sim.ts --benchmark
node --import tsx scripts/mission-encounter-sim.ts --fixtures
node --import tsx --test --test-concurrency=1 api/missions/_authored-mission-kits.test.ts api/missions/authored-mission-journey.test.ts
node --import tsx --test --test-concurrency=2 api/missions/*.test.ts api/solo-pve/*.test.ts api/combat-core/*.test.ts api/pvp/*.test.ts api/pve/*.test.ts api/_first-fights-onboarding.test.ts api/_pve-difficulty.test.ts api/_ai-opponent-loadout.test.ts api/_admin-ai-catalog.test.ts api/_admin-jutsu-catalog.test.ts
npm run build:server
npm run build:client
npm run verify:dist
npm run sizecheck
npm run test:mission-eligibility
npm run test:e2e:live -- authored-missions-express.spec.ts --project=chromium-desktop-live --project=chromium-mobile-live --output=test-results/authored-missions
```
