# Shinobi Journey finishing-pass report

## 1 — Executive result

Task-start checkout: `e3c09fe10988badc2a4b6a96f1f1bf4c085428b3`, with substantial pre-existing and actively changing work. That checkout was preserved. The actual finishing pass uses an isolated worktree on GitHub main as observed during this task: **`ecd8d6ccaba017a6791ec0ec94f822c10658984d`**, branch `codex/coherence-integrity-closeout-20260914`. The branch adds only the two narrow production corrections below and their tests. No deployment or production mutation was performed.

At closeout, GitHub main had advanced to `21e2cc39262422cf2333b068b0588640352226b7` (10 commits, 57 changed paths: dead client source/art/CSS cleanup and related ratchets). The backend, shared code, server routes, root dependencies and the client doctrine/village helpers used by these patches are unchanged between those commits. This branch deliberately retains its tested base. Its browser captures/results certify that base plus these fixes, **not the newer CSS**; integrating with newer main requires the appropriate combined-branch checks.

The two fixes and 19 new behavioral tests are isolated in local commit **`83df471d2eede0265bfad1f6a4fb89e97d33c721`**. Audit documents are a separate commit on the same branch. Neither has been pushed or deployed.

**Assessment: two proven defects corrected; release integrity is not fully certified.** Five defects were reproduced/proved: C1 and C5 fixed; C2–C4 deliberately remain explicit owner decisions. No proven mobile blocker was established, and no production UI file was changed. Multiple combat engines, mode-specific consequences, economy magnitudes and established-player activity choice were preserved.

| Finding | Evidence and impact | Disposition |
|---|---|---|
| C1 — Scholars mission bonus missing on server | Client preview and declared server mirror disagreed. New parity test failed before correction. | **FIXED.** Existing 5% applies only to clan members with Scholars; no new bonus magnitude. |
| C2 — Pet Den / Pet Yard training bonus displayed but omitted | Memory handler probe: baseline, Den level 50 and Yard level 50 all seal 460 XP for identical 4-hour/happiness 100 training; displayed bonuses are 0%, 15%, 12.5%. | **NEEDS OWNER DECISION.** Stacking/rounding with mastery, Loyal, happiness and morale must be specified before changing progression. Old sealed sessions must retain their contract. |
| C3 — interrupted clan-mission claim strands shared reward | Injected failure before clan write: initial HTTP 500, retry HTTP 200 after lease expiry; clan ryo stays 1,000 and XP 0, but response says claimed and personal Clan Points are granted. | **NEEDS OWNER DECISION.** A durable atomic shared-credit proof/recovery protocol is needed. Never replay an ambiguous historical pending receipt blindly. |
| C4 — Exchange refunds after successful treasury credit with lost acknowledgement | Injected post-write failure: War Supply 10 → 1,510 while personal Clan Points remain 4,000 after refund; limit is also refunded. | **NEEDS OWNER DECISION.** Stop treating a thrown write acknowledgement as proof that credit failed. A durable intent/applied-side receipt is needed before automatic refund/resume. |
| C5 — clan-save payload can alter treasury debit receipts | Pre-fix behavioral probe: 4 desired security assertions fail, 1 ordinary-edit assertion passes. Treasury recovery trusts the source `settlementReceipts` field. | **FIXED.** Pin that existing field to stored server evidence, just like the existing clan-war XP journal. No auth role or storage structure changed. |

The unresolved findings are not permission to tune rewards, add UI warnings everywhere, or rebuild storage. Release decisions should treat C3/C4 and any uncertified high-value path as explicit blockers to a claim of universal recovery safety.

Human evidence still required: real storage/commit/health and cache, one scheduled-job owner, lost-response/process-restart settlement, fresh backup+isolated restore, retained-image rollback/newer-save compatibility/forward deploy, staffed war/Clan Boss, both admin roles and creator moderation, and the actual Android build/device.

Finding locations and reproduction evidence:

