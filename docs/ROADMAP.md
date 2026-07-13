# ShinobiX Roadmap

This roadmap is written for GitHub visitors, beta testers, and contributors. It
focuses on what makes ShinobiX safer and more playable as a public browser
MMORPG, not every internal task in the repo.

## Current Goal: v0.1.0-beta

Ship a controlled public beta that proves the early loop without over-promising
late-game polish.

Scope:

- Landing, registration, login, character creation, and Academy onboarding.
- Early training, jutsu, missions, hunts, inventory, bank, hospital, cafeteria,
  Logbook, village map, and world map.
- PvP, ranked PvP, Battle Towers, Pet Arena, professions, Clan Hall, Card Clash,
  and legacy systems enabled with beta labeling and monitoring.
- Admin diagnostics, release health checks, audit logs, reward receipts, beta
  metrics, and rollback notes ready before invites.

Exit criteria:

- Fresh-account smoke passes through first mission claim.
- Mobile smoke covers landing, village, missions, inventory, PvP, tower fight,
  and world map.
- `npm test`, `npm run build`, and release health check pass.
- High-risk feature flags stay disabled unless a staffed staging pass says
  otherwise.

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

- Soft-launch clans, village leadership, village war, and sector war with staff
  coverage.
- Add clearer public explanations for territory, supply, mercenaries, taxes, and
  war rewards.
- Monitor clan disputes, reward receipts, and economy anomalies before broader
  seasons.

## Creator And AI Tools

- Keep player AI image generation disabled until moderation and budget controls
  are staffed.
- Keep Bloodline Maker and creator tools gated until review queues and abuse
  handling are ready.
- Document creator limits clearly before public promotion.

## Media And Community

- Keep README screenshots current with real gameplay captures.
- Add a short gameplay trailer once staging flow is stable.
- Publish beta notes for every release tag.
- Pin a public roadmap issue that links back to this file.

## Not In First Public Beta

- Claims that all late-game systems are complete.
- Public Hollow Gate mobile-ready marketing.
- Unstaffed village/sector-war seasons.
- Ungated AI image generation or economy-impacting creator tools.
