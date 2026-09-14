# Shinobi Journey finishing-pass report

## 1 — Executive result

Task-start checkout: `e3c09fe10988badc2a4b6a96f1f1bf4c085428b3`, with substantial pre-existing and actively changing work. That checkout was preserved. The finishing pass uses an isolated worktree on main as observed during this task: **`ecd8d6ccaba017a6791ec0ec94f822c10658984d`**, branch `codex/coherence-integrity-closeout-20260914`. It contains five original corrections, two subsequent recovery integration fixes, and their regression tests. No deployment or production mutation was performed.

At closeout, GitHub main had advanced to `21e2cc39262422cf2333b068b0588640352226b7` (10 commits, 57 changed paths: dead client source/art/CSS cleanup and related ratchets). The backend, shared code, server routes, root dependencies and the client doctrine/village helpers used by these patches are unchanged between those commits. This branch deliberately retains its tested base. Its browser captures/results certify that base plus these fixes, **not the newer CSS**; integrating with newer main requires the appropriate combined-branch checks.

The initial C1/C5 fixes and 19 new behavioral tests are isolated in local commit **`83df471d2eede0265bfad1f6a4fb89e97d33c721`**. The owner subsequently approved C3/C4's narrow recovery protocols and C2's additive formula, and requested **local checks only**. Those approvals are implemented in **`337b4db7cb84ebc36cafc63c5a50a635df8cd903`**, adding 49 behavioral tests and two settlement inventory checks; audit documents are separate. Nothing has been pushed or deployed.

**Assessment: all five original defects corrected within the approved scope; release integrity is not fully certified.** C2 applies only to new training; C3/C4 recovery applies to new server-bound protocols, with historical ambiguity left untouched. The second integration review found two further gaps in this branch's recovery implementation: an exhausted Exchange card could prevent retry after refresh, and private receipt reads could briefly lag another worker's commit. Both received narrow corrections and regression tests. Exchange now quietly resumes an already-debited retained request when opened or reconnected. Its markup, CSS and normal purchase interaction remain unchanged. Multiple engines, mode-specific consequences and established-player activity choice were preserved.

| Finding | Evidence and impact | Disposition |
|---|---|---|
| C1 — Scholars mission bonus missing on server | Client preview and declared server mirror disagreed. New parity test failed before correction. | **FIXED.** Existing 5% applies only to clan members with Scholars; no new bonus magnitude. |
| C2 — Pet Den / Pet Yard training bonus displayed but omitted | Before: baseline, Den50 and Yard50 all sealed 460 XP. After: baseline 460, Den 529, Yard 517, both 586 under the existing JS arithmetic/rounding. | **FIXED, OWNER APPROVED.** Den/Yard percentages add to mastery before the existing multipliers/rounding/morale. Old sealed sessions retain their reward. |
| C3 — interrupted clan-mission claim strands shared reward | Before: pre-clan-write failure later reports claimed and awards personal points without shared value. | **FIXED FOR NEW PROTOCOL.** Server reservation seals the grant; shared credit/proof and each personal credit/proof are co-written with CAS. Historical pending cannot authorize a grant and remains untouched. |
| C4 — Exchange refunds after successful treasury credit with lost acknowledgement | Before: post-clan-write failure grants 1,500 War Supply at zero net points cost and refunds allowance. | **FIXED FOR NEW PROTOCOL.** Stable client intent, private journal token, co-written debit/credit proofs, and no blind refund. Genuine repeat purchases remain distinct; legacy no-ID final-response ambiguity remains. |
| C5 — clan-save payload can alter treasury debit receipts | Pre-fix behavioral probe: 4 desired security assertions fail, 1 ordinary-edit assertion passes. Treasury recovery trusts the source `settlementReceipts` field. | **FIXED.** Pin that existing field to stored server evidence, just like the existing clan-war XP journal. No auth role or storage structure changed. |

Unresolved evidence is not permission to tune rewards or rebuild storage. Remaining high-value gaps and real storage drills still prevent universal recovery certification. Follow-up recheck verified all **810 prior API source hashes and 21 retained log hashes** before implementing the approved changes. Main was then `87466c3e412c13f440ad55bdf1b371bb9c652b73`; the three additional commits removed retired client Warfront workers/tests, leaving these backend surfaces unchanged. Prior browser captures still do not certify newer main CSS.

