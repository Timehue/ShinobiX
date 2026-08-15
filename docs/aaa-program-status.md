# ShinobiX AAA Cohesion Program Status

> This status follows the corrected owner-authoritative handoff. One authoritative
> engine is required per distinct game mode; the program does not authorize a
> single combat engine for the whole game.

Status date: 2026-08-15 (America/Chicago)

Program state: **Phase 0 locally complete; Phase 1 implemented and validated locally; Phase 2 locally complete; Phase 3 implementation complete with the final integrated local gate pending**

Working branch: `codex/aaa-cohesion-corrected`

Integrated Phase-2 revision: `d9ef64aa94b410f5d307f828ccb1871e826fbf66`

Program baseline: `d8948a311680b92a2a672ae0a0b35714e73e8b4f`

Integrated `origin/main` revision observed on 2026-08-15: `06c9f4c69e92bd9dc8704c2b5f7b15ee36853866`

Merge parents: program first parent
`96d23ec23547f6eb6fbb705d58f46a64c46658cb`; integrated upstream second
parent `06c9f4c69e92bd9dc8704c2b5f7b15ee36853866`.

Program-branch state at the Phase-2 checkpoint: clean

Local runtime observed during discovery: Node `v24.15.0`, npm `11.12.1`

The repository requires Node 22 or newer. Local Node 24 is compatible with that
range. The Phase-1 workflow now pins Node `22.23.1`, but no hosted run of the
split workflow has yet verified Linux/Node-22 execution.

## Phase tracker

| Phase | State | Exit condition |
| --- | --- | --- |
| 0 — verified baseline and architecture truth | **Locally complete** | Baseline evidence, current deployment/storage topology, the complete static mode map, baseline repairs, and final local reruns are recorded. External and hosted checks remain explicit non-passes. |
| 1 — reliable CI | **Implemented and validated locally** | The split workflow, contracts, evidence handling, and operator docs pass local static/discovery validation. Hosted split checks and external branch protection remain unverified, so Phase 1 is not claimed complete. |
| 2 — mode-authority and capability registry | **Locally complete** | The executable registry, generated projection, reverse route census, canonical server capability predicates, client capability boundaries, upstream integration, frozen impacted census, complete root suite, exact release build, and built-artifact browser gate passed locally. Hosted and external evidence remains an explicit non-pass. |
| 3 — engine-boundary hardening | **Implementation complete; final local gate pending** | Wrong-owner and duplicate-authority paths are retired or exact-bound, the registry/docs are reconciled, and focused tests pass. The complete integrated root/build/browser checkpoint must still pass before this phase is labelled locally complete. |
| 4 — frontend decomposition | Pending | Not started. |
| 5 — shared reliability infrastructure | Pending | Not started. |
| 6 — capacity and operations certification | Pending | Not started. |
| 7 — persistent economy and marketplace | Pending | Not started. |
| 8 — durable activity events and Activity Spine | Pending | Not started. |
| 9 — persistent community systems | Pending | Not started. |
| 10 — UI, accessibility, and performance pass | Pending | Not started. |

## Owner-authoritative engine boundaries

The Phase-0 inventory must preserve and prove these distinct authorities:

- Shinobi PvP: casual, challenge, ranked, and sector-war shinobi PvP.
- Solo PvE: normal one-player shinobi-versus-AI combat, including missions,
  story, Academy, World AI, Dungeon Warden, Weekly Boss as currently designed,
  ordinary Solo raids, and Hollow Gate shinobi combat.
- Tower: Battle Towers, Endless Spire, Clan Boss, Tower party combat, Tower PvP,
  and declared headless village-war mercenary combat. The wrong-owner
  Tower-backed Sector garrison fallback is retired fail-closed; its intended
  PvP-backed headless surface remains absent.
- Pet Showdown/Coliseum: the turn-based command/bench/switch/stamina mode and
  the only new paid Coliseum admission/progression settlement.
- Pet Warfront/Tactical Arena: the separate positional map, lane, role,
  pathfinding, objective, and tactical replay engine family; Warfront and
  Tactical remain distinct named modes.
