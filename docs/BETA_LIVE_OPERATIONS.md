# Beta Live Operations

> [!IMPORTANT]
> **HISTORICAL ROLLOUT EVIDENCE — SUPERSEDED FOR CURRENT AVAILABILITY.** Incident procedures remain useful, but the recommended launch labels below record an earlier rollout stage. Use [`LIVE_PRODUCT_STATUS.md`](LIVE_PRODUCT_STATUS.md) for current shipped-system truth.

## Recommended launch configuration

- Enabled: registration, login, saves, Academy, training, inventory/shop/bank/hospital, early missions/hunts, Logbook, village/world travel.
- Enabled with warning and monitoring: PvP/ranked, Battle Towers, Endless Tower, pets, professions, clans, Card Clash, Legacy where its admin controls are verified.
- Admin-monitored: Clan Boss stays enabled. Watch assault settlement, item deductions, damage, standings, and weekly receipts while the staging matrix is captured.
- Desktop-first: Hollow Gate. Do not market it as mobile-ready.
- Staffed events: Village/Sector War stays available for scheduled beta events with operators present. Do not start an unattended permanent season until concurrency and dispute evidence exists.
- Server-authoritative and enabled: all Solo PvE modes, including combat missions, story and Academy, normal Endless, Hollow Gate shinobi combat, Weekly Boss, generic AI fights, and ANBU infiltration. The former client-trust switches are retired; their legacy report routes fail closed.
- AI/creator: accept the configured OpenAI-side generation limit for beta. There are no public creator reward payouts. Moderate public user-generated content, but do not invent a creator-reward shutdown for a system that does not exist.

## Daily operator rhythm

Run `npm run beta:report -- https://shinobijourney.com 1` with `ADMIN_PASSWORD` in the environment. The CLI refuses non-ShinobiX remote origins so the admin header cannot be redirected to an operator-supplied host. Review funnel/reward events, save-derived level/rank/profession distribution, ryo percentiles, exam holds, hospital risk, malformed saves, duplicate attempts, failed claims, unresolved sessions, and Clan Boss settlements. The report is aggregate-only.

Search save failures by request ID. Search battle and reward receipts by their domain IDs. Review Sentry, Better Stack, storage latency, backup freshness, scheduled-job health, and replica count. Record action taken; do not tune balance from a single day.

## Emergency actions

- Save corruption/loss: reject new unsafe-method player requests if ongoing, independently quiesce non-HTTP and GET-side-effect writers when required, snapshot affected records, trace request IDs, compare current/snapshot records, and use isolated restore evidence before owner-authorized production restore.
- Duplicate rewards/economy inflation: set `FREEZE_ECONOMY_REWARDS=1` to reject new unsafe-method player requests, apply the affected feature/job/realtime controls, retain receipts, run economy reconciliation, identify the first bad commit/request, correct through audited tools, then remove controls after replay tests.
- Chat abuse/ban evasion: preserve the minimum moderation evidence, silence/ban, review IP-linked accounts only through admin access, remove messages, and record the audit action. Do not export chat into product analytics.
- Broken ranked season: stop new queue/season mutation, preserve standings and battle receipts, use ranked admin controls, and communicate whether results are paused or void.
- Broken war event: follow `CONTROLLED_WAR_EVENT_RUNBOOK.md` and set `DISABLE_VILLAGE_WAR=1`.
- Broken boss reward: set `DISABLE_CLAN_BOSS=1`; do not delete assaults or reward receipts; reconcile before re-enable.
- Deployment regression: use `DEPLOYMENT_ROLLBACK_RUNBOOK.md`; keep additive schema, verify an account written by the newer build, and retain freeze controls until receipts/reconnect/health pass.

## Moderation certification

Before wider beta, verify two operator roles with real staging credentials: login, player search, save inspection, ban/unban, silence/unsilence, kick, linked-account lookup, message removal, audit logs, economy/reward/battle receipts, ranked/Legacy controls, snapshots, restore procedure, dangerous-action authentication, and unauthorized error behavior. Ordinary players must fail closed on every admin, maker, economy, correction, save-edit, image-generation, and approval route.
