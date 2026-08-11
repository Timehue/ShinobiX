# ShinobiX Live Product Status

Current authority as of August 10, 2026
Repository verification base: `d76a1e7e5d07aab1ac2dce3156e469c9984685c3`

This file is the canonical repository authority for current product stage and player-facing availability. Dated launch recommendations, rollout matrices, release notes, and implementation reports are historical evidence; when their availability wording conflicts with this file or executable runtime behavior, this file and the runtime win.

## Current product stage

ShinobiX is a live public-beta browser MMORPG. The public game is named **Shinobi Journey**; the repository and backend remain **ShinobiX**. This is not a claim of a 1.0 release or of credentialed production health at every moment.

The active architecture is React 19 and Vite on the client, an Express/TypeScript server on Railway, Supabase/Postgres storage, and Socket.IO realtime.

## Shipped player systems

The shipped game includes:

- Academy onboarding, training, jutsu, missions, hunts, inventory, shops, banking, hospital, cafeteria, world travel, and ordinary shinobi PvE/PvP.
- Ranked PvP, Battle Towers, Endless Spire, Weekly Boss, Hollow Gate, story, and village chronicles.
- Companions, Pet Arena, Pet Ladder, Warfront, Pet Gauntlet, expeditions, and breeding.
- Shinobi Chronicle Showdown/Card Clash, including its AI, free-play, clan-war, and sector-war uses.
- Clans, Clan Boss Operations, Village War, Sector War, professions, Legacy, and Hall of Legends.

These systems are launched. Operational monitoring and emergency switches do not make them prelaunch features. Their level, ownership, clan, subscription, event, and other gameplay eligibility rules still apply.

Ordinary shinobi combat, the N-actor Tower engine, companion combat, and Chronicle combat are intentionally separate engines.

## Progression truth

- The only level-progression exam holds are Genin at level 20 and Chunin at level 39.
- Jonin rank begins through normal level progression at level 50. Its Logbook ceremony is optional prestige.
- Special Jonin rank begins through normal level progression at level 80. The existing 100-PvP-kill plus Kage/Elder ceremony is optional prestige and does not block leveling, stats, jutsu, content, or character power.
- Persistent exam keys and server-verified ceremony requirements remain unchanged.

## Runtime defaults and required configuration

Repository defaults describe what the checked-in server does; they do not prove the value of a deployed environment.

| Capability | Repository behavior | Deployment requirement |
| --- | --- | --- |
| Village War and Sector War | Enabled at server startup unless its emergency disable switch is active. | No opt-in flag is required. |
| Clan Boss and Operations | Enabled at server startup unless its system or party emergency disable switch is active. | No opt-in flag is required. |
| New pet-breeding starts | Available unless its emergency start switch is active; existing eggs and timers continue. | No opt-in flag is required. |
| Weekly Boss guard cycle | Available unless its emergency mechanic switch is active. | The core Weekly Boss remains a shipped system. |
| Legacy and Hall of Legends | Routes require the Legacy deployment setting to be enabled. | Production/staging must provide that setting for this shipped system. A missing value is a configuration incident, not a rollout state. |
| Public AI image generation | Off unless intentionally enabled. | Remains permission-, moderation-, and budget-controlled; admin tools are not ordinary-player access. |

The public `/api/player/capabilities` projection reports only bounded availability states and reason codes. It does not return environment-variable names, values, secrets, tokens, diagnostics, player data, or configuration contents.

## Live-operations controls

The following are emergency safeguards, not launch labels:

- Maintenance mode pauses player traffic while operator recovery remains available.
- The gameplay-mutation freeze pauses writes and rewards during economy or integrity incidents.
- Registration can be paused independently.
- Village War, Clan Boss, Clan Boss parties, new pet-breeding starts, and the Weekly Boss guard cycle have scoped disable controls.
- Scheduled jobs can be paused independently.

Admin authentication, content/economy moderation, image generation, dangerous recovery actions, and creator administration remain permission-based. No public status document broadens those boundaries.

## Certification evidence

Automated repository verification:

```text
npm ci
npm test
npm run build
npm run sizecheck
npm run certify:release
npm run check:deployment
npm run check:rollback-readiness
npm run test:backup
npm run test:mission-eligibility
npm run test:release-assets
npm run check:tooling-handoffs
npm audit --omit=dev --audit-level=high
cd shinobij.client
npm ci
npm run lint
npm run build
CI=1 npm run test:e2e
npm audit --omit=dev --audit-level=high
```

These commands cover type/build integrity, unit and integration behavior, route and deployment packaging, release certification, rollback assets, backup tooling, mission eligibility, asset integrity, browser flows, size, and dependency audits. A clean repository run does not replace credentialed checks against a deployed service.

Checks requiring a safe target and credentials include fresh-account/live-save smoke, real multiplayer concurrency, authenticated admin tools, production storage/backup observations, and environment-specific Legacy availability. No current credentialed production result was established while authoring this authority; consult retained live evidence before making an incident or availability claim.

## Historical evidence

- [`PUBLIC_BETA_LAUNCH_RECOMMENDATION.md`](../PUBLIC_BETA_LAUNCH_RECOMMENDATION.md) — July 7 prelaunch recommendation.
- [`FEATURE_FLAG_RELEASE_MATRIX.md`](../FEATURE_FLAG_RELEASE_MATRIX.md) — rollout-era matrix and closeout evidence.
- [`docs/BETA_LIVE_OPERATIONS.md`](BETA_LIVE_OPERATIONS.md) — earlier launch configuration guidance; incident procedures remain useful.
- [`docs/RELEASE_NOTES_v0.1.0-beta.md`](RELEASE_NOTES_v0.1.0-beta.md) — draft first-beta notes.
- [`docs/MMO_ROUNDNESS_IMPLEMENTATION_REPORT.md`](MMO_ROUNDNESS_IMPLEMENTATION_REPORT.md) — implementation and certification evidence for Clan Boss Operations and Activity Spine.

Preserve these documents. Their dated recommendations do not override current launched-system truth.
