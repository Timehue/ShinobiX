# ShinobiX combat regression matrix

Baseline date: 2026-08-27. This is the Phase 2 readiness inventory produced during Phase 0/1; it does not claim that every future migration is authorized.

## Gate result

Existing characterization coverage is sufficient for the first import-only source-of-truth cleanup. No new combat test was necessary for that change because the affected geometry/AOE exports already have direct core tests, a compatibility-export test, mode engine tests, and cross-mode parity tests.

The full discovered suite executed 8,247 tests. All combat-core, PvP, Solo PvE, Tower, Clan Boss, and Hollow Gate tests passed; the 29 baseline failures were outside combat. After restoring the interrupted client dependency install, 28 of those 29 passed and only the pre-existing `App.tsx` line-budget ratchet remained at that snapshot. Concurrent live-main commit `6d5289d` subsequently resolved the ratchet; its focused changed-file verification passed 7/7.

After the import-only change, 123 focused core/PvP/Tower tests passed. The deterministic PvP tuning audit separately completed 3,200 fights and reported `NOT BALANCED` with 150 flags. That verdict is balance evidence, not a regression in the import change: no combat value changed, seat results stayed neutral, and the simulator exercises the live resolver. Balance work must remain a separate, explicitly reviewed change set.

Status legend:

- **Covered**: a focused executable test asserts the behavior.
- **Inventory-covered**: the executable catalog/registry proves reachability/classification, but that alone is not a full behavioral assertion.
- **Mode-specific**: a test pins the behavior in that mode; equality with other modes is not claimed.
- **Gap**: add characterization before moving that rule.

## Basic action and lifecycle matrix

| Behavior | PvP | Solo PvE | Tower / Clan Boss | Evidence |
| --- | --- | --- | --- | --- |
| Basic attack | Covered | Covered | Covered | `pvp/_move-handler.test.ts`; `solo-pve/_solo-pve.test.ts`; `towers/_engine.test.ts` |
| Jutsu cast | Covered | Covered | Covered | PvP apply-jutsu characterization; Solo sealed-jutsu test; Tower PvP-resolver parity test |
| Movement | Covered | Covered | Covered | PvP move/ground tests; Solo sealed-board test; Tower adjacent/off-board/dash tests |
| AP spending and insufficient AP | Covered | Covered through shared parity/action tests | Covered, including Lag/Overclock | PvP move handler; `combat-core/pvp-solo-jutsu-parity.test.ts`; Tower canonical parity |
| Chakra/stamina spending | Covered | Covered | Covered | PvP move handler; Solo parity; Tower engine/resources-v2 parity |
| Action limit | Covered | Covered | Covered through shared constants/action engine | Core constants plus mode tests |
| End turn / scheduler handoff | Covered | Covered | Covered | PvP cooldown/stun handoff; Solo enemy turn; Tower AI-until-human |
| Cooldown apply, reject, tick | Covered | Covered through differential parity | Covered | PvP move handler; cross-mode parity; Tower engine |
| Death | Covered through damage/terminal replay tests | Covered | Covered | PvP golden/terminal tests; Solo terminal outcomes; Tower wiped-squad/objective tests |
| Victory / draw / limit | Covered | Covered, including survival budget | Covered, mode-specific objectives | PvP golden replays; Solo engine; Tower engine |
| Flee / abandon | Covered | Covered | Not a Tower action | PvP adjusted-cost flee; Solo flee/abandon tests |
| Duplicate command | Covered | Covered | Covered | PvP move tokens/receipts; Solo versioned lock; Tower action idempotency |
| Concurrent command | Covered | Covered | Covered | PvP CAS/lease-loss tests; Solo same-version race; Tower session mutation tests |
| Reconnect/terminal recovery | Covered | Covered | Covered | PvP reward/session recovery; Solo stored terminal evidence; Tower state/party lifecycle |

## Targeting and board matrix

