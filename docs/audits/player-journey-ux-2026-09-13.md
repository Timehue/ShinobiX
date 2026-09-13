# Player journey UX audit — 13 September 2026

## Scope and method

This ledger was completed and consolidated **before product edits**. The checkout already contained extensive changes; this audit evaluates that working tree, rather than attributing pre-existing work to this pass. No production accounts or saves were used.

Built the current client into an isolated `.ux-audit-dist` and compiled Express. Ran an instrumented copy of `e2e-live/first-session-onboarding-express.spec.ts` against guarded in-memory Express. The complete new-account journey passed in 1.5 minutes, including a reload after starting training, server-authoritative combat settlement, the Academy reward, sector travel and return, Field Seal, logout/login, and completion of the companion First Contract. Combat was initially completed through ordinary server actions; the initial battlefield and results were inspected separately. This is evidence of persistence, not proof that the interaction is understandable.

Captured and inspected the actual game at **1366×768 and 390×844**. Additional rendered-state probes exercise clock drift, insufficient context, and failed hospital requests using the existing UI audit fixtures. Those fixtures test presentation and recovery behavior; they do not substitute for backend authority testing. Captures and text transcripts are in [the evidence folder](ux-journey-2026-09-13/before/).

## Ranked findings ledger

No P0 was verified. P1 means significant confusion or first-session friction, not a claim that every player becomes permanently blocked.

