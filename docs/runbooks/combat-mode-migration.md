# Normal Solo-PvE Runtime Migration

Status: cutover complete on 2026-08-04.

The governing boundary is simple: one human shinobi against one AI uses the
dedicated `solo-pve` runtime and normal Arena presentation. Genuine parties,
N-actor turns, and objectives remain Tower-owned.

## Completed result

The isolated session, store, engine, versioned action service, state/action
handlers, and route registration under `api/solo-pve/` are live for:

- generic and published creator AI fights;
- E/D and C/B/A/S combat missions;
- Academy spar and story bosses;
- normal Endless waves;
- Hollow Gate shinobi encounters;
- Weekly Boss attempts; and
- ANBU infiltration.

Every migrated start either mints/resumes a bound Solo session or fails closed.
The Arena adapter sends intent and renders returned state/events. No rewarding
fallback accepts a locally computed win, loss, HP pool, enemy, multiplier,
items-used record, or reward.

## Compatibility result

The CI census covers 217 current/legacy jutsu, 164 items, and 71 built-in AI
profiles with zero unsupported or unresolved entries. The 12 published
ground/movement jutsu rejected by the starting Solo engine now resolve through
canonical hex-grid, movement, persistent-zone, and jutsu rules. Items and the
optional four-phase companion are server-sealed and server-resolved.

## Settlement and recovery

Each mode retains its own durable binding and receipt while Solo owns combat.
Settlement derives winner, surviving pools, item/companion use, and terminal
truth from the session. The mode's fail-closed save mutation commits reward,
cost, item deduction, HP, and receipt together. Durable recovery markers close
the cross-key windows where a terminal session or binding write succeeds before
the owning run/save mutation; the identical request repairs or returns the
already-applied result.

## Completed stages

1. Isolated Solo foundation and action/state routes.
2. Generic AI vertical slice and removal of rewarding local fallback.
3. E/D, C+, Academy, and story cutovers with original eligibility and reward
   fingerprints preserved.
4. Endless bound wave start, retryable terminal settlement, and sealed opponent
   resume.
5. Hollow Gate combat cutover while retaining augments, second wind, no-retreat,
   exact ledger credits, pet receipts, extraction, and death reconciliation.
6. Participant-model audit and cutover of Weekly Boss and ANBU; the retired
   ANBU custom action operation returns HTTP 410.
7. Canonical admin AI dual-read, validated rule publication/execution, and the
   normalized Solo combat-event contract.

## AI authoring boundary

`api/combat-core/ai-authoring.ts` owns a bounded, non-recursive vocabulary for
HP/resources, distance/round, status, cooldown, recent player action, target
selectors, legal jutsu purpose, movement, heal/buff/counterplay, and end turn.
Publication proves references and fallbacks before writing. Solo evaluates its
applicable state and deterministically falls through impossible actions while
respecting resources, cooldowns, board legality, and difficulty competence.

Ally/add, objective, threat, summon/add, hold-objective, and multi-actor target
semantics are declared shared adapter points. They are not a completed Tower AI
feature until a Tower caller evaluates them against sealed Tower state and an
end-to-end party/objective journey passes.

## Combat-event boundary

Every Solo action/rejection/companion event includes the bounded normalized
contract from `api/combat-core/events.ts`: runtime/mode/session/round,
actor/target/action, AP/resources, resolver raw and resolved damage, HP/shield
routing, healing/shielding, statuses, movement, zones, items, objective facts,
down/revive/summon/dismiss/flee, and terminal outcome. It contains no account
name, owner slug, character record, credential, or client-trusted input.

The contract is a foundation. Other runtimes and downstream battle history,
achievement, logbook, mission, clan/village, analytics, support, and anti-cheat
consumers still require explicit adapters.

## Required regression checks

1. Canonical fighter hydration and action parity.
2. Compatibility census and AI catalog drift.
3. Forged combat fields ignored or rejected by construction.
4. Duplicate, stale, concurrent, reconnect, and expiry behavior.
5. Runtime/owner/binding/terminal/replay settlement rejection.
6. Atomic save effects and durable recovery under injected failure.
7. Static runtime-import and live-client-caller inventory.
8. Full server/client tests, builds, lint, audits, release certification,
   deployment/assets/size checks, and all Playwright projects.

Tower, local, or trust-based rollback is prohibited. Operational rollback may
disable a start and preserve recovery state, but must continue to fail closed
for rewards.