| Case | Coverage | Evidence / boundary |
| --- | --- | --- |
| Self target | Covered | Tower self-target test; catalog inventory has 25 self-target jutsu; PvP/Solo full-catalog differential parity. |
| Enemy target | Covered | Primary path in all three engines. |
| Ally target | Covered where supported | N-actor relationship/target planning and Tower party tests; two-actor PvP has no allied third actor. |
| Single target | Covered | 171 shipped single-method jutsu inventoried; behavior parity across PvP/Solo. |
| AOE burst / circle | Covered | Core footprint tests, PvP AOE tests, Tower splash and N-actor reducer tests. |
| Empty ground | Covered | 12 shipped ground targets inventoried; immediate pulse, recurrence, miss, and expiry tests. |
| Range boundary | Covered | Core grid tests plus mode rejection tests. |
| Invalid target / friendly fire | Covered | Core N-actor rules and Tower explicit rejection; two-actor plan tests. |
| Invalid/off-board/occupied tile | Covered | Solo and Tower engine tests; PvP move handler/geometry tests. |
| Deterministic AOE order | Covered | Tower roster-permutation and primary-first/actor-ID tests. |
| Cast-scope once / hit-scope per victim | Covered | `combat-core/cast-reducer.test.ts` and `towers/_n-actor-aoe.test.ts`. |
| Push/Pull blockers and board edge | Covered | PvP combat-tag edge/barrier tests; Tower push/pull/debuff-prevent test. |

## Effect/tag matrix

`jutsu-parity-inventory.ts` maps every canonical accepted tag to a behavior family and fails when a tag is unmapped. `pvp-solo-jutsu-parity.test.ts` runs a neutral behavioral case for every shipped built-in and legacy jutsu, then separately exercises eligibility, positional methods, resources, timing, cooldown ordering, and mastery boundaries. `towers/_canonical-combat-parity.test.ts` compares every non-positional canonical tag to `applyPvpJutsu`.

