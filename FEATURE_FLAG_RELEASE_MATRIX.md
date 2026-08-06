# Feature Flag Release Matrix

Updated: August 6, 2026 (post-merge release closeout)

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
| Clan Boss Operations | Initial deploy party-disabled; staging gate pending | Server-owned 1–4 player clan parties seal legal loadouts into the existing N-actor Tower encounter; a leased self-healing registry sweeper and cursor-paged diagnostics cover lifecycle drift; `DISABLE_CLAN_BOSS_PARTIES=1` preserves the legacy solo-compatible assault path. | High | Deploy with `DISABLE_CLAN_BOSS_PARTIES=1`, verify solo compatibility and admin diagnostics, then complete `docs/CLAN_BOSS_OPERATION_STAGING_CERTIFICATION.md` on disposable staging before any party enablement. Retain the party-only kill switch after enablement. |
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
- `DISABLE_CLAN_BOSS_PARTIES=1`: required on the initial closeout deploy; disables party/finder endpoints and returns Clan Boss starts to the compatible solo path without disabling the weekly boss. Retain it as the party-only emergency switch after staging approval.
- `ENABLE_PLAYER_AI_IMAGE_GENERATION=1`: enable only with moderation, budget monitoring, and abuse response.

`ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE` and
`ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS` are retired. They cannot restore
the removed client-authoritative settlement paths.

## Effective Clan Boss flag state

| Surface | Repository default | Initial deploy | Disposable staging after flag-off gate |
| --- | --- | --- | --- |
| Weekly Clan Boss server/routes/cron | On unless `DISABLE_CLAN_BOSS=1` | On; leave `DISABLE_CLAN_BOSS` unset | On |
| Clan Boss client tab | On unless local browser storage explicitly sets `clanBoss.v1=0` | On | On |
| Operation party/finder | On unless `DISABLE_CLAN_BOSS_PARTIES=1` | Intentionally off with `DISABLE_CLAN_BOSS_PARTIES=1`; the explicit server-owned Solo Compatibility UI remains available | On after removing only `DISABLE_CLAN_BOSS_PARTIES` |
| Party rollback | Available | Set | Retained but unset after certification; set immediately for party-only rollback |

## Clan Boss operation closeout

- Task-start `origin/main`: `74198d9bad0813038cabf15edb2b7ddc6a575910`.
- Current certified main base: `cdecc459447c391407f269852cff1f9da59b3251`. The two intervening upstream commits were documentation-only; the closeout branch was rebased before the final build and evidence review.
- Automated result: the complete root and client release chain passed from clean installs. The second-pass wiring run passed `npm test` 5,001/5,001, the CI-mode browser matrix 87/87 executed tests, and two consecutive `npm run certify:clan-boss-operation` runs at a stable 75/75 including the party-disabled solo path; the earlier final chain passed `npm run certify:release` 82/82, the deterministic balance audit, bounded smoke, 9 live browser tests, 8 Warfront tests, and both production audits with 0 vulnerabilities.
- Size result: the final second-pass CI-instrumented build measures 7,238,390 budgeted bytes against the unchanged 7,245,000-byte threshold, leaving 6,610 bytes. No size or bundle limit was raised.
- CI enforcement: `.github/workflows/clan-boss-operation.yml` is path-filtered to operation server/client/contracts, Tower, Activity Spine, admin/cron adapters, and operation certification changes. It runs exactly `npm ci`, `npm run build:server`, `npm run certify:clan-boss-operation`, and `npm run audit:clan-boss-balance` on Ubuntu/Node 22.
- Unresolved external checks: the new workflow has not run on GitHub yet, and the disposable-staging real-Postgres, every-member browser reconnect, leader recovery, response-loss, concurrent settlement, post-ready loadout mutation, stale/expired reconciliation, credentialed admin/safe-disband, packet interruption, human-duration, 390×844, 1440×900, 150% zoom, support, and AFK cases have not been claimed locally.

Rollout recommendation: do not enable parties outside disposable staging yet. Deploy the main-derived build with `DISABLE_CLAN_BOSS_PARTIES=1`; verify the legacy-compatible solo path and credentialed admin diagnostics; enable parties only on disposable staging; execute and retain the evidence packet required by `docs/CLAN_BOSS_OPERATION_STAGING_CERTIFICATION.md`; then approve a staffed rollout while keeping `DISABLE_CLAN_BOSS_PARTIES` immediately available.

The exact clean-chain commands and detailed results are recorded in `docs/MMO_ROUNDNESS_IMPLEMENTATION_REPORT.md`.

