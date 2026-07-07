# Created Content Beta Audit

Date: July 7, 2026

## Verdict

Created content should remain reviewed, admin-only, invite-only, or heavily gated for first beta. Bloodlines, images, items, and player-generated content are high-value identity features, but they can create moderation, spend, balance, and legal risk if opened broadly on day one.

## Current Safety Posture

| Area | Current posture | Beta call |
| --- | --- | --- |
| Bloodline Maker | Marked gated in release matrix | Keep gated or invite-only. |
| Player AI image generation | Disabled unless `ENABLE_PLAYER_AI_IMAGE_GENERATION=1` | Keep disabled for public players. |
| Admin AI image generation | Admin-controlled | Staff only. |
| Created rewards/items | Require review before live use | Keep review queue. |
| Created combat effects | Balance-sensitive | Do not allow unreviewed effects. |
| Audit logs | Content/reward audit domains exist | Use for moderation trails. |

## What Can Be Tested In First Beta

- Admin-created promotional art.
- Staff-reviewed cosmetic uploads.
- Invite-only Bloodline Maker with manual approval.
- Read-only display of created content that cannot affect live combat/economy.
- Moderation workflow rehearsal.

## What Should Not Be Broadly Enabled

- Public player AI image generation.
- Unreviewed bloodline effects.
- Player-created high-stat items.
- Player-created reward tables.
- Any creator flow that spends real AI budget without quota and review.

## Moderation Checklist

Before any created content goes live:

1. Content has an owner and created timestamp.
2. Art/text has been reviewed for public beta standards.
3. Combat/economy effects are reviewed separately from cosmetics.
4. Revert/disable path is known.
5. Audit entry is present or manually logged.
6. Player understands beta content can be adjusted or removed.

## Balance Checklist

For any created combat content:

- Compare AP, effect power, cooldown, range, tags, and resource costs to existing catalog bands.
- Verify rank caps and PvP sanitizer rules apply.
- Add a test if the content introduces a new mechanic or reward path.
- Do not ship created content that bypasses `sanitizeJutsuList`, reward claim endpoints, or admin review.

## Beta Patch 1 Recommendation

Keep created content out of the default public beta loop. Use it as a staff-run showcase or invite-only program after the core fresh-account and reward-integrity paths are stable.

