# PvP / Solo-PvE jutsu parity

Status: authoritative contract, 2026-08-04  
ShinobiX baseline: `5c699ccf0eca7837494a64a8fd96df41bd101439`  
the third-party reference reference inspected read-only: `df6dcd0d7d4b23d9cf309ea3a0159f366f764869`

## Contract

PvP and Solo-PvE resolve the same sealed jutsu intent through the same action
planner and formula resolver. For the same fighters, board, round, weather,
jutsu, target, and pre-cast state they must agree on:

- eligibility, effective AP, action count, chakra, stamina, and cooldown;
- direct, self, movement, empty-ground, ring, and spiral targeting;
- damage, healing, shields, status payloads, active rounds, and durations;
- push/pull destination, ground footprint, immediate zone application, and
  ongoing zone state;
- semantic VFX key, anchor, area tiles, and persistence.

Runtime-specific transport, turn automation, AI policy, settlement, telemetry,
and presentation are adapters around that contract. They are not alternate
jutsu engines.

## Executable inventory

`api/combat-core/jutsu-parity-inventory.ts` derives the census from live code.
The starting review snapshot is:

| Dimension | Derived values |
| --- | --- |
| Executable shipped jutsu | 217 total: 117 built-in, 100 legacy |
| Targets | 180 opponent, 25 self, 12 empty-ground |
| Methods | 171 single, 37 burst, 9 circle |
| AP | 20, 40, 60 |
| Cooldown | 2, 7, 10 |
| Range | 2, 3, 4, 5 |
| Live canonical tags | 21 represented; all 36 accepted canonical tags classified |
| AI references | 30 unique jutsu IDs, zero missing |

Admin-published jutsu are dynamic. The same inventory builder accepts the
authoritative published admin collection and classifies it as
`admin-published`; its CI specimen proves creator-authored target, method,
resource, cooldown, range, and tag fields enter the same census. A production
inventory export must pass the loaded admin collection rather than treating the
offline shipped count as exhaustive.

`api/combat-core/jutsu-parity-inventory.test.ts` fails when an accepted tag lacks
a behavior family, an executable jutsu is unclassified, or a sealed AI profile
references an absent jutsu.

## Ownership

| Concern | Authoritative module |
| --- | --- |
| Cast eligibility, cost, target, footprint, cooldown | `api/combat-core/resolve-jutsu-action.ts` |
| Damage, healing, shields, statuses, displacement | `api/pvp/move.ts` shared `applyJutsu` path plus `api/combat-core/formulas.ts` |
| Hex rings and disks | `api/combat-core/aoe.ts` |
| Semantic cast VFX | `api/combat-core/jutsu-vfx.ts` |
| PvP persistence, locks, receipts, turn transport | `api/pvp/move.ts` |
| Solo state machine, AI turns, encounter adapters | `api/solo-pve/_engine.ts` |

The long-term seam remains `combat-core`; moving the remaining historical
`applyJutsu` body there is mechanical extraction, not permission to introduce a
second behavioral implementation.

## Intentional mode exceptions

`api/combat-core/mode-exceptions.ts` is the closed registry:

- `solo-difficulty-guard`: caps generated-enemy incoming damage envelopes;
- `weekly-boss-score-attack`: applies the boss round multiplier, damage guard,
  and sealed survival round budget;
- `hollow-gate-director`: applies floor-sealed damage directives, positional
  hazards, and a sealed no-retreat rule.

These exceptions cannot override AP, resources, cooldown, target, range,
method, tags, status duration, AOE footprint, or semantic VFX. A mode-specific
balance adjustment must be added to the registry with a test and rationale.

## Reference implementation findings

The the third-party reference reference was used only for behavioral and proportion research.
Its useful structural ideas are independent combat regions (timer, battlefield,
actions, timeline/log), map sizing that preserves the real board aspect ratio,
tabbed secondary information, and persisted presentation preferences. No source,
styles, assets, branding, or visual identity were copied.

## Verification

The primary parity harness is
`api/combat-core/pvp-solo-jutsu-parity.test.ts`. It invokes the real PvP request
handler and the real Solo action engine from equivalent sealed sessions, then
compares normalized state. Its catalog sweep covers every shipped executable
jutsu. Targeted cases and mutation sentinels cover boundaries that a neutral
catalog cast cannot exercise, including insufficient AP/resources, cooldown,
range, status timing, AOE footprint, immediate ground application,
displacement, resource ordering, mastery/level boundaries, and VFX semantics.

Required validation before merge:

```text
node --import tsx --test api/combat-core/pvp-solo-jutsu-parity.test.ts
node --import tsx --test api/combat-core/jutsu-parity-inventory.test.ts
npm test
npm run build:server
cd shinobij.client && npm run lint && npm run build
```

Responsive combat verification additionally runs the live Solo-PvE and PvP
flows in Chromium, Firefox, and WebKit at phone, tablet, desktop, and ultrawide
viewports. Screenshots and measured layout telemetry live under
`docs/screenshots/combat-layout/`.