- Pet Gauntlet: a separate deterministic grid draft/run/transcript authority.
- Pet cinematic duel: exact-cardinality ordinary live PvP 1v1/2v2 is
  server-sealed, memory-only, and intentionally no-reward; Hollow Gate and
  Dungeon use exact parent-bound PvE proofs. New user-picked Arena-AI admission
  is retired, with separately registered recovery/capped settlement only for
  an exact issued pre-cutover token. The broken public ranked surface is also
  retired fail-closed.
- Legacy pet duel: the source-reachable ranked compatibility challenge/start/result
  path, distinct from the public Pet Ladder queue and all modern pet engines. It
  remains defective because cinematic client playback can disagree with the
  server's legacy replay.
- Client-local pet duel: presentation-only code, never valid as reward proof.
- Card Clash: the separate card rules, hidden information, response windows, and
  settlement domain.
- Clan War: shinobi 1v1 delegates to PvP, Pet 1v1/2v2 delegates to Showdown, and
  Tile Cards delegates to Chronicle. New shinobi 2v2 send/join/accept
  progression is retired fail-closed; the intended four-player PvP lifecycle
  remains an explicit surface gap.

Sector War may orchestrate receipts from several engines, but its shared
territory settlement is not combat authority.

Current mode, owner, route, caller, and status precedence lives in
`shared/runtime-mode-registry.ts` and
`docs/generated/runtime-mode-registry.md`. The authored architecture documents
provide cited evidence and boundary narrative without maintaining a competing
generic-Pet table.

## Current check status

The program branch no longer contains the old monolithic 45-minute workflow.
GitHub run `31850478893` for `d8948a3` remains valid **historical baseline
evidence**: the former `test-build` timed out after starting combat test 18 of 30
and skipped client audit. It is not current workflow truth and does not validate
or invalidate the new split jobs. GitHub CodeQL run `31850478918` for the same
baseline succeeded, but it likewise does not certify the integrated program
revision.

The exact integrated Phase-2 revision is merge commit `d9ef64aa94b410f5d307f828ccb1871e826fbf66`,
with program first parent `96d23ec23547f6eb6fbb705d58f46a64c46658cb`,
upstream second parent `06c9f4c69e92bd9dc8704c2b5f7b15ee36853866`,
and common program baseline `d8948a311680b92a2a672ae0a0b35714e73e8b4f`.
Results below describe that exact integrated tree. They are local Windows/Node-24
evidence only and are not hosted Linux/Node-22, staging, database, capacity, or
production-readiness evidence.

The new workflow pins Node `22.23.1` and declares nine stable/compatibility check
names: `CI / server-contracts`, `CI / server-build-security`,
`CI / client-quality`, `CI / release-certification`,
`CI / concurrency-smoke`, `CI / e2e-responsive`, `CI / e2e-combat`,
`CI / e2e-warfront`, and transitional `CI / test-build`. Combat execution is
internally sharded as `CI / e2e-combat / chromium`, `/ firefox`, and `/ webkit`;
`CI / e2e-combat` is the stable fail-closed aggregate. `CI / release-artifact`
is the internal server/client artifact join. No ordinary job timeout exceeds 29
minutes.

Server, client, and joined release archives are immutable artifacts named with
the source SHA, run ID, and run attempt and accompanied by SHA-256 and provenance
files. Every job retains 14-day evidence, including aggregate results. Dependent
jobs use `always()` with explicit upstream-result guards so upstream red does not
silently skip a required context. Hidden `.ci-*` provenance and repository-root
`.playwright-mcp` evidence are included explicitly in upload-artifact v7 uploads.
The Warfront CI configuration snapshots the downloaded built client into
`.playwright-warfront-dist` and previews that artifact rather than rebuilding
different source.

`npm run test:ci` invokes the same complete root auto-discovery runner as
`npm test` while bypassing only the local `pretest` client install, because CI
performs that locked install explicitly.

### Local Phase-1 validation evidence

