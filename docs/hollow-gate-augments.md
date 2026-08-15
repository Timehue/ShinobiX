# Hollow Gate server run and augment contract

Status: shipped and mandatory for browser gameplay.

Current combat-owner and mounted-route status is governed by
[`shared/runtime-mode-registry.ts`](../shared/runtime-mode-registry.ts) and its
[generated projection](generated/runtime-mode-registry.md).

Hollow Gate uses three independent authorities:

- Shinobi combat: the normal `solo-pve` runtime.
- Hollow Hound pet duels: the mounted server-sealed `pet-cinematic-duel` PvE
  path and its run-bound server result receipt. A separate Showdown-capable
  Hollow Gate branch exists but is not the mounted caller, so the long-term
  owner remains unresolved.
- Hollow Gate expedition state: the run token under
  `hg-run:<player>:<token>`.

Hollow Gate does not merge that cinematic path with Showdown/Coliseum, positional
Warfront/Tactical, the Gauntlet grid, ordinary Arena cinematic duels, or the
client-local Dungeon pet path. Those remain distinct authorities or recorded
compatibility/defect paths.

There is no rewarding local fallback. A run without a live server token cannot
start combat, resolve an economy event, or settle.

## Start and resume

`POST /api/hollow-gate/start` authenticates the owner, consumes the entry key,
enforces the server daily cap, derives the canonical depth/event variant, and
mints the run token. The token seals:

- owner, seed, depth, current floor, published board dimensions, and variant boss;
- entry currency and counted-item baselines;
- offered/chosen augment;
- keys, torch, Threat, ward steps, and Second Wind;
- position/step version and a pending server Threat encounter;
- active/resolved combat and non-combat event identities;
- immutable, structurally validated per-floor gameplay manifests;
- the exact reward ledger.

`POST /api/hollow-gate/floor-seal` validates the deterministic browser-generated
floor once, enforces the published dimensions and exact content budgets, proves
full connectivity and target distance, and stores only its walkability/nodes in
the run token. The browser persists richer map presentation for reconnect, but
movement, events, combat, descent, and extraction read only the immutable run
manifest and server position. Mutable saved tiles never authorize gameplay.

## Augments

The server rolls the offer set and accepts only a member of that set under the
run lock. No movement, event, combat, relic, descent, or extraction can race
ahead of the choice.

- Combat effects are derived from `chosenAugmentId` when the Solo PvE encounter
  is built and are enforced by the Solo PvE engine.
- Reward multipliers are derived from the same token and applied when a server
  reward source is recorded.
- Berserker's Gamble seals flee in the engine and extraction at run settlement.
- Treasure Sense removes the Keeper heal choice in presentation and the event
  route independently rejects a forged heal request.

The client receives display fields but never submits a multiplier.

## Movement and non-combat events

`POST /api/hollow-gate/step` accepts adjacent movement intent with a unique
request ID. It owns torch RNG, ward consumption, Threat gain, darkness pressure,
step version, current position, unresolved-combat blocking, and the exact
ambush/boss identity at the Threat threshold.

`POST /api/hollow-gate/event` resolves run-bound, one-time events:

- chests and shard veins;
- shrine Torch refill;
- traps and Second Wind;
- hidden tablets and relics;
- Shrine Keeper choices;
- locked-door chest/trap/pet rolls.

The handler rolls rewards, applies HP changes, updates run resources, writes the
save, and records the ledger source under fail-closed run/save locks. Lost
responses and duplicate requests reuse the event receipt and never apply twice.

`POST /api/hollow-gate/use-consumable` owns every shipped shard relic: Reignite,
Skeleton Key, Hollow Ward, Diviner's Eye cost/use, Sanctify, and Second Wind.
Each request has a bounded idempotency key; duplicate delivery cannot spend
shards or apply an effect twice.

The old `/api/hollow-gate/locked-door` route is an explicit `410` tombstone so a
direct caller cannot roll loot or pets outside the run ledger.

## Combat

`POST /api/hollow-gate/combat-start` validates the run/floor/node/kind, derives
the Hollow Hound and all modifiers, creates a `SoloPveSession`, and writes a
separate Hollow Gate binding. Pet mode writes only its pet binding.

`POST /api/hollow-gate/combat-settle` accepts encounter identity only. Shinobi
settlement reads the terminal Solo PvE outcome, surviving HP, item use, and exact
binding. Pet settlement requires the pet-runtime receipt. Rewards are derived
server-side, written once, and appended to the same exact ledger.

## Exact reward ledger and run end

The ledger records every server credit by unique source ID:

- Ryo, Aura Dust, Aura Stones, Honor Seals, Bone Charms, Fate Shards, and Hollow
  Shards;
- Dungeon Legendary Fragments, Veils of the Hollow, and Elemental Shards.

`POST /api/hollow-gate/settle` accepts only `{ playerName, token, action }`, where
`action` is `extract` or `abandon`. It never reads client outcome, vitals, item
use, boss completion, reward, or haul.

Extraction reconciles each stored balance to at most `entry + exact ledger` while
preserving legitimate in-run spending. Abandon/death applies the server-derived
Greedy Hands retention fraction to currency ledger gains; counted items retain
their shipped behavior. The run token is consumed without importing or mutating
Tower state; combat evidence keeps its independent recovery TTL.

## Invariants

- A source ID credits at most once.
- A combat receipt settles at most once.
- A movement or consumable request ID applies at most once.
- A reward/event node must match the server's current manifest position.
- A terminal Solo PvE session cannot be consumed by pet or Tower settlement.
- A pet receipt cannot settle shinobi combat.
- Generic saves cannot originate Hollow Gate economy gains.
- Client haul, outcome, surviving pools, and reward fields are ignored because
  they are not part of the request contracts.
