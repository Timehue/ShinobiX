# ShinobiX source-of-truth audit

Audit snapshot: 2026-08-27 at `03d433fc90abd6879c242aa59bc24bbe697094ad`.

## Method

This audit traced live imports from `server.ts` routes through handlers, mode engines, shared helpers, storage calls, and test entrypoints. A similarly named file is not counted as a live implementation unless an active caller reaches it. Generated runtime-mode documentation was accepted only after its executable source (`shared/runtime-mode-registry.ts`) was loaded and counted.

Terms used below:

- **NO divergence**: callers reach the same executable rule.
- **POLICY divergence**: a shared primitive exists, but a mode intentionally owns surrounding costs, scheduling, caps, or victory policy.
- **YES divergence**: multiple live implementations calculate the same named behavior differently.
- **UNKNOWN**: the code proves separate paths but does not prove they are intended to match.

## Executive finding

The primary shinobi combat family is partially centralized and already protected by parity tests. The numeric formula layer, hex geometry, jutsu action planning, resource adjustment, status collection operations, cooldown ticking, N-actor targeting, and cast reduction live in `api/combat-core`. The canonical effect application for the live PvP/Solo/Tower family still lives in `api/pvp/move.ts`; Solo imports it directly and Tower reaches it through `api/combat-adapters/clanBossAdapter.ts`.

That means there are not three independent live jutsu-effect engines to merge. The remaining architectural seam is that a mode-neutral effect resolver is housed in a PvP route module. Moving it safely is a future extraction problem, not permission to rewrite combat.

The executable runtime registry contains 61 modes: 56 match their declared owner, three are explicit surface gaps, one is an isolated legacy compatibility defect, and one awaits an owner decision. Pet Showdown, Warfront, Gauntlet, cinematic duel, Chronicle, and client-local practice are separate combat families and must not be silently forced through the shinobi combat core.

## Combat rule table