| Finding | Authoritative source | Reproduction / regression evidence |
|---|---|---|
| C1 | `api/missions/_mission-catalog.ts:missionRewardBonusPct`, used by `api/missions/claim-mission.ts` | `scripts/clan-doctrine-parity.test.mjs`; `scholars-before.log` and `main-scholars-after.log` |
| C2 | `api/pet/progress.ts`, `start-training` XP seal; client `src/lib/village-upgrades.ts:getPetXpBonus` | `clan-probes.mjs`, `clan-probe-results.json:petTraining` |
| C3 | `api/clan/mission/claim.ts`, receipt reservation and replay branch before shared grant; `api/_economic-receipt.ts` | `clan-probe-results.json:clanMission` — failure before the shared write, followed by the same claim after 61 seconds |
| C4 | `api/clan/exchange/purchase.ts`, treasury credit catch and `refundPlayerTreasuryPurchase` | `clan-probe-results.json:clanExchangeLostAck` — shared write commits, then its acknowledgement throws |
| C5 | `api/_clan-save-validate.ts:validateClanSaveWrite`; recovery consumer `api/_cross-key-settlement.ts` | `clan-receipt-guard-before.log`, `api/_clan-save-receipts.test.ts`, `clan-receipt-guard-after-corrected-fixture.log` |

Fault-injection probes run only against disposable memory and preserve the pre-C5 result. They reproduce application write-boundary behavior; they do not substitute for a real database restart/restore drill. Logs, screenshots and traces are local execution evidence in this audit directory; the source-controlled report and matrices preserve the conclusions and test counts.

## 2 — Coherence

[Contract matrix](contract-matrix.json): **74 rows × 33 contracts**. It includes all 64 executable runtime-registry rows (including retired/compatibility entries), plus ten additional progression families discovered through mounted routes, including **Dojo Circuit**. Counts: 259 SHARED CONTRACT, 902 INTENTIONAL MODE RULE, 465 NOT APPLICABLE, 816 UNRESOLVED. Engine-level evidence is not silently promoted into caller-level certification. Unresolved location/secondary-progress/recovery cells remain visible; this is not a claim of universal coherence certification.

Inventory includes ordinary missions/hunts/wandering AI/story/PvE/PvP/ranked, clan 1v1/2v2 and sector/village war; Hollow Gate; every Celestial entry (Endless Tower, Battle Towers, Echoes, First Pact), Endless Spire, Weekly/Clan Boss and crises; pet Arena/Ladder/Showdown/Warfront/Gauntlet/First Pact and legacy cinematic compatibility; Chronicle free play/AI/Echoes/war/Dungeon; plus training, expedition, breeding/custody, narrative, clan/village and Legacy progression.

Intentional contracts preserved:

- **Solo PvE:** saved HP; sealed `continuousVitals` controls chakra/stamina carry. KO admits to the shared 60-second hospital stay. A surviving timeout/loss is not automatically KO. Exact human owner matters in companion fights. Missing terminal state cannot pay or punish. `api/solo-pve/_ai-encounter.ts`, `api/missions/_ai-fight-outcome.ts`, `api/pve/_fight-outcome-settlement.ts`.
- **PvP:** fresh arena/ranked pools differ from continuous world/guard engagements. Continuous PvP defeat (including AFK) has its own hospital consequence; successful flee is the exception unless KO. World protection and flee cost remain unchanged. `api/pvp/_vitals-settlement.ts`.
- **Shared ordinary combat:** canonical equipment/jutsu interpretation and authoritative `itemsUsed` evidence; physical state and consumables are co-written with their save receipt. No attempt to unify all engines. `api/solo-pve/_usage-authority.ts`, PvP consumable/outcome helpers.
- **Towers:** nine N-actor objectives, player-owned actors, per-human item costs even on a wipe, first-clear/assist/weekly Spire distinctions and parent-owned 2v2/war/boss payouts. `api/towers/_engine.ts`, `_tower-store.ts`, `settle.ts`.
- **Academy:** scripted post-win HP and resource restoration, one-step reward and exact dummy binding remain intentional. Ordinary fight settlement must not overwrite that contract.
- **Hollow Gate:** parent run, child proof, ledger, augment/retention and run-specific consequences remain separate. No engine migration was attempted.
- **Pet and Chronicle:** pet XP, rosters, moves and engine-specific proofs; cards/board outcomes and collection entitlements are not shinobi HP/jutsu/hospital rules. No-purse does not mean no Legacy or Dojo credit.
- **Shinobi XP:** retired in `api/_xp-engine.ts`; level derives from earned stat progression. No XP system was restored. Pet/profession XP remains a different concept.

