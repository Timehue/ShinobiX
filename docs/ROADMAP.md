# ShinobiX Roadmap

This roadmap is written for GitHub visitors, beta testers, and contributors. It
focuses on what makes ShinobiX safer and more playable as a public browser
MMORPG, not every internal task in the repo.

## Current Goal: Live Public-Beta Polish

Improve the coherence, reliability, and approachability of the shipped game
without shrinking its range of player paths or introducing balance churn.

Scope:

- Landing, registration, login, character creation, and Academy onboarding.
- Early training, jutsu, missions, hunts, inventory, bank, hospital, cafeteria,
  Logbook, village map, and world map.
- PvP, Ranked PvP, Towers and Spire, Hollow Gate, companions, Chronicle
  Showdown, clans and war, professions, Legacy, and story remain shipped paths.
- Admin diagnostics, release health checks, audit logs, reward receipts, product
  metrics, and rollback notes kept ready for live incident response.

Exit criteria:

- Fresh-account smoke passes through first mission claim.
- Mobile smoke covers landing, village, missions, inventory, PvP, tower fight,
  and world map.
- `npm test`, `npm run build`, and release health check pass.
- Emergency controls and permission boundaries remain tested and ready for
  operational incidents.

## Beta Patch 1

Stabilize the first cohort rather than adding risky balance churn.

- Improve onboarding copy from real player feedback.
- Add clearer empty states for low-population queues and clan/social screens.
- Review early ryo, XP, training, mission, and hospital data before tuning.
- Tighten combat disabled-state messages and battle-log clarity.
- Add more aggregate beta metrics for first-session funnel and reward claims.

## Combat And Progression

- Keep PvP as the truth source for player combat rules.
- Continue moving high-value reward settlement server-side.
- Expand tower and boss parity tests.
- Improve mobile combat readability.
- Tune level 25-100 content from beta data instead of assumptions.

## Social And World Systems

- Improve clarity and operations evidence for clans, village leadership,
  Village War, and Sector War as live systems.
- Add clearer public explanations for territory, supply, mercenaries, taxes, and
  war rewards.
- Monitor clan disputes, reward receipts, and economy anomalies before broader
  seasons.

## Creator And AI Tools

- Keep player AI image generation disabled until moderation and budget controls
  are staffed.
- Keep creator administration and moderation permission-based; do not expose
  admin capabilities to ordinary players.
- Document creator limits clearly before public promotion.

## Media And Community

- Keep README screenshots current with real gameplay captures.
- Add a short gameplay trailer once staging flow is stable.
- Publish beta notes for every release tag.
- Pin a public roadmap issue that links back to this file.

## Boundaries

- Do not claim a 1.0 launch or fabricate live-service evidence.
- Do not conflate operator monitoring with player-facing prelaunch labels.
- Do not broaden AI image generation, creator administration, or economy tools
  beyond their existing permissions.
- Prefer measured polish and verified fixes over speculative combat or economy
  rebalance.

Current availability truth lives in [LIVE_PRODUCT_STATUS.md](LIVE_PRODUCT_STATUS.md).
