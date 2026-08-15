> **This file supersedes earlier handoffs that suggested merging intentionally distinct combat engines.**

# SHINOBIX AAA COHESION, RELIABILITY, AND MMO IMPROVEMENT PROGRAM
## Corrected Owner-Authoritative Implementation Handoff

Repository: Timehue/ShinobiX
Active production host: Railway
Database: Supabase PostgreSQL
Client: React + TypeScript + Vite
Server: Node.js + TypeScript + Express
Required Node version: 22+
Last externally reviewed main commit: d8948a311680b92a2a672ae0a0b35714e73e8b4f

Fetch the current remote before doing anything. The repository may have advanced after this handoff was written. Record the actual current `origin/main` SHA and treat current running code—not stale documentation—as the source of truth, except for the owner-authoritative architecture decisions below.

This handoff supersedes every earlier AAA or engine-unification handoff. Ignore any earlier instruction that suggests combining distinct ShinobiX game engines merely to reduce code duplication.

This is an implementation assignment, not a review-only assignment. Do not stop after writing another plan. Inspect, implement, test, repair regressions, document the result, and leave the work in reviewable commits with a clean working tree.

---

# 1. CRITICAL OWNER-AUTHORITATIVE ARCHITECTURE RULE

ShinobiX is intentionally a multi-engine game.

The objective is:

ONE AUTHORITATIVE ENGINE PER DISTINCT GAME MODE.

The objective is NOT:

ONE COMBAT ENGINE FOR THE ENTIRE GAME.

Different modes have different participant models, board sizes, movement rules, turn structures, AI needs, hidden information, reconnect requirements, boss mechanics, replay formats, and settlement rules. Separate engines are correct when the game modes are materially different.

These boundaries are owner decisions and override any stale comment, audit, generated inventory, or previous AI handoff that suggests otherwise.

## 1.1 Required engine boundaries

### A. Shinobi PvP engine

The PvP engine remains authoritative for:

- Casual player-versus-player combat
- Direct player challenges
- Ranked shinobi PvP
- World or sector-war shinobi PvP
- Other real-player shinobi battles that require PvP authorization

It must retain PvP-specific behavior such as:

- Two authenticated human participants
- Challenge, world-attack, clan-war, or ranked admission
- Reconnect and resume
- AFK and turn-timeout rules
- Move idempotency
- Opponent-private state
- Ranked-rating settlement
- Spectating where supported
- PvP reward authority

Do not merge shinobi PvP into Solo PvE.

### B. Solo PvE engine

The Solo PvE engine remains authoritative for normal shinobi-versus-AI combat, including:

- Missions
- Story fights
- Story bosses
- Academy sparring
- World-map AI
- Wanderers
- Ambushes
- Hunts
- Dungeon Warden
- Weekly Boss where currently designed as Solo PvE
- Ordinary raids that use the normal PvE ruleset
- Hollow Gate shinobi combat
- Other ordinary single-player AI encounters

Hollow Gate shinobi combat must remain on the normal Solo PvE engine.

Do not move ordinary PvE onto the Tower engine.

Do not merge Solo PvE into PvP.

### C. Tower engine

The Tower engine remains authoritative for the larger multiplayer and special-mechanics combat format, including:

- Battle Towers
- Endless Spire
- Clan Boss
- Tower party encounters
- Tower PvP
- Multiplayer PvE or multiplayer PvP using the larger Tower battlefield
- Boss encounters whose special mechanics require the Tower runtime

The Tower engine exists because it supports:

- Larger battle spaces
- Multiple actors
- Party participation
- Special boss mechanics
- Tower floor and run state
- Multiplayer PvE or multiplayer PvP lifecycle
- Tower-specific action and settlement rules

Do not move Towers to normal Solo PvE.

Do not move normal PvE, story, missions, or Hollow Gate shinobi combat to Towers.

### D. Pet Showdown / Coliseum engine

The Pet Showdown engine remains authoritative for the turn-based Coliseum-style pet mode where current design assigns it, including concepts such as:

- Turn-based pet commands
- Fielded pets
- Bench pets
- Switching
- Stamina
- Pet moves
- Signature or super actions
- Showdown weather and turn scripts
- Turn-based Coliseum presentation

This engine is not the Tactical engine.

### E. Pet Warfront / Tactical Arena engine

Pet Warfront and Tactical Arena remain separate positional game modes with their own engine.

They may include:

- Positional movement
- Lanes or larger maps
- Tactical roles
- Walk masks
- Navigation
- Team AI
- Jungle or map objectives
- 4v4 or other larger team formats
- Tactical respawning and objectives
- Warfront-specific replay and simulation behavior

Do not merge Warfront/Tactical with Showdown/Coliseum.

Do not delete Warfront map, walk-mask, board, strategy, AI, replay, parity, or simulation code merely because another turn-based pet engine exists.

A Pet Ladder may rank or display both modes. That does not make them the same engine.

Different replay kinds for Showdown and Warfront are allowed and expected.

### F. Card Clash engine

Card Clash remains a separate card-game engine.

Do not merge Card Clash into:

- Shinobi PvP
- Solo PvE
- Towers
- Pet Showdown
- Pet Warfront

Card phases, response windows, hidden cards, summons, traps, deck legality, and card settlement remain card-specific.

### G. Sector War orchestration

Sector War may use different engines according to the sector’s victory condition:

- Shinobi combat uses the shinobi PvP engine
- Card combat uses the Card Clash engine
- Turn-based pet combat uses the appropriate turn-based pet engine
- Tactical pet combat uses the Tactical engine only where explicitly designed

The different modes may feed a shared server-authoritative territory-control settlement coordinator.

Sharing the final territory settlement does not authorize merging their combat logic.

---

# 2. WHAT MAY AND MAY NOT BE SHARED

## 2.1 Cross-engine infrastructure that may be shared

Distinct engines may share genuinely generic infrastructure such as:

- Authentication
- Authorization
- Request validation
- Safe-name handling
- Rate limiting
- Request IDs
- Structured error responses
- Safe logging
- Sentry and observability
- Save-version compare-and-set helpers
- Distributed locks
- Idempotency tokens
- Durable receipts
- Economy ledger writes
- Outbox delivery
- Retry and ambiguous-write recovery
- Shared visual design tokens
- Shared icons
- Shared animation primitives
- Shared battle-log presentation components
- Shared responsive layout utilities
- Shared accessibility utilities
- Shared stat or tag helpers only where their semantics are actually identical
- Shared test factories
- Shared operational metrics

## 2.2 Gameplay logic that must not be forcibly shared

Do not force distinct engines to share:

- State reducers
- Legal-action models
- Turn sequencing
- Movement rules
- Grid rules
- AI decision logic
- Targeting rules
- Party rules
- Respawn rules
- Bench and switching rules
- Tower boss mechanics
- Warfront map strategy
- Card response windows
- Ranked settlement rules
- Engine-specific battle state
- Engine-specific replay formats
- Engine-specific outcome rules

