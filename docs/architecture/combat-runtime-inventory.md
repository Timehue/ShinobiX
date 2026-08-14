# Combat Runtime Inventory

Baseline: ShinobiX `b815be4fe0088735df444fd7a1464c5e0c3bfa48` on 2026-08-04.
Reference only: a third-party shinobi RPG at `df6dcd0d7d4b23d9cf309ea3a0159f366f764869`.
WorldMap authority inventory re-verified on 2026-08-13.

This is the executable-truth matrix for the solo-PvE cutover. The companion
machine inventory lives in `scripts/combat-runtime-inventory.mjs`; its test
checks Express registration, handler imports, client callers, and terminal
migration claims. `migrated` and `complete` are both terminal: either label
requires the current runtime to equal its target and requires active callers
for its action and state routes. “Local” below means the normal Arena client
resolver, not a server combat session.

| Player-facing mode | Start / action / state | Client host | Session / keyspace | Authority and settlement | Current → target | Migration / rollback |
|---|---|---|---|---|---|---|
| Casual PvP | `pvp/session` / `pvp/move` / `pvp/session` | `PvpBattleScreen` | `PvpSession`, `pvp:<battleId>` | Save-sealed fighters; server actions, winner, vitals, items, rewards/history | PvP → PvP | Keep. Never fall back to a rewarding local result. |
| Ranked PvP | `pvp/ranked-queue` then PvP routes | `Arena` queue + `PvpBattleScreen` | `PvpSession`, `pvp:<battleId>` | PvP owns matchmaking, turns, AFK/forfeit, rating, reward, receipts | PvP → PvP | Keep. Fail closed if session creation/settlement is unavailable. |
| Direct player challenges | `pvp/session` / `pvp/move` / `pvp/session` | `Arena` + `PvpBattleScreen` | `PvpSession`, `pvp:<battleId>` | Same PvP authority and claim receipt | PvP → PvP | Keep. |
| Generic catalog AI | `missions/ai-fight-start` / `solo-pve/action` / `solo-pve/state` | `AiFightHost` → runtime-neutral `MissionArenaFight` | `SoloPveSession`, `solo-pve:<sessionId>` plus runtime-discriminated AI token | Mandatory server session owns actions/outcome/vitals/items/companion costs; settlement writes an exact token receipt | solo-PvE | Migrated. This is the generic published-profile contract used outside the World-context rows below; start/profile/storage failures fail closed and never mint an unbound token. |
| Temporary / creator AI | Generic start only after the profile is published in builtin/admin server content | `AiFightHost` | Same solo session/token | Unknown IDs are rejected; no persistent result is accepted from preview/client combat | published solo-PvE or explicit no-reward preview → same | Persistent generic launch sites require publication; preview remains explicitly non-rewarding. |
| World-context hunt trails | `missions/hunt-trail` lifecycle, then `missions/ai-fight-start` with identity-only `hunt-pack` / `hunt-target`; Solo action/state | `HunterBoard` + `WorldMap` → `AiFightHost` | Solo session/token + `world-ai-active:<player>` + save-owned hunt trail, chain, proof, and pending handoff | Server reconstructs the accepted mission, trail sector/choice, pack stage, target, quality and opening. Settlement owns chain progression, loss/rematch state, exact target proof, Mission Hall progress, and replay. | solo-PvE → solo-PvE | Migrated. Accept/state/choose/abandon and combat settlement are server-owned; a generic AI kill cannot satisfy the hunt turn-in. |
| World-context wanderers | `missions/ai-fight-start` with identity-only `wanderer`, `wanderer-ambush`, `patrol`, `bounty-hunter`, `questbook-boss`, or `story-reckoning`; Solo action/state | `WorldMap` → `AiFightHost` | Solo session/token + World active pointer + durable chain/outcome handoffs and exact context proofs | Server reconstructs profile, level, stage, sector, quest/story seal and cooldown from saved state; settlement applies world progression and recoverable follow-ups exactly once. | solo-PvE → solo-PvE | Migrated. Runtime-authored opponents are no longer client profiles, and refresh/lost-response recovery retains their sealed context. |
| Generic Apex hunts | Generic start with a server-published `apex-ai-*` profile; Solo action/state | `HunterBoard` → `AiFightHost` | Solo session/token + generic active pointer + weekly Apex receipt | Solo owns combat and physical costs; generic settlement verifies the sealed rostered Apex before writing the weekly kill proof. | solo-PvE → solo-PvE | Migrated through the generic-catalog contract. This is intentionally not a World-context hunt trail. |
| Generic explore ambushes | Generic start with `battleKind: explore`; Solo action/state | `WorldMap` → `AiFightHost` | Solo session/token + generic active pointer with sealed sector | Solo owns outcome, surviving HP, items and companion costs; settlement replays from its token and retains the sector for the explore callback. | solo-PvE → solo-PvE | Migrated through the generic-catalog contract; failures never run rewarding local combat. |
| Generic village-guard raids | Generic start with `battleKind: raidAi`; Solo action/state | `WorldMap` → `AiFightHost` | Solo session/token + generic active pointer + raid progress proof | A server-published guard is sealed at start. Solo owns combat, while settlement derives the field-raid proof from that sealed win and deduplicates retries. | solo-PvE → solo-PvE | Migrated through the generic-catalog contract. Natural wanderers use the separate World-context row above. |
| Dungeon Warden | `missions/ai-fight-start` with `battleKind: dungeon` + exact `dungeonRunToken`; Solo action/state | `Dungeon` / `App` → `AiFightHost` | Solo session/token + server-owned active dungeon run | Server reconstructs the Warden and scaling from the sealed run. A win stamps the exact run proof; loss remains retryable; generic purse settlement is suppressed. | solo-PvE → solo-PvE | Migrated. Legacy local-Arena dungeon snapshots are retired into the authoritative run instead of resumed. |
| Creator-event practice fights | `missions/ai-fight-start` with `battleKind: practice`; Solo action/state | `WorldMap` / `App` → `AiFightHost` | Solo session/token; no progression payout | Published, release-safe encounter identity is sealed by the server. Combat outcome is canonical, while the separate narrative continuation remains non-rewarding. | solo-PvE → solo-PvE | Migrated. Rewardful or battle-bearing creator content remains admin preview only, and no player-facing local-Arena result can mint rewards. |
| E/D combat missions | `missions/combat-start` / `solo-pve/action` / `solo-pve/state` | `Missions` → runtime-neutral `MissionArenaFight` | Solo session + `mission-combat-binding:<runId>` + `mission-combat-active:<player>:<mission>` | Solo session owns outcome/vitals/items; binding, active recovery pointer, and Mission Hall receipt own lifecycle/reward | solo-PvE | Migrated; start is idempotent across refresh, lost settle responses replay from durable proof, the rewarding legacy-client claim exception is removed, and failures fail closed. |
| C/B/A/S combat missions | `missions/combat-start` / `solo-pve/action` / `solo-pve/state` | `Missions` → runtime-neutral `MissionArenaFight` | Solo session + `mission-combat-binding:<runId>` + `mission-combat-active:<player>:<mission>` | Solo session owns enemy/actions/winner/vitals/items; binding, active recovery pointer, and Mission Hall receipt own lifecycle/reward | solo-PvE | Migrated with binding/reward fingerprint retained; refresh and lost-response retries reuse coherent durable state. |
| Academy spar | `story/spar-start` / `solo-pve/action` / `solo-pve/state` | `StoryBossFightHost` → runtime-neutral `MissionArenaFight` + `SparCoach` | Solo session + story-combat binding | Solo session owns winner; Academy settle exclusively owns scripted win HP and onboarding reward | solo-PvE | Migrated; binding resume and the single HP writer are preserved. |
| Story battles / bosses | `story/boss-start` / `solo-pve/action` / `solo-pve/state` | `StoryBossFightHost` → runtime-neutral `MissionArenaFight` | Solo session + story-combat binding | Solo session owns winner/vitals/items; story binding and receipt own progress/reward | solo-PvE | Migrated; presentation and binding resume remain fail-closed. |
| Weekly Boss | `weekly-boss` / `solo-pve/action` / `solo-pve/state` | `WeeklyBossArena` → `WeeklyBossFight` | Solo session + weekly run binding + per-spawn contribution receipts | One human attacks one boss per attempt; Solo owns actions/damage/vitals/items while the shared leaderboard banks terminal damage once | solo-PvE | Migrated. The 20-round score attack, guard cycle, damage caps, stamina cost, reconnect TTL, and server-wide contribution system are preserved. |
| Endless | `endless/run` + `endless/wave-start` / `solo-pve/action` / `solo-pve/state` | Endless action hook + runtime-neutral `Arena` | Durable Endless run + wave binding + Solo session | Solo session owns opponent/actions/outcome/vitals/items; wave settle advances and rewards once | solo-PvE | Migrated; terminal settlement is retryable and the sealed opponent is never rerolled. |
| Hollow Gate shinobi | `hollow-gate/combat-start` / `solo-pve/action` / `solo-pve/state` / `combat-settle` | Hollow Gate screen + normal `Arena` | Durable HG run/manifest/ledger + combat binding + Solo session | Solo session owns combat; HG owns movement, encounter identity, exact reward credits, extraction/death reconciliation, and recovery markers | solo-PvE | Migrated; no rewarding tokenless or client-haul path remains. |
| Hollow Gate pet | HG event roll/befriend plus pet combat start/settle | `PetArena` | Pet receipt + HG binding/ledger | Pet engine/receipt decides result; HG consumes only matching pet proof and credits the exact ledger once | Pet → Pet | Kept separate; shinobi sessions are rejected. |
| Battle Towers | `towers/start` / `towers/action` / `towers/state` | `BattleTowerFight` | `TowerSession`, `tower:<runId>` | N-actor queue, objectives, actors, items and Tower settle are server-owned | Tower → Tower | Keep. |
| Endless Spire | Tower start with `mode: spire` / Tower action/state | `BattleTowerFight` | N-actor Tower session and Spire leaderboard | Tower objectives/actors/settlement | Tower → Tower | Keep; this is distinct from normal solo Endless. |
| Clan Boss | `clan-boss/assault-start` / Tower action/state / assault settle | `ClanBoss` | Party Tower session + clan assault binding | Server party actors, boss state, contribution and clan receipt | Tower party → Tower | Keep. |
| Anbu infiltration | `village/anbu-infiltration` start/state/settle plus `solo-pve/action` | `AnbuVaultRaid` using the normal Arena shell | Solo session + durable infiltration binding/recovery record | One human and an optional sealed companion fight one defender; Solo owns actions/outcome/vitals/items and infiltration settlement consumes terminal evidence once | solo-PvE | Migrated. The retired custom `act` operation returns 410; support is the same server-owned companion model as normal Arena, not an independent party slot. |
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

WorldMap callers additionally declare one of two inventory contracts:

- `world-context`: the client sends stable identity only. The server rebuilds
  the opponent and progression context from the save, then seals both into the
  Solo session/token. Hunt opening, chain state, quest/story proof, and rewards
  cannot be supplied by the client.
- `generic-catalog`: Apex, explore, and village-guard raid launchers select a
  server-published catalog profile and a bounded battle kind. Their canonical
  Solo outcome is redeemed through the generic token receipt and any owning
  progress proof is derived from that sealed result.

These descriptors are ratcheted in the machine inventory. A removed descriptor,
an unknown/`partial-*` status, a runtime mismatch, or a missing Solo action/state
caller fails the focused inventory test.
