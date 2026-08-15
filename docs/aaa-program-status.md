# ShinobiX AAA Cohesion Program Status

> This status follows the corrected owner-authoritative handoff. One authoritative
> engine is required per distinct game mode; the program does not authorize a
> single combat engine for the whole game.

Status date: 2026-08-14 (America/Chicago)

Program state: **Phase 0 locally complete; Phase 1 pending; external release evidence remains blocked**

Working branch: `codex/aaa-cohesion-corrected`

Verified local `HEAD` and `origin/main`: `d8948a311680b92a2a672ae0a0b35714e73e8b4f`

Phase-0 worktree state before this file was added: clean

Local runtime observed during discovery: Node `v24.15.0`, npm `11.12.1`

The repository requires Node 22 or newer. Local Node 24 is compatible with that
range, but it does not replace the hosted Linux/Node 22 result.

## Phase tracker

| Phase | State | Exit condition |
| --- | --- | --- |
| 0 — verified baseline and architecture truth | **Locally complete** | Baseline evidence, current deployment/storage topology, the complete static mode map, baseline repairs, and final local reruns are recorded. External and hosted checks remain explicit non-passes. |
| 1 — reliable CI | Pending | Next phase; the confirmed 45-minute hosted timeout remains red until the split workflow completes on GitHub. |
| 2 — mode-authority and capability registry | Pending | Not started. |
| 3 — engine-boundary hardening | Pending | Not started. |
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
  and special N-actor or Tower-mechanics encounters.
- Pet Showdown/Coliseum: the turn-based command/bench/switch/stamina mode.
- Pet Warfront/Tactical Arena: the separate positional map, lane, role,
  pathfinding, objective, and tactical replay mode.
- Card Clash: the separate card rules, hidden information, response windows, and
  settlement domain.

Sector War may orchestrate receipts from several engines, but its shared
territory settlement is not combat authority.

## Current check status

The current main commit does **not** have a complete green CI result.

| Evidence | Result | Interpretation |
| --- | --- | --- |
| GitHub CI run `31850478893` for `d8948a3` | **Cancelled** at the 45-minute job limit | Release-blocking incomplete result. The serial job passed dependency installs, root tests, deployment, rollback, backup, mission/assets/tooling checks, root audit/build, release certification, concurrency smoke, client lint/build, browser install, and the responsive/accessibility suite before timeout. |
| Responsive/accessibility step in that run | 96 passed, 86 project-filtered skips | Step passed, but it is not the final CI result. |
| Combat-layout step in that run | Cancelled after starting test 18 of 30 | No final summary exists; it cannot be counted as passed. |
| Client audit in that run | Skipped after cancellation | Still missing for the current commit's hosted run. |
| GitHub CodeQL run `31850478918` for `d8948a3` | Success | The old warning in `.github/workflows/codeql.yml` about an expected advanced-setup red upload appears operationally stale and must be verified before editing. |

The CI workflow still places the full suite, two builds, two browser suites, and
both audits in one `test-build` job with `timeout-minutes: 45`
(`.github/workflows/ci.yml`). This is a confirmed reliability defect: a green
set of completed steps is reported red/incomplete because the final matrix
cannot finish within the monolithic job budget.

Historical reports contain useful earlier green results, but they do not certify
the current commit or this worktree. A cancelled, timed-out, skipped, or
zero-summary check remains red.

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

## Confirmed architecture and documentation defects

1. **The executable combat inventory is incomplete at exactly the owner-sensitive
   boundaries.** `scripts/combat-runtime-inventory.mjs` has one generic
   `Pet Arena and Coliseum` row and no independent Warfront/Tactical row. Its
   required-mode test repeats that omission, so the guard can pass without
   proving Pet Showdown versus Pet Tactical separation. It also lacks explicit
   rows for Tower PvP, sector-war pet combat, pet-ranked, the two Pet Ladder
   replay kinds, and the authored dungeon-pet path. Real separate routes already
   exist in `server.ts`, including Tower PvP, sector pet, pet ranked, Warfront,
   Showdown, and Pet Ladder routes.
2. **The human runtime inventory repeats the same conflation.**
   `docs/architecture/combat-runtime-inventory.md` labels one row
   `Pet Arena / Coliseum / tactical pet`; this contradicts the corrected owner
   boundary. `docs/architecture/combat-runtime-boundaries.md` likewise describes
   only one generic pet runtime rather than separate Showdown and Tactical
   authorities.
3. **The historical combat parity audit still contains prohibited advice.**
   `COMBAT_PARITY_AUDIT.md` is bannered as superseded, but its parity-gap table
   still recommends moving ordinary Arena, mission, Weekly Boss, and Hollow Gate
   combat to Tower. Those prescriptions must be removed or rewritten as
   historical findings; normal PvE and Hollow Gate shinobi stay on Solo PvE.
4. **The pet retirement scope contradicts itself.**
   `docs/pet-duel-engine-unification-scope.md` opens with “scope only, nothing
   implemented” and an old five-entry plan, while its later status says the
   relevant entries are live on Showdown and records different remaining work.
   It must be rewritten around verified current routes, same-mode Coliseum
   retirement, legacy replay compatibility, actual remaining code, and the
   intentionally separate Warfront/Tactical engine.
