# Master and Grandmaster campaign implementation

Status: implemented in the working tree, October 2, 2026. Validation is local; no production deployment or player telemetry is claimed. Owner decision: fix the remaining short IV/V chapters and missing personal predecessor requirements. The active rules are [World Era Chapters](../../era-chapters.md); structured values belong to [shared chapter definitions](../../../shared/era-chapters.ts).

## Decision and scope

The short hunts/damage and discoveries/early-extraction alternatives are replaced by five-stage Master and Grandmaster campaigns. Both narrative perspectives require the same two operation stages and three mandatory fresh examinations. IV follows completed modern III; V follows completed modern IV and its separate world unlock. IV admits level 70 and a Proven Legacy, V admits level 100 and a Legacy summit. Any known chosen Legacy rarity qualifies, preserving permanent identity choice.

The old 200/400 mission proposal was below or barely above III's now-implemented 300 victories. The accepted implementation raises IV's mission/Gate volume by 1.5× relative to III and doubles that volume at V. S-rank missions establish sustained field service; clean, within-par high-Spire victories with named mechanics establish the additional combat requirements. Counts are implementation tuning, not evidence of measured enjoyment or months of completion time. Canonical rules retain the daily-cap arithmetic and assumptions.

The initial research proposed new normalized solo/group trials, varied commissions, Gate mastery variants and emblem art. This bounded implementation uses the current public Spire and existing title rewards. Those new content systems remain future work and are not presented as shipped. Production Spire requires four live players; no equivalent solo path currently exists. The Hall states the group requirement before acceptance. Strong teammates may help, and power is not normalized. Revisit if group availability, stronger builds or repetition defeat the intended experience.

## Authority and integration

- [Journey endpoint](../../../api/eras/journey.ts): shared five-era order, known Legacy identity/stage and level checks, world availability, modern predecessor completion, immutable perspective and atomic completion/title save. Aggregate Legacy counters are no longer read for any campaign.
- [Campaign recorder](../../../api/_era-campaign.ts): complete mandatory stages, fresh rank-qualified mission wins, full five-floor boss-cleared extraction, exact mode/tier, same-run clean/par/pylon/signature predicates and permanent replay receipts. Spire proof requires four distinct live human owners; Story, embedded, AI-recruit and short-party practice cannot substitute.
- [Tower records](../../../api/towers/_records.ts): derives Spire tier, provenance and owners from the sealed session. Commits campaign proof with player records; failed writes keep settlement retryable. Generic saves cannot supply evidence.
- [Mission recovery tests](../../../api/missions/mission-combat-claim-saga.test.ts) and [Gate recovery tests](../../../api/hollow-gate/_external-credit-settlement.test.ts) exercise IV/V credit through the real authenticated reward handlers, including rejected commits and replay.
- [Actual Tower endpoint](../../../api/towers/settle-party-lifecycle.test.ts): final IV/V Spire credit retries after a failed campaign save without duplicate Fate Shards, keeps battle recovery available until stable, credits no campaign to an unstarted squadmate, then seals the cosmetic title through the real journey endpoint. Subsequent settlement replay preserves the completed save.
- [Hall chapter component](../../../shinobij.client/src/components/WorldEraChapter.tsx): exposes every stage, level/Legacy and four-player admission requirements, locks incomplete claims, preserves historic titles and original perspectives, and links objectives to missions/Gate/Towers and earned titles to Profile.

Historical v1 IV/V completion preserves cosmetic ownership and its timestamp as `legacyCompletedAt` after same-perspective migration. It cannot finish a modern campaign or unlock a successor. Existing I–III v2 receipts retain their current definitions and progression. World history, community milestones, first mythic-rarity awakening and Legacy birth-era stamping retain their independent semantics. No migration rewrites production saves.

## Controlled combat evidence

[Probe](mastery-probe.mts) drives the real Spire encounter builder, engine and enemy AI with the existing deterministic geared-squad policy. [Results](mastery-probe-results.json) retain the catalog version and 288 attempts: six examination tiers × 24 seeds × two four-member fixtures. Blessing week zero only. The stronger sensitivity uses the previously documented 1.56 bloodline multiplier, +42% item damage and 1.4× jutsu effect powers; no enemy tuning was changed.

| Tier | Baseline wins / 24 | Baseline fully qualified / 24 | Stronger fully qualified / 24 |
| --- | ---: | ---: | ---: |
| 12 | 22 | 2 | 7 |
| 15 | 18 | 0 | 1 |
| 16 | 16 | 1 | 7 |
| 17 | 16 | 5 | 7 |
| 18 | 12 | 1 | 10 |
| 20 | 8 | 0 | 8 |

