# Server Combat Migration Plan

## Current authority boundary

PvP (`api/pvp/*`) is the normal-shinobi rules source. Battle Towers (`api/towers/*`) reuse PvP hydration, jutsu resolution, statuses, resources, items, and cooldown helpers. Clan Boss, C/B/A/S combat missions, and Weekly Boss now create sealed Tower sessions and derive outcomes from completed server state. The independent client Arena remains the result source for E/D tutorial missions, Hollow Gate encounters, and story/event fights.

The shared binding is `api/missions/_authoritative-combat-session.ts`. It seals player, mission, enemy profile, reward fingerprint, run ID, expiry, and settlement state, then validates a completed winning Tower session. Its hostile tests cover wrong player, mission, run, membership, expiry, incomplete/lost sessions, reward drift, and replay.

## Stage 1: higher-rank built-in missions â€” implemented

The implemented route is `POST /api/missions/combat-start`. It seals the save and enemy into an embedded non-public Tower floor. `Missions.tsx` renders the sealed session through `MissionArenaFight` — the normal Arena PvE combat shell (`CombatSideHud` dossiers, the `arena-fullscreen pvp-battle-layout` hex board, the `basic-action-bar` + jutsu/item cards), driven move-by-move by `/api/towers/action` — so a C/B/A/S mission looks like every other PvE fight instead of the tactical tower rail. (It previously reused `BattleTowerFight`; the switch is presentation-only — the session, validation, and reward flow are unchanged.) A completed winning session is validated by `/api/missions/queue-combat-claim`, which marks the binding settled and mints an authority-tagged single-use claim token. `claim-mission` accepts C/B/A/S only with that server-combat token; a local pending flag or legacy token cannot pay it. E/D remain capped tutorial Arena fights.

Acceptance: C/B/A/S fight start is player/mission/enemy bound; abandoned/lost/expired fights pay nothing; the same win cannot pay twice or another mission; wrong-account settlement is rejected; consumed items deduct once; refresh resumes the same server session; old and new reward paths cannot both pay.

## Stage 2: Weekly Boss â€” implemented

`startFight` now reserves an attempt, charges stamina server-side, seals the boss week/profile/starting HP and player into a score-attack Tower session, and returns the server session. `logFight` ignores client damage numbers and banks only the completed session's boss HP delta under the run and boss locks. The run settles once and consumed items deduct through the Tower store. Keep `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE` unset; the public legacy `damage` route is rejected.

## Stage 3: Hollow Gate

Bind a Tower encounter to the existing Hollow Gate run token, floor, node/encounter ID, enemy seed, and reward eligibility. A run token may have at most one active encounter; movement is blocked while it is active. Settlement must consume the encounter once and update the run under its existing lock. Add duplicate, wrong-player, expired-run, replayed-encounter, and deduction tests before enabling valuable combat rewards.

## Stage 4: story/events and ordinary Arena PvE

Move high-value authored fights first. Preserve mode objectives in server encounter metadata. Leave purely cosmetic or tutorial client fights capped until scheduled. Do not extract or introduce a new combat formula engine; use Tower/PvP helpers and keep client calculations display-only.

## Required tests per stage

- Server seals loadout and enemy; forged client reward/enemy values are ignored.
- AP, movement, targeting, jutsu, created/bloodline jutsu, weapons, armor, throwables, consumables, statuses, cooldowns, charges, and costs resolve server-side.
- Wrong player/account/mission/week/run and expired bindings reject.
- Win, wipe, timeout, disconnect, refresh/resume, and abandon behave deterministically.
- Duplicate and concurrent settlement pay/deduct once; failed save can safely retry.
- Legacy and authoritative channels are mutually exclusive.
- Reward and battle receipts remain searchable by request ID and session ID.