Accidental divergence corrected: C1. `api/missions/_mission-catalog.ts:missionRewardBonusPct` now includes the existing member Scholars 5%, matching `getMissionRewardBonus` and mission preview. Existing combat claims remain ryo-only; field/hunt stat rewards and caps remain unchanged. Previously sealed claim reservations keep their existing amount.

New test: `scripts/clan-doctrine-parity.test.mjs` compares actual client/server helpers for all doctrines with/without clan membership and village/Aura combinations; 12 assertions. The initial desired contract failed 2/12 before the fix; focused catalog/saga/parity coverage passed 60/60 afterwards.

Unresolved intent: pet-training stacking (C2); some caller-specific location and secondary-credit contracts; retained legacy pet-ranked presentation mismatch flagged by the current registry. The latter is **not counted as a newly reproduced defect**; new challenge admission is retired and current ranked Showdown must not be confused with compatibility notices. The Hollow Gate pet long-term engine choice remains owner-controlled.

## 3 — Integrity

[Value-path registry](value-path-registry.json): **469 source/route rows**, covering 279 mounted routes plus 347 syntactically discovered value-mutation candidate files, grouped into 20 economic/progression families. Each row carries endpoint/source, actor/activity binding, value authority, client inputs, eligibility, expiry, replay, atomic boundary, receipt, retries, recovery, admin search, tests and flags. Discovery includes pure projections and unclassified callsites; this is deliberately **not a certificate that all 469 rows grant value or all are safe**. Dynamic writes, socket/job callsites and each remaining UNRESOLVED field must be reviewed before universal release signoff.

Coverage includes ryo, Fate Shards, Bone Charms, Aura Stones, Honor/Mythic Seals, Chronicle collection/currencies, gear/items/consumables, stat/jutsu/profession/pet progression, clan XP/treasury/Clan Points/War Supply, rating, territory/war control, Hollow Gate, creator/events/story, bosses/missions, crafting/banking/premium and Legacy/Hall grants. Generic save sanitization, privileged corrections and scheduled awards are included as separate boundaries.

[Adversarial matrix](adversarial-matrix.json) records all 14 requested scenarios for each high-value family. A specific existing behavioral test is distinguished from **NOT ESTABLISHED** and from a reproduced defect. A test filename or shared lock is never counted as proof of every crash case. The full root suite reuses existing concurrent/wrong-owner/forged-value/expiry/receipt/recovery contracts rather than adding brittle snapshots.

Important current evidence:

- PvP has immutable terminal recovery, per-save durable settlement and a server-credit barrier before browser ACK. Existing tests cover lost claim/CAS acknowledgement, before/after save, secondary saga retry, generation conflict and old shared-ring churn. A legacy 90-day battle history is not the same object as a live session.
- Hollow Gate validates player/token/run/node/floor/kind/enemy plus exact engine child proof. Its final payout and redeemed-run record share a save write. Legacy/era/token side effects remain separately deduped; a consumed/missing run cannot invent another payout.
- Story uses the canonical next opponent/milestone and one-time redemption; generic saves cannot skip milestones or forge its ledger. Built-in event claims recognize the level 9 Aura Sphere only, refuse arbitrary authored IDs, and check capacity before burning the entitlement.
- Missions seal authority at start/terminal, compute canonical rewards and preserve claim identity. Bosses bind to stored spawn/operation/party/player/clan and parent terminal. The full staging boss/weekly matrix is still required.
- Direct trade requires a nonce by default; concurrent duplicate and different-payload replay tests exist. The `ALLOW_NONCELESS_TRANSFERS` override removes that guarantee and must stay off for certification. Post-debit ambiguity is not automatically refunded.
- Treasury gifts use lexically ordered locks, durable intent and applied-side receipts, with recovery tests. C5 now prevents ordinary clan saves from clearing/forging the clan-side evidence. Legacy clients without `requestId` still conflate genuinely separate identical gifts with replay for the journal window; changing that client protocol is outside these patches.
- Donations, supply collection and some bounded purchase flows have different journals/atomic boundaries. A random transaction ID or “needs-reconcile” log is not exactly-once automatic recovery. C3/C4 are executable counterexamples to a blanket green claim.

Current historical P1 dispositions:

