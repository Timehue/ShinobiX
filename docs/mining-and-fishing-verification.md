# Mining and fishing implementation verification

Local verification record, October 8, 2026. This records implemented behavior and the remaining release checks; it is not a production deployment record.

## Requirement coverage

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Water fishing nodes and mountain/rock mining nodes | 24 authored nodes across ten painted sectors, each with an accessible approach | `shared/resource-nodes.ts`; placement and walkability assertions in `shared/resource-gathering.test.ts`; visual placement review in `.tmp/resource-node-art-review.png` |
| Explore, fishing, and mining share 100 daily actions | One combined UTC-day total used by admission, Explore, Outpost, and world HUD | `shared/resource-gathering.ts`, `api/world/_explore.ts`, `src/screens/WorldMap.tsx`; boundary and mixed-action tests |
| Three node attempts, including failures | Debit at Start; personal refill ten minutes after depletion | Server pure and handler tests; browser exhaustion journey |
| Separate skills; better success and quality at higher levels | Independent Fishing/Mining XP, levels 1–10; site gates 1/4/7; monotonic success and capped grade weights | `shared/resource-gathering.test.ts`; starting-level ownership and level-up tests |
| Fishing interaction | Timed hook and hold/release tension game; keyboard and pointer input | `shared/fishing-game.test.ts`; source-browser fishing journey; real-server desktop and phone journeys |
| Fracture Chain mining | Three solvable formations with two or three charges; ordered crack animation; overlapping paths destroy the core | Solver enumeration tests; source-browser clean exposure and 50th-use tool journey |
| Animation option and reduced motion | Cast arc, dipping float, bending rod, splash and fish motion; four mining biome finishes; three-second baseline option; reduced motion retains the same rules | Five source-browser projects, including full motion, reduced motion, phone, Firefox, and WebKit |
| Central Shinobi Outpost | Hunting, Fishing, Mining tabs; existing Hunting screen reused | `src/screens/ShinobiOutpost.tsx`; source-browser and real-server tab checks |
| Basic and gold tools | Basic tools cost 150 Ryo, break after 50 admitted uses; gold tools cost exactly 50 Fate Shards each and do not break | Purchase, duplicate ownership, discount exclusion, durability, persistence, and browser tests |
| Dedicated equipment slots | Fishing Pole and Pickaxe slots in Inventory, server-owned equipment changes | `src/components/GatheringEquipment.tsx`; equipment ownership and admission tests |
| Higher ore for higher equipment | Explicit Fine/Superior/Pristine forging requirements, with Pristine requirements for named equipment | Forge unit and named-registry integration tests; named-forge browser ore-consumption assertions |
| Useful fish and mineral grades | Explicit same-family refining; selected-grade Fish Rations recipe with a shared 40-ration output cap | Refining handler tests, cooking unit tests, and real-server persisted cooking journey |
| Results match the game | Illustrated parchment reports, charcoal, muted gold, warm bronze, neutral silver fish, gold tension gauge, useful XP/action details | Theme and gauge browser assertions; desktop and phone screenshots visually reviewed |
| Server authority and retries | Sealed difficulty, reward family, grade ceiling, skill, draws, mode and expiry; bounded inputs; idempotent receipts; shared-pool reservation journal | Pure and handler tests for duplicate admission/resolution, reservation recovery, failed save, uncommitted expiry, movement/battle epoch and persistence |
| Reconnect after a lost Start answer | Status reconciles the matching pending Start ID before playing the restored attempt | `src/lib/resource-api.test.ts`: recovery, other-device identity, and interrupted reconciliation cases |
| Private reward rolls | Character saves and responses contain public attempt details only; reward draws and sealed rules remain in the server journal | API response and persisted-save assertions; missing/mismatched journal tests; cancellation and expiry remain available without granting rewards |

Client paths in this table are relative to `shinobij.client/`. Existing Common mineral IDs and saved exploration finds retain their behavior. Higher grades use separate stack IDs. Generic client saves and submitted combat snapshots cannot overwrite gathering progression or tool durability.

## Completed checks