| ID | Journey / exact moment | Severity | Current player experience / harm | Evidence | Minimal correction | Systems / files | Regression risk |
|---|---|---|---|---|---|---|---|
| UX-01 | New account → Academy; storage notice still open when the companion starts guiding | **P1** | On a phone, the companion covers the notice text and `Got it`. Two persistent fixed surfaces compete for the same bottom space. The control cannot be located visually, although the click-through guide lets an automated click reach it. | [Mobile training](ux-journey-2026-09-13/before/03-training-390.png), [desktop comparison](ux-journey-2026-09-13/before/03-training-1366.png); `StorageNotice` uses `--z-notice:500`, coach uses 9000; both anchor above mobile navigation. The click-only probe passed despite the visible obstruction; geometry is the correct assertion. | Stack the guidance above the measured notice while it remains open; reserve that space until dismissed. Keep the existing notice and acknowledgement semantics. | `StorageNotice.tsx`, adaptive shell geometry | Medium: mobile safe areas, short viewports, guide CTA visibility, and modal stacking must be checked. Avoid an ever-higher global z-index. |
| UX-02 | First combat; opening turn and first movement/attack | **P1** | The tip says to use “Basic Attack,” while the visible control is `Attack` and the dummy starts outside melee range. The fixed tip also covers fighter vitals on mobile. Its attack/jutsu branches precede low-AP advice, so a novice can be told to act without the AP to do it. | [Mobile fight](ux-journey-2026-09-13/before/08-first-combat-390.png), [desktop fight](ux-journey-2026-09-13/before/08-first-combat-1366.png); `SparCoach.tsx` branch order; `MissionArenaFight.tsx` `enemyInMelee`, `moveAp`, `attackAp`, and targeting handlers. | Put short, state-aware guidance in the combat feedback band that already reserves space. Prioritize turn/AP and movement, use actual control names, and let targeting/error feedback take precedence. | `SparCoach.tsx`, `MissionArenaFight.tsx`, combat feedback CSS | Medium: fixed battlefield geometry must remain stable; test real movement/jutsu use and desktop/mobile action reachability. No combat values change. |
| UX-03 | Stat/jutsu training → waiting → collection or paid finish; device clock differs from server | **P1** | The screen says “Ready” and enables Claim while the HUD still shows ~90 seconds left. Jutsu finish prices/readiness use the same wrong time. A device behind can withhold the action after completion. The automatic jutsu queue also schedules with the device clock. | [Stat countdown contradiction](ux-journey-2026-09-13/before/16-clock-training-1366.png), [jutsu contradiction](ux-journey-2026-09-13/before/16-clock-jutsuTraining-1366.png); reproduced at +180 seconds after a correct heartbeat sample. `Training.tsx` stores `Date.now()` while its action handlers use `serverNow()`; queue runner also uses `Date.now()`. | Use the existing server clock for training countdowns, progress, cost previews, and queue deadlines. Re-check pending queue timing as heartbeat samples arrive. | `Training.tsx`, `jutsu-training-queue.ts`, existing `server-clock.ts` | Medium: early/late devices, queued promotion, auto-claim, cancellation, and price boundary behavior. Server remains the sole settlement authority. |
| UX-04 | Defeat → Hospital → free timer expires; discharge request fails, then recovery succeeds | **P1** | A failed automatic request is silent and repeats each second. The UI still says “Ready now” without explaining why the player remains admitted. Free success then navigates to the village without confirming treatment or the remaining resource needs. | [Hospital after HTTP 503](ux-journey-2026-09-13/before/17-hospital-retry-1366.png); `freeCheckout(true)` suppresses errors and resets its latch; `now` retries each second; `applyDischargeAndLeave` only toasts when charged ryo > 0. | Show an inline failure with a clear `Check out free` retry; perform one automatic attempt per admission, then use the existing manual retry. Confirm successful free discharge and explain HP versus chakra/stamina. | `Hospital.tsx`, existing `hospital-discharge.ts` adoption contract | Medium: preserve admission lock, versioned snapshot acceptance, free/paid request semantics, and healer flow. Never release locally on a failed response. |
| UX-05 | First training; selecting a duration immediately starts a paid-in-stamina action | **P2** | Buttons expose duration and gain but hide their 5/15/35/60 stamina costs. An unaffordable option only explains itself in a hover title, which is unavailable to touch users. | [Start controls](ux-journey-2026-09-13/before/15-training-cost-1366.png); `TRAINING_TIERS`, client affordability guard, and server stamina debit in `api/training/start.ts`. | Show each existing stamina cost alongside its gain and show any affordability shortfall directly on the disabled choice. | `Training.tsx`, training skin only if needed | Low: presentation only; keep all formulas, tiers, and debits unchanged. |
| UX-06 | First learned jutsu → Profile loadout | **P2** | The workbench header reports `3 / 15`, but the tab and quick-equip panel report 12 usable slots. Players cannot tell which capacity is real. | [Mobile loadout](ux-journey-2026-09-13/before/06-jutsu-equip-390.png); header hardcodes `LOADOUT_CAP_SUB`, while the panel correctly derives `unlockedSlots` from entitlement. | Use the already-derived usable capacity in the header. | `JutsuLoadoutPanel.tsx` | Low: subscriber and ordinary-player capacity labels; no entitlement or save change. |
| UX-07 | First mission claim; stat training collection/cancellation | **P2** | Routine successful actions queue a generic Notice/OK dialog, adding an acknowledgement before the already-obvious next activity. Stat training simultaneously suggests “collect next” while the timer is still running, even though the Academy says to continue playing. | Academy live test explicitly requires `dismissNotice` after the claim; `Missions.claimAcademyTrial`, `Training.completeTraining` and `cancelTraining` use `alert`. Active Training copy always says to collect next. | Use the existing nonmodal success language: an inline training receipt, existing toast for the Academy reward, and ready-dependent next-step copy. Preserve errors and the cancellation confirmation. | `Training.tsx`, `Missions.tsx`, first-session browser expectation | Low: keep exact authoritative reward/overflow text and ensure success remains announced by assistive technology. |
| UX-08 | Jutsu collection is empty; Profile → learning a technique | **P2** | The empty state sends the player to “Training Grounds,” which trains stats. There is no direct action, so the player must infer the separate Jutsu Training Hall. This is a valid empty/legacy state, not the normal fresh-account starter kit. | Initial browser fixture rendered “You haven't trained any jutsu yet. Visit the Training Grounds to learn them.” Traced Profile's empty-state branch and the separately rendered `training`/`jutsuTraining` screens. The later capacity probe reused capture 20 with a learned technique, so that image is capacity evidence only. | Name the Jutsu Training Hall and link directly using existing navigation. | `Profile.tsx` | Low: preserve the existing navigation guard and loaded tab context. |

## Root-cause review

- UX-01 owns the shared bottom-overlay collision; do not patch every Academy screen individually.
- Follow-up reproduction for UX-01: the fresh mobile Academy run exposed the same guide obstruction [after a viewport change at the Mission Hall reward](ux-journey-2026-09-13/before/23-academy-reward-resize-390.png). This capture was taken after the initial corrections, before the resize correction. The original one-time target reveal had already disconnected. Extend that shared reveal to respond to resizing and verify the target's geometry, rather than patching the mission button.
- UX-02 combines placement, terminology, and invalid next-action advice in one replacement of the spar hint's presentation. Existing combat feedback owns its geometry.
- UX-03 combines stat training, paid jutsu training, and automatic queue timing; all must read one clock.
- UX-04 owns the failed/successful hospital handoff; preserve the existing server snapshot adoption function.
- UX-05 and UX-07 are separate problems: informed commitment versus feedback after a completed action.
- UX-06 is a capacity-label defect; UX-08 is a wrong-destination empty state. Neither requires new jutsu functionality.
- No art, typography identity, economy, balance, progression system, or new screen is proposed. No P3 implementation is planned.

