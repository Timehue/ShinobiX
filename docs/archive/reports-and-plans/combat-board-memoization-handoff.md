# Closure — local Arena board memoization

**Status:** Closed by retirement on 2026-08-15. Do not implement the extraction
described by earlier revisions of this handoff.

The proposed optimization targeted the local combat reducer and hex board that
used to live in `shinobij.client/src/screens/Arena.tsx`. A production reverse-
reachability audit showed that code had no live admission path:

- Combat Spar publishes `requestAiFight`, then `AiFightHost` starts a sealed
  Solo session and renders `MissionArenaFight`.
- Direct and ranked challenge acceptance delegates to App's canonical
  `acceptChallengeGlobal`, which creates `/api/pvp/session` and routes the
  returned server battle ID into `PvpBattleScreen`.
- `startPrefight` was reachable only from a `pendingPvpOpponent` effect, and
  every mounted producer supplied `null`.
- local `arena` and `arenaStory` snapshots already fail closed in
  `battleResumeStateExists`; boot removes rolling-upgrade residue instead of
  restoring browser-owned HP, AP, or turn state.

Optimizing that board would therefore preserve dead code and create a second
combat presentation contract. The local reducer, persister, AI policy, board,
command deck, and timeline leaves were removed. `Arena.tsx` now owns only the
Battle Arena and Arena District lobbies, polling, challenge publication, pet
navigation, tournament projection, and delegation into authoritative hosts.

## Live performance ownership

Any new mobile combat performance work must profile the mounted renderers:

- `MissionArenaFight.tsx` for ordinary Solo PvE;
- `PvpBattleScreen.tsx` for session PvP;
- `BattleTowerFight.tsx` for Tower combat.

Do not add board hooks, combat state, timers, settlement, snapshot writers, or
combat DOM back to `Arena.tsx`. A regression in one of the live renderers should
be characterized and optimized in that owner, with its existing source/layout
contracts and on-device profiling.

## Retirement proof

The guardrails are executable:

- `src/screens/Arena.authority.test.ts` pins reverse reachability, server-sealed
  AI/PvP routing, the lack of a non-null `pendingPvpOpponent` producer, and
  snapshot rejection.
- `src/screens/Arena.size.test.ts` caps the lobby controller and hook-free lobby
  leaves, preserves pet/spectate/ladder ordering, and rejects retired leaves.
- `src/lib/ai-fight-request.test.ts` pins Combat Spar to `requestAiFight` and
  rejects local fallback or snapshot resurrection.
- `src/lib/combat-shell-contract.test.ts` and
  `src/screens/MissionArenaFight.layout.test.ts` cover only mounted combat
  renderers.

This closure intentionally has no device-profile result for the retired board:
there is no production interaction capable of mounting it.