| Rule | Current implementations | Live callers | Divergence? | Risk | Proposed canonical owner |
| --- | --- | --- | --- | --- | --- |
| Direct jutsu damage | Numeric primitives in `combat-core/formulas.ts`; phase orchestration in `combat-core/resolveJutsu.ts`; PvP phase hooks in `pvp/move.ts` | PvP calls `applyJutsu`; Solo imports that function; Tower adapter converts actors then calls it | NO within the PvP/Solo/Tower shinobi family | Low. The owner file name obscures the actual shared boundary. | Keep formulas/phase orchestration in `combat-core`; eventually extract the PvP phase hooks into a mode-neutral core module with wrappers. |
| Basic attack damage | PvP creates a synthetic 10-EP jutsu; Solo has its own basic-action branch; Tower has its own N-actor basic-action branch, using shared direct-damage formula | Respective mode action handlers | POLICY divergence | Medium if constants drift; the action shapes and N-actor target policy are mode-specific. | Shared numeric formula; explicit mode policies with parity tests for values intended to match. |
| Defense / damage reduction | Armor raw DR, status DR contribution, DOT mitigation, and final damage formulas in `combat-core/formulas.ts`; mode builders derive combat snapshots | PvP, Solo through PvP resolver, Tower jutsu adapter; pet engines are separate | POLICY divergence | Medium. Snapshot construction/equipment sealing differs by mode even when the final formula is shared. | `combat-core/formulas.ts` for math; mode adapters for sealed fighter inputs. |
| Stat resolution and caps | XP/stat ledger in `_xp-engine.ts` and `_stat-growth.ts`; combat projections/caps in `combat-core/formulas.ts`; PvP `_multipliers.ts` and mode builders assemble fighter state | Save/progression, PvP session creation, Solo/Tower admission | POLICY divergence | Medium. Separate builders are necessary, but mirrored fields can drift. | Progression owners for persisted stats; combat core for combat math; tested adapters for each mode. |
| Jutsu catalog and accepted tags | Built-in and legacy catalogs under `api/pvp`; admin-published content through `_admin-jutsu-catalog.ts`/`_content-store.ts`; canonical aliases/sets in `pvp/_tags.ts`; executable inventory in `combat-core/jutsu-parity-inventory.ts` | PvP, Solo, Tower, AI profiles, admin tools | NO for current catalog merge; admin content is an additional source by design | Low. 217 shipped entries were inventoried; no missing AI IDs and no unmapped canonical tags. | Catalog modules + content store; move tag taxonomy to combat core only as a separately tested extraction. |
| Jutsu effect resolution | `pvp/move.ts` implements tag phases and delegates numeric work to `resolveJutsu`; Solo imports it; Tower adapter invokes it per target through `cast-reducer.ts` | PvP, Solo, Tower, Clan Boss | NO for supported shared tags | Medium architectural coupling: importing a route module couples Solo/Tower to PvP session types/log text. | A future `combat-core/effects` extraction preserving `applyJutsu` wrappers. |
| AP base costs | Basic action constants are local in PvP, Solo, and Tower; jutsu AP is sealed in catalog/session data; `adjustedApCost` applies Lag/Overclock | All shinobi mode engines | POLICY divergence | Medium because repeated literal basic costs can drift. Existing tests pin parity. | A shared basic-action policy only for values proven identical; mode-owned exceptions stay explicit. |
| AP validation / action cap | `resolve-jutsu-action.ts` validates jutsu AP/action/resource/cooldown; PvP and Solo call it. Tower validates its N-actor command locally and uses shared cost adjustment/constants. | PvP/Solo/Tower action paths | YES at orchestration level; no proven outcome defect | Medium. Tower requires N-actor semantics, but repeated validation ordering can drift. | Keep shared jutsu-plan validator for two-actor modes; add or extend a neutral N-actor validator only after parity characterization. |
| Movement cost | `nextStepToward`/hex neighbors in core; PvP move is 30 AP; Solo local move policy; Tower local move/dash policy | Mode action engines | POLICY divergence | Low-to-medium. Tactical occupancy and dash rules differ by mode. | Core geometry; mode-owned movement policy, with shared constants only where tests prove equality. |
| Target legality | `resolve-jutsu-action.ts` for two-actor jutsu target/tile semantics; `n-actor.ts` for relationship/target planning; Tower adds objective/actor vetoes | PvP, Solo, Tower | POLICY divergence | Low. Separate two-actor and N-actor planners are explicit. | `combat-core/resolve-jutsu-action.ts` and `combat-core/n-actor.ts`. |
| Range and hex distance | `combat-core/grid.ts`; AOE footprint in `combat-core/aoe.ts`; `pvp/_aoe.ts` is a compatibility re-export | PvP, Solo, Tower | NO | Low. Tower now imports directly from core; the historical wrapper remains for compatibility callers. | `combat-core/grid.ts` and `combat-core/aoe.ts`. |
| Cooldown ticking | `combat-core/cooldowns.ts`; PvP and Solo call it. Tower retains its scheduler/action cooldown bookkeeping but shares combat constants and jutsu values. | PvP/Solo/Tower | POLICY divergence | Medium. Turn topology differs, so blind unification would be unsafe. | Core cooldown-map primitive; mode scheduler decides when a tick occurs. |
| Status collection semantics | Active/has/add/remove/stack/tick helpers in `combat-core/statuses.ts`; tag meaning/application ordering in `pvp/move.ts`; Tower converts actors to/from PvP fighter status shapes for jutsu casts | PvP, Solo, Tower/Clan Boss | NO for shared jutsu effects; POLICY divergence for mode hazards/modifiers | Medium coupling, low known behavioral divergence. | Core collection + extracted core effect phases; explicit Tower modifier layer. |
| Healing | Mastery and status multipliers in core; jutsu Heal in shared effect resolver; Basic Heal is local per mode; Tower modifiers apply Spire heal-cut | PvP/Solo/Tower | POLICY divergence | Medium. Basic-heal constants and mode caps must not be conflated with jutsu Heal. | Core jutsu healing formula; mode basic-heal policy. |
| Barrier / Shield | `shieldAmountForMastery` in core; tag application/post-damage in `pvp/move.ts`; PvP caps live shield at min(max HP, 5,000); Tower maps shields through adapter | PvP/Solo/Tower | POLICY divergence | Medium. PvP live cap is route-local; verify Tower-equivalent cap before moving it. | Core formula plus explicit, named mode cap policy. |
| Reflect | Core post-damage formula inputs; effect/status ordering in `pvp/move.ts`; Tower/Clan Boss jutsu path reuses it | PvP/Solo/Tower | NO for shared jutsu | Low | Future mode-neutral effect resolver. |
| Lifesteal / Vamp | `Vamp` canonicalizes to `Siphon`; Lifesteal status and post-damage healing are in `pvp/move.ts` using core percentage helpers; equipment lifesteal is also applied there | PvP/Solo/Tower jutsu adapter | NO for shared jutsu | Low; alias behavior is explicit and tested. | Tags/catalog + mode-neutral effect resolver. |
| Absorb | Status application and post-damage conversion in `pvp/move.ts`; core provides post-damage math | PvP/Solo/Tower | NO for shared jutsu | Low | Mode-neutral effect resolver. |
| Afterburn / DOT | `Afterburn` aliases to `Ignition`; `applyDoTs` in `pvp/move.ts` handles Wound, Poison, and Drain behavior, with resource-v2 branches; Solo and Tower import it | PvP/Solo/Tower | NO within family | Medium because the function lives in the PvP module and resource-v2 behavior is conditional. | Extract DOT reducer with characterization wrapper. |
| Wound | Wound amount/cap helpers in core; application and tick order in `pvp/move.ts` | PvP/Solo/Tower | NO | Low | Core formula + future core effect reducer. |
| Stun | Tag application/prevention in `pvp/move.ts`; AP penalty constant/formula in core; modes apply it at their turn boundary | PvP/Solo/Tower | POLICY divergence | Medium because scheduler timing differs. | Core status meaning and penalty; mode scheduler owns activation/tick boundary. |
| Bloodline/elemental seal | Canonical tags/aliases in `_tags.ts`; bloodline offense suppression in core formulas; elemental action rejection in `resolve-jutsu-action.ts`; effect application in `pvp/move.ts` | PvP/Solo/Tower | NO for jutsu path | Low | Combat core after extraction. |
| Cleanse | Core removal-by-kind primitive; each mode exposes a basic cleanse action and respects Cleanse Prevent | PvP/Solo/Tower | POLICY divergence | Medium. AP/cooldown/action scheduling are duplicated. | Core status removal; mode action policy until parity proves a shared command resolver. |
| Clear | Core removal-by-kind primitive; each mode exposes opponent-buff clear and respects Clear Prevent | PvP/Solo/Tower | POLICY divergence | Medium for the same reason as Cleanse. | Core status removal; mode action policy. |
| Push / Pull | Effect displacement loop in `pvp/move.ts` uses core neighbors/distance and occupancy veto; Tower uses mapped fighters for jutsu then maps positions back | PvP/Solo/Tower | NO for shared jutsu footprint | Medium. N-actor blockers make adapter correctness load-bearing. | Core displacement primitive accepting an occupancy policy, only after focused N-actor tests. |
| Copy / Mirror | Canonical tag ordering and effect copying in `pvp/move.ts`; status primitives in core | PvP/Solo/Tower | NO within family | Low-to-medium due to deferred status activation ordering. | Future core effect reducer; retain ordering tests. |
| Prevention effects | Buff/Debuff/Cleanse/Clear/Stun prevention implemented in `pvp/move.ts` and checked by action branches | PvP/Solo/Tower | NO for shared jutsu | Low | Future core effect reducer. |
| Ground effects / AOE | Geometry in core; canonical ground tag/filter/plan in `resolve-jutsu-action.ts`; ground application/tick in `pvp/move.ts`; N-target reduction in `cast-reducer.ts` | PvP, Solo, Tower | POLICY divergence | Medium. Tower N-actor target ordering and one-cast/many-hit semantics differ structurally but are tested. | Core geometry/planning/reducer; mode adapter for actor projection and environment objects. |
| Stealth | No executable shinobi status/effect named Stealth was found. `n-actor.ts` exposes a generic mode veto hook that could represent stealth/protection, but no live Stealth rule was found in this family. | None proven | Not applicable | UNKNOWN if a product surface expects it. Do not invent a combat rule. | No owner until a live rule or confirmed requirement exists. |
| Death | Fighter HP clamp/post-damage lives in shared effect flow; PvP `checkWinner`, Solo terminal projection, and Tower side-alive/objective logic decide terminal state | Respective engines | POLICY divergence | Low. Different participant topology requires different terminal policies. | Shared HP invariants; mode-owned terminal policy. |
| Victory / turn limit | PvP uses two-fighter winner/draw and normalized effective health at max rounds; Solo owns player/enemy outcome; Tower owns last-side/objective/wave rules | Respective engines | YES, intentional | Low if kept explicit; high if falsely unified. | Mode engines, not shared combat math. |
| Rewards | PvP claim/recovery modules, PVE fight-outcome settlement, Tower/Spire settlement, Clan Boss contribution/settlement, Hollow Gate parent settlement | Dedicated server endpoints/services | YES, intentional | High sensitivity. These are distinct economic authorities and must remain outside the combat reducer. | Economy/progression settlement services invoked by mode-specific sealed outcomes. |
| Equipment modifiers | Session creation loads saved equipment/admin/forged definitions and derives sealed combat multipliers; core formulas consume normalized numbers | PvP session, Solo/Tower admission adapters | POLICY divergence | Medium. Each admission path must reject client-supplied definitions and preserve forged recovery. | Shared equipment-to-combat snapshot builder is a candidate only after cross-mode fixtures. |
| Weapon effects | PvP creates a server-catalog-derived synthetic jutsu, applies range/AP/cooldown/charge rules, then uses shared jutsu effects; Tower has a parallel sealed-item N-actor action path | PvP/Tower; Solo item/weapon policy in Solo engine | POLICY divergence | Medium-high due to duplicated action validation, despite shared effect math. | Shared normalized weapon resolver after exact characterization of costs, charges, target rules, and aliases. |
| Armor effects | Equipment multipliers/reflect/absorb/lifesteal are derived from sealed server definitions and consumed by effect phases | PvP/Solo/Tower adapter paths | UNKNOWN for complete cross-mode parity | Medium. No failure was observed, but builders are separate. | Shared equipment snapshot contract with mode-specific exclusions. |

