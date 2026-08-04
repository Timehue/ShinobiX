# Combat Runtime Boundaries

Status: verified against the executable routes on 2026-08-03.

This document is the ownership contract for combat runtimes. It supersedes
older migration notes that treated the Battle Tower engine as the default
server-authoritative PvE engine.

## Owner decisions

- Normal one-player shinobi combat uses the `solo-pve` runtime and keeps the
  current Arena presentation.
- Dedicated player-versus-player combat remains in the `pvp` runtime.
- Battle Towers own multiplayer, party, N-actor, objective, and deliberately
  Tower-shaped special encounters. Tower is not the default solo-PvE backend.
- Hollow Gate shinobi encounters are normal solo PvE. They must not be routed
  through Tower.
- Pet Arena and Card Clash remain independent games and must not import a
  shinobi-combat session or resolver.

## Verified current inventory

| Experience | Current authority | Current runtime/store | Target |
|---|---|---|---|
| Casual/ranked/war PvP | Server | `PvpSession`, `pvp:<battleId>` | Keep `pvp` |
| Battle Towers / Endless Spire | Server | `TowerSession`, `tower:<runId>` | Keep `tower` |
| Clan boss / party-special encounters | Server | Tower-shaped N-actor session | Keep special/Tower ownership |
| Generic catalog AI fights | Server | `SoloPveSession` from `missions/ai-fight-start`; normal Arena presentation adapter | Keep `solo-pve`; unknown profiles and server failures fail closed |
| C/B/A/S combat missions | Server | Tower-shaped session from `missions/combat-start` | Move to `solo-pve` |
| E/D combat missions | Client outcome remains accepted | Local Arena plus queue claim | Move to `solo-pve`, then delete trust exception |
| Story bosses | Server | Tower-shaped session from `story/boss-start` | Move to `solo-pve` |
| Weekly boss | Server | Deliberately special Tower-shaped score encounter | Keep special ownership unless separately redesigned |
| Endless mode (`/endless/run`) | Client fight, server wave bookkeeping | AI-fight token proof | Move each wave to `solo-pve` |
| Hollow Gate shinobi fights | Client supplies win/loss/flee and surviving HP | HG run binding plus local Arena | Move to `solo-pve`; preserve HG run/augment/reward rules |
| Hollow Gate pet fights | Server-verified pet receipt | Pet runtime | Keep pet runtime |
| Pet Arena | Server/client pet-specific flow | Pet session and pet formulas | Keep separate |
| Card Clash | Card-specific flow | Card engine | Keep separate |

`story/spar-start` and `endless/wave-start` both exist and are registered in
`server.ts`. The Academy host actively calls `story/spar-start`; the normal
Endless client still does not call `endless/wave-start` and therefore continues
to run rewarding waves locally. A registered handler is only a live player
journey when the machine inventory also proves a client caller.

## Shared versus runtime-owned code

Shared code may own only rules that are identical across shinobi runtimes:

- canonical player hydration from `hydrateCharacterFromSave`;
- server-sealed equipped jutsu, items, item charges, stats, and modifiers;
- deterministic grid, status, resource, and formula primitives in
  `api/combat-core/`;
- the existing PvP-backed player jutsu resolver until it is extracted behind a
  runtime-neutral adapter;
- parity fixtures and golden replays.

Each runtime owns its orchestration and persistence:

| Runtime | Owns |
|---|---|
| `pvp` | two-player identity, role authorization, PvP turn shell, PvP rewards/history |
| `solo-pve` | one human versus server enemies, AI turns, normal-PvE difficulty rules, versioned intent API, reconnect, mode settlement bindings |
| `tower` | N-actor queue, party membership, objectives, boss phases, Tower terrain/modifiers, Tower settlement |
| `pet` | pet stats, pet moves, pet matchmaking/results |
| `card` | deck/card rules and card settlement |

No runtime may read another runtime's key as proof of victory. Settlement must
check an explicit runtime discriminator and the binding for the owning mode.

## `solo-pve` session contract

A solo session is a server record, not a client combat snapshot. At minimum it
contains:

- `runtime: 'solo-pve'`, schema version, session ID, owner, encounter kind and
  server-authored encounter reference;
- authoritative player/enemy fighters, positions, resources, cooldowns,
  statuses, ground effects, turn/AP state, round, log, and terminal outcome;
- monotonically increasing `version` plus a bounded move-token receipt ring;
- creation/action/expiry timestamps and `settlementState`;
- server-sealed environment and mode metadata needed to reproduce and settle
  the encounter.

The action endpoint accepts intent only: session ID, expected version, move
token, action kind, and identifiers/targets needed for that action. It must not
accept fighter snapshots, HP, resources, enemy stats, multipliers, rewards, or
an outcome.

Every mutation is serialized by a fail-closed session lock. A successful action
increments the version. A duplicate move token returns the current state
without replaying the action. A stale expected version is rejected with the
current version/state so a reconnecting client can recover safely.

## Settlement contract

Mode settlement must derive outcome and surviving state from the terminal
`solo-pve` session, verify owner and encounter binding, and place the one-time
receipt in the same fail-closed save mutation as rewards, costs, item
deductions, and persistent HP. A client-declared result can be telemetry but
never authority.

## Runtime guards

Required static and behavioral guards:

- normal solo entry points cannot import `TowerSession`, `_tower-store`, or
  `_engine` after their migration;
- Tower entry points cannot persist `runtime: 'solo-pve'` sessions;
- pet/card code cannot import shinobi combat sessions;
- settlement rejects a session with the wrong runtime, owner, binding,
  encounter, or non-terminal status;
- fighter hydration and player-side action resolution stay parity-pinned across
  PvP, solo PvE, and Tower adapters.

## Migration order

1. Add and test the isolated `solo-pve` session/store/action foundation.
2. Move generic catalog AI fights and remove their local outcome-authoritative
   fallback.
3. Move E/D missions, then C+ missions and story encounters.
4. Move each Endless wave.
5. Move Hollow Gate shinobi fights, preserving normal Arena presentation and
   HG-specific run/augment/reward behavior.
6. Delete retired client resolvers, Tower compatibility bindings, and trust
   flags only after all callers and rollback windows are gone.