- Final root test suite: **14,020 passed, two skipped**, zero failures or cancellations. All **1,728 discovered files** were verified through the repository's existing 48-shard controls. The aggregate checks every shard header, completion marker, result counters, and file coverage (`.tmp/resource-backend-final-summary.json`, `.tmp/resource-backend-shards-progress.log`, `.tmp/resource-backend-shard-N.log`). The two existing road-challenger cases skipped because no natural pet challenger rolled in their current encounter window.
- Final admission/reward handler and pure tests: **15 passed**, zero failures (`.tmp/resource-admission-final-tests.log`).
- After keeping reward rolls private: **16 passed**, zero failures (`.tmp/resource-private-seal-tests.log`).
- Client reconnect and economy intent tests: **7 passed**, zero failures (`.tmp/resource-client-recovery-tests.log`).
- Persistence/ownership/source regression checks: **24 passed** after the cleared-attempt persistence fix.
- Gathering source-browser suite: **16 passed** across desktop, full-motion desktop, phone, and WebKit. Final theme checks: **8 passed**, with zero scoped WCAG A/AA violations (`.tmp/resource-ui-theme.log`).
- After the private reward-roll contract change: **16 passed** across the same four projects, plus **4 passed** in Firefox (`.tmp/resource-ui-final-contract.log`, `.tmp/resource-ui-firefox-final.log`). This verifies the current public attempt contract across all three browser engines.
- Expanded animation suite: **29 passed, one failed** (`.tmp/resource-ui-animation-final.log`). The fishing test now clicks the hook using Playwright's enabled-state waiting, avoiding a separate polling delay within the short hook window. All five fishing projects then passed with the gold gauge. The final fishing/core-destruction selection had **nine passed, one failed** (`.tmp/resource-fishing-shatter-final.log`); its Firefox failure occurred before the modal opened, and the same unmodified case passed in isolation (`.tmp/resource-shatter-firefox-retry.log`). Together these runs verify all **35 distinct source-browser cases**, including frozen/volcanic formations and overlapping-charge failure, without claiming a single clean 35-case run.
- Shared world HUD: **18 passed** across three projects, covering prior failures and the new combined daily-cap case (`.tmp/resource-hud-final.log`). The earlier broad source-HUD run had 115 passed, five failed, and nine skipped; its failed flows did not reproduce in this focused run.
- Strict combat layout: **20 passed, ten intentionally skipped**, zero failures (`.tmp/resource-combat-layout-suite.log`). The ten skips are the two authoritative Tower variants restricted by the existing test to the primary Chromium project, across the other five projects.
- Latest full frontend lint: **zero errors**, 15 existing warnings (`.tmp/resource-lint-latest.log`). The files edited during that run also passed a targeted lint check (`.tmp/resource-final-files-lint.log`).
- Final animation/source files and the repaired movement test passed targeted lint after their last edits (`.tmp/resource-animation-lint-final.log`, `.tmp/resource-adaptive-input-lint-final.log`). `git diff --check` passed; Git emitted line-ending notices without whitespace errors.
- Updated server API compilation and the combined production build passed (`.tmp/resource-server-build-final.log`, `.tmp/resource-production-build-final.log`). The final client rebuild, distribution integrity, and size check also passed after the last tension-gauge contrast adjustment (`.tmp/resource-client-rebuild-final.log`). The compiled stylesheet contains the final `#d18c74` warning fill. Initial JS/CSS remains within the existing budget at 394,416 bytes gzip.
- Final real-server gathering journey: **2 passed**, desktop and phone, including map approach, mining, fishing, Outpost tabs, and persisted fish cooking (`.tmp/resource-live-final-current.log`). The journey verifies the combined HUD reads Shared 2/100, private reward fields are absent from the real HTTP save, the tension gauge renders, and completed attempts clear. Current screenshots were visually reviewed.
- Named-forge browser suite: eight reveal cases passed, followed by **six settlement cases passed** after correcting their outdated button-label assertion (`.tmp/resource-named-forge-final-retry.log`). Ore consumption is asserted.
- The original world projection case passed one isolated rerun (`.tmp/resource-world-regression.log`) but failed again in the final serial selection. Its snapshot shows the held-left key reached column 1 while the assertion waited for column 10. The continuous controller can cross a tile between its 250 ms authority samples. The test now verifies each held key changes the rendered world position in the correct direction, releases input in a finally block, then returns to the exact target through the normal tile control. Desktop and phone verification **passed two cases** (`.tmp/resource-adaptive-input-final.log`), and targeted lint passed. Gameplay code did not change.
- Production build, distribution integrity, and size check passed with the palette, HUD, private journal, recovery, and animation changes, including the final CSS contrast adjustment.