## Verified tag and catalog coverage

Executing `buildJutsuParityInventory()` over shipped content produced:

- 217 jutsu: 117 built-in and 100 legacy;
- target counts: 180 opponent, 25 self, 12 empty ground;
- methods: 171 single, 37 AOE burst, 9 AOE circle;
- AP values: 20, 40, 60;
- cooldown values: 2, 7, 10;
- ranges: 2, 3, 4, 5;
- zero missing AI-referenced jutsu IDs;
- zero unmapped canonical tags.

Accepted aliases are normalized before behavior mapping: `Seal -> Bloodline Seal`, `Afterburn -> Ignition`, `Time Compression -> Lag`, `Time Dilation -> Overclock`, and `Vamp -> Siphon`.

## Mode ownership outside the shared shinobi family

| Family | Canonical implementation | Why it is not a duplicate of shinobi combat |
| --- | --- | --- |
| Pet Showdown | `api/pet/_showdown-engine.ts` and Showdown handlers | Separate party/turn script and pet stats; used for practice, Coliseum, ladder, clan/sector war. |
| Pet Warfront | Warfront engine/handlers under `api/pet` and client replay | Tactical grid with sealed server inputs and its own capped/rewarded modes. |
| Pet Gauntlet | Gauntlet grid engine/handler | Server-replayed decision transcript and receipt. |
| Pet cinematic duel | Pet battle start/result and realtime duel session | Cinematic replay/log authority; live PvP is memory-only and unrewarded, token modes settle exact proofs. |
| Chronicle / Card Clash | Card Clash and war card handlers | Card/deck/turn rules, not jutsu/AP combat. |
| Client-local pet duel | Client practice-only engine | Registry marks it no-reward/client-only; it is not an authority for persisted outcomes. |