| Validation | Result | Scope |
| --- | --- | --- |
| `actionlint 1.7.12` | **PASS** | All current workflow files passed static validation. |
| Prettier YAML parse | **PASS** | All workflow YAML parsed successfully; this is syntax evidence, not a hosted run. |
| Workflow/package contract tests | **PASS** | 5/5 tests: three workflow-contract cases and two package-script cases. |
| Warfront Playwright discovery | **PASS — discovery only** | 24 tests selected across the configured DPR projects. No browser execution is inferred. |
| Firefox combat discovery | **PASS — discovery only** | 5 tests selected for the Firefox combat shard. |
| Chromium combat discovery | **PASS — discovery only** | 20 tests selected across the Chromium combat projects. |

### Local Phase-2 authority evidence

| Validation | Result | Scope |
| --- | --- | --- |
| Runtime registry and audit projection | **PASS** | 21/21 focused tests cover 55 independently pinned modes, generated-document parity, reverse Express/client route and Socket.IO transport census, inert surface gaps, all six pet authority separations, and immutable compatibility projection. |
| ANBU typed registry consumer | **PASS** | 3/3 tests retain Solo PvE ownership and reject the retired Tower/custom-action path. |
| Canonical server release flags and public projection | **PASS** | 53/53 focused tests plus 198/198 broader ANBU, Clan Boss, and Village War tests; final source/flag contract 8/8 and public projection 6/6. |
| Upstream integration and adversarial review | **PASS after repair** | The two-parent merge has no conflicts or unmerged entries and retains all 14 upstream-touched paths. Review found and repaired the admin elapsed-read ownership defect; no P0/P1 remained in the reviewed Phase-2 paths. |
| Frozen impacted census | **PASS** | Client: 424/424 tests across 55 files. Server and source contracts: 331/331 tests across 33 files. |
| Elapsed-state and save-recovery regressions | **PASS** | Isolated elapsed-state persistence: 3/3. Corrected Tower, save-flight, and session-load slice: 20/20. |
| Strict TypeScript and client lint | **PASS** | Server `npx tsc -p tsconfig.cpanel.json --noEmit --pretty false`, client `npx tsc -b`, and the complete client lint all passed. |
| Runtime documentation drift | **PASS** | Generation and immediate `--check` agree byte-for-byte; generated output has no timestamp or SHA. |
| Complete root suite | **PASS** | `npm run test:ci`: 6,387/6,387 tests across 892 suites; 0 failed/cancelled/skipped/todo; `710057.6022 ms`. |
| Exact CI-environment release build | **PASS** | Required Sentry/release/build metadata was present. Server: `99.2 KB`; client dist: `300.3 MB`. Budgeted product JS/CSS: `7,694,029` raw / `2,356,743` gzip bytes; story JSON: `566,126` / `143,154`; combined: `8,260,155` / `2,499,897`; all emitted JS/CSS: `7,777,827` / `2,384,799`. The 11-file initial graph was `1,456,273` raw / `384,488` gzip bytes, 512 bytes under the `385,000`-byte cap; `verify-dist` passed. |
| Built-artifact browser matrix | **PASS** | 42 tests discovered: 30 passed, 12 intentional project-filtered skips, 0 failed, `45.4s`, covering the product-truth player-focus and release-smoke suites against the built artifact. |

The integrated client capability implementation spans the strict
fresh/stale/unknown store, admission boundaries, navigation and mixed-feature
gates, background mutation writers, Activity Spine, and admin diagnostics. The
integrated upstream save/recovery work and all Phase-2 changes crossed the
complete local test, build, lint, and built-artifact browser gates. Phase 2 is
therefore locally complete. This deliberately narrow claim is not a substitute
for hosted Node-22 execution, staging, real-database, capacity, operations,
rollback, or production-readiness evidence.

### Local Phase-3 focused evidence

These results were collected from the current Phase-3 worktree on local
Windows/Node 24. They prove the changed boundaries and source contracts, but do
not replace the pending complete integrated root/build/lint/browser checkpoint.

