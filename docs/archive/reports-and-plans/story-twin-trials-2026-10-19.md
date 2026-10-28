# Independent twins in the Jonin trials

The Stormveil and Frostfang level-50 story milestones now spawn two simultaneous enemies. Each has an individual sprite and portrait, health bar, resource pools, status effects, cooldowns, target ID and turn in the queue.

| Trial | Blade fighter | Caster |
| --- | --- | --- |
| Tempest Twins | Stormblade: a siphoning lightning slash, a defensive stance and movement | Stormseal: a wounding lightning lance, a draining poison seal and movement |
| Glacier Twins | Iceblade: a siphoning blade strike, a shield with damage reduction and movement | Frostseal: a wounding ice lance, a seal that adds Ignition and Recoil, and movement |

Names identify the roles of the existing twins; no personal backstory was added. Move effects, costs and cooldowns resolve from existing catalog techniques. Descriptions explain the retained effects rather than borrowing unrelated weapon or creature flavor.

Both enemies must be defeated. The surviving twin continues taking turns after the other falls. The story binding records both required actor IDs, and settlement checks their deaths against the completed authoritative battle before advancing the chapter or paying its existing reward. The old combined HP is split 55/45 across the two bodies. Each has 65% of the old offense and 80% of the old defense, accounting for the extra enemy turn rather than duplicating a full-strength boss. Other story chapters and the final Kage encounters retain their existing runtime.

The existing embedded multi-actor grid engine supplies targeting, AoE, independent turns and pet support. The outer session remains Solo-PvE: owner checks, optimistic revisions, move-token retries, abandonment, usage charging, physical outcomes and `/api/story/settle` remain in their existing lifecycle. Internally the shared embedded state retains its legacy `huntCombat` field name, with an explicit `purpose: 'story-twins'` marker. The story UI uses a separate multi-actor screen with the existing story result/reward dialog; it does not call Tower action or reward endpoints. Its exit forfeits the trial with the existing 10% maximum-HP abandonment cost, rather than suggesting that the player can resume it from Battle Towers.

Existing active fights retain their stored one-opponent state and older binding. New starts receive the two-actor trial. No save migration, schema change or deployment operation was performed.

## Individual art

Four transparent 384 × 384 WebP assets were added under `shinobij.client/public/combat-actors/narrative/`:

- `glacier-twin-blade.webp`
- `glacier-twin-seal.webp`
- `tempest-twin-blade.webp`
- `tempest-twin-seal.webp`

Built-in imagegen generated them from the existing grouped twin art as a character/style reference. Original PNGs are preserved in the Codex generated-images directory. Each prompt asked for exactly one whole person, one head, two arms and two legs, a transparent background, a compact left-facing three-quarter pose, and no scenery, border, text or duplicate figures. Individual instructions were:

1. Glacier blade: preserve the front/right crouching white-haired twin, with two ice daggers and an offensive skirmisher pose.
2. Glacier seal: preserve the rear/left upright white-haired twin, hands making a jutsu seal and an ice ward around one forearm.
3. Tempest blade: preserve the front/left black-haired unmasked twin, advancing with a short lightning-charged sword.
4. Tempest seal: preserve the rear/right silver-haired masked twin, guarding with a short lightning-charged blade and one hand making a jutsu seal.

## Verification

- Focused gameplay/story/hunt regressions: 58 passed, including nine new trial checks for separate health and turns, real techniques, independent targeting, the surviving twin's turn, two-death reward validation and idempotent move delivery.
- Browser: four complete trials passed through the actual StoryBossFightHost, at 1440px and 390px for both villages. The harness uses the real server builders, action service, combat engine and story proof validator, with local in-memory transport and a synthetic finisher to reach the first KO and final reward deterministically. It verifies no early reward, one chapter reward after both deaths, and the Continue flow. It is a functional regression check, not a balance playthrough.
- Screenshots for both alive, one remaining and chapter victory are in `shinobij.client/test-results/story-twin-trials/`; representative desktop and phone images were inspected.
- Full repository suite: 16,032 passed, 28 skipped, 0 failed, 0 cancelled (16,060 total). The two source assertions for leave-button mode gating now include story trials, preserving their original busy-state checks.
- Additional focused checks: all 23 art/entrypoint/story-host regressions, all 16 lifecycle/forfeit contract checks, all 12 art/gameplay checks after separating the client art map, all nine difficulty/gameplay checks, and all four transport retry checks passed.
- Final server and client builds, lint (0 errors, 23 existing warnings), built-asset verification, build-size budgets and diff whitespace checks passed.
- Affected Chromium desktop/mobile combat smoke: 6 passed. Strict Chromium multi-actor layout and jutsu-selection viewport sweep: 1 passed. These focused checks are not the full cross-browser Playwright suite.

