# Combat Runtime Boundaries

Status: verified against executable routes on 2026-08-13 after the WorldMap cutover.

This is the ownership contract for combat runtimes. Server authority and Tower
are separate concepts: normal one-player shinobi combat uses `solo-pve` while
real parties, N-actor queues, and objectives use Tower.

## Owner decisions

- One human shinobi against one AI uses `solo-pve` and the normal Arena UI.
- Player-versus-player combat stays in `pvp`.
- Battle Towers, Endless Spire, and Clan Boss own genuine party, N-actor, and
  objective combat. Tower is not the default server-authority backend.
- Hollow Gate shinobi encounters are normal Solo PvE; Hollow Hounds use the pet
  runtime.
- Pet Arena and Card Clash remain independent games.

## Verified current inventory

The detailed executable matrix is in
`docs/architecture/combat-runtime-inventory.md` and is guarded by
`scripts/combat-runtime-inventory.mjs`.

| Runtime | Player-facing owners |
|---|---|
| `pvp` | Casual, ranked, direct challenges, and sector-war shinobi duels |
| `solo-pve` | Generic/published AI (including Apex, explore ambushes, and village-guard raids), server-reconstructed World-context hunts/wanderers, all combat missions, Academy spar, story bosses, normal Endless waves, Hollow Gate shinobi encounters, Weekly Boss attempts, and ANBU infiltration |
| `tower` | Battle Towers, Endless Spire, and Clan Boss party assaults |
| `pet` | Hollow Hound receipts, Pet Arena/Coliseum, and pet-ranked modes |
| `card` | Card Clash and sector-card contests |

`story/spar-start` and `endless/wave-start` both exist, are registered, and have
real client callers. Their rewarding paths require terminal Solo evidence.
Weekly Boss and ANBU were audited by participant model: both current encounters
are one human with the normal optional companion against one AI, so they use
Solo rather than Tower.

WorldMap AI uses two entry contracts without changing combat authority. The
World-context path sends identity only and lets the server reconstruct hunts,
wanderers, chains, quest/story seals, and progression. Apex, explore ambushes,
and village-guard raids use the generic published-catalog path. Both create the
same canonical `SoloPveSession`, use `solo-pve/action`, and settle from sealed
terminal evidence; neither accepts a client-resolved outcome.

## Shared versus runtime-owned code

Shared code may own only rules identical across shinobi runtimes:

- canonical player hydration from `hydrateCharacterFromSave`;
- server-sealed jutsu, items, charges, stats, and modifiers;
- deterministic formula, grid, status, resource, and cooldown primitives under
  `api/combat-core/`;
- the canonical jutsu resolver reused by PvP, Solo, and Tower adapters;
- parity fixtures and golden replays;
- validated bounded AI programs in `api/combat-core/ai-authoring.ts`;
- the privacy-bounded event projection in `api/combat-core/events.ts`.

Each runtime owns orchestration and persistence:

| Runtime | Owns |
|---|---|
| `pvp` | two-player identity, authorization, PvP turns, forfeit, history, rating, rewards |
| `solo-pve` | one human versus server AI, optional companion, difficulty, versioned intent API, reconnect, terminal evidence |
| `tower` | party membership, N-actor queue, objectives, boss phases, Tower terrain/modifiers and settlement |
| `pet` | pet stats, moves, matchmaking, replay/receipt validation |
| `card` | decks, card rules, match state and settlement |

No runtime may read another runtime's key as victory proof.

## `solo-pve` session contract

A Solo session is a server record, not a client snapshot. It contains an
explicit runtime/schema, opaque session and owner identity, server-authored
encounter reference, authoritative fighters and optional companion, board,
resources, cooldowns, statuses, zones, AP/round/turn, ordered events, terminal
outcome, settlement state, version, and a bounded move-token receipt ring.

The action endpoint accepts intent only: session, expected version, move token,
action kind, and required IDs/targets. It never accepts HP, fighter snapshots,
enemy stats, multipliers, rewards, or outcome. A fail-closed session lock
serializes mutations. Duplicate move tokens do not replay; stale versions return
authoritative recovery state.

## Settlement contract

Mode settlement verifies runtime, owner, binding, encounter, terminal status,
and expected outcome. Its fail-closed save mutation commits the one-time receipt
with rewards, costs, item deductions, and persistent HP. Lost responses are
retryable from terminal evidence; a client declaration is never authority.

## Runtime and publication guards

- normal Solo entry points cannot import Tower session/store/engine modules;
- Tower entry points cannot persist `runtime: 'solo-pve'` sessions;
- pet/card code cannot import shinobi sessions;
- settlement rejects wrong runtime, owner, binding, encounter, active session,
  replay, and loss-as-win;
- hydration and player actions remain parity-pinned across adapters;
- the published Solo compatibility census must remain at zero unsupported;
- creator AI publication rejects missing references, invalid targets, missing
  fallback, overlong programs/loadouts, and missing condition operands before
  any requested field commits.

## Cutover result and remaining boundary work

The normal Solo cutover is complete. No rewarding migrated mode accepts a local
outcome. Remaining local Arena execution is explicitly non-rewarding preview or
old-save presentation compatibility.

The shared AI vocabulary includes forward Tower/party concepts, but Solo only
evaluates concepts meaningful to one-human/one-enemy state. A future Tower
adapter must evaluate allies, objectives, threat, and multi-actor selectors
from sealed Tower state. The normalized combat event is emitted by Solo today;
history, achievement, clan/village analytics consumers and other runtime
adapters remain follow-up work rather than completed features.