## Journey coverage and retained behavior

| Priority journey | Trace and finding |
|---|---|
| Brand-new account and Academy | Village/bloodline/avatar choices, companion grant, persisted tutorial; UX-01. The creator explains village identity versus stats. |
| First combat | Real sealed session and first-win receipt; UX-02. Existing win settlement and retry behavior retained. |
| First jutsu acquisition/equip/use | Free level-one unlock → Profile → equipped starter technique present in combat; UX-02, UX-03, UX-06, UX-08. |
| First equipment interaction | Both starter items opened and equipped through the visible detail dialog; slot, effects, and sell value visible. Dialog remains clear on both sizes. |
| First training | Server start and persistent token, then next tutorial beat; UX-03, UX-05, UX-07. |
| First mission | Academy Trial claim and subsequent Logbook instruction; UX-07. Daily-cap exemption already explained. |
| First sector excursion | Map region focus → one travel request → field trace → return; no new verified finding. Map chip preserves the objective without a full companion banner. |
| First defeat/hospital | Traced defeat routing and versioned hospital discharge; rendered admission and HTTP failure probes; UX-04. |
| Return after recovery | Free/paid discharge adopts authority before navigation; UX-04 addresses missing outcome/retry context. |
| First meaningful unlock | Field Seal acknowledgement and next-activity ceremony persist; first contract survives logout/login. Choice of combat/discovery/companion already provides a concrete handoff. |

## Verification after implementation

All eight findings were corrected: four P1 and four P2. No P0 or P3 implementation was added.

| Finding | Implemented correction and evidence |
|---|---|
| UX-01 | The shared shell stacks the guide above the measured storage notice. The existing target reveal centers the action between the HUD and guide, including after resizing. [Notice and guide](ux-journey-2026-09-13/after/19-academy-notice-390.png); [reward clearance](ux-journey-2026-09-13/after/23-academy-reward-clearance-390.png). The browser checks assert geometry as well as clickability. |
| UX-02 | The fixed spar overlay was removed. Short advice uses the existing combat feedback band, prioritizes available actions, and yields to targeting/error feedback. [Mobile combat](ux-journey-2026-09-13/after/08-first-combat-390.png). The persisted journey now actually uses Move and Flicker through battlefield targets before completing the fight with ordinary server actions. |
| UX-03 | Stat training, jutsu countdowns, paid-finish previews, and automatic queue deadlines use the existing server clock. [Stat timer](ux-journey-2026-09-13/after/16-clock-training-1366.png); [jutsu timer](ux-journey-2026-09-13/after/16-clock-jutsuTraining-390.png). Queue probes cover devices three minutes ahead and behind. |
| UX-04 | A failed automatic free checkout presents an inline retry and stops repeated background requests. Successful free and paid discharge confirms treatment after the authoritative snapshot is accepted. [Failed request and retry](ux-journey-2026-09-13/after/17-hospital-retry-390.png); [return to village](ux-journey-2026-09-13/after/18-hospital-recovered-390.png). |
| UX-05 | Training choices display their existing stamina prices and any shortfall directly. [Training costs](ux-journey-2026-09-13/after/15-training-cost-390.png). No price, gain, or stamina debit changed. |
| UX-06 | The loadout header uses the same derived usable capacity as its controls. [Loadout](ux-journey-2026-09-13/after/20-loadout-slots-390.png). |
| UX-07 | Stat training success uses an announced inline receipt; Academy mission success uses the existing toast. Active training explains that play can continue while waiting. Cancellation confirmation and error handling remain. [Training receipt](ux-journey-2026-09-13/after/21-training-receipt-390.png). |
| UX-08 | The empty collection names and links to the Jutsu Training Hall through existing guarded navigation. [Empty collection](ux-journey-2026-09-13/after/22-empty-loadout-1366.png). |

### Continued review beyond the Academy