## Follow-up integration audit and encounter scenes

The follow-up traced the real boss-start, Solo action, physical-outcome and story-settle handlers for both villages. New tests authenticate an owner, start and persist both actors, reject another account, defeat the caster first, reject an early reward and a dead target without charging an action, finish the blade fighter, and replay the reward without paying twice. They also forfeit and replay the forfeit without charging HP twice, then suffer a real enemy knockout and verify saved zero HP, an unchanged chapter and the hospital recovery gate on another start.

Additional engine tests cover one area cast defeating both twins, expiry and repeated recovery, and completion records with a living or duplicate twin. Completion validation now rejects any surviving enemy and requires each bound twin ID to occur exactly once. The initial redundant queue rotation was removed: the existing squad-first scheduler already primes the player's opening turn before either enemy.

Fixed presentation gaps:

- The paired trials no longer announce a cleared or failed Tower floor. Their logs state that both twins fell, the player was defeated, or the trial reached its round limit.
- A forfeit at less than 10% maximum HP now logs the HP actually removed, capped by remaining health; the existing cost formula is unchanged.
- A trial loss cannot discard its run ID while the physical-outcome report is pending or failed. It shows saving status and a retry control, and exposes Return to story once confirmation succeeds.
- The phone forfeit control uses a shorter visible label and reduced horizontal padding, while retaining its full accessible name and confirmation of the existing HP cost.
- The host selects the single-opponent or paired screen directly. It no longer loads an intermediary screen module. The client art resolver also validates the four supported twin IDs without duplicating their paths.

Two new 1536 × 864 WebP encounter scenes were made with built-in imagegen and inspected:

- `shinobij.client/public/scenes/story/story-stormveil-village-50-twins.webp` — Stormblade advancing with a lightning sword; masked, silver-haired Stormseal casting a lightning seal on the storm proving platform.
- `shinobij.client/public/scenes/story/story-frostfang-village-50-twins.webp` — Iceblade holding ice daggers; Frostseal casting an ice ward in the frozen proving courtyard.

Each scene is wired to its chapter's final trial page and the paired combat backdrop. The earlier scene art remains on preceding dialogue pages, and each combat actor retains its own individual sprite and portrait. Original generated PNGs are preserved outside the project; optimized project copies total 795,540 bytes. Exact prompts, references, provenance and conversion settings are in [the art prompt record](story-twin-trial-art-prompts-2026-10-19.json).

The expanded browser harness tests win, defeat and forfeit in both villages at 1440px and 390px. It deliberately rejects the first reward request and rejects physical-outcome requests until the user retries. It checks that no unconfirmed result can be dismissed, losses grant no reward, wins grant one reward, both new images decode, and each twin's dossier shows its own portrait and sealed technique names. Synthetic finishers make victory deterministic; separate API tests use the twins' actual attacks to verify knockout consequences. This remains a regression audit rather than a normal-loadout balance playthrough.

Final follow-up results:

- Full repository suite: **16,041 passed, 28 skipped, 0 failed, 0 cancelled** (16,069 total), recorded in `.tmp/twin-audit-full-final.log`.
- Final focused gameplay/API/expiry tests: **37 passed**, including the low-health forfeit log case; final dialog contracts: **12 passed**.
- Final browser run: **12 passed**, with individual dossier portraits and techniques, retry flows and a measured assertion that the complete forfeit label fits. Evidence is in `shinobij.client/test-results/story-twin-trials/` and `.tmp/twin-audit-browser-complete.log`.
- Chromium desktop/mobile combat smoke: **6 passed**. Strict Chromium multi-actor geometry and jutsu-selection sweep: **1 passed**. The final phone-only padding rule is scoped to the story trial's accessible button name; all 12 trial flows were rerun with it.
- Final server/client builds, built-asset verification and whitespace checks passed. Lint: **0 errors, 23 existing warnings**. The unchanged product budget passes at **9,568,810 bytes**, below its 9,570,000-byte ceiling.
- These checks do not constitute a full WebKit/Firefox matrix, live production-database test, or normal-loadout balance playthrough. The 28 optional/integration skips remain skips.
