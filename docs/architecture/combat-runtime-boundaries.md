# Combat Runtime Boundaries

Status: verified against executable routes on 2026-08-15 after the Phase-3 boundary hardening.

This is the ownership contract for combat runtimes. Server authority and Tower
are separate concepts: normal one-player shinobi combat uses `solo-pve`, while
the enumerated Tower modes use Tower for shinobi parties, N-actor queues, or
Tower-specific objectives. Pet and Card participant models remain independent.

## Owner decisions

- One human shinobi against one AI uses `solo-pve` and the normal Arena UI.
- Player-versus-player combat stays in `pvp`.
- Battle Towers (solo or party), Endless Spire, Clan Boss, Tower PvP, and the
  declared headless village-war mercenary battle use Tower. Tower is not the
  default server-authority backend. The former Tower-backed Sector garrison
  fallback (`resolveMercBattle`/`sealTowerFighter`) stays retired for good —
  Sector War's `garrison-start`/`garrison-resolve` actions
  (`api/village/sector-war.ts`) now resolve the liveness fallback as a genuine
  Solo PvE session against a sealed snapshot of the defending village's real
  ANBU (`api/_sector-war-garrison-encounter.ts`, reusing
  `api/_anbu-infiltration-store.ts`'s roster/snapshot code verbatim), never
  Tower. The mode is labeled `pvp` because Sector War orchestrates its scoring
  into the same contest a live human duel feeds — not because its combat
  engine is PvP's.
- Hollow Gate shinobi encounters are normal Solo PvE. The mounted Hollow Gate
  pet caller uses one parent-prebound cinematic proof and an exact versioned
  result receipt. New Showdown admission and unbound legacy Showdown adoption
  fail closed; a legacy parent may recover only the unique exact active
  same-player/run cinematic child. The long-term replatform choice remains
  owner-controlled; it is not a second current authority or a generic pet
  boundary.
- Pet Showdown/Coliseum, positional Warfront/Tactical, the Gauntlet grid,
  cinematic Pet Arena duels, legacy pet duels, and client-local pet duels are
  separate authorities or explicitly recorded compatibility paths. The
  rewarding Dungeon Pet seal now uses the cinematic family; that does not make
  generic client-local presentation valid reward proof.
- Card Clash remains an independent Chronicle game.

## Verified current inventory

Current executable mode, owner, route, caller, and status truth lives in
[`shared/runtime-mode-registry.ts`](../../shared/runtime-mode-registry.ts) and
its [generated projection](../generated/runtime-mode-registry.md). The table
below remains a hand-authored boundary summary; the detailed Solo cutover,
keyspace, and rollback narrative remains in
[`combat-runtime-inventory.md`](combat-runtime-inventory.md).

| Runtime | Mounted or intended boundary summary |
|---|---|
| `pvp` | Casual, ranked, direct challenges, human-defender Sector War shinobi duels, Clan War shinobi 1v1, and the Sector War ANBU-garrison liveness fallback (Sector War orchestrates the scoring; the fight itself runs on `solo-pve`); Clan War shinobi 2v2 names PvP as its intended owner but new progression is retired fail-closed until a four-player lifecycle exists |
| `solo-pve` | Generic/published AI (including Apex, explore ambushes, and village-guard raids), server-reconstructed World-context hunts/wanderers, all combat missions, Academy spar, story bosses, normal Endless waves, Hollow Gate shinobi encounters, Weekly Boss attempts, ANBU infiltration, and (under Sector War's `pvp`-labeled orchestration) the Sector War garrison fallback |
| `tower` | Battle Towers, Tower parties, Endless Spire, Clan Boss, Tower PvP, and declared headless village-war mercenary battles; the Sector garrison fallback stays off Tower for good — it now runs on `solo-pve` |
| `pet-showdown` | Showdown practice, the sole new paid Coliseum admission and progression settlement, Showdown ladder, and Showdown-backed Sector/Clan War pet fights |
| `pet-warfront` | Pet Warfront, Pet Ladder Warfront, and co-op Tactical preview; standalone Tactical remains a distinct missing surface even where Warfront-family reuse is allowed |
| `pet-gauntlet-grid` | Pet Gauntlet's deterministic grid draft, transcript replay, and capped settlement |
| `pet-cinematic-duel` | Exact-cardinality ordinary live PvP 1v1/2v2 Socket.IO replay, exact parent-bound Hollow Gate and Dungeon PvE replays, and bounded recovery/settlement of already-issued pre-cutover Arena-AI tokens; new user-picked Arena-AI and live-ranked admission are retired fail-closed and name this family only as their intended owner |
| `legacy-pet-duel` | New `rankedPet` challenge creation is retired fail-closed; retained notices/start tokens/results remain recoverable, although cinematic client playback and legacy server replay can disagree. It is not the public Pet Ladder queue |
| `client-local-pet-duel` | Historical and non-rewarding local pet presentation only; it remains separately named and is never accepted as combat or reward proof |
| `chronicle` | Card Clash, sector-card, clan-war card, and dungeon-card combat; the Dungeon Card terminal now stamps the exact active run before parent settlement |

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
| `pet-showdown` | turn-based pet commands, bench/switch/stamina state, Showdown scripts, and the only new paid Coliseum receipts |
| `pet-warfront` | positional teams, formations, lanes/objectives, deterministic Warfront replay, and Warfront-family settlement |
| `pet-gauntlet-grid` | run-only draft state, grid placements, deterministic transcript replay, and capped run settlement |
| `pet-cinematic-duel` | cinematic 1v1/party input logs; recovery and settlement of exact already-issued Arena-AI receipts without new admission; the parent-prebound Hollow Gate proof; the server-selected Dungeon Rare Beast and its parent-run proof; and server-sealed, memory-only live PvP transport with no reward/rating write |
| `legacy-pet-duel` | retained sealed legacy ranked challenge inputs and compatibility settlement; new notices are retired and it is not a substitute for the public ranked surface, Showdown, Warfront, Gauntlet, or cinematic authority |
| `client-local-pet-duel` | presentation-only local duel state; it is never valid reward proof |
| `chronicle` | decks, hidden projections, card actions, match state, and settlement |

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
outcome. The unreachable local Arena reducer, board, AI policy, and snapshot
writer have been retired; `Arena.tsx` is now a lobby and admission/delegation
surface only. Rolling-upgrade Arena snapshots are removal-only compatibility
data and never mount local combat.

The shared AI vocabulary includes forward Tower/party concepts, but Solo only
evaluates concepts meaningful to one-human/one-enemy state. A future Tower
adapter must evaluate allies, objectives, threat, and multi-actor selectors
from sealed Tower state. The normalized combat event is emitted by Solo today;
history, achievement, clan/village analytics consumers and other runtime
adapters remain follow-up work rather than completed features.
