# PvP Beta Balance Audit

Date: July 7, 2026

## Verdict

PvP is beta-viable as a monitored system, not as a fully solved competitive ladder. The current server-session, receipt, anti-farm, and Academy-protection work makes it safe enough to test, but first beta should avoid broad AP, damage, cooldown, or reward changes until real match data exists.

## Current Anchors

| Area | Current value or behavior |
| --- | --- |
| Session TTL | 15 minutes for combat-core/PvP session state. |
| Log cap | PvP combat log capped to 60 lines. |
| Basic attack | 40 AP, adjacent target, server-resolved damage/fx. |
| Basic heal | 60 AP, cooldown-gated. |
| Clear/Cleanse | 60 AP, cooldown-gated. |
| Stun | 40 AP penalty; a stunned 100 AP turn becomes 60 AP. |
| Post-damage effects | Wound/Siphon/Lifesteal/Reflect/Absorb are capped through combat-core formulas. |
| Base PvP win reward | 100 XP and 75 ryo before contextual modifiers. |
| Death's Gate sector | Doubles base PvP XP/ryo in the tested reward helper. |
| Competitive protection | Sub-Genin players are protected from non-consensual/competitive PvP; spar/pet exemptions exist. |
| Ranked starting point | Player ranked rating defaults to 1000. |
| Receipts | Battle and action receipts exist for review. |

## Launch Strengths

- PvP sessions are server-created and action commits are server-side.
- Rewards are claimed through server paths.
- Battle/action receipts give staff a way to investigate disputes.
- Repeat/reward-farm checks and account-age checks reduce obvious farming.
- Client-side battle logs and VFX expose what happened without trusting the client for settlement.

## Risks To Watch

| Risk | Evidence to collect | First action |
| --- | --- | --- |
| Burst one-turn kills | Match length, opening action sequence, level band | Inspect receipts before changing damage. |
| Stun frustration | Frequency of stun wins and failed turns | Review AP loss and counterplay copy before numeric nerfs. |
| Mobile misclicks | Reports/screenshots from PvP controls | Patch layout/copy first. |
| Disconnect/stuck sessions | Created vs settled sessions, battle ids stuck active | Fix session recovery before balance. |
| Reward farming | Repeat wins, account age, same target patterns | Use existing anti-farm checks and receipt review. |
| Low-population ladder skew | Rating spread and repeated opponent pairs | Delay ranked-season claims until population is larger. |

## Do Not Change Blind

- AP costs.
- Stun AP penalty.
- Base PvP XP/ryo.
- Rank thresholds.
- Jutsu effect caps.
- Ranked rating formula.
- Pet trait bonuses that affect PvP rewards.

## Safe Beta Patch 1 Work

- Improve player-facing invalid-action messages where feedback identifies confusion.
- Add a staff checklist for reviewing battle ids and action receipts.
- Publish a beta note that ranked is monitored and rating may be adjusted after beta data.
- Add aggregate metrics for match length, settlement rate, and mode.

## Go/No-Go

Enable PvP and Ranked PvP with monitoring if:

1. One desktop PvP fight settles and grants expected receipts.
2. One mobile PvP fight can complete without blocked controls.
3. Ranked reward/rating deltas are reviewed in staging.
4. Staff can inspect a reported battle id.