| Effect/tag | Direct characterization | Cross-mode evidence | Status |
| --- | --- | --- | --- |
| Heal | Exact mastery/cap test | PvP/Solo full catalog; Tower heal/self/weapon tests | Covered |
| Shield | Exact mastery/cap and shield-before-HP tests | PvP/Solo; Tower Shield-tagged weapon/canonical parity | Covered |
| Barrier | Deferred activation and ground authority | PvP/Solo positional parity; Tower ground footprint | Covered |
| Pierce | True-damage floor/shield/reflect test | PvP/Solo positional parity; Tower movement-circle impact | Covered |
| Stun | Prevention and deferred refresh tests | PvP/Solo timing parity; Tower elemental/canonical parity and Stun test | Covered |
| Poison | Direct/ground/refresh/DOT tests | PvP/Solo resources-v2 parity; Tower DOT and exertion tests | Covered |
| Drain | Tick behavior | PvP/Solo catalog parity; Tower Drain field test | Covered |
| Absorb | Exact incoming-damage conversion test | PvP/Solo and Tower canonical tag parity | Covered |
| Reflect | Exact bounce test and true-damage exclusion | PvP/Solo; Tower sequential AOE/caster-death test | Covered |
| Lifesteal | Dedicated PvP suite plus characterization | PvP/Solo and Tower canonical parity | Covered |
| Increase Damage Given | Exact soft-cap test | PvP/Solo; Tower buff and modifier tests | Covered |
| Decrease Damage Given | Ground refresh/direct-stack tests | PvP/Solo; Tower both-target consumable | Covered |
| Increase Damage Taken | Catalog/parity behavior | PvP/Solo and Tower non-positional parity | Covered |
| Decrease Damage Taken | Deferred activation and exact mitigation | PvP/Solo and Tower floor modifier parity | Covered |
| Increase Heal | Inventory + shared resolver parity | PvP/Solo and Tower canonical parity | Covered |
| Increase Generals | Dedicated PvP test | PvP/Solo and Tower damage-flow test | Covered |
| Increase Discipline | Dedicated PvP test | PvP/Solo and Tower canonical parity | Covered |
| Debuff Prevent | Active/deferred behavior and zone/Mirror blocking | PvP/Solo; Tower displacement/ground parity | Covered |
| Buff Prevent | Copy blocking and effect application | PvP/Solo and Tower canonical parity | Covered |
| Cleanse Prevent | Authoritative move-handler phase tests | PvP/Solo and Tower canonical parity | Covered |
| Clear Prevent | Authoritative move-handler phase tests | PvP/Solo and Tower canonical parity | Covered |
| Stun Prevent | Tag application/prevention | PvP/Solo and Tower canonical parity | Covered |
| Copy | Exact exclusions and deferred persistence | PvP/Solo and Tower canonical parity | Covered |
| Mirror | Exact copied-debuff behavior and deferred persistence | PvP/Solo and Tower canonical parity | Covered |
| Push | Edge, barrier, and prevention behavior | PvP/Solo positional parity; Tower displacement test | Covered |
| Pull | Shared displacement parity | PvP/Solo positional parity; Tower displacement test | Covered |
| Bloodline Seal | Formula suppression and alias coverage | PvP/Solo eligibility; Tower canonical parity | Covered |
| Elemental Seal | Action rejection | PvP/Solo eligibility parity; Tower all-jutsu-route test | Covered |
| Wound | Exact amount, rank caps, two-stack cap, deferred third stack | PvP/Solo and Tower AOE rider | Covered |
| Recoil | Exact mastery scaling | PvP/Solo; Tower ground/control tests | Covered |
| Move | Pure move VFX and positional behavior | PvP/Solo positional parity; Tower Flicker test | Covered |
| Ignition (`Afterburn` alias) | Alias/inventory plus full-catalog differential behavior | PvP/Solo and Tower canonical parity | Covered |
| Lag (`Time Compression` alias) | AP-adjustment parity | PvP flee/AP, PvP/Solo eligibility, Tower paid-action matrix | Covered |
| Overclock (`Time Dilation` alias) | AP-adjustment parity | PvP flee/AP, PvP/Solo eligibility, Tower paid-action matrix | Covered |
| Siphon (`Vamp` alias) | Exact post-damage healing and rank caps | PvP/Solo and Tower canonical parity | Covered |
| Recoil, prevention, Copy/Mirror ordering combinations | Dedicated combination tests | Cross-mode canonical parity | Covered |
| Stealth | No live effect found | Generic N-actor veto hook only | Not applicable / UNKNOWN |

## Equipment and consumable matrix

| Case | Coverage | Evidence |
| --- | --- | --- |
| No equipment baseline | Covered | Exact 960 reference-base apply-jutsu characterization. |
| Armor DR | Covered | Core formula and Tower compute-damage tests; PvP equipment/stat budget suites. |
| Shield/reflect/absorb/lifesteal equipment effects | Covered in PvP; adapter parity supports Tower jutsu path | PvP item-resolution, guard, lifesteal, Sennin/equipment tests. |
| Equipped weapon damage | Covered | PvP weapon-damage and move-handler tests; Tower weapon EP test. |
| Weapon range | Covered | PvP move validation and Tower engine target tests. |
| Weapon cooldown | Covered | PvP item resolution/move tests and Tower repeated-swing test. |
| Thrown weapon charge | Covered | PvP consumables; Tower spend/reject-order tests. |
| Named weapon effect tags | Covered | PvP named-weapon VFX; Solo named-tag damage cases; Tower Heal/Shield weapon parity. |
| Potion/resource restore | Covered | PvP consumables and Tower charge/cooldown tests. |
| Both-target consumable | Covered | PvP VFX/behavior, Solo application, Tower Smoke Bomb. |
| Multiple overlapping modifiers | Covered for status/equipment math in focused suites | Core formulas, PvP combat-stat/item suites, Tower modifier matrix. |
| Complete cross-mode equipment snapshot equality | No single golden fixture proves every field from one save across PvP, Solo, and Tower admission | Add before consolidating equipment builders. | Gap |