Traced the existing First Contract's combat, discovery, and companion routes through `FirstContractHost`, `first-contract.ts`, and `first-contract-navigation.ts`. The combat route explains the E-Rank Drill and subsequent claim, with preparation handoffs for an empty loadout or no learned jutsu. Discovery names the numbered-sector/explore sequence and keeps the journal available on the map. Companion care names the free Pet interaction or an owned treat. Completion reports the recorded activity, preserves the running training context, and offers the next activity or Logbook. The real companion completion and acknowledgement survived logout/login and reload: [route choices](ux-journey-2026-09-13/after/24-contract-live-routes-390.png), [completion](ux-journey-2026-09-13/after/25-contract-live-recap-390.png).

The existing First Contract browser suites passed at both desktop and touch-enabled mobile sizes. They cover route-save failure and retry, keyboard focus restoration and dialog accessibility, combat preparation and tab context, the return on a later day, and unobstructed mission/map guidance. [Desktop routes](ux-journey-2026-09-13/after/later-desktop/first-contract-routes.png); [mobile map guidance](ux-journey-2026-09-13/after/later-mobile/discovery-wayfinding.png). Mission help was additionally exercised at 360×640 and 844×390.

Queued jutsu training was also reviewed as a later repeat-use loop; its clock defect is consolidated into UX-03. No separate later-system finding was verified from these traces. Endgame modes, live multiplayer, and every later economy/progression loop are outside the completed runtime coverage; this is not a claim that the entire game has no further UX issues.

### Checks

- Server build and client production build succeeded; client TypeScript build passed.
- **103 focused tests passed**, covering training parity and authority, hospital snapshot adoption, jutsu queue/clock behavior, loadout capacity, Academy wiring, spar guidance, and fixed combat/adaptive layout contracts.
- The persisted desktop and mobile Academy journeys passed, including real UI movement and Flicker targeting, mission reward, travel, Field Seal, logout/login, and the companion contract.
- **40 browser checks passed in the final matrix**: 30 in the desktop run (one persisted Academy journey, nine First Contract/handoff checks, and 20 surface/clock probes), plus the Academy journey and nine First Contract/handoff checks with touch-enabled mobile settings. Surface probes cover both representative sizes, failed discharge/retry, training receipts, cost visibility, capacity, empty-state navigation, notice overlap, resizing, and server-clock drift. The desktop run took 3.5 minutes; the mobile run took 2.3 minutes, with no retries.
- Visual review uses the screenshots under `before/` and `after/`. Browser fixture checks establish presentation and recovery behavior; the guarded Express journey and focused server tests establish the separate persistence/authority evidence.

The corrections introduce no save schema, reward, combat balance, content, or art-direction changes. Verification is local against the existing working tree, with an in-memory test backend. Nothing was deployed.

### Reproduce locally

From the repository root, run `npm run build:server`. Then, in `shinobij.client`, run the following PowerShell commands:

```powershell
npx tsc -b
npx vite build --outDir .ux-audit-dist
node scripts/prepare-ux-journey-audit.mjs
$env:UX_AUDIT_PHASE = 'after'
$env:UX_AUDIT_MOBILE = ''
npx playwright test -c test-results/ux-journey-work/playwright.config.ts
$env:UX_AUDIT_MOBILE = '1'
npx playwright test -c test-results/ux-journey-work/playwright.config.ts academy.spec.ts later.spec.ts
```

The preparation script creates an instrumented copy of the existing Academy test plus wrappers for the surface and First Contract suites. It uses port 25413 and disables background jobs in the guarded in-memory server. The temporary client build is removed after this audit; rebuild it before reproducing. Run logs remain in the ignored `shinobij.client/test-results/ux-*.log` files.

## Second review requested by the user

The recorded 103 focused tests and 40 browser checks were confirmed. A fresh TypeScript/client build and the 103 focused tests also passed. Additional viewport probes uncovered an incomplete UX-01 correction:

- At 844×390 and 979×768, the guide overlapped the notice by 50px. Its stacking rule stopped at 800px, while the mobile shell runs through 979px. [Landscape reproduction](ux-journey-2026-09-13/recheck-before/26-shell-844x390.png).
- At 360×640, the notice was clear but the highlighted training action remained behind the guide. The document scroller was excluded from the extra centering adjustment because its computed overflow is `visible`. [Short-phone reproduction](ux-journey-2026-09-13/recheck-before/26-shell-360x640.png).

These are consolidated into UX-01. Follow-up inspection also found that the noncombat skin could override the reserved bottom padding. The correction matches the shell breakpoint, measures and reserves the whole guide/notice/navigation stack in desktop and document scrollers, rechecks a target when its dimensions or the guide/notice change, and compacts the existing guide in short landscape so its current instruction, Skip, and any destination action fit.

