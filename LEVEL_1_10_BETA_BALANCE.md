# Level 1-10 Beta Balance

Date: July 7, 2026

## Verdict

Levels 1-10 are ready for a controlled beta without numeric changes. The current path gives a fresh player clear actions, small ryo rewards, and quick early levels, but the first beta must verify that players understand where to go after Academy Training.

## Current Anchors

| Area | Current value or behavior |
| --- | --- |
| New character wallet | 100 ryo. |
| Level curve | `xpNeeded(level) = 6 * level * level`. |
| 100 XP anchor | Level 1 plus 100 XP reaches level 4 with 16 XP left. |
| Base health | 500 HP at level 1, +100 max HP per level. |
| Combat resources | Combat resources v2 is pinned in tests: 1000 chakra and 1000 stamina at level 1, scaling to 10000. |
| Academy Trial | 40 XP, 30 ryo, 5 stamina. |
| Academy Checklist | 150 XP, 120 ryo, 10 stamina, 2 Fate Shards. |
| E-rank combat mission | 15 XP, 10 ryo, 1 Territory Control Scroll. |
| D-rank combat mission | Level 5+, 25 XP, 20 ryo, 1 Territory Control Scroll. |
| Early hunts | Level 1 hunts pay 80 XP, 60 ryo, 8 stamina, materials. |
| Early fetch mission | Level 1 fetch pays 90 XP, 75 ryo, 8 stamina. |
| Newbie dailies | Pre-profession daily tasks pay 120 or 160 ryo each. |
| Training | 15m/1h/4h/8h tiers pay 23/22/21/20 stat points per hour, plus modest XP. |

## Beta Strengths

- The Academy path teaches training, jutsu, loadout, inventory, sparring, hospital recovery, first mission, Logbook, and sector return.
- The Logbook continues the player toward Genin instead of ending after tutorial.
- Newbie dailies exist before professions unlock, avoiding an empty daily panel.
- Early ryo faucets are small and bounded; rare currency appears as a one-time Academy Checklist reward, not a repeatable early faucet.
- Higher-value client-trusted combat mission rewards remain gated by release flag.

## Watch List

| Risk | Why | First response |
| --- | --- | --- |
| Players over-level before learning systems | Early XP curve is intentionally fast | Prefer clearer Logbook copy over lowering XP. |
| Players miss where to spend rewards | Several menus unlock early | Use Daily Briefing/Logbook/hints before adding rewards. |
| Hospital feels punitive | Discharge is 2500 ryo, wait timer is about 60 seconds | Watch first KO feedback; do not change unless soft-lock evidence appears. |
| Newbie dailies feel mandatory | Two ryo tasks can create daily pressure | Keep rewards modest; do not add rare currencies. |
| PvP too early | Spar/pet modes are exempt, competitive gates protect sub-Genin targets | Keep PvP as opt-in; do not push it in first-session CTAs. |

## Recommendation

Do not change level 1-10 XP, ryo, AP, stamina, or training values before the first beta cohort. The safer Beta Patch 1 work is:

1. Monitor Academy completion and first mission claim.
2. Monitor no-ryo hospital complaints.
3. Monitor whether players use Logbook after the first mission.
4. Patch only copy, routing, or stuck states unless receipts show reward defects.