Code duplication is preferable to an incorrect abstraction when two systems only look similar but have different game semantics.

## 2.3 Same-mode duplication rule

Consolidation is allowed only when two implementations are proven to represent the same exact game mode and same intended ruleset.

Before consolidating anything, produce an equivalence analysis proving that the candidate implementations have the same:

- Player-facing mode identity
- Participants
- Board or field model
- Legal actions
- Turn lifecycle
- Balance contract
- Outcome meaning
- Reward contract
- Progression contract
- Replay contract
- Owner intent

If any of those differ materially, preserve separate engines.

Do not classify systems as duplicates solely because:

- Both use pets
- Both use a grid
- Both use AP
- Both have bosses
- Both have turns
- Both display combat animations
- Both award the same currency
- Both are launched from the same screen
- Both contribute to the same ladder or war

No combat-engine migration is authorized merely by this handoff.

---

# 3. PROGRAM MISSION

Improve ShinobiX from a feature-rich beta into a cohesive, durable, production-quality browser MMO.

Prioritize:

1. Release reliability
2. Prevention of regressions
3. Correct authority boundaries
4. Player save and reward safety
5. Maintainable frontend architecture
6. Real capacity evidence
7. Persistent player economy
8. Meaningful social institutions
9. Consistent AAA UI and interaction quality
10. Operational supportability

Do not add another unrelated major game mode.

ShinobiX already has enough breadth. Improve, connect, verify, and polish what exists.

---

# 4. DEFINITION OF AAA QUALITY

“AAA quality” is not satisfied by attractive screenshots or large feature counts.

For this assignment, AAA quality means:

## 4.1 Gameplay correctness

- The server determines authoritative outcomes.
- Invalid actions are rejected with clear reasons.
- Duplicate requests do not duplicate results.
- Refresh and reconnect do not lose active sessions.
- Rewards cannot be claimed twice.
- Confirmed rewards do not disappear after a dropped response.
- Stale saves cannot overwrite newer saves.
- Different modes use the correct engine.

## 4.2 Player trust

- No silent loss of progress
- No silent loss of items
- No unexplained reward failures
- No UI success before server settlement
- No hidden client/server disagreement
- Clear retry behavior
- Clear resume behavior
- Clear capability-disabled behavior
- Support tools for transaction or battle disputes

## 4.3 UX quality

Every major surface must include:

- Loading state
- Slow-network state
- Empty state
- Success state
- Recoverable error state
- Fatal error boundary
- Retry state
- Disabled-capability state
- Resume-after-refresh state where applicable
- Immediate input feedback
- Clear action hierarchy

## 4.4 Visual quality

- Consistent typography
- Consistent spacing
- Consistent component states
- Deliberate visual hierarchy
- Correct use of the existing ninja/fantasy art direction
- No generic dashboard redesign that erases village or mode identity
- No placeholder art
- No placeholder copy
- No broken or stretched assets
- No inconsistent button or panel behavior

## 4.5 Responsiveness

- No clipping
- No off-screen actions
- No sidebar overlap
- No inaccessible dialogs
- No hidden required scrolling area
- No combat controls becoming unusable
- Stable battle-board scaling
- Usable mobile touch targets
- Support for common zoom and DPR values

## 4.6 Accessibility

- Keyboard access
- Visible focus
- Correct semantic elements
- Accessible names
- Dialog focus trapping and restoration
- No drag-only required action
- Sufficient contrast
- Reduced-motion support
- Useful live announcements for asynchronous result changes
- Screen-reader-safe error and status messages

## 4.7 Performance

- Controlled initial bundle
- Route-based lazy loading
- Bounded memory growth
- No obvious render loops
- No excessive polling
- No unbounded save arrays
- No unbounded server logs
- Measured route latency
- Measured event-loop delay
- Defined build-size budgets

## 4.8 Maintainability

- Clear mode ownership
- Pure domain logic outside React where practical
- Focused hooks
- Focused components
- Typed contracts
- Machine-checked route and runtime mappings
- No giant new monoliths
- Anti-regrowth budgets
- No stale generated documentation

## 4.9 Operations

- Correlation IDs
- Useful error context
- Health checks
- Backup verification
- Restore drills
- Rollback documentation
- Capacity results
- Economy reconciliation
- Battle and transaction receipt lookup

---

# 5. NON-NEGOTIABLE NO-REGRESSION RULES

No implementation can honestly guarantee that a regression is impossible before testing. Therefore:

ANY DETECTED REGRESSION BLOCKS COMPLETION.

Do not mark a phase complete while it contains a known regression.

## 5.1 Never weaken tests

Do not:

- Delete a failing test just to make CI green
- Skip a failing test
- Add `.only`
- Convert failures into warnings
- Lower thresholds to conceal regressions
- Replace exact assertions with vague truthiness assertions
- Blindly update visual snapshots
- Reduce tested browsers without approval
- Remove supported viewport coverage
- Hide test failures behind `continue-on-error`
- Treat a timeout or canceled run as a pass
- Claim success without the final test summary

A test may be removed only when:

1. The behavior is intentionally retired.
2. No live path still depends on it.
3. A stronger replacement test exists.
4. The removal is documented.

## 5.2 Never weaken type or lint safety

Do not:

- Add broad file-level lint suppressions
- Add broad TypeScript suppressions
- Use `@ts-ignore` to bypass architecture problems
- Add unsafe `any` to authority, settlement, auth, or economy code without a documented boundary
- Disable React hook rules broadly
- Move code merely to evade an existing line-budget test

Fix the structure.

## 5.3 Preserve gameplay unless specifically authorized

Do not accidentally change:

- Combat formulas
- AP costs
- Movement costs
- Cooldowns
- Jutsu behavior
- AI behavior
- Pet behavior
- Tower mechanics
- Story outcomes
- Training gains
- Economy rates
- Daily caps
- Drop rates
- Breeding odds
- Rankings
- Rewards
- Tax behavior
- Item ownership
- Existing save fields
- Existing battle history
- Existing replay verdicts

Where an intentional behavior change becomes necessary, measure it, document it, add tests, and separate it from structural refactoring.

## 5.4 Never trust client-authored authority

The client may submit intent only.

The server must remain authoritative for:

- Damage
- Healing
- Resource costs
- Movement legality
- Target legality
- Cooldowns
- Enemy definitions in rewarding encounters
- Battle outcomes
- Rankings
- Rewards
- Currency changes
- Item ownership
- Pet ownership
- Territory ownership
- Story completion
- Mission completion
- Clan and village treasury changes
- Marketplace settlement

Never accept raw client-supplied enemy stats for a rewarding or progression-bearing encounter.

Use a server-owned immutable encounter ID and server-side resolution.

