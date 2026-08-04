# ShinobiX v0.1.0-beta Release Notes

Draft date: July 7, 2026

These notes are prepared for the first controlled public beta release. Do not
publish the release until the checks in `RELEASE_CHECKLIST.md` and
`PUBLIC_BETA_LAUNCH_RECOMMENDATION.md` have current evidence.

## Summary

ShinobiX is ready for a small public beta focused on the early shinobi journey:
create a character, complete Academy onboarding, train, learn jutsu, run early
missions, try combat, and explore the first social and progression systems.

This release intentionally labels advanced systems as beta, monitored, or
feature-gated.

## Highlights

- Browser-based shinobi RPG client with character creation, village choice,
  starter bloodline, avatar selection, and protected local/dev save flow.
- Early-game progression through Academy goals, training, jutsu, missions,
  hunts, inventory, hospital, bank, cafeteria, Logbook, and world travel.
- Tactical AP combat with jutsu, movement, cooldowns, effects, battle logs, and
  PvP-oriented rule parity work.
- Server-owned Solo PvE combat across missions, story and Academy fights,
  Endless Tower, Hollow Gate, Weekly Boss, generic AI fights, and ANBU raids,
  including refresh recovery and once-only settlement.
- Data-driven AI rule authoring and a bounded normalized combat-event contract
  now provide the foundations for reusable behavior and telemetry consumers.
- PvP, ranked PvP, Battle Towers, Pet Arena, professions, clans, Card Clash, and
  legacy systems available for monitored beta use.
- Backend hardening for auth, saves, reward receipts, economy logs, rate limits,
  audit events, ranked rating, mission eligibility, and beta metrics.
- Release operations docs for health checks, feature flags, cPanel/Railway
  deployment, Supabase migration, and rollback readiness.

## Beta Warnings

- Village War and Sector War should soft-launch only with staff coverage.
- Player AI image generation and creator tools should stay disabled for public
  beta unless moderation and budget monitoring are staffed.
- Hollow Gate is late-game and desktop-first until mobile verification passes.

## Required Pre-Release Checks

```bash
npm ci
npm test
npm run build
cd shinobij.client && npm ci
cd shinobij.client && npm run lint
cd shinobij.client && npm run build
```

Also run:

- Fresh-account smoke through first mission claim.
- Mobile smoke at 390x844 and 430x932.
- PvP ranked and unranked settlement receipt review.
- Admin login and moderation smoke.
- Release health check against the intended staging/production URL.

## Suggested GitHub Release Text

Title:

```text
v0.1.0-beta - Controlled public beta
```

Description:

```text
First controlled public beta for ShinobiX / Shinobi Journey.

Focus: character creation, Academy onboarding, training, jutsu, early missions,
missions-to-combat loop, inventory, bank, hospital, village systems, monitored
PvP, towers, pets, clans, professions, and release hardening.

This is a beta. Advanced systems are gated, monitored, or desktop-first until
fresh player data and smoke checks prove they are ready.
```

## Post-Release Watchlist

- Fresh-account drop-off before first mission claim.
- PvP/tower sessions that fail to settle.
- Ryo or XP percentile jumps without a known source.
- Mobile blockers in combat, missions, inventory, and world map.
- Confusing battle-log, cooldown, and disabled-action messages.
- Reports involving save loss, reward duplication, or security bypasses.