| Validation | Result | Scope |
| --- | --- | --- |
| Runtime registry, generated projection, and public capabilities | **PASS** | 28/28 tests cover 56 independently pinned modes, route/client/Socket.IO reverse census, two route-less retired Arena-AI rows, the separate exact issued-token recovery/settlement row, Showdown-only paid Coliseum entry, and Hollow Gate's exact parent-bound cinematic proof. |
| Runtime documentation drift | **PASS** | Generation and immediate `--check` agree byte-for-byte for the 56-row projection. |
| Hollow Gate pet authority and reconnect/adversarial slices | **PASS** | 35/35 combined Hollow Gate/storage/Showdown/reconnect checks, 4/4 dedicated adversarial checks, and 13/13 final crash/abandon/receipt-key review checks. |
| Pet Coliseum single-owner and battle-authority slices | **PASS** | 4/4 single-owner checks and 8/8 battle-authority checks. |
| Focused type/lint checks | **PASS** | Server cPanel TypeScript passed after registry reconciliation; the client TypeScript build and focused `PetArena` lint passed on the frozen runtime/UI slice. |

Phase 3 therefore has locally complete implementation and focused boundary
evidence, but remains **final integrated local gate pending**. No final Phase-3
revision, complete root-suite result, exact release-build result, or
built-artifact browser result is claimed here.

The split contexts have not run on GitHub, and the desired protection in
`docs/required-branch-protection.md` has not been read from or applied to external
GitHub settings. Phase 1 is therefore locally implemented/validated, not hosted
complete and not production-readiness evidence.

### Local Phase-0 execution evidence

The following evidence was collected in the isolated Windows worktree with Node
`v24.15.0` and npm `11.12.1`. It does not replace hosted Linux/Node-22, staging,
production, real-PostgreSQL, or capacity evidence. Results are console-only unless
noted; ignored Playwright output is not a durable release artifact.

| Local command group | Result | Scope |
| --- | --- | --- |
| Locked installs | **PASS** | Root: 174 packages, 0 vulnerabilities, approximately `11.75s`. Client: 319 packages, 0 vulnerabilities, approximately `14.03s`. |
| `npm test` | **PASS** | Final post-hardening run: 6,265/6,265 tests, 882 suites, 0 failed/cancelled/skipped/todo, `946749.746 ms`. The earlier 6,260-test run is superseded; initial sandbox `spawn EPERM` attempts were infrastructure-only. |
| Static/focused baseline gates | **PASS** | Deployment `~1.039s`; rollback-readiness `~1.106s`; mission eligibility `~0.900s`; release assets `~1.284s` (65 references, 165 badge PNGs, 21 Pet Home WebPs); pet breeding `~1.912s` (1,000,000 deterministic rolls); tooling handoffs `~1.160s`. |
| Backup-focused test | **PASS** | Final hermetic result: 16/16 tests, 0 failed/cancelled/skipped/todo, `299.16 ms`, including split-store checks for every disk-routed prefix. No real isolated-database restore or production recoverability is proven. |
| Root and client audits | **PASS** | Both reported 0 vulnerabilities (`~1.0s` root, `~1.43s` client). |
| Lint and builds | **PASS** | Client lint `~105s`; final exact-tree root build passed; client build `~79.7s`. Root build reported server `99.1 KB`, client dist `300.2 MB`, tracked budget `7.84 MB` raw / `2.37 MB` gzip, and all emitted JS/CSS `7.38 MB` raw / `2.26 MB` gzip. |
| Local certification and soaks | **PASS** | Fresh rebuild release certification 87/87 (`~17.83s`); concurrency smoke 172 calls/0 errors/24 users/health p99 `2ms` (`~18.51s`); Hollow Gate one test/50,000 replays (`261.99 ms`); Clan Boss operation 78/78 (`~5.4s`); balance audit exit zero (`~1.36s`); story content four assets, `566126` raw / `143154` gzip bytes (`~0.71s`). |
| Playwright install and responsive/accessibility E2E | **PASS** | Browser install exit zero (`~2.68s`); E2E 95 passed, 87 project-filtered skips, 0 failed (`~2.9m`). |
| Combat-layout E2E | **PASS** | 20 passed, 10 intentional project-filtered skips, 0 failed; approximately `16.4m`. The WebKit combat file was the slow file at approximately `8.0m`. |
| Warfront E2E | **PASS / PERFORMANCE WARNINGS** | 8 passed, 16 intentional DPR-filtered skips, 0 failed in `3.1m`. Telemetry reported repeated `100–3,114ms` long tasks and a `THREE.Clock` deprecation; the missing-atlas 404 was the deliberate fallback scenario. |
| Visual regression and size | **PASS after repair** | Central Hub initially failed twice by 40,606 pixels (`4%`) because the August 5 snapshot predated the August 7 player-focus UI. Only that baseline was regenerated; final visual 4/4 in `11.3s`. Four PNGs total `2,605,263` bytes under the `3,145,728`-byte cap. |
| `scan:data` and `ledger:audit` | **BLOCKED** | No safe database credentials are present; no database-backed result exists. |

