# Combat Runtime Inventory

Baseline: ShinobiX `b815be4fe0088735df444fd7a1464c5e0c3bfa48` on 2026-08-04.
Reference only: TheNinjaRPG `df6dcd0d7d4b23d9cf309ea3a0159f366f764869`.

This is the executable-truth matrix for the solo-PvE cutover. The companion
machine inventory lives in `scripts/combat-runtime-inventory.mjs`; its test
checks Express registration, handler imports, client callers, and completion
claims. “Local” below means the normal Arena client resolver, not a server
combat session.

| Player-facing mode | Start / action / state | Client host | Session / keyspace | Authority and settlement | Current → target | Migration / rollback |
|---|---|---|---|---|---|---|
| Casual PvP | `pvp/session` / `pvp/move` / `pvp/session` | `PvpBattleScreen` | `PvpSession`, `pvp:<battleId>` | Save-sealed fighters; server actions, winner, vitals, items, rewards/history | PvP → PvP | Keep. Never fall back to a rewarding local result. |
| Ranked PvP | `pvp/ranked-queue` then PvP routes | `Arena` queue + `PvpBattleScreen` | `PvpSession`, `pvp:<battleId>` | PvP owns matchmaking, turns, AFK/forfeit, rating, reward, receipts | PvP → PvP | Keep. Fail closed if session creation/settlement is unavailable. |
| Direct player challenges | `pvp/session` / `pvp/move` / `pvp/session` | `Arena` + `PvpBattleScreen` | `PvpSession`, `pvp:<battleId>` | Same PvP authority and claim receipt | PvP → PvP | Keep. |
| Generic catalog AI | `missions/ai-fight-start` / `towers/action` / `towers/state` | `AiFightHost` → `MissionArenaFight` | `TowerSession`, `tower:<runId>` plus AI token | Server when sealed; unresolved/seal failure falls back locally and the token/report can still persist outcome | Tower/local → solo-PvE | Pending. Rollback must disable start and fail closed for rewards, never restore trusted local wins. |
| Temporary / creator AI | Generic start when resolvable; otherwise no combat route | `AiFightHost` or local `Arena` | AI token only on compatibility path | Client decides local outcome; persistent callers are not safely distinguishable from preview | Local compatibility → published solo-PvE or explicit no-reward preview | Pending. Preview may remain local only with no persistent side effects. |
| Hunts / apex hunts | Generic AI routes | `WorldMap` request bus → `AiFightHost` | Same generic AI session/token | Generic settlement also applies hunt/world callbacks | Tower/local → solo-PvE | Pending; failure must retain the hunt for retry. |
| Explore ambushes | Generic AI routes | `Arena` launch + `AiFightHost` | Same generic AI session/token | Server token reward ceiling; local result still supplies outcome on fallback | Tower/local → solo-PvE | Pending; retry without reroll. |
| Village guards / wanderers | Generic AI routes | `WorldMap` → `AiFightHost` | Same generic AI session/token plus world binding | Winner and HP are server-owned only on the sealed Tower path | Tower/local → solo-PvE | Pending; world progress must not accept preview/local proof. |
| E/D combat missions | Generic/local Arena then `missions/queue-combat-claim` | `Missions` / local `Arena` | Legacy-client token + pending claim receipt | Client outcome is accepted inside the bounded legacy exception | Local client authority → solo-PvE | Pending; remove the exception/flag only after full solo journey passes. |
| C/B/A/S combat missions | `missions/combat-start` / Tower action/state | `Missions` → `MissionArenaFight` | Tower session + `mission-combat-binding:<runId>` | Server enemy/actions/winner/vitals/items; binding and later Mission Hall receipt own reward | Tower → solo-PvE | Pending; retain binding/reward fingerprint and fail closed. |
| Academy spar | `story/spar-start` / Tower action/state | `StoryBossFightHost` → `MissionArenaFight` + `SparCoach` | Tower session + story-combat binding | Server winner; Academy settle exclusively owns scripted win HP and onboarding reward | Tower → solo-PvE | Pending; preserve the single HP writer and resume from binding. |
| Story battles / bosses | `story/boss-start` / Tower action/state | `StoryBossFightHost` → `MissionArenaFight` | Tower session + story-combat binding | Server winner and story progress/reward receipt; separate physical outcome report | Tower → solo-PvE | Pending; keep presentation and binding, fail closed. |
| Weekly Boss | `weekly-boss` / Tower action/state | `WeeklyBossArena` → `WeeklyBossFight` | Tower-shaped one-player score attempt + weekly guard | One human attacks one boss per attempt; server-wide contribution settles from terminal session | Tower solo attempt → solo-PvE unless deliberately redesigned as party/N-actor | Decision recorded: current participant model is one human, so target is solo-PvE. Keep guard cycle/contribution receipt. |
| Endless | `endless/run`; registered `endless/wave-start` is not called / local Arena | Endless action hook + `Arena` | Save run token; legacy AI token; dead Tower wave binding/session | Server economy but client submits wave, win and vitals on the active path | Local client authority → solo-PvE | Pending; retry terminal wave settlement, never reroll opponent. |
| Hollow Gate shinobi | `hollow-gate/combat-start` / local Arena / `combat-settle` | Hollow Gate screen + `Arena` | HG run/binding, no shinobi combat session | Binding is server-owned; client submits outcome, surviving HP and haul-related truth | HG binding + local authority → solo-PvE | Pending last; retain dungeon state and durable HG binding/ledger. |
| Hollow Gate pet | HG combat start/settle | `PetArena` | Pet receipt + HG binding | Pet engine/receipt decides result; HG consumes only matching pet proof | Pet → Pet | Keep separate; reject shinobi sessions. |
| Battle Towers | `towers/start` / `towers/action` / `towers/state` | `BattleTowerFight` | `TowerSession`, `tower:<runId>` | N-actor queue, objectives, actors, items and Tower settle are server-owned | Tower → Tower | Keep. |
| Endless Spire | Tower start with `mode: spire` / Tower action/state | `BattleTowerFight` | N-actor Tower session and Spire leaderboard | Tower objectives/actors/settlement | Tower → Tower | Keep; this is distinct from normal solo Endless. |
| Clan Boss | `clan-boss/assault-start` / Tower action/state / assault settle | `ClanBoss` | Party Tower session + clan assault binding | Server party actors, boss state, contribution and clan receipt | Tower party → Tower | Keep. |
| Anbu infiltration | `village/anbu-infiltration` for start/action/state/settle | `AnbuVaultRaid` using normal Arena shell | Custom Tower-shaped session/binding | Current vault assault is a single human plus optional support against a defender; custom route owns outcome | Tower-shaped special → participant-model audit | Decision pending until its support/objective semantics are proven genuinely N-actor. |
| Sector war shinobi | PvP session/move/state plus sector-war registration/resolve | `WorldMap` + `PvpBattleScreen` | PvP session + sector-war single-use token/receipt | PvP decides winner; sector-war binding applies world consequence once | PvP → PvP | Keep. |
| Sector war card | `village/sector-card` | `SectorCardBattle` | Card session keyspace | Card engine decides result and applies contest receipt | Card → Card | Keep. |
| Pet Arena / Coliseum / tactical pet | Pet start/result or pet-specific route | `PetArena` | Pet tokens/sessions/receipts | Pet engine and server replay/validation own persistent result | Pet → Pet | Keep. |
| Card Clash | `card-clash/*` | `CardHall` / `CardClashFreePlay` | Card match/deck state | Card engine owns actions and settlement | Card → Card | Keep. |

## Authority fields required after migration

For every normal solo row, `SoloPveSession` must be the player/enemy/action,
winner, surviving-pool and item-use authority. The owning mode keeps a separate
binding and a durable one-time receipt for reward/progression. Reconnect reads
`solo-pve:<sessionId>`; terminal evidence must outlive the short action TTL.
No rewarding local fallback is permitted. Rollback disables or retries the
server start/settle path and preserves existing bindings; it never asks the
client to attest a win.

