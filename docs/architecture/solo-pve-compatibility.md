# Solo-PvE combat compatibility

This report is enforced by `api/solo-pve/_compatibility.test.ts`. A generated or admin-sealed loadout that contains an unsupported target, method, tag, or item target fails at encounter creation instead of entering a battle that can fail mid-cast.

## Published content snapshot

Snapshot date: 2026-08-04

| Content | Checked | Result |
| --- | ---: | --- |
| Current + legacy jutsu catalogs | 217 | 0 unsupported |
| Item catalog | 164 | 0 unsupported |
| AI profiles | 71 profiles / 30 unique jutsu references | 0 unresolved or unsupported |
| Ground-target jutsu | 12 | 0 unsupported |
| Move-tagged jutsu | 12 | 0 unsupported |

Published target distribution: `OPPONENT` 180, `SELF` 25, `EMPTY_GROUND` 12. Published method distribution: `SINGLE` 171, `AOE_BURST` 37, `AOE_CIRCLE` 9.

## Supported authoring contract

Targets: `OPPONENT`, `SELF`, `OTHER_USER`, `CHARACTER`, and `EMPTY_GROUND`. In the one-human/one-enemy runtime, `OTHER_USER` and `CHARACTER` resolve to the sealed enemy.

Methods: `SINGLE`, `ALL`, `AOE_CIRCLE`, `INSTANT_EFFECT`, `AOE_SPIRAL`, and `AOE_BURST`. The historical `AOE_LINE` spelling remains an input alias for `INSTANT_EFFECT`. `ALL` and `AOE_BURST` resolve to the one sealed enemy in this 1v1 runtime; multi-target fan-out remains a Tower/team-runtime responsibility.

Movement and ground targets use the canonical 12x10 odd-column hex grid. Destinations must be on-board, open, unoccupied, within the sealed range, and not blocked by terrain or an active Barrier. `AOE_CIRCLE` movement applies its ring impact only when the enemy is adjacent to the landing tile. `INSTANT_EFFECT` creates the center-plus-neighbors zone, while `AOE_SPIRAL` creates a radius-two filled disk. Persistent zones accept the canonical `Decrease Damage Given`, `Recoil`, and `Poison` ground tags.

Jutsu formulas, tag/status resolution, DoTs, ground-effect application, status ticking, resources, cooldowns, and weather multipliers call the same server modules used by PvP. Basic movement remains one adjacent hex; the normal Arena has no separate basic Dash action. Move-tagged jutsu are the normal Arena's ranged movement mechanic.

Items support sealed equipped weapons, thrown-weapon charges, consumable charges, restore-only potions, cooldowns, canonical weapon effects/tags, and `weaponEffectTarget: "both"` behavior such as Smoke Bomb. Client-supplied item definitions or inventory counts are never consulted after session creation.

## CI guard

The guard fails when:

- a published or AI-referenced jutsu cannot resolve;
- a target, method, combat tag, item effect, or item target is outside the declared vocabulary;
- `INSTANT_EFFECT` is not ground-targeted;
- `AOE_SPIRAL` lacks either `Move` or `EMPTY_GROUND`;
- a persistent ground method has no supported ground tag; or
- the catalog counts change without updating this checked report.