The supplemental `test:e2e:live` suite was not part of the handoff's exact Phase-0
command set and remains deferred. Release certification plus the responsive and
combat-layout suites cover the required Phase-0 live paths. Future changes to its
onboarding or Express journeys must run it explicitly.

## Phase-3 boundary outcomes and remaining documentation state

1. **The fetched executable combat inventory was incomplete at owner-sensitive
   boundaries.** The Phase-2 checkpoint now contains
   `shared/runtime-mode-registry.ts`, converts
   `scripts/combat-runtime-inventory.mjs` into a deterministic audit projection, and
   expands its independent facts, reverse route census, surface-gap contract,
   capability bindings, and generated documentation. The registry slice is
   locally complete on the integrated revision; hosted and external evidence
   remains open.
2. **Ordinary live Pet Arena PvP now enforces its cinematic-duel roster
   contract.** Live 1v1 and 2v2 remain one server-sealed, memory-only, no-reward
   Socket.IO lifecycle, distinct from paid Coliseum and public ranked play. The
   shared client roster helper and server admission both require the exact
   one-pet or two-pet cardinality; the server rejects mismatched rosters rather
   than truncating them into a different encounter.
3. **The historical combat parity audit still contains prohibited advice.**
   `COMBAT_PARITY_AUDIT.md` is bannered as superseded, but its parity-gap table
   still recommends moving ordinary Arena, mission, Weekly Boss, and Hollow Gate
   combat to Tower. Those prescriptions must be removed or rewritten as
   historical findings; normal PvE and Hollow Gate shinobi stay on Solo PvE.
4. **The pet retirement scope is historical, not current authority.**
   `docs/pet-duel-engine-unification-scope.md` now marks both its initial scope
   and later “live on main” note as superseded history, links the generated
   registry, and records paid Showdown-only Coliseum, retired Arena-AI admission
   plus issued-token compatibility, exact-cardinality social PvP, retired public
   ranked, exact parent-bound Hollow Gate and Dungeon proofs, and the remaining
   legacy-ranked defect without collapsing Showdown, Warfront, Gauntlet,
   cinematic, legacy, or client-local engines.
5. **Current settlement and Hollow Gate contracts now defer combat ownership to
   the registry.** `docs/architecture/reward-settlement-contract.md` no longer
   treats migrated Solo missions or Hollow Gate shinobi wins as bounded client
   trust. `docs/hollow-gate-augments.md` records one parent-prebound cinematic
   proof, exact child receipt matching, duplicate-start reuse, and abandon-time
   revocation. New Hollow Gate Showdown admission and unbound legacy Showdown
   adoption fail closed; exact retained-child recovery is compatibility, not a
   second authority. Older dated reward audits remain historical evidence and
   require explicit scoping when cited.
6. **The database audit mixes current and retired topology.**
   `docs/DATABASE_AND_BACKGROUND_JOB_AUDIT.md` announces the cPanel overlay's
   retirement, then labels the old remote-proxy/disk-overlay table as Railway
   `LIVE`. Current checked-in deployment topology is one Railway replica with Supabase
   PostgreSQL/base-store; the old table must be unmistakably historical.
7. **Several audit findings are stale after later remediation.** Older
   concurrency/reward reports still list mission-handoff, treasury ordering,
   client-attested Solo outcomes, and other findings that later reports claim
   fixed. They must not be promoted into implementation work until traced in
   current code.
