# Release Reward Integrity Audit

Scope: player-facing paths where a client can report win/loss, damage, rewards,
XP, ryo, items, mission completion, or boss contribution. Rule source:
`docs/auth-and-anti-cheat-patterns.md`.

## Classification

| Path | Files | Classification | Release status |
|---|---|---|---|
| PvP sessions and rewards | `api/pvp/session.ts`, `api/pvp/move.ts`, `api/pvp/claim-rewards.ts` | Server-authoritative | Acceptable. Server owns moves and reward claim receipts. |
| Battle Towers / Endless Spire | `api/towers/*` | Server-authoritative | Acceptable. Server owns run state, actions, settlement, and item spend receipts. |
| Clan Boss | `api/clan-boss/*`, `api/towers/*` | Server-authoritative | Acceptable with staging smoke. Damage is extracted from finished tower session and settled once. |
| AI fight XP/ryo | `api/missions/ai-fight-start.ts`, `api/missions/report-ai-fight.ts` | Server-minted token with sealed reward values | Acceptable for XP/ryo. Token is single-use, player-bound, and server-seals base rewards. |
| Built-in combat mission rewards | `api/missions/queue-combat-claim.ts`, `api/missions/claim-mission.ts` | Client-trusted local combat for win signal | Tutorial-tier E/D missions remain enabled by strict caps. C/B/A/S payouts are gated by default unless `ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS=1`. |
| Field/hunt mission claims | `api/missions/claim-mission.ts`, `api/missions/_mission-progress-receipt.ts` | Server-minted progress receipts for built-ins | Acceptable for built-in field/hunt rewards. Unknown creator-authored missions fall back to client path and need separate sign-off. |
| Weekly world boss | `api/weekly-boss.ts`, `shinobij.client/src/screens/WeeklyBossArena.tsx` | Client-trusted damage proof with token/caps, not server-derived HP delta | Gated for public beta by default. Player contribution requires `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE=1`; UI shows disabled state otherwise. |
| Hollow Gate | `api/hollow-gate/*`, `shinobij.client/src/lib/hollow-gate-*` | Server token and bounded settlement; combat encounters still need parity review | Medium residual risk. No new release gate added in this pass; include in staging smoke. |
| Story/event Arena fights | `shinobij.client/src/screens/Arena.tsx`, story/event screens | Client-trusted local combat | Do not attach high-value release rewards without server token/settlement. Existing story rewards need content-owner sign-off. |
| Pet/card modes | `api/pet/*`, `api/card-clash/*`, client pet/card libs | Separate non-ninja-combat engines | Out of scope for PvP/tower parity, but reward endpoints still need their existing receipts/tests. |

## Changes In This Pass

- Weekly Boss player contribution is release-gated by default. Admin reset and
  read-only leaderboard remain available; non-admin `startFight`, `damage`, and
  `logFight` return a closed gate unless `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE=1`.
- Weekly Boss UI displays a disabled contribution state when the server gate is
  closed.
- Built-in combat mission C/B/A/S payouts are release-gated by default. E/D
  tutorial-tier combat mission rewards remain enabled under strict XP/ryo caps.
- Release flags are pure-tested in `api/_release-flags.test.ts`.

## Remaining Release Risks

- Weekly Boss should be moved to server tower or Clan Boss style sessions before
  re-enabling public contribution.
- Higher-rank combat missions should mint a fight-start token tied to mission,
  enemy, player, and server-authoritative result, or route through tower combat.
- Creator-authored story/event rewards need a content audit before public release
  if they grant premium, power, title, legacy, or competitive resources.
- Hollow Gate combat parity should be manually staged and then migrated to a
  server-authoritative combat session if valuable fight rewards depend on local
  Arena outcomes.
