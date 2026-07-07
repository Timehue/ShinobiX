# Economy Release Audit

Date: July 7, 2026

## Verdict

The early economy is safe enough for public beta if high-risk reward systems remain gated. Do not wildly rebalance before the first player cohort; the safer move is to monitor receipts and adjust after real behavior data.

## Major Faucets And Sinks

| Type | Source/Sink | Values Observed | Release Call |
| --- | --- | --- | --- |
| Starter wallet | New character | 100 ryo | Good; enough to begin without trivializing purchases. |
| Academy Trial | One-time onboarding | 40 XP, 30 ryo, 5 stamina | Good; small and safe. |
| Academy Checklist | One-time onboarding capstone | 150 XP, 120 ryo, 10 stamina, 2 Fate Shards | Good; satisfying without breaking progression. |
| Combat missions | E/D client-trusted only by default | E: 15 XP/10 ryo; D: 25 XP/20 ryo | Safe; higher tiers gated. |
| Field/hunt missions | Early repeatables | D hunts: 80 XP/60 ryo; D fetch: 90 XP/75 ryo | Good early loop. |
| Daily mission cap | Mission catalog | 20 missions and 20 hunts per day | Good pacing limit. |
| Bank interest | Server-authoritative | 0.01% per bank upgrade level, max 0.5%/day, principal cap | Safe; not runaway. |
| Shop | Gear/cards | Ryo and Fate Shard sinks | Good; check price feel after beta weekend. |
| Jutsu training | Ryo sink | Paid levels to rank cap; free Lv 1 unlock | Good onboarding sink. |
| Hospital | Ryo sink | Discounts via upgrades/clan doctrine | Needs staging check for soft-lock risk. |
| War rewards | Village/clan war | Large ryo, Honor Seals, Fate Shards, crates | Gate/monitor; high impact. |
| Named gear forge | Premium material sink | Bone Charms, Fate Shards, Aura Stones, Mythic Seals | Good late sink; needs clarity. |
| AI image generation | Spend sink outside game economy | Real OpenAI cost | Now admin-only by default. |

## Exploit Risks

| Risk | Current Mitigation | Remaining Action |
| --- | --- | --- |
| Client claims high-value combat rewards | `ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS` defaults off for high tiers | Keep off until server settlement replaces legacy path. |
| Weekly Boss client damage | `ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE` defaults off | Keep off until server-authoritative damage exists. |
| Bank runaway wealth | Daily claim, tiny percent, principal cap | Monitor balances after beta weekend. |
| Duplicate war rewards | Receipts and war IDs exist, but impact is high | Staffed soft launch only. |
| AI image spend abuse | New `ENABLE_PLAYER_AI_IMAGE_GENERATION` flag defaults off | Keep admin-only unless budget/moderation is staffed. |
| Rare currency confusion | Hints and docs help, but UI still dense | Add more tooltips after first beta feedback. |

## Suggested Tuning Numbers

- Keep starter ryo at 100 for beta weekend.
- Keep D-rank mission rewards as-is; if players feel stuck, raise early ryo by 10-20%, not rare currencies.
- Keep bank interest cap unchanged until real balance data exists.
- Keep war bounty/crate rewards gated or manually monitored; they are too large to launch unattended.
- Consider adding an explicit hospital hardship fallback only if staging finds a no-ryo/no-health loop.