5. **Settlement documentation retains pre-cutover authority claims.**
   `docs/architecture/reward-settlement-contract.md` still describes Hollow Gate
   and legacy missions as bounded client-trust work deferred to P0-3, while the
   current Solo-PvE boundary and inventory say those rewarding paths migrated to
   server-owned Solo sessions. Historical reward audits contain the same stale
   rows and need explicit scoping or current-status corrections.
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
8. **The executable and older human inventories remain incomplete.** The new
   `docs/architecture/verified-mode-authority.md` closes the Phase-0 static map,
   including ANBU, mercenary, Clan War, Gauntlet, co-op Tactical, and Dungeon Card.
   The machine inventory and pre-existing architecture docs have not yet been
   generated from that truth and remain Phase-2 drift risks.
9. **Sector War's garrison fallback uses the wrong shinobi engine.** The combat
   win condition resolves a rewarding AI garrison through the Tower mercenary
   runtime instead of the owner-selected PvP family. Its settlement also has
   best-effort Legacy/Era side effects beyond territory contribution, so the
   Sector layer must not be described as territory-only or wholly exact-once.
10. **Dungeon encounter settlement lacks two required proofs.** Dungeon Pet
    selects the enemy and resolves the outcome on the client, while final dungeon
    settlement checks only the run, Warden proof, and elapsed time. Dungeon Card
    uses server-owned Chronicle actions, but final settlement does not consume its
    terminal proof either.
11. **The public Pet Ranked route remains on the legacy simulation.** A staged
    Showdown-based authority exists, but the mounted start/result path still uses
    the legacy pet duel. It is server-authoritative, yet it does not match the
    intended same-mode Showdown cutover.
12. **Hollow Gate Pet has two authority paths.** The mounted client uses the
    legacy pet start/result flow, while the Showdown handler contains a separate
    Hollow Gate-capable path that the caller does not use. A verified cutover and
    replay-compatibility decision is required before either path is retired.
13. **Tactical Arena is currently only a Warfront alias.** Sharing the positional
    Tactical engine family is allowed, but the owner handoff requires Warfront and
    Tactical Arena to remain distinct named modes. The missing independent surface
    is an open product/route gap, not an undecided owner requirement.

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
- Branch protection settings and current required check names have not yet been
  verified through an authorized repository-settings read.
- The corrected handoff, baseline report, and verified mode-authority report now
  exist and are Phase-0 evidence. Implementation, regression, capacity,
  operations, rollback, and branch-protection reports remain future deliverables;
  their absence does not imply a pass.

## External blocks and non-claims

The following need external access or an explicitly safe target. They remain
blocked evidence, not failed product assertions:

- credentialed Railway/Supabase staging health and restore checks;
- real Postgres load and shared-backend concurrency runs;
- production environment/configuration observation;
- disposable multi-account and multi-human Clan Boss/browser exercises;
- production or staging rollback drill;
- GitHub branch-protection mutation, if permissions are unavailable.

No destructive production operation, deployment, environment change, database
migration, production load test, or production-data mutation is authorized by
this status.

## Exact next work

1. Split the monolithic CI into stable required jobs that reuse exact built
   artifacts and preserve every existing check. Keep a compatibility aggregate
   until branch protection can migrate safely.
2. Add durable per-job evidence and a nonempty local-Postgres integrity target;
   never substitute an empty in-memory scan for production evidence.
3. Correct and expand the machine inventory from the complete static trace. Add
   tests that explicitly distinguish Showdown from Tactical, Solo from Tower,
   PvP from Solo, and Card Clash from every other engine.
4. Fix or disable wrong-owner/reward-proof paths before exposing strict green
   ownership assertions: Sector garrison, Dungeon Pet/Card, Pet Ranked, Hollow
   Gate Pet, and standalone Tactical.
5. Keep the real isolated-database restore, staging health, branch protection,
   and production capacity checks externally blocked until authorized targets
   are available; hermetic/local passes are not substitutes.

```text
git fetch --prune origin main
git rev-parse origin/main
git branch --show-current
git status --short
node --version
npm --version
npm ci
npm ci --prefix shinobij.client
npm test
npm run check:deployment
npm run check:rollback-readiness
npm run test:backup
npm run test:mission-eligibility
npm run test:release-assets
npm run test:pet-breeding-odds
npm run check:tooling-handoffs
npm run scan:data
npm run ledger:audit
npm audit --audit-level=high
npm --prefix shinobij.client audit --audit-level=high
npm run build
npm run certify:release
npm run soak:smoke
npm run test:hollow-gate-soak
npm run certify:clan-boss-operation
npm run audit:clan-boss-balance
npm run check:story-content
npm --prefix shinobij.client run lint
npm --prefix shinobij.client run build
npm --prefix shinobij.client run test:e2e
npm --prefix shinobij.client run test:e2e:combat-layout
npm --prefix shinobij.client run test:e2e:visual
npm --prefix shinobij.client run test:e2e:visual:size
npm --prefix shinobij.client run test:e2e:warfront
npm --prefix shinobij.client run test:e2e:live # supplemental when applicable
git diff --check
git status --short
```

Playwright browser installation is required before the browser gates when the
environment does not already provide Chromium, Firefox, and WebKit. Commands
that need credentials or a disposable remote target must be recorded as
externally blocked rather than replaced with invented results.