## Mode/orchestrator matrix

| Mode | Combat authority under test | Characterization present |
| --- | --- | --- |
| Casual/direct/ranked/world shinobi PvP | `pvp/session.ts` + `pvp/move.ts` | Session publication, authorization, move semantics, idempotency, timeout, terminal/reward recovery, balance simulations. |
| Solo AI, story, spar, missions, hunts | Solo PvE store/service/engine | Sealed admission, server AI, movement/effects/resources, concurrent actions, terminal settlement. |
| Tower / party / Spire | Tower engine/store/session mutation | Deterministic full runs, objectives, hazards, N-actor AOE, parties, idempotency, settlement. |
| Clan Boss | Tower combat plus Clan Boss contribution/settlement | Assault adapter parity, contribution, party, storage, sector state, profession/reward tests. |
| Hollow Gate shinobi | Parent Hollow Gate ledger plus Solo/Tower child | Cutover, combat binding, token, reconnect soak, expired-run escape, parent settlement tests. |
| Hollow Gate pet | Exact cinematic child proof plus parent settlement | Adversarial authority/receipt/race suite. |
| Pet Showdown/Warfront/Gauntlet/cinematic | Separate registered engines | Extensive pet suites in the full run; not asserted equal to shinobi combat. |
| Card Clash / Chronicle | Separate card engine | Separate game; not part of this combat-core migration gate. |

## Replay, authority, and invariants

| Invariant | Evidence |
| --- | --- |
| Client cannot submit another fighter's action | HTTP auth/name/role tests in PvP, Solo, and Tower. |
| Replayed action cannot spend twice | PvP move token + action receipt; Solo action token/version; Tower command ring/fingerprint. |
| Rejected action does not spend AP/resources or persist token | PvP insufficient-resource tests; Solo rejection event/no mutation; Tower invalid command and engine tests. |
| AP does not go negative on adjusted terminal action | PvP Overclock flee test and shared cost clamp tests. |
| Cooldown cannot be bypassed by retry | Idempotency ordering and cooldown tests per engine. |
| Client cannot choose terminal outcome | Solo forged outcome ignored; PvP/Tower server terminal functions; sealed child receipts. |
| Rewards cannot be granted by combat mutation alone | Dedicated claim/settlement and exact receipt/recovery tests. |
| Concurrent same-state actions linearize | PvP exact session CAS, Solo fail-closed session lock/version, Tower session mutation lock/version. |
| N-target AOE is deterministic | Cast reducer and Tower roster-permutation tests. |
| Catalog growth cannot introduce an unknown tag silently | `_tags.test.ts` plus `jutsu-parity-inventory.test.ts`. |

## Required additions before larger combat extraction

1. Add one cross-mode equipment-snapshot golden fixture that starts from the same saved character and compares every normalized fighter field used by PvP, Solo, and Tower.
2. Before extracting `applyJutsu` out of `pvp/move.ts`, pin log wording, FX/VFX batches, deferred status timestamps, shield caps, and ground-effect serialization at the wrapper boundary—not only numeric fighter state.
3. Before sharing basic actions, build an explicit table proving which AP, resource, cooldown, target, and end-turn rules are intended to match. Current repetition is safer than an unproven abstraction.
4. Keep terminal/victory and reward tests mode-specific. Their divergence is structural and intentional.

## Completed first refactor protected by this matrix

Tower's hex-distance and filled-disk imports now point directly to `combat-core/grid.ts` and `combat-core/aoe.ts` instead of the historical `pvp/_aoe.ts` compatibility re-export. This changed no function, signature, constant, persistence shape, or behavior and removed one false ownership edge from Tower to PvP. After the change, 123 focused core/PvP/Tower tests passed, followed by the server build and runtime-mode documentation check.
