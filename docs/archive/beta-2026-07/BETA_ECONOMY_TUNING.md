# Beta Economy Tuning

Date: July 7, 2026

## Verdict

Do not change economy values for Beta Patch 1 unless validation finds a reward defect or soft-lock. The early ryo economy is modest, and the high-impact faucets are already gated or should be staffed.

## Current Faucets

| Faucet | Value | Beta call |
| --- | --- | --- |
| Starter wallet | 100 ryo | Keep. |
| Academy Trial | 30 ryo | Keep. |
| Academy Checklist | 120 ryo, 2 Fate Shards | Keep; one-time. |
| E combat mission | 10 ryo | Keep. |
| D combat mission | 20 ryo | Keep. |
| Level 1 hunts | 60 ryo | Keep. |
| Level 1 fetch | 75 ryo | Keep. |
| Newbie dailies | 120 or 160 ryo each | Keep; monitor completion. |
| PvP base win | 75 ryo | Monitor via receipts. |
| Bank interest | +0.01% per Bank upgrade level, max 0.5%/day at level 50 | Keep; monitor as inflation faucet. |
| War rewards | Large ryo, Honor Seals, Fate Shards, crates | Gate or staff. |
| Village war ground bounty | 500 ryo and 1 Fate Shard daily when active | Staff/gate with war systems. |

## Current Sinks

| Sink | Value | Beta call |
| --- | --- | --- |
| Hospital discharge | 2500 ryo before discounts, or wait about 60 seconds | Watch first-KO feedback. |
| Hospital top-up | 50 ryo before discounts | Keep. |
| Training | Stamina cost, not ryo | Keep. |
| Jutsu training | Ryo sink with rank caps | Keep; verify no unclear failure states. |
| Shop/marketplace | Ryo and rare currencies | Keep; watch purchase confusion. |
| Village tax | If enabled, level 15+ only, 5000 ryo exemption, 250000/day cap, 50% burn share, 3-day catch-up max | Do not broadly enable without admin notice. |
| War resources | War declaration, sector war, mercenary costs | Soft-launch only. |
| AI image generation | Real spend outside game economy | Keep admin-only by default. |

## Economy Metrics

Daily beta checks:

- Median and 90th percentile wallet ryo.
- Median and 90th percentile bank ryo.
- Count of bank-interest claims and total ryo minted.
- Mission/hunt claims by tier.
- PvP rewards granted by mode.
- Hospital discharges paid vs waited.
- Rare currency balances for Fate Shards, Honor Seals, Bone Charms, Aura Dust, Aura Stones, Mythic Seals.

## Tuning Rules

- Change one faucet or sink at a time.
- Prefer low-level ryo copy/clarity fixes over adding ryo.
- Never add repeatable Fate Shards to early content without a test and explicit economy review.
- Do not tune war rewards from low-population data.
- If a player soft-lock is proven, add a targeted fallback instead of raising all rewards.

## Beta Patch 1 Recommendation

No economy number changes. Recommended work:

1. Track first-KO hospital outcomes.
2. Track ryo percentile growth after the first beta weekend.
3. Keep weekly boss, high-tier client-trusted combat rewards, player AI image generation, and unstaffed war seasons gated.
4. Prepare a small ryo-only adjustment plan for level 1-10 if data shows repeated poverty, capped to 10-20% on early repeatables.