“Fully qualified” means victory, no knockout, score par, pylon disruption and that tier's required signature counter in the same run. Every tier produced a qualifying stronger-fixture run. Baseline zeros at 15/20 demonstrate demanding conditions for that policy/fixture; they do not prove impossible encounters or a calibrated human difficulty target. The policy does not deliberately search for every required mechanic, so qualifying percentages are not estimated human win rates. [Opportunity tests](../../../api/towers/_combat-tactics.test.ts) separately execute pylon disruption and the required signature/charge counter on the actual six maps within par timing; controlled positions isolate opportunity, not complete-run success.

## Validation and remaining evidence

165 distinct focused Node tests passed across campaign/admission/migration, actual source settlements, Tower tactics and records, ownership/merge, titles, client receipts and narrative rules. Ten desktop/mobile browser cases passed, including every IV/V stage and second perspective, objective navigation, conclusion/title adoption, accessibility and overflow. Server/client TypeScript checks and scoped whitespace checks passed. Mobile completion screenshots were visually checked; the final browser rerun includes corrected S-rank-only mission instructions. Overlapping reruns are counted once.

Initial extended Gate fixtures exceeded the game's 32-character player-name limit and failed before the injected save fault. Short, distinct fixture identities fixed the test; the final 15 era/source variants pass. An optional boss-phase array needed an explicit assertion in the mechanics fixture for server TypeScript validation. Neither failure required a gameplay workaround.

Completed work: campaign definitions, mode/party proof, admission, migration, rewards, Hall, controlled tests, compiler checks and documentation readback. No implementation work remains for this bounded change. Deployment, human playtesting and telemetry remain separate. Revisit budgets for repeated-opponent fatigue, squad availability and observed abandonment; revisit encounter rules if stronger builds trivialize the required joint feats. Independent normalized solo trials remain additional content, not an implicit promise of this implementation.

### Follow-up integration check — October 2, 2026

The additional review found no new runtime wiring defect. Rechecked the five-era predecessor sequence, authoritative source timestamps and mode/party proof, retryable settlement, server-owned saves/titles, historical adoption and Express endpoint registration. 133 Node tests passed in this follow-up: 102 campaign/source/ownership/title/client-receipt checks, 16 real Legacy journey checks and 15 Express route checks. These overlap earlier validation and are not added to its 165-test count.

Extended the real Legacy journey test to read actual era admission before Proven and after the Proven/summit trial completions. Level, predecessor campaigns and world V are controlled prerequisites; the chosen Legacy and its stages come from the real acceptance and trial handlers. This verifies IV stays blocked at Stage III, opens at Stage IV and V opens at Stage V, without confusing a summit of any rarity with the community's first mythic-rarity awakening.

Added desktop/mobile Hall checks for III → IV and IV → V, alongside I → II. All 14 browser cases passed. The real Hall and chapter components adopt completion and immediately refetch admission, without waiting for their periodic refresh. Browser API responses remain controlled; real handler tests independently cover eligibility and writes. Server/client TypeScript and scoped whitespace checks also passed. No gameplay tuning or production deployment was performed during this follow-up.

### Main release verification — October 2, 2026

Integrated in an isolated checkout based on current `origin/main` at `3abfe24222ce47bd9f64064f3b8c034819b5cbde`. Preserved main's recent forge/card releases, mission recovery and Hall navigation. Only era changes and their required title ownership and CI integration are included. Chapter identity changes now remount the personal component, clearing transient state without synchronous effect updates and invalidating outstanding replies on unmount.

Release checks passed: 227 focused Node tests, 14 CI contract tests, 14 desktop/mobile browser cases, full server/client production build and bundle/distribution gates, full client lint (zero errors), generated tooling handoffs, deployment configuration, rollback checks and 92/92 isolated fresh-account certification checks. The era source fixture is excluded from production-preview discovery and runs with its dedicated Vite config in the required responsive CI job. Initial patch extraction left an extra title-registry delimiter; it was removed before these final passing checks. No unrelated workspace changes are included. These are local candidate checks; GitHub CI and production deployment are separate evidence.

Reproduction:

```text
node --import tsx --test api/_era-campaign.test.ts api/eras/journey.test.ts api/towers/_combat-tactics.test.ts api/towers/_records.test.ts
node --import tsx --test api/towers/settle-party-lifecycle.test.ts api/missions/mission-combat-claim-saga.test.ts api/hollow-gate/_external-credit-settlement.test.ts api/_utils.test.ts
node --import tsx --test api/save/_sanitize-legacy.test.ts api/save/_state-ownership-parity.test.ts api/_text-moderation-titles.test.ts shinobij.client/src/lib/era-journeys.test.ts shinobij.client/src/data/story-tone-and-staging.test.ts
node --import tsx --test api/legacy/_journey-e2e.test.ts server-routes.test.ts
node --import tsx docs/audits/eras-2026-10-01/mastery-probe.mts
node node_modules/typescript/bin/tsc -p tsconfig.cpanel.json --noEmit
cd shinobij.client
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit
node node_modules/@playwright/test/cli.js test --config playwright.world-eras.config.ts
```
