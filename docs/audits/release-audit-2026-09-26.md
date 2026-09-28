# Release audit — 2026-09-26

Scope: the current dirty working tree, including changes already present when this audit began. Checks used local builds, deterministic simulations, and disposable in-memory server accounts. No production deployment, staging database, or Android package was exercised.

## Fixed during this audit

- The production client artifact exceeded its 512 MiB cap at 514.0 MiB. Seven new Tower battlefield WebPs were resized for their display scale and encoded at WebP quality 75. Their combined source bytes fell from 3,788,342 to 1,557,884 (2,230,458 bytes saved). The 4×4 atlas layout and transparency remain intact. A 1024×768 Tower capture was visually inspected after the change. The rebuilt client artifact passes at 511.8 MiB.
- A Tower tile hover rule could remain painted after a touch. Its hover style now applies only to hover capable pointers; keyboard `:focus-visible` remains available. The touch hover gate passes.
- Unused Tower fight synchronization state and two unused computations were removed. This avoids unnecessary React state updates on reconnect. The focused Tower tests and full lint pass.
- Hollow Gate movement projection was extracted from `App.tsx` into a pure helper, preserving rapid input chaining while satisfying the enforced `App.tsx` size limit. The helper and size tests pass.
- A paid hospital discharge could commit on the server while its HTTP reply was lost, then leave the player on the hospital screen after heartbeat reconciliation showed full HP. The hospital now returns an admitted player to the village when authoritative state clears admission. The lost-reply mobile live journey passes and checks the single 2,500-ryo charge.
- On mobile, the compact Town Hall tip covered the storage notice's `Got it` button. The tip now reserves the measured notice height. The live mobile Kage journey passes through the same notice and Town Hall entry.
- Daily Briefing and Patch Notes could mount over an active visual novel, stacking full-screen dialogs. They now wait until the story scene ends. Both full Academy first-session variants, including the Aura Sphere claim, logout, relogin, and first-contract persistence, pass against built Express.
- Stale checks were aligned to current, separately verified behavior: Academy level floors, save migration totals, PvP level thresholds, authored mission simulation outcomes, Card Hall navigation, Tower terrain art, and the sound certifier's current master mute path. The sound behavior itself passed the runtime mute and backgrounding tests.
- The generated design token handoff was refreshed; its check now passes.

## Verified gates

| Gate | Result |
| --- | --- |
| Root build, server and client typechecks, asset verification, size check | Pass; client 511.8 MiB of 512 MiB cap; initial JS/CSS 384,874 bytes gzip |
| Root `test:ci` | 12,012 passed, 0 failed |
| Frontend lint | 0 errors; 14 code quality warnings |
| Release certification | 92/92 checks passed |
| Clan Boss operation certification | 92/92 checks passed |
| Final cross browser `test:e2e` rerun after the fixes | 1,338 passed, 692 project scoped skips, 0 failed (32.0 minutes) |
| Strict live combat layout matrix | 20 passed, 10 project scoped skips, 0 failed |
| Warfront device matrix | 39 passed, 129 project scoped skips, 0 failed |
| SFX certification | 25/25 mastered cues passed |
| Asset and readiness checks | Release asset references, card variants, audio encodes, 160 pet LODs and impostors, 160 pet model assets, deployment configuration, rollback readiness, backup tests, tooling handoffs, runtime mode docs, and mission eligibility passed |
| Production dependency audits | Root and client: 0 high severity vulnerabilities |
| Live Express desktop project | 37 passed, 2 project-scoped skips, 0 failed on a fresh server |
| Live Express mobile project, split by registration budget | Initial run: 23 passed, 8 project-scoped skips, then 8 account registrations received HTTP 429; fresh-server remainder: 9/9 passed, covering all eight affected cases plus one overlap |

The Chromium archive resource test completed 43 visits. Across its last two 20-visit windows, documents stayed at 1, DOM nodes at 2,122, and event listeners at 410. This supports no repeated archive DOM or listener accumulation in that test path; it does not establish a general FPS or memory guarantee.

## Open findings

1. **Neutral PvP simulation is outside its own balance targets.** The 3,200-fight audit reports `NOT BALANCED` with 168 flags. Sustain scored 67.5–82.5% and Prevention 5.8–26.7% across the tested levels, versus a 40–60% target. At levels 25–100, the 15-technique Supporter origin won 75.0–79.7% against the 12-technique base origin in 64 crossed fights per level. A-rank scored 44.1–49.2% directly against B-rank at levels 10–80, below the audit's expected 50–70% edge. These are deterministic neutral loadout results, not live matchmaking rates. No broad balance or entitlement change was made without validating its effect on the other matchups.
2. **S-rank authored mission pacing merits playtest review.** The deterministic Bukijutsu clear took 13 rounds, one beyond its prior 12-round assertion. In the fixed Ninjutsu comparison, the `answer` response finished with less HP than direct damage, while `guard` improved survival. This is one controlled simulation, not a claim about all player builds.
3. **The live Express test command exhausts its per-IP registration budget.** The original two-project run shared one in-memory server and reached the intended 25 registrations per 15 minutes; 25 mobile cases then received HTTP 429 at account setup. Even the mobile project alone exceeds that budget: its final full run reached 23 passes before eight later registrations received 429. Those cases all passed in a fresh-server nine-case remainder run. Desktop passed as one isolated project. Run mobile live certification in batches with fresh servers; keep the player-facing registration limit intact.
4. **Build size headroom is narrow.** The final client is 536,697,860 bytes against a 536,870,912-byte cap, leaving 173,052 bytes. The seven Tower images recovered 2,230,458 bytes, but a small future asset can exhaust the remaining margin. Continue asset sizing before adding new media.

## Boundaries

Build and local browser checks cannot certify live database migrations, real payment delivery, production network latency, staging multiplayer fairness, or the Android TWA package. The PvP and mission balance results need human pacing and fairness review on a disposable staging environment before they are treated as live player outcomes.

## Live main follow-up

Commit `47964f89f` was pushed to `main` after rebasing onto `6542d969d`. It contains the hospital lost-response reconciliation, story-dialog deferral, mobile notice spacing, and matching browser test updates. The other pending work in the audited dirty checkout, including the new Tower battlefield art and its compression, was not included in that push.

The main-based candidate passed its production build, 12,432 root tests, frontend lint with zero errors, 1,339 cross-browser tests, 20 strict combat-layout tests, and focused live Academy, hospital, and Town Hall journeys. GitHub CI, CodeQL, Production Image, and post-deploy health completed successfully. The public `/health` endpoint returned HTTP 200 and commit `47964f89ff3ae466affb74d42feeffb3e889682d` after Railway cutover.