## 5.5 No destructive production operations

Do not:

- Run destructive load tests against production
- Run unreviewed migrations against production
- Reset production data
- change Railway replica count without architecture support
- change secrets
- push directly to main
- deploy incomplete feature branches
- enable half-built production features

Use staging, local isolated storage, or test fixtures.

---

# 6. WORKING PROCEDURE

## 6.1 Branch

Fetch current remote state.

Work from current `origin/main` on a dedicated branch.

Suggested branch:

codex/aaa-cohesion-corrected

Do not work directly on `main`.

Do not force-push shared branches.

## 6.2 Persist this assignment

Create:

CODEX_AAA_HANDOFF.md

Store this full assignment in that file so later Codex sessions and reviewers use the corrected architecture.

Add a warning at the top:

“This file supersedes earlier handoffs that suggested merging intentionally distinct combat engines.”

## 6.3 Read before editing

Read and verify at least:

- CLAUDE.md
- README.md
- RELEASE_CHECKLIST.md
- FEATURE_FLAG_RELEASE_MATRIX.md
- PUBLIC_BETA_LAUNCH_RECOMMENDATION.md
- COMBAT_PARITY_AUDIT.md
- RAILWAY_SETUP.md
- package.json
- shinobij.client/package.json
- server.ts
- railway.json
- .github/workflows/*.yml
- scripts/combat-runtime-inventory.mjs
- scripts/combat-runtime-inventory.test.mjs
- docs/architecture/*
- docs/pet-duel-engine-unification-scope.md
- current storage and save-version documentation
- current rollback documentation
- current economy and ledger documentation
- every applicable AGENTS.md

Do not believe a system works merely because:

- A document says complete
- A comment says authoritative
- A filename exists
- A route is imported
- A README advertises it

Trace the current live flow:

client entry
→ API call
→ Express registration
→ handler
→ authority validation
→ storage mutation
→ settlement
→ response
→ retry behavior
→ history or receipt

## 6.4 Phase commits

Use separate reviewable commits for:

- Baseline repair
- CI
- Runtime registry
- Capability integration
- Frontend extraction
- Shared mutation infrastructure
- Database migrations
- Marketplace
- Activity events
- UI polish
- Final certification

Do not combine an engine-boundary change, database migration, major React refactor, and economy change in one commit.

Where GitHub access permits, create separate stacked draft pull requests per major phase.

Otherwise, keep one branch with clearly separated commits.

## 6.5 Continue through the program

Continue through all phases in order.

Do not begin a later phase while an earlier phase is red.

If tool or context limits force a stop:

- Stop only at a clean phase boundary
- Leave tests green
- Leave no partially enabled feature
- Commit completed work
- Leave the working tree clean
- Update `docs/aaa-program-status.md`
- Record exact remaining steps and commands
- Do not call the entire program complete

---

# 7. PHASE 0 — VERIFIED BASELINE AND ARCHITECTURE TRUTH

Before modifying behavior, establish the verified baseline.

## 7.1 Record environment

Create:

docs/aaa-program-baseline.md

Record:

- Current `origin/main` SHA
- Working branch
- Node version
- npm version
- Operating system
- Date
- Current Railway topology from code/config
- Current storage mode
- Current branch-protection state if accessible
- Current CI structure
- Existing known red checks

## 7.2 Create verified mode-authority report

Create:

docs/architecture/verified-mode-authority.md

For every combat mode, record:

- Mode name
- Player-facing entry
- Intended engine
- Actual current start route
- Actual action route
- Actual state route
- Actual settlement route
- Participant model
- Reward policy
- Replay/history format
- Client caller
- Server handler
- Whether current code matches owner intent
- Whether documentation is stale

At minimum include:

- Casual shinobi PvP
- Ranked shinobi PvP
- Player challenges
- Generic AI
- World-context AI
- Missions
- Story
- Academy
- Dungeon Warden
- Weekly Boss
- Endless
- Hollow Gate shinobi
- Battle Towers
- Endless Spire
- Clan Boss
- Tower PvP
- Sector War shinobi combat
- Sector War card combat
- Sector War pet combat
- Pet Showdown/Coliseum
- Pet ranked
- Pet Ladder Showdown rows
- Pet Warfront
- Tactical Arena
- Pet Ladder Warfront rows
- Hollow Gate pet encounters
- Dungeon pet encounters
- Card Clash

Do not change an engine assignment merely because the current inventory is stale.

Owner-authoritative boundaries win.

## 7.3 Run baseline commands

Run exact locked installs:

npm ci
npm ci --prefix shinobij.client

Run:

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
npm run build
npm run certify:release
npm run soak:smoke
npm --prefix shinobij.client run lint
npm --prefix shinobij.client run build

Install Playwright browsers where required:

cd shinobij.client
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e
npm run test:e2e:combat-layout
cd ..

Also run applicable existing:

- Hollow Gate reconnect soak
- Clan Boss operation certification
- Clan Boss balance audit
- Story certifications
- Visual regression suite
- Warfront tests
- Pet Showdown tests
- Tower tests
- PvP tests
- Economy tests
- Backup/restore tests

Record:

- Exact command
- Pass/fail
- Test count
- Duration
- Artifact path
- Any canceled or missing tests
- Root build size
- Client build size
- Major route chunk sizes
- Load-smoke results

## 7.4 Existing failures

If baseline failures already exist:

- Separate them from new work
- Identify root cause
- Repair release-blocking failures in a dedicated commit
- Re-run affected and full gates
- Do not weaken the gate
- Do not begin Phase 1 while the baseline remains falsely green or incompletely tested

---

# 8. PHASE 1 — MAKE CI RELIABLE AND TRUSTWORTHY

The current CI performs too much serial work in one job. Split it without dropping any existing check.

Create stable required jobs such as:

- server-contracts
- server-build-security
- client-quality
- release-certification
- concurrency-smoke
- e2e-responsive
- e2e-combat

Names may vary, but they must remain stable for branch protection.

## 8.1 server-contracts

Include:

- Root tests
- Route parity
- Combat runtime inventory
- Deployment topology contract
- Rollback compatibility contract
- Mission eligibility
- Release asset checks
- Tooling handoff drift
- Data-integrity checks that do not require production access

## 8.2 server-build-security

Include:

- Exact root dependency install
- Server build
- Dist verification
- Root audit
- Backup and restore tests
- Ledger audit
- Relevant migration checks

## 8.3 client-quality

Include:

- Exact client dependency install
- TypeScript build
- Client lint
- Production client build
- Story-content check
- Build-size gate
- Visual-baseline size gate
- Relevant static accessibility checks

## 8.4 release-certification

Build once and certify the same compiled server artifact.

Preserve the existing fresh-account journey including:

- Registration
- Initial save
- Currency-forgery rejection
- Progression-forgery sanitization
- Reward settlement
- Refresh
- Relog
- Retry
- Stale autosave handling
- Academy spar
- Two-account PvP
- Reconnect
- Move idempotency
- Battle completion
- Settlement
- History

Do not certify a different build than the artifact that would deploy.

## 8.5 concurrency-smoke

Preserve the current quick real-server smoke.

This does not replace database-backed staging capacity testing.

## 8.6 e2e-responsive

Use browser matrices or sharding for:

- Chromium
- Firefox
- WebKit

Preserve responsive and accessibility coverage.

## 8.7 e2e-combat

Keep combat layout and jutsu-arming tests separate.

Retain:

- Screenshots
- Videos where useful
- Traces
- Layout evidence
- Failure artifacts

## 8.8 Artifact reuse

Where practical:

- Build once
- Upload compiled server/client artifact
- Reuse it downstream
- Do not rebuild subtly different artifacts in each certification job

## 8.9 CI completion criteria

- No ordinary job exceeds 30 minutes without a documented reason
- No required run times out
- A missing final test summary fails
- A canceled test fails
- Zero-test discovery fails
- All existing checks remain represented
- GitHub check names are documented
- Local commands match CI commands
- Test artifacts are retained on failure

## 8.10 Branch protection

If permissions allow, protect `main` with:

- Pull requests required
- Required status checks
- Branch must be up to date
- Force pushes disabled
- Branch deletion disabled
- Emergency admin bypass only
- Code-owner review for auth, storage, economy, combat settlement, and migrations where practical

If permissions do not allow Codex to configure it, create:

docs/required-branch-protection.md

Include exact required check names and settings.

Do not claim branch protection is applied unless it is actually applied.

---

# 9. PHASE 2 — CREATE A MODE-AUTHORITY AND FEATURE-CAPABILITY REGISTRY

This is a registry of multiple intentional engines.

It is not an engine-unification registry.

Extend or replace stale machine-readable inventories with one verified shared contract.

Suggested structure:

shared/runtime-mode-registry.ts

Each mode should declare:

type RuntimeMode = {
  id: string;
  label: string;
  category:
    | "shinobi-pvp"
    | "solo-pve"
    | "tower"
    | "pet-showdown"
    | "pet-tactical"
    | "card"
    | "non-combat";
  authorityEngine: string;
  clientEntries: readonly string[];
  startRoutes: readonly string[];
  actionRoutes: readonly string[];
  stateRoutes: readonly string[];
  settlementRoutes: readonly string[];
  participantModel:
    | "solo"
    | "two-player"
    | "party"
    | "headless"
    | "asynchronous-defense";
  rewardPolicy:
    | "none"
    | "server-settled"
    | "server-capped"
    | "parent-mode-settlement";
  replayKind?: string;
  capabilityKey?: string;
  killSwitch?: string;
  intentionallySeparateFrom?: readonly string[];
};

## 9.1 Required engine declarations

The registry must explicitly identify:

- Shinobi PvP
- Solo PvE
- Tower
- Pet Showdown/Coliseum
- Pet Warfront/Tactical
- Card Clash

The registry must not alias those six categories to one shared gameplay runtime.

## 9.2 Tests

Add tests proving:

- Every player-facing combat route is registered in Express
- Every listed start route has a real client caller
- Every action and state route matches the intended engine
- Every reward-bearing mode has one identified settlement route
- Every mode declares a reward policy
- Every mode declares a participant model
- Pet Showdown and Pet Tactical have different authority engines
- Solo PvE and Tower have different authority engines
- PvP and Solo PvE have different authority engines
- Card Clash remains separate
- Hollow Gate shinobi points to Solo PvE
- Battle Towers and Clan Boss point to Tower
- Sector War invokes the correct engine for each victory condition
- No disabled capability remains recommended by Activity Spine
- No client route calls an unmounted API
- No mounted player-facing API is unintentionally unreachable

## 9.3 Capability integration

ShinobiX already has a public capability system.

Extend it. Do not create a competing availability system.

Use the capability result to control:

- Navigation visibility
- Disabled states
- Activity Spine recommendations
- Player-facing unavailable messages
- Feature entry buttons
- Relevant polling
- Admin operational state

A disabled feature must not:

- Remain fully clickable and return an unexpected 404
- Remain recommended
- Continue background polling
- Pretend to be available

## 9.4 Documentation generation

Generate or validate:

- Combat runtime inventory
- Feature matrix
- Capability documentation
- Route coverage report
- Engine ownership report

Do not allow manually maintained docs to contradict executable registry data.

---

# 10. PHASE 3 — ENGINE-BOUNDARY HARDENING, NOT ENGINE MERGING

Audit boundaries and remove accidental duplicate authority only where proven safe.

## 10.1 Pet boundaries

Explicitly preserve:

- Showdown/Coliseum as turn-based pet combat
- Warfront/Tactical as positional pet combat
- Separate state shapes
- Separate AI
- Separate replays
- Separate movement and map rules
- Separate balance
- Separate test suites

Do not remove:

- Warfront board code
- Tactical map logic
- Walk masks
- Warfront AI
- Warfront strategy
- Warfront replays
- Warfront parity tests
- Tactical 3D presentation
- Warfront simulator mirror where still required

Pet Ladder may include both modes with separate replay kinds.

Do not force one replay format across both.

## 10.2 Current pet Coliseum documentation

The repository may contain old scope text followed by newer completion status.

Rewrite that documentation to clearly separate:

- Same-mode Coliseum implementation retirement
- Intentionally separate Warfront/Tactical mode
- Current verified live routes
- Current remaining legacy code
- Current replay compatibility

Do not automatically port Dungeon Pet Battle or live Pet Arena PvP merely because the documentation once proposed it.

First establish:

- What player-facing mode it belongs to
- Which engine the owner intends
- Whether rewards are involved
- Whether a server-owned encounter identity exists
- Whether current code is actually live

Any authored pet encounter that carries progression or reward authority must use:

- A server-owned encounter ID
- Server-resolved enemy definition
- Server-resolved outcome
- Server-owned context proof

Never accept raw enemy stats from the client.

## 10.3 Solo PvE and Tower boundaries

Add tests locking these owner decisions:

- Hollow Gate shinobi → Solo PvE
- Missions → Solo PvE
- Story → Solo PvE
- World AI → Solo PvE
- Battle Towers → Tower
- Endless Spire → Tower
- Clan Boss → Tower
- Tower PvP → Tower

Do not move one mode merely because another engine has a more impressive UI.

Shared presentation components are permitted only if no engine-specific behavior leaks.

## 10.4 PvP and Solo PvE boundaries

Keep:

- PvP authorization
- Ranked admission
- Human turn timing
- Spectator projection
- Rating
- PvP settlement

inside the PvP domain.

Keep:

- Server-authored AI
- Mission context
- Story context
- World context
- Solo PvE settlement

inside Solo PvE.

Shared formulas are permitted only when identical semantics are proven through tests.

## 10.5 Sector War

Permit a shared territory-control coordinator that accepts validated mode-specific receipts.

Do not let the common coordinator:

- Recalculate combat
- Trust a client winner
- Interpret card state
- Interpret pet commands
- Interpret shinobi combat state

It should accept only an authoritative result from the mode’s engine.

## 10.6 Dead-code removal

Remove code only when all are proven:

- No live importer
- No runtime registration
- No client caller
- No active-session compatibility dependency
- No replay-history dependency
- No migration dependency
- No rollback dependency

Add a test that prevents retired authority code from becoming reachable again.

---

# 11. PHASE 4 — FRONTEND DECOMPOSITION WITHOUT BEHAVIORAL OR VISUAL REGRESSION

Current large screens must be decomposed incrementally.

Priority order:

1. Arena.tsx
2. WorldMap.tsx
3. AdminPanel.tsx
4. PetArena.tsx
5. PvpBattleScreen.tsx
6. BattleTowerFight.tsx

Do one screen at a time.

Do not combine all six refactors into one commit.

## 11.1 First pass: structural extraction only

During the first pass for each screen:

- Preserve behavior
- Preserve visual output
- Preserve DOM ordering where practical
- Preserve classes
- Preserve test IDs
- Preserve keyboard behavior
- Preserve network timing
- Preserve engine ownership
- Preserve settlement timing

Extract:

- Pure domain decisions
- View-model construction
- Network adapters
- Timers
- Socket lifecycle
- Resume logic
- Input state
- Presentational components

Suggested pattern:

features/<feature>/
  domain/
  hooks/
  api/
  components/
  types/
  tests/

## 11.2 Do not create replacement monoliths

Do not move a 5,000-line block into a new 5,000-line file.

Targets:

- Ordinary screen module: ideally below 2,000–2,500 lines
- Presentational component: generally below 500 lines
- Domain module: generally below 800 lines
- Generated data may be larger

Use judgment. Do not fragment code into meaningless one-function files merely to hit a number.

## 11.3 Domain logic outside React

Move into pure modules where practical:

- Legal UI transitions
- Selection state
- Targeting view models
- Display formatting
- Derived statuses
- Resume decisions
- Screen-to-mode routing
- Non-render combat presentation state

Do not move authoritative combat resolution into the client.

## 11.4 Hooks

Use focused hooks for:

- Session loading
- Session resume
- Timers
- Sockets
- Input
- Polling
- Mutation state
- Error recovery

Avoid one giant `useGameEverything` hook.

## 11.5 Anti-regrowth

Add line-budget or complexity ratchets for each successfully decomposed screen.

Do not raise budgets to fit new features.

## 11.6 Refactor verification

After each screen:

- Run its focused tests
- Run full root tests
- Run client lint
- Run client build
- Run relevant Playwright tests
- Compare screenshots
- Test refresh
- Test loading
- Test error state
- Test mobile
- Test keyboard
- Test the relevant engine separately

No design changes in the same commit as the initial extraction unless necessary to repair a verified bug.

---

# 12. PHASE 5 — SHARED RELIABILITY INFRASTRUCTURE

Improve generic settlement and save-safety infrastructure without merging gameplay engines.

## 12.1 Audit existing patterns

Inspect current implementations of:

- Save-version compare-and-set
- KV locks
- Training tokens
- PvP move idempotency
- PvP reward settlement
- Hollow Gate receipts
- Pet Showdown receipts
- Mission rewards
- Clan and village treasuries
- Shop purchase/sell
- Bank transfer and interest
- Crafting
- Pet breeding/hatching
- Economy ledger

Identify identical reliability mechanics that can safely share helpers.

Do not rewrite stable domain rules merely to make them fit an abstraction.

## 12.2 Authoritative mutation coordinator

Create generic helpers capable of supporting:

- Stable operation IDs
- Deterministic lock ordering
- Fail-closed critical locks
- Save-version compare-and-set
- Bounded retries
- Exact readback after ambiguous acknowledgement
- Durable receipts
- Outbox publication
- Repair records
- Structured audit records
- Request correlation

Conceptual API:

await authoritativeMutation({
  operationId,
  actor,
  lockKeys,
  loadState,
  authorize,
  validate,
  applyDomainMutation,
  persist,
  recoverAmbiguousCommit,
  writeReceipt,
  publishOutbox,
  audit
});

The domain mutation remains engine or feature specific.

## 12.3 Do not force all current handlers into it at once

Adopt incrementally.

Recommended order:

1. New marketplace settlement
2. Treasury transfers
3. High-value crafting
4. Shop and bank operations
5. Pet breeding/hatching
6. Other economy mutations
7. Existing battle rewards only where parity can be proven

Do not destabilize currently proven PvP or Hollow Gate settlement merely for code uniformity.

## 12.4 Fault injection

Add deterministic tests for:

- Duplicate request
- Reordered duplicate request
- CAS conflict
- Lock contention
- Lock expiry
- Write succeeds but acknowledgement fails
- Receipt write fails after value write
- Outbox write fails
- Process interruption between steps
- Stale predecessor
- Multi-owner partial failure
- Retried settlement after dropped HTTP response

Prove:

- No duplicate reward
- No duplicate item
- No negative balance
- No silently lost confirmed result
- Retry returns the authoritative terminal state
- Admin repair tooling can identify unresolved operations

---

# 13. PHASE 6 — REAL CAPACITY AND OPERATIONS CERTIFICATION

ShinobiX is currently designed around a single server instance.

Do not change replica count merely to claim scalability.

## 13.1 Staging only

Use a staging Railway service with:

- Same container class
- Same Node version
- Same server build
- Same PostgreSQL adapter
- Same Supabase region where possible
- Isolated synthetic accounts
- Isolated staging data

Do not run destructive load against production.

## 13.2 Capacity stages

Run:

- 100 concurrent players for at least 30 minutes
- 200 concurrent players for at least 30 minutes
- 300 concurrent players for at least 30 minutes

Run both:

- Distributed sectors
- Worst-case crowded hub/sector

Use realistic traffic:

- Authentication
- Token refresh
- Save reads
- Autosaves
- Heartbeats
- Travel
- Presence
- Chat
- Clan polling
- Leaderboards
- Activity Spine
- Training
- Missions
- Solo PvE
- PvP session reads
- PvP moves
- Settlement
- Shop/bank
- Marketplace once available

## 13.3 Metrics

Record:

- Request count
- Status distribution
- p50 latency
- p95 latency
- p99 latency
- 5xx rate
- Expected 409 rate
- Expected 429 rate
- Lock contention
- Save conflicts
- Database pool usage
- Database query latency
- Event-loop delay
- CPU
- Memory
- Garbage collection pressure
- Socket reconnects
- Presence drift
- Duplicate settlement count
- Missing settlement count
- Unreadable saves
- Process restarts

## 13.4 Minimum 100-player acceptance

Unless the measured baseline already supports stricter limits:

- Zero corrupted saves
- Zero duplicate rewards
- Zero lost confirmed rewards
- Zero authority mismatches
- 5xx below 0.1%
- Ordinary-read/heartbeat p95 below 500 ms
- Save/combat-mutation p95 below 1.5 seconds
- No sustained unbounded memory growth
- No sustained event-loop stall above 100 ms

Report expected 409 and 429 responses separately from failures.

## 13.5 Horizontal scaling rule

Do not deploy multiple replicas until all exist:

- Shared presence
- Shared Socket.IO adapter
- Distributed matchmaking ownership
- Distributed cron leadership
- Cross-instance locks
- Cross-instance exact-once settlement
- Reconnect tests across instance replacement

Until then, keep one replica and document:

- Certified capacity
- Safe operating limit
- Alert threshold
- Upgrade threshold
- Required Railway resources

## 13.6 Reports

Create:

docs/aaa-program-capacity-report.md
docs/aaa-program-operations-runbook.md

If staging credentials are unavailable:

- Complete the harness and workflow
- Provide exact commands
- Provide safety checks
- Mark the external run blocked
- Do not invent results
- Do not call capacity certification complete

Continue independent phases that do not depend on those results.

---

# 14. PHASE 7 — PERSISTENT PLAYER ECONOMY AND MARKETPLACE

First audit current code.

Do not assume the marketplace is missing because one earlier review failed to locate it.

Search for:

- Grand Marketplace
- Marketplace
- Auction
- Listings
- Bids
- Escrow
- Player trade
- Shop
- Bank
- Crafting
- Economy ledger
- Item tradability

Map current client and server behavior.

## 14.1 Do not duplicate existing systems

If a real persistent marketplace already exists:

- Improve it in place
- Preserve current items and listings
- Preserve compatible routes
- Add missing authority, escrow, search, history, or audit behavior

If only direct trade or local UI exists:

- Implement a persistent asynchronous marketplace

## 14.2 Hybrid data model

Do not rewrite temporary battle/session KV storage.

Continue using KV-style records for:

- Active battles
- Matchmaking
- Locks
- Temporary tokens
- Short-lived sessions
- Presence leases

Use normalized PostgreSQL tables for query-heavy durable marketplace data.

Suggested tables:

- economy_transactions
- economy_operation_receipts
- market_listings
- market_bids
- market_escrows
- market_settlements
- market_price_history

Use:

- Constraints
- Indexes
- Idempotent migrations
- Expand-contract rollout
- Staging verification
- Recovery documentation

## 14.3 Listing authority

On listing:

1. Authenticate seller.
2. Validate item ownership.
3. Validate quantity.
4. Validate tradability.
5. Reject equipped, bound, quest-locked, busy, or otherwise unavailable assets.
6. Remove exact quantity under authoritative locking.
7. Place asset in escrow.
8. Create listing.
9. Write receipt and ledger entry.

## 14.4 Bid and buyout authority

On bid:

- Reserve funds
- Prevent double spending
- Safely release prior highest bid
- Record bid
- Handle retry idempotently

On buyout:

- Lock listing, buyer, seller, and escrow in deterministic order
- Verify active listing
- Verify sufficient unreserved funds
- Transfer funds
- Apply tax
- Transfer item
- Close listing
- Write settlement receipt
- Write ledger entries
- Publish activity event

## 14.5 Race tests

Prove a listing cannot be:

- Bought twice
- Bought and canceled
- Bought and expired
- Returned after sale
- Settled without escrow
- Sold without payment
- Paid without item delivery

## 14.6 Tradability scope

Do not make pets tradable unless current owner design already allows it.

Do not broaden tradability for:

- Bound items
- Quest items
- Equipped items
- Subscription entitlements
- Legacy rewards
- Admin-only items

Respect current game rules.

## 14.7 Marketplace UI

Provide:

- Search
- Pagination
- Sorting
- Filters
- Listing form
- Fee preview
- Expected proceeds
- Buy confirmation
- Bid confirmation
- History
- Sold state
- Expired state
- Stale-listing message
- Insufficient-funds message
- Retry-safe confirmation
- Mobile filters
- Keyboard access
- Loading and empty states

Never display ownership transfer before server settlement succeeds.

---

# 15. PHASE 8 — UNIVERSAL ACTIVITY EVENTS AND ACTIVITY SPINE

ShinobiX already has Activity Spine.

Extend it. Do not build a competing recommendation system.

## 15.1 Durable activity events

Create a versioned authoritative event contract for significant actions.

Examples:

- BattleSettled
- MissionCompleted
- StoryDecisionRecorded
- TerritoryChanged
- ItemCrafted
- ItemTraded
- PetBefriended
- PetHatched
- PetBattleSettled
- ClanContributionRecorded
- VillageContributionRecorded
- TrainingCompleted
- ProfessionProgressRecorded

Each event needs:

- eventId
- operationId
- player
- eventType
- schemaVersion
- occurredAt
- authoritative source
- payload

## 15.2 Idempotent consumers

Consumers may update:

- Achievements
- Daily missions
- Weekly missions
- Profession mastery
- Clan contribution
- Village contribution
- Legacy eligibility
- Seasonal records
- Activity history
- Analytics
- Public feed where allowed

Duplicate events must not duplicate progress.

Out-of-order events must not create impossible state.

## 15.3 Shadow migration

Do not replace every direct counter update at once.

Use:

1. Existing update remains authoritative.
2. Emit shadow event.
3. Consumer calculates expected result.
4. Compare direct and event-derived result.
5. Report mismatch.
6. Repair semantic differences.
7. Cut over only after sustained parity.
8. Remove old update later.

## 15.4 Activity Spine

Activity Spine must use:

- Server capability state
- Authoritative progress
- Active resumable sessions
- Explicit blockers
- Player-selected focus
- Current rank and level
- Relevant weekly activity
- Current limits and caps

It must never:

- Recommend disabled content
- Recommend a completed one-time task as incomplete
- Hide an active battle or run that needs resuming
- Suggest a capped activity without explaining the cap
- Read only stale client-local progress
- Overwhelm the player with a wall of competing recommendations

Show:

- One primary action
- A limited number of secondary actions
- Clear reason
- Clear blocker
- Clear long-term progression

---

# 16. PHASE 9 — PERSISTENT COMMUNITY SYSTEMS

Do not duplicate:

- Friends
- Blocking
- Messages
- Clan chat
- Village chat
- Moderation
- Reporting

Build on those systems.

Priority:

1. Clan recruitment board
2. Village bulletin board
3. Player activity feed
4. Shareable battle reports
5. War, tournament, and season recaps
6. Mentor request board
7. Clan event scheduling
8. Marketplace watchlist

## 16.1 Moderation

Every public content surface needs:

- Authentication
- Author identity
- Timestamp
- Length bounds
- Sanitization
- Rate limiting
- Report
- Moderator removal
- Block filtering
- Audit trail
- Edit/delete policy

Do not expose:

- IP addresses
- Hidden inventory
- Private battle information
- Moderation internals
- Admin notes
- Authentication data

## 16.2 Activity feed authority

Feed entries must come from authoritative activity events.

Do not accept client-submitted claims such as:

“I won a ranked match”
“I captured a sector”
“I crafted a Mythic item”

The server event is the proof.

Support privacy controls where appropriate.

---

# 17. PHASE 10 — AAA UI/UX AND PERFORMANCE PASS

Perform presentation changes only after structural and authority work is stable.

## 17.1 Preserve the game’s identity

Do not turn ShinobiX into a generic SaaS dashboard.

Preserve:

- Ninja/fantasy atmosphere
- Village-specific identity
- Existing high-quality artwork
- Distinct mode identity
- Combat readability
- Existing owner-approved layouts where working

Improve consistency without flattening personality.

## 17.2 Required interaction states

Every major screen must have:

- Loading
- Slow loading
- Empty
- No results
- Disabled capability
- Recoverable error
- Fatal error boundary
- Retry
- Success
- Pending authoritative mutation
- Resume after refresh

## 17.3 Responsive test matrix

Test at least:

- 320×568
- 360×800
- 390×844
- 768×1024
- 1024×768
- 1366×768
- 1440×900
- 1920×1080

Also test:

- 80% zoom
- 100% zoom
- 125% zoom
- 150% zoom
- DPR 1
- DPR 1.25
- DPR 1.5
- DPR 2

## 17.4 Combat-specific UI

For each combat engine separately verify:

- Board fits
- Required controls remain visible
- Selection is obvious
- Cancel is obvious
- Target state is obvious
- Current actor is obvious
- AP/resources are readable
- Cooldowns are readable
- Status effects are readable
- Log is accessible
- End-turn behavior is clear
- Error rejection explains why
- Animations do not block required input
- Refresh resumes correctly

Do not assume a layout that works for Solo PvE also works for:

- PvP
- Tower
- Showdown
- Tactical Arena
- Card Clash

Each has its own layout contract.

## 17.5 Accessibility

Run automated accessibility checks and manual keyboard checks.

Verify:

- All controls have accessible names
- Focus order is logical
- Focus is visible
- Dialog focus is trapped
- Focus returns after dialog close
- Escape works where expected
- No color-only information
- Reduced motion works
- Critical status changes are announced
- Drag interfaces have keyboard alternatives

## 17.6 Performance budgets

Record before and after:

- Initial compressed JS
- Initial CSS
- Route chunks
- Image payload
- First usable screen
- World Map load
- Arena load
- Pet Showdown load
- Tactical Arena load
- Card Clash load
- Admin load
- Memory after repeated navigation
- Long-session memory
- Input latency
- Render count for hot components

Fail CI on unjustified material regressions.

Use lazy loading and preload only likely next screens.

Do not preload the whole game.

---

# 18. FULL REGRESSION MATRIX

Before final completion, test every intentional engine separately.

## 18.1 Account and save

Test:

- Register
- Login
- Token refresh
- Logout
- Relog
- Account deletion
- Initial save
- Autosave
- Immediate save
- Stale save
- Concurrent save
- Save conflict recovery
- Dropped response
- Backup
- Restore

## 18.2 Training and progression

Test:

- Start training
- Time gate
- Stamina cost
- Completion
- Duplicate completion
- Jutsu training
- Jutsu queue
- Exams
- Hunter rank
- Profession selection
- Profession progress
- Legacy capability and progression
- Story progression
- Story choice persistence

## 18.3 Shinobi PvP engine

Test:

- Casual
- Challenge
- Ranked
- Sector War shinobi
- Legal move
- Invalid move
- Duplicate move token
- Reconnect
- Refresh
- AFK
- Timeout
- Forfeit
- Win
- Loss
- Draw where supported
- Settlement
- Duplicate claim
- Rating
- History
- Spectating

## 18.4 Solo PvE engine

Test:

- Academy
- E/D mission
- C/B/A/S mission
- World ambush
- Wanderer
- Hunt
- Dungeon Warden
- Story boss
- Weekly Boss
- Endless ordinary Solo-PvE path where applicable
- Hollow Gate shinobi
- Invalid action
- Refresh
- Resume
- Settlement
- Duplicate report

## 18.5 Tower engine

Test:

- Battle Tower
- Party join
- Party leave
- Tower action
- Tower state
- Tower resume
- Endless Spire
- Clan Boss
- Tower PvP
- Special boss mechanics
- Multi-actor behavior
- Settlement
- Duplicate settlement

## 18.6 Pet Showdown/Coliseum

Test:

- Practice
- Paid arena entry
- Ranked where designed
- Showdown Ladder rows
- Bench
- Switch
- Rest
- Guard
- Move
- Signature/super
- Weather
- Timeout if live PvP uses it
- Reconnect
- Replay
- Reward cap
- Duplicate turn
- Duplicate settlement

## 18.7 Pet Warfront/Tactical

Test independently:

- Movement
- Pathfinding
- Walk mask
- Roles
- AI
- Objectives
- Respawn
- Team coordination
- 4v4 where supported
- Map mechanics
- Warfront replay
- Tactical Ladder rows
- Settlement

Do not use Showdown tests as proof that Tactical works.

## 18.8 Card Clash

Test:

- Legal deck
- Invalid deck
- Draw
- Summon
- Tribute
- Set
- Flip
- Attack
- Magic
- Trap
- Response window
- Turn timeout
- AI match
- Player match
- Refresh
- Resume
- Hidden information
- Settlement
- Duplicate action

## 18.9 Clans and villages

Test:

- Create/join clan
- Leave
- Kick
- Mentor
- Treasury donation
- Treasury transfer
- Upgrade
- Mission claim
- Clan chat
- Clan War
- Clan Boss
- Village Kage
- Elder
- Village treasury
- Village upgrade
- Tax
- War resources
- Sector declaration
- Sector result
- Territory capture
- War crate

## 18.10 Economy and marketplace

Test:

- Shop purchase
- Shop sell
- Bank deposit/transfer
- Interest
- Craft
- Forge
- Direct trade
- Marketplace listing
- Bid
- Buyout
- Cancel
- Expire
- Tax
- Escrow
- Race conditions
- Duplicate operation
- Ledger reconciliation
- Negative balance rejection

## 18.11 UI

Test:

- Mobile
- Tablet
- Desktop
- Zoom
- Keyboard
- Screen reader semantics
- Reduced motion
- Loading
- Empty
- Error
- Retry
- Disabled capability
- Refresh/resume

## 18.12 Operations

Test:

- `/health`
- Deep DB health
- Storage RPCs
- Backup marker
- Graceful shutdown
- Restart authorization
- Request ID
- Error sanitization
- Economy reconciliation
- Battle receipt lookup
- Rollback compatibility

---

# 19. FINAL COMMAND GATE

Run all applicable commands at final state:

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
npm run build
npm run certify:release
npm run soak:smoke
npm run test:hollow-gate-soak
npm run certify:clan-boss-operation
npm run audit:clan-boss-balance
npm --prefix shinobij.client run lint
npm --prefix shinobij.client run build
npm --prefix shinobij.client run test:e2e
npm --prefix shinobij.client run test:e2e:combat-layout

Also run every new:

- Runtime registry test
- Engine boundary test
- Marketplace test
- Activity event test
- Fault-injection test
- Visual test
- Accessibility test
- Capacity test available in the environment

Run:

git diff --check
git status --short

The working tree must be clean except for intentionally uncommitted artifacts that are explicitly documented.

---

# 20. DATABASE MIGRATION RULES

For all new durable schema:

Use expand-contract.

1. Add new schema.
2. Deploy code capable of old and new reads.
3. Shadow-write.
4. Backfill.
5. Verify counts and invariants.
6. Switch reads.
7. Monitor.
8. Remove old path only later.

Every migration needs:

- Forward SQL
- Idempotency or migration-table protection
- Indexes
- Constraints
- Staging result
- Rollback or repair procedure
- Backup requirement
- Data validation query
- Compatibility statement

Do not apply production migrations without explicit production authorization.

---

# 21. RELEASE AND ROLLBACK

Create:

docs/aaa-program-rollback.md

Prove:

- Previous server build can read current saves where promised
- New schema may remain present during rollback
- Completed transactions remain valid
- Active sessions either remain compatible or fail with a clear recovery path
- Feature capabilities hide incompatible rolled-back features
- Backup restore works
- No rollback duplicates rewards
- No rollback reopens settled marketplace listings

Do not call a rollout reversible merely because Git can revert source code.

---

# 22. FINAL DELIVERABLES

Create and maintain:

- CODEX_AAA_HANDOFF.md
- docs/aaa-program-baseline.md
- docs/architecture/verified-mode-authority.md
- docs/aaa-program-status.md
- docs/aaa-program-implementation-report.md
- docs/aaa-program-regression-report.md
- docs/aaa-program-capacity-report.md
- docs/aaa-program-operations-runbook.md
- docs/aaa-program-rollback.md
- docs/required-branch-protection.md

## 22.1 Implementation report

Include:

- Starting SHA
- Final SHA
- Branch
- Commits
- Pull requests
- Exact files changed
- Routes added
- Routes retired
- Schema added
- Legacy code removed
- Capabilities changed
- Mode-authority changes

## 22.2 Verification report

For every command include:

- Command
- Duration
- Pass/fail
- Test count
- Artifact
- Failure reason where relevant

Never describe a canceled or timed-out run as passed.

## 22.3 Engine report

For each engine include:

- Modes
- Routes
- Settlement
- Test evidence
- Known risks

Explicitly prove that no prohibited engine merger occurred.

## 22.4 Performance report

Include:

- Before and after bundle sizes
- Before and after route chunks
- Before and after latency
- Memory results
- Capacity results
- Known operating limits

## 22.5 Regression report

State results for:

- Authentication
- Saves
- Training
- PvP
- Solo PvE
- Towers
- Hollow Gate
- Pet Showdown
- Pet Tactical
- Card Clash
- Story
- Clans
- Village War
- Economy
- Marketplace
- Mobile
- Accessibility
- Admin
- Backup
- Rollback

## 22.6 Remaining issues

Separate:

- Confirmed defect
- Possible risk
- External permission block
- Production validation still required
- Future enhancement

Do not use “AAA complete” unless every required item has objective evidence.

---

# 23. EXECUTION ORDER

Execute in this order:

1. Fetch current main and record SHA
2. Save this corrected handoff in the repository
3. Build verified mode-authority map
4. Run clean baseline
5. Repair existing release blockers
6. Split CI
7. Configure or document branch protection
8. Build multi-engine runtime registry
9. Align capabilities, navigation, and Activity Spine
10. Add engine-boundary tests
11. Correct stale engine documentation
12. Remove only proven dead same-mode authority code
13. Decompose Arena
14. Decompose World Map
15. Decompose Admin Panel
16. Decompose Pet Arena
17. Decompose PvP Battle Screen
18. Decompose Tower Battle screen
19. Build shared reliability infrastructure
20. Add fault-injection coverage
21. Run staging capacity certification
22. Audit existing economy and marketplace
23. Implement or harden persistent marketplace
24. Add durable activity events in shadow mode
25. Connect Activity Spine to authoritative event/capability truth
26. Add persistent community surfaces
27. Perform AAA UI/UX pass
28. Run complete regression matrix
29. Run rollback drill
30. Produce final reports and draft PRs

---

# 24. PROHIBITED SCOPE

Do not:

- Merge PvP and Solo PvE
- Merge Solo PvE and Towers
- Move Hollow Gate shinobi combat to Towers
- Move normal missions or story to Towers
- Merge Pet Showdown and Warfront/Tactical
- Remove Tactical map or AI systems
- Merge Card Clash with another combat engine
- Change combat balance during structural refactoring
- Add a new major game mode
- Add a new currency
- Rewrite all storage
- Reintroduce retired character XP
- Duplicate existing friends, messages, or chat
- Copy TheNinjaRPG code
- Make decisions because another repository claims it is better
- Treat file existence as proof of live functionality
- Claim production scalability from in-memory local results
- Deploy a partially implemented phase

---

# 25. FIRST RESPONSE REQUIRED FROM CODEX

Before editing, report:

1. Current `origin/main` SHA
2. Current branch
3. Whether the working tree is clean
4. Current verified engine map
5. Any contradiction between current code, current docs, and owner-authoritative boundaries
6. Baseline commands that will be run
7. Existing red checks
8. Planned first phase and exact files likely involved

Then begin implementation.

Do not wait for another approval unless a safety-sensitive external production action is required.

---

# 26. FINAL STANDARD

The goal is not the largest diff.

The goal is to leave ShinobiX:

- More reliable
- More cohesive
- Easier to maintain
- Easier to operate
- Harder to exploit
- Better under real concurrency
- More socially persistent
- More economically meaningful
- More polished
- Fully regression-certified

Preserve distinct game modes and their correct engines.

Share infrastructure where semantics are truly shared.

Never merge gameplay systems merely because they both contain combat.

A phase is complete only when its code, tests, responsive behavior, accessibility, performance, observability, data safety, and rollback behavior are proven.
