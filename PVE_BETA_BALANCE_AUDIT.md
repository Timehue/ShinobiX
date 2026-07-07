# PvE Beta Balance Audit

Date: July 7, 2026

## Verdict

PvE is the safest core beta loop. Missions, hunts, training, Academy, Logbook, towers, and advanced PvE all exist, but first beta should promote early missions and monitored towers rather than every late-game mode at once.

## Current Reward Bands

| Content | Level | Rewards |
| --- | --- | --- |
| Academy Trial | One-time | 40 XP, 30 ryo, 5 stamina. |
| Academy Checklist | One-time | 150 XP, 120 ryo, 10 stamina, 2 Fate Shards. |
| E combat mission | 1 | 15 XP, 10 ryo, 1 Territory Control Scroll. |
| D combat mission | 5 | 25 XP, 20 ryo, 1 Territory Control Scroll. |
| C combat mission | 15 | 75 XP, 60 ryo, 1 Territory Control Scroll. |
| B combat mission | 30 | 150 XP, 125 ryo, 1 Territory Control Scroll. |
| A combat mission | 50 | 300 XP, 250 ryo, 1 Territory Control Scroll. |
| S combat mission | 70 | 700 XP, 600 ryo, 1 Territory Control Scroll. |
| Level 1 hunts | 1 | 80 XP, 60 ryo, 8 stamina, materials. |
| Level 1 fetch | 1 | 90 XP, 75 ryo, 8 stamina. |

## PvE Progression Guardrails

- Daily mission cap: 20 missions.
- Daily hunt cap: 20 hunts.
- Combat stat growth: AI fight wins grant 8 stat points, bounded by the 60/day combat stat cap.
- Training remains the main stat faucet at roughly 20-23 stat points per hour depending on tier.
- Higher-value client-trusted combat rewards are gated unless `ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS=1`.
- Weekly Boss client damage is gated unless `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE=1`.

## Beta Strengths

- The mission catalog is server-authoritative.
- Early rewards are modest and readable.
- Daily caps prevent unlimited mission/hunt farming.
- Logbook and Daily Briefing can point players back to the next useful loop.
- Existing tests pin PvE difficulty, XP/stat math, weekly boss guard behavior, and mission reward parity.

## Watch List

| Risk | Why | Response |
| --- | --- | --- |
| Early PvE feels too easy | New players get quick levels and v2 resource pools | Do not nerf first; watch mission completion and KO rates. |
| Midgame content feels repetitive | Mission tiers are sparse between rank beats | Use daily/weekly goals and Beta Patch 1 content, not XP inflation. |
| Tower/tower mobile issues | Advanced combat UI is dense | Require mobile smoke before promoting. |
| Weekly Boss reward abuse | Shared boss contribution can mint rewards | Keep gated until server-authoritative settlement. |
| High-tier combat reward trust | Legacy client-trusted paths can be abused | Keep high-tier client trust disabled. |

## Safe Beta Patch 1 Work

- Add one or two low-risk mission flavor variants if content pace feels thin.
- Improve mission reward summary copy.
- Improve tower entry warnings and mobile layout from screenshots.
- Add aggregate metrics for mission tier completion and PvE KO rate.

## Recommendation

Keep PvE numbers unchanged for first beta. Patch stuck states, reward delivery, and clarity first. Tune XP/ryo only after level distribution and wallet data show a real pacing problem.

