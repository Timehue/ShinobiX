# Server Combat Migration Plan

Status: completed on `codex/solo-pve-cutover` (2026-08-04).

## Current authority boundary

PvP (`api/pvp/*`) owns player-versus-player shinobi combat. Tower
(`api/towers/*`) owns genuine party and N-actor encounters: Battle Towers,
Endless Spire, and Clan Boss. Pet and Card combat remain independent.

One-human/one-AI shinobi fights use `solo-pve`. This includes catalog and
published AI fights, hunts, ambushes, guards, wanderers, every built-in combat
mission, Academy sparring, story battles, normal Endless, Hollow Gate shinobi
combat, Weekly Boss attempts, and ANBU infiltration. ANBU uses one live raider
against an AI-controlled daily snapshot. Weekly Boss remains a one-player score
attack while its shared contribution economy stays on the mode route.

Mode bindings seal the owner, mode identity, derived enemy, reward fingerprint,
Solo session ID, expiry, and settlement state. They validate terminal Solo
evidence and keep each mode's economy separate from the combat runtime.

## Completed stages

### Combat missions

`POST /api/missions/combat-start` seals the save and catalog enemy into a Solo
session. `Missions.tsx` renders the normal Arena shell and sends versioned
action intent to `/api/solo-pve/action`. A completed win is validated by
`/api/missions/queue-combat-claim`, which mints a single-use claim authority.
E/D and C/B/A/S all use this path; the rewarding legacy client-win exception is
removed.

### Weekly Boss

`startFight` reserves an attempt, charges stamina server-side, and seals a
20-round Solo score attack. Active-run pointers plus attempt/debit receipts let
a lost start response recover the same run. `logFight` validates terminal Solo
state and banks the server enemy-HP delta once. Legacy `damage` and
`logFightLegacy` reports return HTTP 410.

### Hollow Gate

Each shinobi encounter binds a Solo session to the durable Hollow Gate run,
floor, node, encounter kind, derived enemy, and reward eligibility. The server
owns combat modifiers, active encounter state, exact run ledger, death, Second
Wind, flee restrictions, item charges, extraction, and once settlement. Hollow
Hound fights remain on the pet runtime with a distinct receipt.

### Story, Academy, generic AI, Endless, and ANBU

Academy, story, catalog/published AI, hunts, ambushes, guards, wanderers, raids,
and ANBU create Solo sessions and render through the normal Arena shell. Normal
Endless derives the current wave and opponent from its durable run and settles
terminal vitals and rewards once. No rewarding path falls back to a locally
resolved shinobi fight.

## Required invariants

- Server seals loadout, opponent, environment, runtime, and mode binding.
- Browser requests contain action intent, expected version, and move token only.
- Wrong owner/mode/run, expired bindings, active sessions, and loss-as-win reject.
- Duplicate/concurrent settlement pays and deducts once; failed writes retry.
- Terminal evidence survives lost action and settlement responses.
- Solo, Tower, PvP, and Pet evidence cannot cross-settle.
- Reward receipts remain searchable by request ID and session ID.

Current route ownership and recovery details live in
`docs/architecture/combat-runtime-inventory.md`,
`docs/architecture/combat-runtime-boundaries.md`, and
`docs/runbooks/combat-mode-migration.md`.