8. **The Phase-2 authority slice is locally complete.** The reconciled boundary,
   inventory, authority-map, settlement, Hollow Gate, and historical pet-scope
   documents now defer current row truth to the shared registry and preserve the
   distinct Tower and pet-family boundaries. The registry, generated projection,
   audit integration, and canonical server flag predicates passed focused review.
   The client capability implementation and upstream save/recovery integration
   passed the complete local test, build, lint, and browser gates. Hosted and
   external certification remain non-passes.
9. **Sector War's wrong-owner garrison fallback is retired fail-closed.** The
   former branch resolved a territory-affecting AI garrison through Tower even
   though the intended owner family is PvP. It now returns `410` before combat or
   contest settlement. The registry therefore keeps a route-less surface-gap row
   until the PvP domain supplies an authoritative headless lifecycle; ordinary
   Village-War mercenary Tower combat remains a separate valid mode.
10. **Dungeon Warden, Card, and Pet now form one exact parent proof chain.** The
    Warden uses Solo PvE, the Card seal uses a deterministic run-bound Chronicle
    session, and the Pet seal uses a fixed server-owned Rare Beast plus cinematic
    replay. Parent settlement requires all three wins on the exact active token;
    client enemy stats, claimed outcome, and presentation-only local duel code are
    not authority.
11. **The broken public Pet Ranked queue is retired fail-closed.** The public
    surface no longer joins the ordinary no-reward realtime duel, and its server
    queue endpoint returns `410` without minting a pairing. Re-admission requires
    one server-owned cinematic proof shared by combat and rating. Ordinary social
    Socket.IO PvP, legacy ranked recovery, and Showdown remain separate modes.
12. **The legacy ranked compatibility path is independently defective.** Its
    mounted, source-reachable challenge/start/result path can display cinematic
    client playback whose winner disagrees with the server's legacy replay. It is
    not the public Pet Ladder queue. New `rankedPet` notices are retired; retained
    notices, start tokens, and results remain compatibility-only until their
    active records expire or settle.
13. **Hollow Gate Pet has one exact current cinematic authority and an open
    long-term owner choice.** The parent preselects a versioned cinematic proof at
    combat creation, duplicate starts reuse that exact proof and seed, and parent
    settlement accepts only the matching versioned engine/proof receipt. New
    Hollow Gate Showdown admission and adoption of unbound legacy Showdown
    siblings fail closed. A legacy parent may recover only the unique exact
    active same-player/run cinematic child. The row remains `owner-decision` only
    for the future replatform choice; exact retained-child recovery does not
    create a second live authority.
14. **Clan War's engine gap is specifically shinobi 2v2 and is fail-closed.**
    Shinobi 1v1 uses PvP, Pet 1v1/2v2 uses Showdown, and Tile Cards uses Chronicle.
    New shinobi 2v2 send/join/accept progression returns `410`; retained queue
    records are cleanup-only and cannot launch. Re-admission requires one
    server-owned four-player PvP lifecycle that settles the whole challenge.
15. **Tactical Arena is currently only a Warfront alias.** Sharing the positional
    Tactical engine family is allowed, but the owner handoff requires Warfront and
    Tactical Arena to remain distinct named modes. The missing independent surface
    is an open product/route gap, not an undecided owner requirement.
16. **Paid ordinary Pet Coliseum progression now has one Showdown owner.** The
    Pet Arena CTA enters `/pet/showdown`; Showdown alone owns new paid Coliseum
    admission, turn execution, capped reward, counters, witness, Chronicle, and
    exact-once Legacy sidecars. New user-picked cinematic Arena-AI 1v1/2v2 rows
    are route-less retired surface gaps. A separate compatibility row exposes
    `/pet/battle-start` only as exact recovery and `/pet/battle-result` only as
    settlement for an already-active pre-cutover unmarked token; it has no new
    start role, and context-free admission returns `410`.

No `AGENTS.md` was found in the repository or its parent during the Phase-0
scan. The applicable root and client `CLAUDE.md` instructions were read.

## Confirmed risks and open evidence

- The checked-in deployment topology intentionally configures one Railway replica. Presence
  and Socket.IO remain process-local; horizontal scaling is not authorized.
