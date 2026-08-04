# Normal Solo-PvE Runtime Migration

This runbook implements the boundary contract in
`docs/architecture/combat-runtime-boundaries.md`. The governing decision is
that server authority and Tower are separate concepts: normal one-player combat
uses a dedicated `solo-pve` runtime while keeping the Arena experience.

## Implementation status (2026-08-03)

- The isolated session, store, engine, versioned action service, state/action
  handlers, and route registration exist under `api/solo-pve/`.
- The foundation has focused tests for canonical fighter parity, runtime/key
  isolation, sealed action lookup, server AI turns, PvE damage guards,
  consumable accounting, fail-closed locking, concurrent writes, stale
  versions, duplicate tokens, tampered payloads, expiry, and ownership.
- A Tower-free generic-AI encounter builder and a runtime-discriminated token/
  settlement bridge exist. Existing live AI starts still mint Tower sessions.
- The client wire contract exists in `shinobij.client/src/lib/solo-pve-api.ts`.
  No Arena entry point consumes it yet, so this work does not change live combat.
- The next cutover is the Arena adapter plus generic catalog-AI start wiring;
  local temporary-opponent fallback removal and browser parity are part of that
  same cutover, not a later cleanup.

## Do not rebuild

- `hydrateCharacterFromSave` in `api/pvp/session.ts` is the canonical player
  fighter builder.
- `api/combat-core/` owns shared deterministic formulas, grid helpers,
  resources, and statuses.
- PvP's player jutsu resolver is already reused by Tower and should be adapted,
  not copied.
- Existing mode bindings, reward fingerprints, save mutation utilities, and
  receipt patterns remain useful after their session type changes.

`buildAuthoritativeSoloEncounter`, `TowerSession`, `_tower-store`, and the Tower
engine are compatibility sources for currently migrated modes, not the target
normal-PvE architecture.

## Stage 1: isolated foundation

Add `api/solo-pve/` with:

- a discriminated, schema-versioned session model;
- a separate `solo-pve:<sessionId>` store and TTL;
- fail-closed per-session locking;
- `state` and versioned `action` handlers;
- a deterministic one-human-versus-server-AI orchestrator that delegates shared
  player action resolution to combat-core/PvP adapters;
- bounded move-token idempotency and reconnect semantics;
- no reward logic in the generic action handler.

The foundation is not live until its handlers are explicitly registered in
`server.ts` and one entry point mints its sessions.

## Stage 2: generic catalog AI vertical slice

Migrate `missions/ai-fight-start` first because it has a small settlement
surface.

1. Resolve the opponent from the server catalog.
2. Hydrate the player from the save and server catalogs.
3. Mint a `solo-pve` session and bind its ID into the existing single-use fight
   token.
4. Drive Arena controls through the solo action API. The client sends intent
   and renders returned state.
5. Make `report-ai-fight` require the matching terminal solo session for a
   migrated token and derive win, HP, item use, and defeat costs from it.
6. Do not silently downgrade to a local authoritative fight. An unresolved
   temporary opponent must either be server-authored before launch or remain on
   an explicitly named, non-rewarding compatibility path.

Ship with a default-on release flag and an emergency disable flag. A disabled
server path must fail closed for rewards; it must not restore trust in a client
win claim.

## Stage 3: missions and story

- Migrate E/D combat missions, then remove
  `clientTrustedCombatMissionRewardAllowed` and its queue-claim exception.
- Migrate C/B/A/S mission bindings from `TowerSession` to `SoloPveSession`
  without changing reward fingerprints or mission eligibility.
- Migrate story boss entry/settlement. There is no `story/spar-start` route in
  the current tree; verify real route names before adding new wiring.

## Stage 4: Endless

The current `/endless/run` endpoint is bookkeeping, not a wave combat runtime.
Add a bound wave start only when it mints a solo session from server-owned wave
state. The server increments the wave after a matching terminal victory; the
client never supplies the wave result.

## Stage 5: Hollow Gate

Hollow Gate is last because it combines a long-lived run, augments,
consumables, extraction, second wind, and encounter rewards.

- Keep shinobi encounters `runtime: 'solo-pve'` and keep the normal Arena UI.
- Keep Hollow Hound encounters in the pet runtime.
- Seal augment/environment effects into the encounter or derive them from the
  locked HG run; never accept multipliers from the client.
- Derive win/loss/flee, surviving HP, item use, and encounter credits from the
  terminal session.
- Preserve HG-specific second wind, retreat restrictions, hospitalization,
  death retention, and run settlement as mode-owned rules.
- Replace the client haul claim with server-ledgered run credits before
  considering the migration complete.

Hollow Gate must not be moved to Tower as a shortcut.

## Required checks for every cutover

1. Fighter hydration deep-equals the canonical PvP hydration for the same save.
2. Shared player actions match parity fixtures for damage, resources,
   cooldowns, statuses, displacement, and item use.
3. Forged HP/resources/enemies/multipliers/outcomes/rewards are rejected or
   ignored by construction.
4. Duplicate move tokens do not replay; stale versions do not mutate; concurrent
   actions serialize; reconnect returns the authoritative state.
5. Settlement rejects wrong runtime, owner, binding, encounter, active session,
   loss-as-win, and replay.
6. The payout receipt and all save effects commit atomically under a fail-closed
   lock.
7. Runtime import guards prevent a normal solo route from regressing to Tower.
8. Run focused tests during development, then the full test/build/deployment,
   release-asset, lint, and browser journey gates after overlapping feature work
   is stable.

## Removal gate

Delete local Arena authority, Tower compatibility bindings, fallback claims,
and release flags only when no executable route imports them and production has
passed its rollback window. Documentation alone is not evidence of removal.
