# Combat Feel Release Audit

Date: July 7, 2026

## Verdict

Combat is beta-viable, but it needs mobile smoke testing and launch-week monitoring. The game already explains AP in the Academy spar, locks active fights against accidental navigation, records receipts for important server paths, and gates high-risk client-reported rewards.

## Strengths

- Academy spar teaches AP, Basic Attack, Jutsu, Wait, and HP victory.
- PvP uses server sessions and reward claim paths.
- Navigation guard blocks leaving unresolved PvP, arena fights, card duels, Hollow Gate runs, and tower fights.
- Weekly Boss client damage and higher-value combat mission rewards are gated by release flags.
- Battle history/log formatting tests exist.

## Fixes Implemented

- Added beta notices for Weekly Boss, Sector War card/pet fights, Card Clash, Pet Arena/Ladder, Battle Towers, Endless Tower, and Hollow Gate.
- Added one-time Arena hint that tells players to practice AI or mission fights before challenging real players.
- Added release metadata tests to keep high-risk notices from disappearing silently.

## Combat Clarity Checklist

| Area | State | Notes |
| --- | --- | --- |
| Whose turn | Monitor | Existing combat UIs show turn/log, but needs mobile verification. |
| AP clarity | Ready for first fight | Academy spar explicitly teaches AP. |
| Cooldowns | Monitor | Verify disabled buttons explain cooldown/resource reasons across PvP and PvE. |
| Invalid targets | Monitor | PvP targeting tests exist; player-facing message audit still needed. |
| Damage feedback | Monitor | VFX exists; mobile readability needs browser smoke. |
| Battle log | Ready with monitor | Log formatting/history tests exist. |
| Status icons | Monitor | Dense status stacks should be checked on 390px screens. |
| Jutsu ranges | Monitor | Jutsu detail copy exists; in-fight range clarity should be verified. |
| Win/loss explanation | Monitor | Receipts/logs exist; player-facing summary should be checked in staging. |

## Gate Recommendations

- PvP: enable with warning and monitor receipts.
- Ranked PvP: enable with warning; watch disconnects and rating deltas.
- Battle Towers: enable with warning after mobile smoke.
- Weekly Boss: gate contribution/rewards until server-authoritative damage is live.
- Clan/Village/Sector war combat: soft-launch only with admin coverage.