| Issue / concern | Classification | Current evidence and residual |
|---|---|---|
| [#19](https://github.com/Timehue/ShinobiX/issues/19), Hollow Gate linkage | **FIXED ALREADY** | Current combat/session/parent validators and `_combat-session.test.ts` confirm exact linkage and once-only settle; owner comment also records closure of #13. No old replatform recommendation applied. |
| #19, client/creator can define arbitrary story/event value | **NOT REPRODUCIBLE** in reviewed current claim paths | Canonical story settlement and built-in-only event grant, negative authored-ID and wrong-player tests. This does not certify every creator upload/moderation operation. |
| #19, live retry and recovery | **STILL PRESENT** | C3/C4 memory fault injection; additional per-path NOT ESTABLISHED cases. C5 receipt-authoring hole corrected but does not repair historical ambiguous transactions. |
| #19, receipt search | **PARTIALLY PRESENT** | Full-admin Battle Receipts accepts PvP and HG combat IDs; Economy Settlements lists state/limit and scans stale transactions. It has no universal player/activity/transaction/time query. No admin architecture/auth changes made. |
| #19 overall | **PARTIALLY PRESENT** | Authority has substantially improved, but universal recovery/search acceptance is not met. Do not close the issue from this pass. |
| [#10](https://github.com/Timehue/ShinobiX/issues/10), deployment/release health | **HUMAN CERTIFICATION REQUIRED** | Local topology, rollback-readiness, build and 90-check memory API certification pass. Real commit/store/cache/jobs/backup/restart/rollback/newer-save proof is not supplied. |
| [#20](https://github.com/Timehue/ShinobiX/issues/20), backup/restore | **HUMAN CERTIFICATION REQUIRED** | Current runbook defaults to base-store and supports retired-overlay capture only for reviewed rollback. Historical “hybrid” wording is not a reason to re-enable disk storage. Fresh target-distinct restore/hash/record/RPO/RTO evidence is still needed. |
| [#15](https://github.com/Timehue/ShinobiX/issues/15), Clan Boss | **HUMAN CERTIFICATION REQUIRED** | Structurally authoritative operation/Tower integration; safe staging solo/party, all actions/items, expiry/reconnect, caps and weekly rerun remain required. |
| [#18](https://github.com/Timehue/ShinobiX/issues/18), admin/moderation | **HUMAN CERTIFICATION REQUIRED** | Existing roles/diagnostics inspected; actual two-role and ordinary-player negative operations matrix remains unexecuted. |
| [#16](https://github.com/Timehue/ShinobiX/issues/16), creator/AI readiness | **PARTIALLY PRESENT** | Reviewed reward boundaries refuse authored value; staffing, publish/removal, disabled-save compatibility, upload/cost and live rollback certification remain. No public enablement. |
| [#9](https://github.com/Timehue/ShinobiX/issues/9), staffed war | **HUMAN CERTIFICATION REQUIRED** | Shared authority is not a staffed-event result. Preserve configured disabled state outside approved windows; no speculative population/economy changes. |

Operator lookup recommendation, **design only**: extend the existing full-admin Economy Settlements filter path with actor, activity/transaction/source and time range, retaining role policy and returning receipt state/applied-side evidence. Before implementation, review query/index/retention costs and negative-role tests. This pass does not add a separate admin product or weaken access controls. [Concrete recovery decisions](RECOVERY-DECISIONS.md) specify the smallest proposed C2–C4 scopes, failure tests and historical-state safeguards.

[Operator checklist](OPERATOR-CHECKLIST.md) specifies safe target identity, storage, health/login/first save, representative settlement, lost response, interruption/reconnect, jobs, backup/isolated restore and record verification, restart, retained-image rollback, newer-save compatibility and forward deployment. No destructive production action was performed.

## 4 — Clans

The current system is substantial: Clan Hall/creation/browse/recruitment; roster/roles/overrides; chat/notices; treasury currencies/items/donations/gifts; Clan Exchange; eight missions, XP/levels/hall tiers; seven upgrades and four doctrines; territory/guards/scrolls/War Supply/recon; clan wars with shinobi 1v1/2v2 and card/pet integrations; Clan Boss parties/standings; rankings/history/seal pool; Sensei/Student milestones; companion escorts/custody; succession/dissolution and membership cleanup.

| Doctrine | Current benefit | Existing upgrade/system overlap |
|---|---|---|
| Warmonger | +100 clan-war pool HP; not character damage | War Room  +2 HP/level, Scout Network, guards/territory/history |
| Merchant | +5% village shop ryo discount | Blacksmith 0.2%/level, Treasury Vault 0.2%/level War Supply, treasury/Exchange |
| Scholars | +5% training/mission bonus; mission mirror fixed in C1 | Training Grounds 0.2%/level, missions, existing Sensei/Student |
| Medics | −5% hospital cost | Medical Wing 0.3%/level, existing support/recovery/boss identity |

Pet Den 0.3%/level (15% cap) currently suffers C2. Building cap 50, existing costs/percent caps preserved. Hall tiers remain Camp 1/Dojo 7/Compound 15/Fortress 25/Citadel 40. Scout tiers remain position 1 / level 15 / name 30 during active war outside safe village. Other numeric maxima and exact feature/source inventory are in [Clan truth/design](CLAN-DESIGN.md).

Doctrine identity is already visible through Clan Hall, creator choice, and clan browsing/crest/pitch. Do not create another page. The backend permits founder doctrine changes; do not describe a historical choice as universally immutable. Nonetheless, a future change in its mechanical meaning needs fairness protection.

**Future specialization: POST-LAUNCH, design only.** Use existing crests/notices/records for voluntary doctrine flavor and cosmetics: Warmonger war history/recon identity; Merchant treasury/Exchange identity; Scholars mission/mentorship recognition; Medics recovery/support recognition. Any access/information/cost/timing advantage is mechanical and requires explicit owner approval. No extra damage/defense, premium generation, progression bar, currency, mandatory checklist, marketplace or second mentor system.

For any approved future mechanical expansion: one free version-bound confirmation/reselection for each legacy clan on the existing doctrine control; old contract remains until voluntary confirmation; active wars/runs retain sealed effects; record authorized actor/old/new/version; make retry idempotent; preserve choice through succession and rollback. Do not force a login popup or implement the entitlement now.

## 5 — Mobile

[Coverage matrix](mobile-coverage.json) inventories 65 player-facing screen identifiers plus five major/system concerns: A gauntlet 36, B dedicated layout/interaction 11, C visual regression 1, D device-only 1, E not established 21. Coverage classification describes the test's scope; it does not certify every nested screen or fixture state.

Existing infrastructure retained: five-viewport gauntlet (360×800,390×844,430×932,844×390,1440×900), adaptive shell, screen-specific map/touch/roster/combat tests, full-browser suite, visual baselines and strict combat matrix. Current reduced-motion context settings were respected; gallery captures use full-motion presentation. No thresholds were raised and no pixel baseline was updated.

**Production UI changes: none. New UI tests: none. Proven mobile defects: none established in this pass.** Existing strong tests were reused. The 10 gallery captures were visually inspected: Central, Village, World Map, Inventory, Profile, Pet Home, Town Hall, Card Hall, Story Hall and mobile menu. Some gallery fixtures intentionally show a locked or empty state; that is not a full unlocked deck/roster certification. A transient toast or a dense screen alone did not justify a layout change.

**The mobile gauntlet is not green:** 256 passed, 67 skipped, 2 failed. The two World Map touch-minimum assertions reproduce at 430×932 and 844×390. Diagnostic measurements show the landmark's explicit 44px box counter-scaled to approximately 43.97px and 43.95px; visible landmarks still receive hit tests. This does not establish an inaccessible action or an unusable map. Production geometry and the test's 44px threshold were both left unchanged, as requested. `worldmap-probe-results.json` and `worldmap-repro/` preserve measurements/screenshots/traces. The first concurrent full-browser launch cleared its parent test-results directory; the isolated reproduction captures are retained outside it.

Strict combat completed with 19 passes, 10 intended skips and one Firefox Solo-PvE timeout. Its screenshot was the login restoration screen **before combat**, not a clipped HUD; the exact unchanged case passed on a fresh memory server in one minute. Both outcomes remain recorded. The original full invocation was not green, and no auth change or timeout increase was made to hide it.

Screens inspected by source/test mapping and deliberately unchanged: every entry in the coverage matrix. The actual gallery-inspected screens are listed above; gauntlet exercises centralHub, village, profile, inventory, logbook, training, jutsuTraining, missions, bloodlineMaker, clan, worldMap, townHall, bank, shop, grandMarketplace, hospital, cafeteria, storyHall, sunscarFestival, home, pets, petLadder, hunting, tavern, hallOfLegends, shinobiCouncil, messages, professions, guides, shinobiTiles and echoesOfWar, plus Central modals/destination entries. Other compatibility/parent routes remain explicitly limited by coverage.

[Actual Android checklist](OPERATOR-CHECKLIST.md#actual-android--google-play-build-smoke) covers install/update, login/creation, all major gameplay families, Android back/keyboard/orientation/system bars, touch/scroll, suspension/reconnect and measured real-device performance. **It has not been run on a physical device in this task.**

### Validation evidence

| Gate | Result |
|---|---|
| Root `npm test` after C1 | **10,403/10,403 passed**, 0 failed/cancelled, 15m14s. |
| Final root `npm test` after both fixes | **10,410/10,410 passed**, 0 failed/cancelled/skipped, 6.1 minutes. |
| C1 focused parity/catalog/saga | 60/60 passed ; 12 new parity checks; before correction 2/12 failed. |
| C5 focused validator/treasury recovery | 54/54 passed, including 7 new guard tests. Initial added fixture expectation was corrected to preserve existing normalization; no production behavior changed for that correction. |
| Full build / dist / size gates | **Final build after both fixes passed**, including server/client compilation, content, dist and size checks; no budget increases. |
| Client lint | Passed: 0 errors, 14 existing warnings. |
| Release certification, real local Express + memory store | 90/90 passed on retry. First run failed local health startup before gameplay assertions; retained separately. |
| Mission eligibility / release assets / runtime docs | Passed. |
| Topology / rollback-readiness | Passed local checks; not an executed deployed rollback. |
| Mobile gauntlet | 256 passed / 67 skipped / 2 reproducible World Map size-assertion failures; no production UI change or relaxed threshold. |
| Strict combat layout | 19 passed / 10 skipped / 1 login-stage timeout; exact failed case passed unchanged on isolated retry. |
| Full browser suite | **641 passed / 512 skipped**, zero failed, 32.8 minutes. |
| Real target restore/rollback and actual Android | **HUMAN CERTIFICATION REQUIRED.** |

Logs named `main-*` and the specific gate logs describe the isolated checkout. Preliminary `root-tests*`, `build.log`, and task-start status relate to the original dirty checkout and are not release evidence. No pass from that moving checkout is substituted for this branch's checks.

`validation-results.json` records final outcomes and SHA-256 hashes for the retained local logs. Run `node --import tsx docs/audits/finishing-pass-2026-09-14/contracts.mjs`, the inventory/value/mobile generators, and `verify-artifacts.mjs` from the repository root to regenerate source-derived artifacts. Artifact validation checks structure and source references; it does not turn untested cases into passes.

## 6 — Regression risk

| Production change | Necessity / player consequence | Regression surfaces | Evidence |
|---|---|---|---|
| `api/missions/_mission-catalog.ts:missionRewardBonusPct` | Restore declared client/server parity for the existing Scholars 5%. Eligible member receives the already displayed mission bonus without a new action. | Non-members, other doctrines, village/Aura stacking, caps/rounding, ryo-only combat claims, fixed capstone rewards and sealed prior reservations. | Actual helper parity 12 checks, mission catalog/saga 60, full root suite. No doctrine magnitude, UI, economy table or proof change. |
| `api/_clan-save-validate.ts:validateClanSaveWrite` | Protect existing treasury debit evidence from client clan-save overwrite. Normal members/leadership continue their existing actions. | Clan bootstrap, founder/member edits, existing XP journal, source receipt retention, treasury recovery and generic admin save behavior. Direct server treasury writes remain authoritative. | Before 4 failing guard assertions; 7 new production regression tests and 54 focused existing/new checks pass. Final full root suite passed. |

No new route, currency, timer, warning, modal, confirmation, mandatory tutorial, notification, engine, schema, storage structure, role/rate/IP change, or layout tweak was introduced. These fixes cannot determine whether an old ambiguous transaction paid; no historical compensation or receipt deletion was attempted. The isolated worktree protects the user's concurrent original-checkout edits.

## 7 — Final owner handoff

### SAFE / COMPLETE

- C1/C5 narrowly corrected with failing-before/passing-after evidence and regression tests; final gates are listed above.
- Mode/contract inventory, value-path and adversarial evidence, current P1 disposition, complete clan truth/future-safe design, mobile coverage/gallery and precise certification checklists delivered.
- Intentional mode differences, current mobile layout, existing doctrine magnitudes and level 50–100 player choice preserved. No deployed change or destructive operation.

### NEEDS OWNER DECISION

- C2: exact prospective pet-training bonus stacking/rounding; retain old sealed timers and decide historical remediation separately.
- C3/C4: approve a small durable recovery design and release containment for ambiguous clan shared-value writes; no blind replay/refund. Unresolved legacy transactions need authoritative evidence before correction.
- Unified existing-admin receipt search and remaining UNRESOLVED high-value adversarial cells. Do not advertise universal exactly-once recovery or close #19 yet.
- The gauntlet's subpixel World Map measurement discrepancy. No player blocker was proven, and no test threshold was relaxed; the gate remains explicitly red.
- Retained legacy pet-ranked presentation and long-term Hollow Gate pet authority choice; no speculative engine migration.
- Mechanical doctrine expansion remains POST-LAUNCH with legacy free confirmation/reselection if approved.

### NEEDS HUMAN LIVE/STAGING CERTIFICATION

- Exact deployed commit/store/cache/health, real first-save/reconnect/reward retry and process interruption, one scheduler primary and duplicate-job protection.
- Fresh backup, different empty restore target, hashes/counts/representative saves/clans/territory/receipts, measured RPO/RTO, restart, retained-image rollback/newer-save preservation/forward deploy.
- Staffed Clan Boss/war, two-role admin and creator disable/rollback evidence, and the actual Android build on recorded devices.
