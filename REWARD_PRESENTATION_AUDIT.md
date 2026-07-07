# Reward Presentation Audit

Date: July 7, 2026

## Verdict

Reward delivery is mostly safer than reward presentation. The codebase has server-authoritative claim paths, receipts, audit logs, and tested reward math, but several player-facing rewards still appear as alerts, toasts, or dense text. Beta Patch 1 should improve clarity before changing values.

## Current Presentation Strengths

- Achievement toasts stack and auto-dismiss.
- Profession mission completion toasts exist.
- Academy Checklist alert summarizes XP, ryo, stamina, and Fate Shards.
- Mission reward catalog is server-authoritative.
- PvP and important combat paths can be inspected through receipts.
- Bank interest claim message shows ryo gained.
- Release notices warn about gated or monitored systems.

## Presentation Risks

| Risk | Why it matters | Recommendation |
| --- | --- | --- |
| Alert fatigue | Major rewards and warnings can feel like browser popups | Convert repeated alerts to consistent in-game reward panels over time. |
| Rare currency confusion | Many currencies exist | Add short labels/tooltips where players ask repeated questions. |
| Delayed server rewards | Claim paths can succeed after async work | Show "claimed" vs "pending" clearly when needed. |
| Reward source unclear | Players may not know if a reward came from mission, PvP, achievement, or war | Include source label in summaries. |
| War/boss rewards are high value | Disputes will happen | Require receipts and clear patch notes before enabling. |
| Mobile toast overlap | Toast stacks may collide with combat/village controls | Verify with mobile smoke. |

## Reward Summary Standard

Use this order everywhere:

```text
Source complete
+XP
+ryo
+stamina
+rare currency
+items
New level/rank if changed
```

For high-value systems, include:

```text
Receipt/battle id:
Claim status:
```

## Safe Beta Patch 1 Work

- Standardize player-facing reward copy for common sources.
- Add "No rare currency" clarity only where players ask for it; avoid clutter.
- Ensure mobile toasts do not cover primary combat controls.
- Make staff review docs mention which receipt/log to inspect for PvP, missions, bank, war, and boss.

## Do Not Do Yet

- Do not add flashy reward animations that obscure controls.
- Do not add new reward currencies.
- Do not increase rewards to make the UI feel better.
- Do not expose internal audit details to players.

## Recommendation

Keep reward values unchanged. Improve reward explanation, source labels, and staff review paths first.

