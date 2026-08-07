# Public Beta Launch Recommendation

> [!IMPORTANT]
> **HISTORICAL ROLLOUT EVIDENCE — SUPERSEDED FOR CURRENT AVAILABILITY.** This July 7 recommendation records a prelaunch decision point and is preserved for audit history. It must not be used to label shipped systems today. See [`docs/LIVE_PRODUCT_STATUS.md`](docs/LIVE_PRODUCT_STATUS.md) for current product truth.

Date: July 7, 2026

## Overall Recommendation

Launch a controlled public beta only after the live fresh-account smoke and mobile combat smoke pass. The core loop is ready enough to test with real players, but high-risk economy/social/creator systems should be gated, monitored, or clearly labeled.

## Ready For Beta

- Landing, registration, login, and character creation.
- Academy onboarding path.
- Training and jutsu training.
- Inventory, shop, bank, hospital, cafeteria.
- Mission Hall, early field missions, early hunt missions.
- Logbook and early progression goals.
- Village map and basic World Map exploration.
- Admin moderation/diagnostics after credential smoke.

## Enable With Warning

- PvP and Ranked PvP.
- Battle Towers and Endless Tower.
- Pet Arena and Pet Ladder.
- Professions.
- Clan Hall basic social flow.
- Card Hall/Card Clash as a side-mode beta.
- Legacy goals and Hall of Legends.

## Gate Until Fixed

- Broad Village War and Sector War rollout until admin coverage and reward receipt review are ready.
- Player AI image generation unless `ENABLE_PLAYER_AI_IMAGE_GENERATION=1` is intentionally set with moderation and budget monitoring.
- Bloodline Maker promotion until moderation/review process is staffed.

## Cut From First Public Beta

- Public marketing of Hollow Gate as mobile-ready.
- Public player AI image generation.
- Unstaffed Village/Sector War seasons.
- Admin/creator tools for ordinary players.
- Any claim that all late-game systems are complete.

## Top 10 Fixes Before Inviting Players

1. Run fresh-account live/staging smoke through first mission claim.
2. Run mobile screenshots at 390x844 and 430x932 for landing, village, missions, inventory, PvP, tower fight, and world map.
3. Run release health check against deployed URL with expected save store.
4. Verify Admin 1/Admin 2 login and moderation tools.
5. Verify PvP battle receipt after one ranked and one unranked fight.
6. Verify save snapshot and restore runbook.
7. Decide public brand: ShinobiX versus Shinobi Journey.
8. Rehearse refresh/reconnect recovery for each Solo PvE mode against staging.
9. Rehearse duplicate and lost-response settlement retries against staging.
10. Keep `ENABLE_PLAYER_AI_IMAGE_GENERATION` unset unless staffed.

## Top 10 Fixes After First Beta Weekend

1. Tune early ryo only from real retention/economy data.
2. Add currency glossary/tooltips where players ask the same questions repeatedly.
3. Improve mobile combat layout from screenshots and session recordings.
4. Add clearer cooldown/disabled-action copy where battle logs confuse players.
5. Add war onboarding only if enough clans actually form.
6. Promote or gate Card Clash based on stuck-match data.
7. Review pet ladder rating and queue pacing.
8. Add more empty states to screens with low-population data.
9. Tighten creator moderation flow.
10. Revisit late-game Hollow Gate mobile support.