## Non-combat sources of truth found during Phase 0/1

| Rule family | Current owner(s) | Conflict status | Risk / next audit |
| --- | --- | --- | --- |
| Generic save field ownership | `api/save/_state-ownership.ts` consumed by `api/save/[name].ts` and projections | One manifest exists. The file was concurrently modified during this audit. | Re-run golden/parity/ratchet tests after the user change settles. |
| Save concurrency | `_saveVersion.ts`, `withKvLock`, handler version checks, domain receipts | Multiple mechanisms serve different operations, not proven duplicates. | Phase 4/5 should classify each mutating route by mechanism. |
| Currency balances | Fields on `save:<player>` or shared treasury records, mutated by domain endpoints | No single generic economy writer; many domain writers are intentional. | High-value Phase 5 map must enumerate every source/sink and concurrency guard. |
| Economy telemetry | `_economy.ts` | Explicitly best-effort and not balance authority. | Aggregate updates are lock-free and may undercount; the recent transaction list is declared the dispute trail. Performance/integrity audit required. |
| Durable economic workflow | `_durable-settlement.ts`, `_economy-tx.ts`, `_economic-receipt.ts`, `_cross-key-settlement.ts` | Separate abstractions exist for different failure shapes. | Architectural risk: route-by-route use must be mapped before consolidation. |
| Item definitions | Built-in `pvp/_item-catalog.ts`; canonical published `content:*`; admin catalog/tombstones; per-player forged definitions with `forged-item:*` recovery | Layered sources are explicit. | Phase 4 must enumerate creation and ensure every consumer honors tombstones/forged recovery. |
| Runtime combat ownership | `shared/runtime-mode-registry.ts` | Executable registry; five non-match rows are explicit. | Keep the generator check in CI and resolve the one legacy defect independently. |
| Presence | Process-local `onlineStore`, bounded `presence:snapshot` recovery | Single-process authority only. | Horizontal scaling blocker, not a current one-replica defect. |
| Scheduled work ownership | In-process timers plus `cron:lease:*` exact-owner leases | Consistent distributed lease helper. | Confirm every future timer uses it; game-loop soft state is intentionally excluded. |