Human evidence still required: real storage/commit/health and cache, one scheduled-job owner, lost-response/process-restart settlement, fresh backup+isolated restore, retained-image rollback/newer-save compatibility/forward deploy, staffed war/Clan Boss, both admin roles and creator moderation, and the actual Android build/device.

Finding locations and reproduction evidence:

| Finding | Authoritative source | Reproduction / regression evidence |
|---|---|---|
| C1 | `api/missions/_mission-catalog.ts:missionRewardBonusPct`, used by `api/missions/claim-mission.ts` | `scripts/clan-doctrine-parity.test.mjs`; `scholars-before.log` and `main-scholars-after.log` |
| C2 | `api/pet/progress.ts`, `api/pet/_progress.ts:petTrainingUpgradeBonusPct` | Original `clan-probe-results.json:petTraining`; new `api/pet/training-clan-bonus.test.ts` |
| C3 | `api/clan/mission/claim.ts`, `mission/_settlement.ts`, `api/_clan-points.ts` | Original `clan-probe-results.json:clanMission`; new `api/clan/_reward-recovery.test.ts` |
| C4 | `api/clan/exchange/purchase.ts`, `exchange/_settlement.ts`, client `lib/clan-exchange-intent.ts` | Original `clan-probe-results.json:clanExchangeLostAck`; new recovery and client retry tests |
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

Unresolved intent: some caller-specific location and secondary-credit contracts; retained legacy pet-ranked presentation mismatch flagged by the current registry. The latter is **not counted as a newly reproduced defect**; new challenge admission is retired and current ranked Showdown must not be confused with compatibility notices. The Hollow Gate pet long-term engine choice remains owner-controlled. C2's formula is now owner-approved and implemented.

## 3 — Integrity

[Value-path registry](value-path-registry.json): **471 source/route rows**, covering 279 mounted routes plus 349 syntactically discovered value-mutation candidate files, grouped into 20 economic/progression families. The two added recovery helpers are included. Each row carries endpoint/source, actor/activity binding, value authority, client inputs, eligibility, expiry, replay, atomic boundary, receipt, retries, recovery, admin search, tests and flags. Discovery includes projections and unclassified callsites; this is **not a certificate that all 471 rows grant value or all are safe**. Dynamic writes, socket/job callsites and remaining UNRESOLVED fields still need callsite review.

Coverage includes ryo, Fate Shards, Bone Charms, Aura Stones, Honor/Mythic Seals, Chronicle collection/currencies, gear/items/consumables, stat/jutsu/profession/pet progression, clan XP/treasury/Clan Points/War Supply, rating, territory/war control, Hollow Gate, creator/events/story, bosses/missions, crafting/banking/premium and Legacy/Hall grants. Generic save sanitization, privileged corrections and scheduled awards are included as separate boundaries.

[Adversarial matrix](adversarial-matrix.json) records all 14 requested scenarios for each high-value family. A specific existing behavioral test is distinguished from **NOT ESTABLISHED** and from a reproduced defect. A test filename or shared lock is never counted as proof of every crash case. The full root suite reuses existing concurrent/wrong-owner/forged-value/expiry/receipt/recovery contracts rather than adding brittle snapshots.

Important current evidence:

- PvP has immutable terminal recovery, per-save durable settlement and a server-credit barrier before browser ACK. Existing tests cover lost claim/CAS acknowledgement, before/after save, secondary saga retry, generation conflict and old shared-ring churn. A legacy 90-day battle history is not the same object as a live session.
- Hollow Gate validates player/token/run/node/floor/kind/enemy plus exact engine child proof. Its final payout and redeemed-run record share a save write. Legacy/era/token side effects remain separately deduped; a consumed/missing run cannot invent another payout.
- Story uses the canonical next opponent/milestone and one-time redemption; generic saves cannot skip milestones or forge its ledger. Built-in event claims recognize the level 9 Aura Sphere only, refuse arbitrary authored IDs, and check capacity before burning the entitlement.
- Missions seal authority at start/terminal, compute canonical rewards and preserve claim identity. Bosses bind to stored spawn/operation/party/player/clan and parent terminal. The full staging boss/weekly matrix is still required.
- Direct trade requires a nonce by default; concurrent duplicate and different-payload replay tests exist. The `ALLOW_NONCELESS_TRANSFERS` override removes that guarantee and must stay off for certification. Post-debit ambiguity is not automatically refunded.
- Treasury gifts use lexically ordered locks, durable intent and applied-side receipts, with recovery tests. C5 now prevents ordinary clan saves from clearing/forging the clan-side evidence. Legacy clients without `requestId` still conflate genuinely separate identical gifts with replay for the journal window; changing that client protocol is outside these patches.
- Donations, supply collection and some bounded purchase flows have different journals/atomic boundaries. A random transaction ID or “needs-reconcile” log is not proof of automatic recovery. C3/C4 now have local regression evidence for the approved protocols; that evidence does not certify other paths or old ambiguous transactions.

Current historical P1 dispositions:

| Issue / concern | Classification | Current evidence and residual |
|---|---|---|
| [#19](https://github.com/Timehue/ShinobiX/issues/19), Hollow Gate linkage | **FIXED ALREADY** | Current combat/session/parent validators and `_combat-session.test.ts` confirm exact linkage and once-only settle; owner comment also records closure of #13. No old replatform recommendation applied. |
| #19, client/creator can define arbitrary story/event value | **NOT REPRODUCIBLE** in reviewed current claim paths | Canonical story settlement and built-in-only event grant, negative authored-ID and wrong-player tests. This does not certify every creator upload/moderation operation. |
| #19, live retry and recovery | **PARTIALLY PRESENT** | C3/C4 fixed for new protocols with local fault tests; additional per-path NOT ESTABLISHED cases and deployed recovery drills remain. C5 protection does not repair historical ambiguous transactions. |
| #19, receipt search | **PARTIALLY PRESENT** | Full-admin Battle Receipts accepts PvP and HG combat IDs; Economy Settlements lists state/limit and scans stale transactions. It has no universal player/activity/transaction/time query. No admin architecture/auth changes made. |
| #19 overall | **PARTIALLY PRESENT** | Authority has substantially improved, but universal recovery/search acceptance is not met. Do not close the issue from this pass. |
| [#10](https://github.com/Timehue/ShinobiX/issues/10), deployment/release health | **HUMAN CERTIFICATION REQUIRED** | Local topology, rollback-readiness, build and 90-check memory API certification pass. Real commit/store/cache/jobs/backup/restart/rollback/newer-save proof is not supplied. |
| [#20](https://github.com/Timehue/ShinobiX/issues/20), backup/restore | **HUMAN CERTIFICATION REQUIRED** | Current runbook defaults to base-store and supports retired-overlay capture only for reviewed rollback. Historical “hybrid” wording is not a reason to re-enable disk storage. Fresh target-distinct restore/hash/record/RPO/RTO evidence is still needed. |
| [#15](https://github.com/Timehue/ShinobiX/issues/15), Clan Boss | **HUMAN CERTIFICATION REQUIRED** | Structurally authoritative operation/Tower integration; safe staging solo/party, all actions/items, expiry/reconnect, caps and weekly rerun remain required. |
| [#18](https://github.com/Timehue/ShinobiX/issues/18), admin/moderation | **HUMAN CERTIFICATION REQUIRED** | Existing roles/diagnostics inspected; actual two-role and ordinary-player negative operations matrix remains unexecuted. |
| [#16](https://github.com/Timehue/ShinobiX/issues/16), creator/AI readiness | **PARTIALLY PRESENT** | Reviewed reward boundaries refuse authored value; staffing, publish/removal, disabled-save compatibility, upload/cost and live rollback certification remain. No public enablement. |
| [#9](https://github.com/Timehue/ShinobiX/issues/9), staffed war | **HUMAN CERTIFICATION REQUIRED** | Shared authority is not a staffed-event result. Preserve configured disabled state outside approved windows; no speculative population/economy changes. |

Operator lookup recommendation, **design only**: extend the existing full-admin Economy Settlements filter path with actor, activity/transaction/source and time range, retaining role policy and returning applied-side evidence. Review query/index/retention costs and negative-role tests before implementation. This pass does not change admin access. [Approved recovery scope](RECOVERY-DECISIONS.md) records C2–C4 implementation, failure tests and historical-state safeguards.

[Operator checklist](OPERATOR-CHECKLIST.md) specifies safe target identity, storage, health/login/first save, representative settlement, lost response, interruption/reconnect, jobs, backup/isolated restore and record verification, restart, retained-image rollback, newer-save compatibility and forward deployment. No destructive production action was performed.

## 4 — Clans

The current system is substantial: Clan Hall/creation/browse/recruitment; roster/roles/overrides; chat/notices; treasury currencies/items/donations/gifts; Clan Exchange; eight missions, XP/levels/hall tiers; seven upgrades and four doctrines; territory/guards/scrolls/War Supply/recon; clan wars with shinobi 1v1/2v2 and card/pet integrations; Clan Boss parties/standings; rankings/history/seal pool; Sensei/Student milestones; companion escorts/custody; succession/dissolution and membership cleanup.

| Doctrine | Current benefit | Existing upgrade/system overlap |
|---|---|---|
| Warmonger | +100 clan-war pool HP; not character damage | War Room  +2 HP/level, Scout Network, guards/territory/history |
| Merchant | +5% village shop ryo discount | Blacksmith 0.2%/level, Treasury Vault 0.2%/level War Supply, treasury/Exchange |
| Scholars | +5% training/mission bonus; mission mirror fixed in C1 | Training Grounds 0.2%/level, missions, existing Sensei/Student |
| Medics | −5% hospital cost | Medical Wing 0.3%/level, existing support/recovery/boss identity |

Pet Den 0.3%/level (15% cap) now applies to new training under C2's approved formula, alongside Pet Yard 0.25%/level. Building cap 50 and existing costs/percent caps are preserved. Hall tiers remain Camp 1 / Dojo 7 / Compound 15 / Fortress 25 / Citadel 40. Scout tiers remain position 1 / level 15 / name 30 during active war outside safe village. Full source inventory is in [Clan truth/design](CLAN-DESIGN.md).

Doctrine identity is already visible through Clan Hall, creator choice, and clan browsing/crest/pitch. Do not create another page. The backend permits founder doctrine changes; do not describe a historical choice as universally immutable. Nonetheless, a future change in its mechanical meaning needs fairness protection.

**Future specialization: POST-LAUNCH, design only.** Use existing crests/notices/records for voluntary doctrine flavor and cosmetics: Warmonger war history/recon identity; Merchant treasury/Exchange identity; Scholars mission/mentorship recognition; Medics recovery/support recognition. Any access/information/cost/timing advantage is mechanical and requires explicit owner approval. No extra damage/defense, premium generation, progression bar, currency, mandatory checklist, marketplace or second mentor system.

For any approved future mechanical expansion: one free version-bound confirmation/reselection for each legacy clan on the existing doctrine control; old contract remains until voluntary confirmation; active wars/runs retain sealed effects; record authorized actor/old/new/version; make retry idempotent; preserve choice through succession and rollback. Do not force a login popup or implement the entitlement now.

## 5 — Mobile

[Coverage matrix](mobile-coverage.json) inventories 65 player-facing screen identifiers plus five major/system concerns: A gauntlet 36, B dedicated layout/interaction 11, C visual regression 1, D device-only 1, E not established 21. Coverage classification describes the test's scope; it does not certify every nested screen or fixture state.

Existing infrastructure retained: five-viewport gauntlet (360×800,390×844,430×932,844×390,1440×900), adaptive shell, screen-specific map/touch/roster/combat tests, full-browser suite, visual baselines and strict combat matrix. Current reduced-motion context settings were respected; gallery captures use full-motion presentation. No thresholds were raised and no pixel baseline was updated.

**Production layout changes: none.** The second review adds one invisible Exchange lifecycle correction and browser coverage for paid recovery, reconnect after failure, and an unpaid intent that must remain untouched. It adds no player action, dialog, warning or timer. Existing strong layout tests were reused. The 10 original gallery captures were visually inspected: Central, Village, World Map, Inventory, Profile, Pet Home, Town Hall, Card Hall, Story Hall and mobile menu. Some gallery fixtures intentionally show a locked or empty state; that is not a full unlocked deck/roster certification. A transient toast or a dense screen alone did not justify a layout change.

**The mobile gauntlet is not green:** 256 passed, 67 skipped, 2 failed. The two World Map touch-minimum assertions reproduce at 430×932 and 844×390. Diagnostic measurements show the landmark's explicit 44px box counter-scaled to approximately 43.97px and 43.95px; visible landmarks still receive hit tests. This does not establish an inaccessible action or an unusable map. Production geometry and the test's 44px threshold were both left unchanged, as requested. `worldmap-probe-results.json` and `worldmap-repro/` preserve measurements/screenshots/traces. The first concurrent full-browser launch cleared its parent test-results directory; the isolated reproduction captures are retained outside it.

Strict combat completed with 19 passes, 10 intended skips and one Firefox Solo-PvE timeout. Its screenshot was the login restoration screen **before combat**, not a clipped HUD; the exact unchanged case passed on a fresh memory server in one minute. Both outcomes remain recorded. The original full invocation was not green, and no auth change or timeout increase was made to hide it.

Screen layouts inspected by source/test mapping and deliberately unchanged: every entry in the coverage matrix. Only the nested Exchange component's recovery lifecycle changed on the second review. The actual gallery-inspected screens are listed above; gauntlet exercises centralHub, village, profile, inventory, logbook, training, jutsuTraining, missions, bloodlineMaker, clan, worldMap, townHall, bank, shop, grandMarketplace, hospital, cafeteria, storyHall, sunscarFestival, home, pets, petLadder, hunting, tavern, hallOfLegends, shinobiCouncil, messages, professions, guides, shinobiTiles and echoesOfWar, plus Central modals/destination entries. Other compatibility/parent routes remain explicitly limited by coverage.

[Actual Android checklist](OPERATOR-CHECKLIST.md#actual-android--google-play-build-smoke) covers install/update, login/creation, all major gameplay families, Android back/keyboard/orientation/system bars, touch/scroll, suspension/reconnect and measured real-device performance. **It has not been run on a physical device in this task.**

### Original C1/C5 validation evidence

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

`validation-results.json` preserves original C1/C5 outcomes and log hashes. `recheck-evidence.json` records the follow-up check before C2–C4 implementation; `api-source-hashes-before-recovery.json` preserves that source snapshot. Current source-derived matrices include the approved recovery helpers. Run the inventory/contract/value/mobile generators and `verify-artifacts.mjs` from the repository root to regenerate them. Artifact validation checks structure and source references; it does not turn untested cases into passes.

### Approved C2–C4 follow-up validation

The follow-up uses Node 22.23.2 and disposable memory only. The focused group passes **147/147**, including new real-handler interruption, concurrency, rollover, server-proof spoofing, ownership and client retry checks. Full server/client build, asset/dist and size gates pass with no budget increase. Client lint passes with zero errors and the same 14 existing warnings. Existing clan interaction/mobile-roster browser tests pass **4 tests, 17 intentional skips**, across their configured projects. This is focused follow-up coverage; the original full-browser/gauntlet/combat outcomes above remain accurately scoped to C1/C5.

**Final root `npm test`: 10,461/10,461 passed, zero failures/cancellations/skips, 336.1 seconds.** This run includes both corrected inventories and all final recovery tests. The last active worker was the existing pet cinematic engine parity test; it completed without modification. All approved local fixes are committed. Actual deployed storage/rollback and physical Android certification remain explicitly unexecuted.

The new protocol's own migration review also reproduced two unsafe prototype cases before finalization: pre-seeded mission and Exchange fields without private authorization. Both are now rejected before value writes. These are regression tests of this uncommitted implementation, not additional shipped defects. The first full follow-up run passed 10,451/10,453 tests, exposing the old Exchange inventory marker and a missing client ownership mirror for the two new receipts. The mirror was corrected to prevent spurious device-draft recovery banners; the inventory now pins both recovery helpers. Local Express/memory certification also passed 90/90. Final root-suite results and source/log hashes are recorded in `recovery-validation.json`.

### Second integration review validation

The second review began at `50964ac9d`; its implementation and regression tests are committed locally in **`645323855`**. It reproduced a saved-debit Exchange request that the default screen never resumed after points/stock were exhausted, and stale private receipt reads across mocked Postgres workers. These are follow-up gaps in this branch's new recovery implementation, not two additional claims about the shipped game. The existing approved recovery scope covers both narrow corrections.

The first second-review source passed **10,469/10,469 root tests**, zero failures/cancellations/skips, and **63/63 focused checks**. Build, dist/assets, size and lint passed; all six focused mobile Chromium/WebKit cases passed. Final diff review then found an extraction regression: a manual retry did not persist its in-memory ID after browser storage became available again. A new test failed before restoring the original write and passes afterwards (**64/64 focused checks**). The earlier broad runs were deliberately interrupted and all required gates restarted; superseded logs are preserved with `before-fallback` names and are not counted as final gates.

Browser cases cover paid resume, quiet failed-response recovery on reconnect, and no automatic unpaid purchase. The initial reconnect fixture attached its response listener after the default Exchange tab had already sent the request; correcting that test timing required no production change. The earlier type-check failure was a local TypeScript narrowing error, corrected before the passing build.

**Final root suite: 10,470/10,470 passed, zero failures/cancellations/skips, 409.5 seconds. Final focused group: 64/64 passed. Final client lint: zero errors, 14 existing warnings. Final full build, dist/assets and size gates: passed. Final mobile recovery browser cases: 6/6 passed. Final strict combat-layout gate: 20 passed, 10 intended skips, zero failures, 22.3 minutes, with `COMBAT_LAYOUT_CAPTURE_PHASE=after` and `COMBAT_LAYOUT_STRICT=1`.**

**Full cross-browser run: 660 passed, 512 intended skips, 2 failed, 26.1 minutes. The full invocation was not green.** All 21 new Exchange cases passed across the seven configured projects. Chromium-desktop Village reported repeated `net::ERR_NETWORK_CHANGED` and could not import a chunk; the chunk existed and had the same SHA-256 in the build and immutable test snapshot. Its exact unchanged case passed on a fresh preview. Firefox's first-contract ceremony timed out in `page.goto(...networkidle)` before its assertions; the screenshot showed the complete ceremony, and the exact unchanged case also passed on a fresh preview. No production, wait-condition or assertion change was made for either retry. Both original failures and both successful reruns are retained.

`second-review-validation.json` records final source/log hashes, counts and scope. Historical results above remain separate, including the original gauntlet's two subpixel World Map failures. No thresholds, snapshots or browser skips were changed. The Exchange main render, cards and dialogs are byte-identical after line-ending normalization to the second-review starting commit; only its recovery lifecycle changed. Real storage restart/restore, deployment and physical Android certification remain unexecuted under the owner's local-only direction.

## 6 — Regression risk

| Production change | Necessity / player consequence | Regression surfaces | Evidence |
|---|---|---|---|
| `api/missions/_mission-catalog.ts:missionRewardBonusPct` | Restore declared client/server parity for the existing Scholars 5%. Eligible member receives the already displayed mission bonus without a new action. | Non-members, other doctrines, village/Aura stacking, caps/rounding, ryo-only combat claims, fixed capstone rewards and sealed prior reservations. | Actual helper parity 12 checks, mission catalog/saga 60, full root suite. No doctrine magnitude, UI, economy table or proof change. |
| `api/_clan-save-validate.ts:validateClanSaveWrite` | Protect existing treasury debit evidence from client clan-save overwrite. Normal members/leadership continue their existing actions. | Clan bootstrap, founder/member edits, existing XP journal, source receipt retention, treasury recovery and generic admin save behavior. Direct server treasury writes remain authoritative. | Before 4 failing guard assertions; 7 new production regression tests and 54 focused existing/new checks pass. Final full root suite passed. |
| Pet training start | Apply the approved existing Den/Yard benefits to newly sealed sessions. | Membership, caps, mastery/Loyal/happiness, rounding/morale, old sessions and duration. | New handler tests and existing pet/progression suite; old sealed reward remains unchanged. |
| Clan mission settlement and protected personal proof | Resume new interrupted shared/personal settlement without repeating value. | Existing weekly admission, historical pending, storage failures, save versions and display-history churn. | Co-written CAS proofs bound to the private server owner; fault/forgery/history tests. |
| Exchange treasury settlement and client intent | Retain an uncertain debit and finish missing credit with the same purchase identity. | Genuine repeat purchases, old clients, allowance rollover, clock skew, lock expiry, lost acknowledgements and retained-image rollback. | Server-token-bound journal/proofs, no automatic refund, local adversarial/client tests; live rollback remains uncertified. |
| `ClanExchange.tsx`, `lib/clan-exchange-recovery.ts`, intent/API helpers | Finish a saved debit even when its point cost or used allowance disables the purchase card after refresh. No new click or alert. | Unpaid/abandoned intent, StrictMode remounts, reconnect, expired/replaced IDs, canonical save-version commit and session-storage fallback. | Browser reproduction failed with zero recovery requests before correction; focused behavioral tests and required full UI gates recorded in the second-review evidence. |
| `api/_storage.ts` recovery receipt cache exclusions | Read private mission/Exchange receipts from the same current storage authority as their applied save proofs. | Cross-worker get/mget visibility; existing safe caches and unrelated namespaces remain unchanged. | Both new mocked-Postgres cache tests failed before correction; storage and full recovery regression coverage afterwards. This is not a real Postgres restart drill. |

No new route, currency, visible timer, warning, modal, confirmation, tutorial, notification, engine, schema, role/rate/IP change or layout tweak was introduced. The owner-approved recovery fields extend existing saves/journals; no storage engine was replaced. Prices/rewards/limits remain unchanged except the specifically approved prospective pet bonus correction. Historical compensation and receipt deletion were not attempted. The isolated worktree protects concurrent original-checkout edits. Before deployment, verify rollback uses a compatible retained image; old blind-refund workers must not process new pending Exchange operations.

## 7 — Final owner handoff

### SAFE / COMPLETE

- C1–C5 corrected within the approved scope, with reproduction evidence and regression tests. C2 is prospective and C3/C4 apply to new server-bound protocols; gates and limitations are listed above.
- Second review closes the paid-Exchange screen recovery and cross-worker receipt visibility gaps. Normal purchases and visible layout remain unchanged; an unpaid intent never starts automatically.
- Mode/contract inventory, value-path and adversarial evidence, current P1 disposition, complete clan truth/future-safe design, mobile coverage/gallery and precise certification checklists delivered.
- Intentional mode differences, current mobile layout, existing doctrine magnitudes and level 50–100 player choice preserved. No deployed change or destructive operation.

### NEEDS OWNER DECISION

- Historical remediation only: old ambiguous clan transactions and any old pet compensation need authoritative evidence and a separate decision. C2's formula and C3/C4's narrow recovery design are already approved and implemented; no repeated approval is needed.
- Unified existing-admin receipt search and remaining UNRESOLVED high-value adversarial cells. Do not advertise universal exactly-once recovery or close #19 yet.
- The gauntlet's subpixel World Map measurement discrepancy. No player blocker was proven, and no test threshold was relaxed; the gate remains explicitly red.
- Retained legacy pet-ranked presentation and long-term Hollow Gate pet authority choice; no speculative engine migration.
- Mechanical doctrine expansion remains POST-LAUNCH with legacy free confirmation/reselection if approved.

### NEEDS HUMAN LIVE/STAGING CERTIFICATION

- Exact deployed commit/store/cache/health, real first-save/reconnect/reward retry and process interruption, one scheduler primary and duplicate-job protection.
- Fresh backup, different empty restore target, hashes/counts/representative saves/clans/territory/receipts, measured RPO/RTO, restart, retained-image rollback/newer-save preservation/forward deploy.
- Staffed Clan Boss/war, two-role admin and creator disable/rollback evidence, and the actual Android build on recorded devices.
