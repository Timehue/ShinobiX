# Feature Flag Release Matrix

Updated: August 4, 2026

| System | Launch State | Reason | Risk | Required Before Enable |
| --- | --- | --- | --- | --- |
| Core onboarding/training/missions | Public beta enabled | Academy and all combat missions use server-owned Solo sessions and server settlement. | Low | Live fresh-account smoke. |
| Inventory/shop/bank/hospital | Public beta enabled | Core progression and sinks are understandable with hints. | Low-medium | Mobile smoke and no-ryo recovery check. |
| PvP | Enable with warning | Server sessions and receipts exist. | Medium | Desktop/mobile PvP smoke and receipt review. |
| Ranked PvP | Enable with warning | Server rating paths exist. | Medium | Monitor disconnects and rating deltas. |
| Battle Towers | Enable with warning | Playable advanced PvE. | Medium | Mobile fight and refresh/resume smoke. |
| Endless Tower | Enable with warning | Repeatable PvE goal with server-owned actions, recovery, and settlement. | Medium | Monitor reward pacing and long sessions. |
| Clan Hall | Enable with warning | Useful social loop. | Medium | Admin support for clan disputes. |
| Clan Boss | Enabled by default/admin monitored | `server.ts` force-sets `ENABLE_CLAN_BOSS=1` unless `DISABLE_CLAN_BOSS=1`. | High | Storage/reward receipt review and staff coverage; `DISABLE_CLAN_BOSS=1` kill switch ready. |
| Weekly Boss | Monitor | Server-owned Solo score attack; contribution is derived from the authoritative boss-HP delta. Legacy client damage reports return HTTP 410 unconditionally. | Low | Monitor attempts and settlement receipts. |
| Village War Map | Enabled by default/staffed | High-impact world/economy system; `server.ts` force-sets `ENABLE_VILLAGE_WAR=1` unless `DISABLE_VILLAGE_WAR=1`. | High | Admin runbook and reward audit; `DISABLE_VILLAGE_WAR=1` kill switch ready. |
| Sector Wars | Soft-launch/staffed | Territory, terrain, mercenaries, and supply affect live world. | High | Low-population balance review and receipt monitoring. |
| Card Clash | Soft-launch | Contained side mode. | Medium | Stuck-match monitoring and mobile check. |
| Pet Arena | Enable with warning | Good side content. | Medium | Rating/pacing telemetry. |
| Pet Ladder | Enable with warning | Ranked pet content. | Medium | Offer/stuck-match monitoring. |
| Hollow Gate | Desktop-first beta | Dense late-game flow with no-retreat pressure. | Medium | Desktop staging pass, then mobile pass. |
| ANBU infiltration | Enable with warning | Server-owned Solo encounter bound to the infiltration run, with recovery and once settlement. | Medium | Staging reconnect and retry smoke. |
| Legacy system | Enable with warning | Long-term goal layer. | Medium | Admin emergency tools verified. |
| Professions | Enable with warning | Adds identity and long-term rewards. | Medium | Confirm role explanations and reward pacing. |
| Creator tools | Gate/desktop-first | Large forms and player-created content moderation risk. | High | Content moderation staffing and review queues. |
| Bloodline Maker | Gate/monitor | Powerful player identity feature; image/content moderation needed. | High | Review queue and player education. |
| Item Maker | Admin-only | Economy and power risk. | High | Keep behind admin auth. |
| AI image generation | Admin-only by default | Real spend and content moderation risk. | High | Set `ENABLE_PLAYER_AI_IMAGE_GENERATION=1` only with budget/moderation coverage. |
| Admin moderation | Admin-only enabled | Needed to operate beta. | Medium | Admin credential smoke and audit-log check. |
| Economy diagnostics | Admin-only enabled | Needed for launch operations. | Medium | Admin staging smoke. |

## Active release switches

- `DISABLE_WEEKLY_BOSS_GUARD=1`: emergency switch for new Weekly Boss guard cycles.
- `DISABLE_VILLAGE_WAR=1`: emergency switch for Village War.
- `DISABLE_CLAN_BOSS=1`: emergency switch for Clan Boss.
- `ENABLE_PLAYER_AI_IMAGE_GENERATION=1`: enable only with moderation, budget monitoring, and abuse response.

`ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE` and
`ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS` are retired. They cannot restore
the removed client-authoritative settlement paths.