The added matrix checks 360×640, 844×390, 979×768, and 980×768, with motion enabled and the full instruction visible. It verifies target clearance, the Skip control, notice dismissal, and navigation clearance. All four passed: [short phone](ux-journey-2026-09-13/recheck-after/26-shell-360x640.png), [landscape](ux-journey-2026-09-13/recheck-after/26-shell-844x390.png), [tablet](ux-journey-2026-09-13/recheck-after/26-shell-979x768.png), [desktop boundary](ux-journey-2026-09-13/recheck-after/26-shell-980x768.png).

The final TypeScript and production build passed. The 16 Academy/shell contract checks passed after the follow-up, in addition to the 103-test regression rerun. A combined browser run passed 23 of 24 checks and produced one resize assertion failure; an isolated rerun passed both resize cases. The resize test now avoids consecutive identical viewport overrides and retains diagnostic geometry if it fails. **Ten consecutive resize checks passed** after that test cleanup. The final touch-enabled mobile Academy journey also passed, including UI movement/Flicker, rewards, travel, Field Seal, logout/login, and the companion contract. All 25 distinct second-review browser scenarios were verified across these runs; this was not one uninterrupted green combined run.

To reproduce the additional viewport matrix after preparing the audit build, run `npx playwright test -c test-results/ux-journey-work/playwright.config.ts recheck.spec.ts`. The second-review run logs use the `ux-recheck-` prefix.

## Verified against live main for release

The UX changes were isolated onto a clean checkout of `bdc212f71414fb8368b82c214b441bef77ab6538`, the GitHub main revision also confirmed healthy at `https://shinobijourney.com/health`. Existing First Contract, jutsu presentation, combat, and cleanup changes from that newer main were retained. The loadout correction uses main's current `equippedCount` and `unlockedSlots`; unrelated local work was not included.

Release verification on this combined source passed:

- Server compilation and client TypeScript checking; production bundle, nine static legal pages, deployment artifact verification, and size checks. These stages were completed separately after stopping duplicate local typechecks.
- The additional build using the Production Image workflow's public production-style settings passed all size gates: **8,287,179 bytes** of budgeted product JS/CSS against the existing **8,300,000-byte** ceiling. No budget was raised.
- **116 focused regression tests**, **two Playwright configuration contract checks**, and **90/90 local release-certification checks**.
- **34 browser checks passed together without retries**, followed by **10 touch-enabled mobile checks without retries**. Both runs include the persisted Academy journey and First Contract handoffs. This supersedes the earlier mixed-run resize verification with a complete green release matrix.
- Visual inspection confirmed clear mission-reward controls and short-landscape guidance: [mobile mission](ux-journey-2026-09-13/live-main/11-first-mission-390.png), [mobile combat](ux-journey-2026-09-13/live-main/08-first-combat-390.png), [short landscape](ux-journey-2026-09-13/live-main/26-shell-844x390.png). The release breakpoint evidence also covers [360px](ux-journey-2026-09-13/live-main/26-shell-360x640.png), [979px](ux-journey-2026-09-13/live-main/26-shell-979x768.png), and [980px](ux-journey-2026-09-13/live-main/26-shell-980x768.png).

The audit harness now puts motion settings under Playwright's `contextOptions`, matching the current repository contract. The Academy and added breakpoint checks explicitly exercise full motion. Browser and certification accounts use only the guarded local in-memory backend.

### CI follow-up

The first main push (`28cb89954`) passed Production Image, but CI caught two test-maintenance issues: the browser suites' empty fixture destructuring violated lint, and the existing `GameToast.test.ts` spot-check still required the former hospital payment wording. The browser hooks now use the Chromium fixture explicitly, and the toast check matches the current paid-discharge confirmation. These corrections change only tests and this record. Lint on the corrected files, all six toast tests, and three focused runtime checks of both browser-suite hooks passed. The previously verified game source and production bundle are unchanged.

The subsequent CI run passed those checks and exposed the generated design-token handoff's stale breakpoint inventory. Running the repository's `export-tooling-handoffs.mjs` producer refreshed only `docs/generated/design-tokens.json`; the economy exports were unchanged. Its `--check` verification passed. This follow-up updates generated breakpoint occurrences and source line numbers without changing token values or game code.

CI for `eea0e4bb2` subsequently completed with all 17 other jobs passing, including every application-test and browser matrix. The final aggregate was blocked solely by that generated-inventory check.