- The fetched baseline's backup runbook can route base-store saves into an empty
  legacy overlay during restore validation. The Phase-0 patch avoids that path,
  reports the selected save store, and passes 16/16 focused hermetic tests. No real
  isolated-database restore drill has run, so recoverability is not claimed.
- The currency side-car ledger is documented as a projection, not gameplay
  authority. Multi-replica stale reads and KV-saga-versus-transaction risks are
  not closed merely because `ledger:audit` exists.
- Current Railway environment values, deployed `saveStore`, fresh-backup state,
  Supabase contention, production data integrity, and scheduled-job health have
  not been verified in this Phase 0.
- Existing local and historical in-memory soaks are regression evidence, not a
  real Postgres/Railway capacity certificate.
- Clan Boss party operation still has documented disposable-staging,
  multi-human, packet-loss, authenticated viewport, admin, AFK, and real-Postgres
  evidence outstanding.
- The live product and release reports warn that current credentialed staging
  smoke, restore evidence, and environment-specific Legacy availability require
  operator access.
- Stable required check names and the desired protection policy are now
  documented, but their hosted emission and GitHub settings have not been
  verified through an authorized repository-settings read.
- The corrected handoff, baseline report, verified mode-authority report, CI
  operator guide, and desired branch-protection policy now exist. The external
  protection state, hosted split-run evidence, capacity, operations, and rollback
  evidence remain non-passes until verified.

## External blocks and non-claims

The following need external access or an explicitly safe target. They remain
blocked evidence, not failed product assertions:

- credentialed Railway/Supabase staging health and restore checks;
- real Postgres load and shared-backend concurrency runs;
- production environment/configuration observation;
- disposable multi-account and multi-human Clan Boss/browser exercises;
- production or staging rollback drill;
- review-branch push, draft pull-request publication, hosted CI/CodeQL run and
  artifact evidence, and GitHub branch-protection read/mutation; the available
  GitHub authorization in this environment is invalid or unavailable.

No destructive production operation, deployment, environment change, database
migration, production load test, or production-data mutation is authorized by
this status.

## Exact next work

1. Complete the final integrated Phase-3 root test, exact release build, lint,
   generated-document drift, and built-artifact browser gates. If they pass,
   record Phase 3 as locally complete and begin Phase 4 without merging distinct
   engine families. Sector garrison, Clan War shinobi 2v2, public Pet Ranked, and
   standalone Tactical remain explicit fail-closed or route-less product gaps;
   legacy ranked remains recovery-only and defective. Hollow Gate's future
   replatform choice remains owner-controlled while its current executable
   authority is already exact and singular.
2. When valid GitHub authorization is available, push the review branch and open
   a draft pull request that preserves the Phase-2 merge checkpoint and its
   evidence.
3. Require all nine stable/compatibility contexts, three combat shards, the
   internal release join, and both CodeQL language checks to produce final hosted
   summaries and retained artifacts.
4. After GitHub has observed those contexts, apply the documented `main`
   protection with strict up-to-date checks. Retain `CI / test-build` during the
   migration, verify an ordinary PR and `main` run, then remove only that
   compatibility requirement and record the external rule identifier.
5. Keep the real isolated-database restore, staging health, database audits, and
   production capacity checks externally blocked until authorized targets are
   available; hermetic/local passes are not substitutes.

```text
git show -s --format="%H %P" d9ef64aa94b410f5d307f828ccb1871e826fbf66
git merge-base 96d23ec23547f6eb6fbb705d58f46a64c46658cb 06c9f4c69e92bd9dc8704c2b5f7b15ee36853866
git rev-parse origin/main
git status --short
node --import tsx --test scripts/ci-workflow-contract.test.mjs scripts/ci-package-scripts.test.mjs
npm run test:ci
git diff --check

# After pushing the review branch, with authorized GitHub access:
gh run list --workflow CI --limit 20
gh pr checks <pull-request>
gh api repos/Timehue/ShinobiX/branches/main/protection
```

Playwright browser installation is required before the browser gates when the
environment does not already provide Chromium, Firefox, and WebKit. Commands
that need credentials or a disposable remote target must be recorded as
externally blocked rather than replaced with invented results.