## Proven issues and risks

### PROVEN BUG

- `pet-ranked-legacy-compat`: retained compatibility notices display a cinematic duel while settlement replays the legacy duel, so the displayed winner can be rejected. The current Pet Ladder queue does not create this path. Evidence is encoded in the executable runtime registry and generated registry test suite.
- Live Socket.IO pet duel: `petduel:finished` is described as a non-authoritative hint whose premature use is ignored, but the handler unconditionally runs the complete deterministic replay and calls `finishDuel` for any running participant session. A participant can therefore end the unrewarded live presentation early. The computed winner remains server-owned and no reward path is attached.

### ARCHITECTURAL RISK

- `api/pvp/move.ts` is both an HTTP handler and the live shared jutsu/DOT/ground-effect library for Solo and Tower. This is working and tested, but it increases coupling and makes route-module changes unusually high impact.
- Basic actions and portions of AP/cooldown validation are repeated across PvP, Solo, and Tower. Existing parity tests reduce risk; no mismatch was proven in this audit.
- Weapon/equipment snapshot builders are mode-specific. Shared final math does not prove all admission paths seal identical inputs.
- Cross-key economic consistency is implemented through multiple lock/receipt/saga helpers over a KV table. This may be appropriate, but route-by-route classification is still required before any unification.

### UNKNOWN

- No live shinobi Stealth rule was found. The generic N-actor targeting hook alone is not proof of a feature.
- Admin-published jutsu were not present in the deterministic shipped-catalog inventory run; live-data content must be scanned separately before asserting 100% production catalog coverage.

## Refactor gate decision

- **Gate A — Understand:** passed for the runtime path and shared shinobi geometry/AOE dependency.
- **Gate B — Test:** passed for geometry/AOE through `combat-core/_grid.test.ts`, `pvp/_aoe.test.ts`, Tower engine/AOE tests, and the full combat suite.
- **Gate C — Scope:** a direct Tower import from `combat-core` is isolated and reversible.
- **Gate D — Verify:** passed: 123 focused core/PvP/Tower tests, server build, and runtime-mode documentation check.
- **Gate E — Diff:** passed: the source diff is one import redirection; no function, signature, constant, persistence shape, or compatibility export changed.

No formula, AP value, cooldown, tag behavior, reward, persistence schema, or public API is authorized by this audit to change.
