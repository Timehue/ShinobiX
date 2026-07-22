# Beta Patch 1 Content Plan

Date: July 7, 2026

## Patch Goal

Beta Patch 1 should make the first beta easier to understand and easier to monitor. It should not add a new major system, change the XP curve, or rebalance combat from guesses.

## Must Improve

| Area | Work | Reason |
| --- | --- | --- |
| Fresh-account monitoring | Track registration, character creation, Academy completion, first mission claim | This is the launch funnel. |
| Reward review | Make battle ids, mission claims, and economy anomalies easy to inspect | Reward defects are beta killers. |
| Mobile core smoke | Verify landing, village, missions, PvP, tower, bank, training, hospital | Mobile blockers become P1. |
| Player feedback triage | Use P0-P3 and tags from `BETA_FEEDBACK_TRIAGE.md` | Prevent noisy balance churn. |
| Patch notes | Publish safe scope and known gated systems | Sets expectations honestly. |

## Safe Content

| Content | Scope |
| --- | --- |
| Early mission flavor | Add variants only if they reuse existing reward bands and claim paths. |
| Logbook/Daily Briefing polish | Clarify next goals and rank/exam holds. |
| Reward summary polish | Make XP/ryo/rare currency gains easier to read. |
| Empty states | Low-population PvP/profession/pet queues should explain what to do next. |
| Staff-run events | Manual, low-reward events with explicit rollback plan. |

## Enable Later

| System | Required before broader enable |
| --- | --- |
| Weekly Boss rewards | Server-authoritative contribution settlement and receipt review. |
| Village/Sector War seasons | Admin runbook, operator coverage, economy review, low-population rules. |
| Hollow Gate mobile promotion | Dedicated mobile smoke and long-run state review. |
| Bloodline Maker | Moderation queue, content review, revert/disable path. |
| Player AI image generation | Budget limits, moderation, abuse controls, explicit flag enable. |

## Keep Disabled Or Staffed In First Beta

- `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE` should stay unset.
- `ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS` should stay unset for high-tier rewards.
- `ENABLE_PLAYER_AI_IMAGE_GENERATION` should stay unset for public players.
- Unstaffed Village/Sector War seasons should not be marketed as live.
- Created combat/economy content should not bypass review.

## Patch Scope Recommendation

Ship:

1. Documentation and staff runbooks.
2. Monitoring/checklist additions.
3. Copy/UX polish from actual first-session reports.
4. Small content additions that reuse existing reward paths.

Do not ship:

1. New economy systems.
2. New combat math.
3. New repeatable rare-currency faucets.
4. New unreviewed creator paths.
5. Claims that endgame is fully balanced.