## Responsive regression reconciliation

- Full responsive suite finished: **1,998 passed, 780 skipped, 63 failed** across 2,841 collected cases (`.tmp/resource-responsive-suite-final.log`). It used an immutable build snapshot. The initial full run is not recorded as green.
- Several asset-loading tests read filenames directly from mutable `dist/.vite/manifest.json`, while the original preview served the frozen `.playwright-dist-14195` build. The later final rebuild changed the observed filenames for PetEvolutionCutscene, PvpBattleScreen, WildPetBinding, and WorldCrisis80. Comparison: `.tmp/resource-immutable-asset-comparison.json`. Their request assertions pass against a matching final-build snapshot. No build changed during the reruns.
- The first 57-case serial rerun finished with **53 passed, one intentionally skipped, three failed** (`.tmp/resource-responsive-rerun.log`). The skipped Firefox A Rank Awakening contract is restricted by its existing test to Chromium; the earlier failure occurred during browser setup. The remaining Firefox cases passed unchanged. The three failures were the transient movement assertion described above and two timed WebKit Awakening Skip-button clicks.
- The repaired movement case passed on desktop and phone. An additional **eight cases passed**: the two unchanged WebKit Awakening flows and all six later tablet failures (`.tmp/resource-responsive-followup.log`).
- A coverage audit compares the original 63 failures, the 57-case selection, its three failures, the eight-case followup, and the repaired desktop movement case. It reports **63 accounted for and zero unresolved failures** (`.tmp/resource-browser-final-summary.json`). This records reconciled coverage across runs, not a claim of a single clean full-suite run. Original traces and failure logs are preserved.

The final requirement audit found no unfinished required feature or open verification check. The implementation table above covers the agreed Outpost, nodes, skills, shared allowance, tools, equipment, minigames, animations, material consumers, and authority/recovery behavior.

## Operational behavior

No SQL migration is needed. Optional server-owned save fields initialize old characters at level 1 with unused nodes. The API is explicitly registered in `server-api-routes.ts`. The resource route shares the existing save-lock then sector-pool-lock order with exploration. Save and shared-pool records are reconciled through a journal; they are not described as a single atomic write. Reward draws are read from that server journal at resolution, rather than exposed in the character save. Expired uncommitted admissions release reservations without charging the character. Accepted admissions retain their costs if cancelled or expired.

This work is local and has not been pushed or deployed. Iron, frozen, volcanic, and stormglass mining finishes are implemented. Additional formations, sound, stress hints, and alternative fishing timing settings remain future polish.

## Follow-up integration and presentation audit

The requested follow-up audit found and repaired several integration and presentation gaps:

- A restored attempt now retains its node when settling, so the result shows the correct remaining charges and offers another attempt. Previously, reload recovery could show an empty node and a false replenishment message.
- Node preflight explains the required tool before admission. Missing equipment cannot offer a misleading Start action.
- Inventory gives the gathering kit a full-width row. Tool cards also adapt to narrow containers, preventing one card from covering the next Equip button. Controls retain a 44-pixel minimum height.
- Tool details identify the correct world-map use, remaining basic-tool uses or permanent durability, and Fate Shard pricing. Fish and ore identify their cooking and crafting consumers.
- The Outpost's Crafter link opens the workshop directly. The desktop profile and mobile You sheet show the same combined Explore, fishing, and mining action count as the world HUD and Outpost; hunting retains its own allowance.
- Remaining green gathering accents were replaced with gold, bronze, charcoal, and restrained grade colors. Tool purchase artwork uses a compact framed panel instead of a 420-pixel empty stage.

Completed follow-up evidence:

- **71 targeted unit/handler checks passed** (`.tmp/resource-audit-integration.log`, `.tmp/resource-audit-economy.log`).
- **50 gathering browser cases passed in one run**, covering Chromium, Firefox, WebKit, phone, full motion, reduced motion, narrow equipment controls, reload recovery, missing equipment, success, failure, depletion, skill level-up, and the 50th basic-tool use (`.tmp/resource-audit-source-final.log`). Scoped WCAG A/AA audits passed.
- **Four final real-server journeys passed**, desktop and phone (`.tmp/resource-audit-final-live.log`). These use the isolated production artifact with the final profile-counter repair. They buy and equip both basic and gold tools, verify persistence and durability, play both minigames, use the shared allowance, cook fish, refine ore, and forge a rare weapon using higher grades. Actual persisted quantities confirm lower eligible ore is spent first and Pristine ore is preserved until explicitly refined. Earlier fixture and navigation-assumption failures remain in their original logs.
- **Ten existing screen checks passed against that final artifact**: eight Inventory, Shop, Grand Marketplace, and Outpost artwork/layout checks, plus two Inventory/Jutsu keyboard-tab checks across desktop and phone (`.tmp/resource-audit-final-screens.log`, `.tmp/resource-audit-final-layout.log`). These cover the final screen edits made after the broad regression run started.
- **Strict combat layout passed: 20 passed, ten intentional skips**, zero failures (`.tmp/resource-audit-combat-layout.log`).
- Full frontend lint passed with zero errors and 15 existing warnings. Files edited afterward passed targeted lint, including the shared counter and finalized browser tests (`.tmp/resource-audit-lint-final.log`, `.tmp/resource-audit-counter-lint.log`, `.tmp/resource-audit-test-lint-final.log`).
- Final isolated production compilation and size checks passed. Initial JS/CSS is **394,405 bytes gzip**, below the unchanged 394,500-byte ceiling (`.tmp/resource-audit-shared-counter-build.log`, `.tmp/resource-audit-final-size.log`). The broad suite's original `dist` and frozen preview manifests remained identical while it ran.
- The first five broad-run failures were reconciled by **five passing reruns** (`.tmp/resource-audit-broad-recovery.log`). The mixed-action test now verifies 45 Explore actions plus 55 gathering attempts reach the shared cap. Four story cases encountered screenshot output-file errors; they passed with the existing supported evidence-directory override and unchanged gameplay code.

The final default production build also passed server/client compilation, distribution integrity, and the unchanged size budgets (`.tmp/resource-audit-production-final.log`). A fresh full frontend lint on the final source passed with zero errors and the same 15 existing warnings (`.tmp/resource-audit-lint-current.log`).

The exploratory responsive run was stopped after 1,065 collected-case progress entries in favor of a complete three-shard run against the final production build, matching CI's sharding approach. Each shard used a separate immutable preview and story-evidence folder. The completed gate collected **2,841 unique cases: 2,057 passed, 781 skipped, three failed**. All three failures passed isolated reruns against the same unchanged final build:

- Firefox Exchange capacity/prepare-return: the initial snapshot showed the session-expired login screen before the Exchange opened; the unchanged rerun passed (`.tmp/resource-audit-market-retry.log`, `.tmp/resource-audit-market-retry.json`).
- Firefox Jutsu network feedback: the initial boot timed out on the same session-expired screen before reaching training; the unchanged rerun passed (`.tmp/resource-audit-training-retry.log`, `.tmp/resource-audit-training-retry.json`).
- WebKit phone Vanguard mastery/respec: the initial assertion timed out while the screen was still restoring; the unchanged rerun passed (`.tmp/resource-audit-vanguard-retry.log`, `.tmp/resource-audit-vanguard-retry.json`).

The aggregate verifies **2,841 collected and 2,841 unique cases**, no report-level errors, no unfinished cases, and **zero unresolved failures** (`.tmp/resource-audit-responsive-current-summary.json`). Original shard failures and traces remain preserved; this is reconciled coverage across runs, not a claim of a single green full-suite invocation. The default production manifest and all three frozen-preview manifests had identical SHA-256 hashes (`.tmp/resource-audit-final-manifests.json`). No production build changed during this gate or its reruns.

This follow-up audit is complete. No required integration repair or verification check remains open. The result is locally built and verified; it has not been pushed or deployed.
