# ShinobiX tooling implementation report

- Date: 2026-08-05
- Audit baseline: `4d533bb61cb4c7c1b843f441dfef3f0da539deae`
- Implementation branch: `codex/tooling-observability-gap-audit`
- Deployment boundary: one Railway replica, repository `Dockerfile`, `node dist/server.js`
- Scope constraints preserved: no database/save-schema migration, no balance change, no authentication contract change, no new production host, no generated `dist` committed

The complete audit and evidence matrix is in [TOOLING_INTEGRATION_AUDIT.md](TOOLING_INTEGRATION_AUDIT.md). This report records what was implemented, what remains intentionally external or deferred, and the final verification evidence.

## Implemented

### Privacy-safe Sentry hardening

**What and why.** The existing optional Sentry integration was retained and hardened rather than replaced. A shared recursive sanitizer removes authorization, cookies, tokens, passwords, player/admin identity, request bodies, saves, inventory, chat/message/report/prompt content, API keys, and secret-like nested values. Client events use an intentionally smaller boundary that keeps only scrubbed exception type/value/message and stack data. Express captures add bounded request ID, route-template, method, and gameplay-subsystem correlation without sending a raw URL or request object. Both paths remain error-only, tracing-off, default-PII-off, lazy/fail-open, and complete no-ops without a DSN.

**Primary files.** `shared/observability-sanitize.ts`, `api/_sentry-context.ts`, `server.ts`, `shinobij.client/src/lib/sentry.ts`, `shinobij.client/src/lib/sentry-runtime.ts`, and their focused tests.

**Verification.** Seven focused sanitizer/context/client tests passed; serialized nested fixtures contained none of the forbidden values. The final production build was also run with non-empty server and client dummy DSNs. Healthy clients keep the 83,793-byte Sentry vendor chunk off the initial graph.

**Residual risk.** Private source-map upload is not configured because no Sentry organization/project/upload credentials or post-upload deletion policy were supplied. Client stack traces may therefore be less readable until that owner-controlled workflow is approved.

### Optional aggregate product analytics

**What and why.** A provider-neutral event boundary now exposes eleven explicit product events and fourteen allowlisted categorical properties. The optional PostHog adapter calls its capture endpoint directly; there is no SDK, autocapture, replay, cookie, persisted queue, person profile, stable player/device/session identifier, raw error, request ID, balance, save, inventory, or freeform text. Every event uses one global aggregate sentinel and `$process_person_profile: false`. Canonical server events are emitted only after account, save/creation, mission, purchase, breeding, or ranked settlement authority succeeds. Landing, explicit feature-entry, creation-start, and recoverable-boundary events are client-observed. All dispatches are bounded to 1.5 seconds, fire-and-forget, and disabled by default.

**Primary files.** `shared/product-analytics.ts`, `api/_product-analytics.ts`, `shinobij.client/src/lib/analytics/**`, selected authoritative call sites, [PRODUCT_ANALYTICS_DATA_INVENTORY.md](PRODUCT_ANALYTICS_DATA_INVENTORY.md), `.env.example`, and `Dockerfile`.

**Verification.** Eight focused schema, server, and client tests passed. Disabled builds retain only the small no-op boundary; validation and transport code are lazy. A deployment test now proves Railway's Docker build declares and forwards every client analytics gate.

**Residual risk.** The transport is technically ready but production enablement is not approved. The owner must first decide region, retention, account access, lawful basis/consent, privacy-policy wording, deletion expectations, event budget, and whether a user-facing global opt-out is required. Leave every analytics gate absent until then. The direct endpoint contract follows the [PostHog capture API](https://posthog.com/docs/api/capture).

### Real-Express golden account journey

**What and why.** A Playwright journey now proves the missing player-critical seam: character creation through the real UI, actual account registration, first authoritative save, refresh, local-storage clearance to simulate a clean device, password login through the UI, and authoritative save restoration. It rejects unexpected runtime errors, 5xx responses, broken images, and overflow on desktop and mobile. The related unload-save path now catches the expected navigation-aborted keepalive rejection, preventing a real unhandled promise rejection without changing save authority.

**Primary files.** `shinobij.client/e2e-live/golden-account-express.spec.ts`, `shinobij.client/src/App.tsx`, `shinobij.client/playwright.live.config.ts`, and `shinobij.client/playwright.config.ts`.

**Verification.** The full live suite passed 9 tests with 1 intentional skip in 3.7 minutes. The default seven-project matrix passed 38 tests with 74 capability/project skips and no failures. `PLAYWRIGHT_PORT` now permits an isolated preview port while retaining 4173 as the default.

**Residual risk.** The live suite uses the isolated in-memory QA backend, not production data. It validates the real handlers and built client but does not replace a post-deploy smoke check.

### Native visual-regression pilot

**What and why.** Four deterministic Windows/Chromium baselines protect the desktop/mobile landing hero, character-creator entry, and authenticated Central Hub shell. Motion and time are fixed; carets are hidden; unstable canvas/video output is masked; baselines have explicit manual-update and byte-count gates. Percy was rejected because native Playwright supplies the required comparison without another paid service or artifact boundary.

**Primary files.** `shinobij.client/playwright.visual.config.ts`, `shinobij.client/e2e-visual/**`, `shinobij.client/scripts/check-visual-baselines.mjs`, `.github/workflows/visual-regression.yml`, and [VISUAL_REGRESSION.md](VISUAL_REGRESSION.md).

**Verification.** All 4 comparisons passed. The 4 baseline PNGs total 2,634,130 bytes, below the 8-file/3 MiB caps. Each baseline was visually inspected after generation.

**Residual risk.** The canonical renderer is Windows/Chromium and the workflow is manual to avoid font/renderer noise. Dynamic combat, canvas, and generated-content screens remain covered by functional/layout evidence rather than pixel assertions.

### Realtime/load harness extension

**What and why.** The existing Node harness was extended instead of adding k6. It now uses the real Socket.IO client with configurable connection ramp, sector spread, periodic presence and snapshot traffic, explicit expected-versus-unexpected disconnect accounting, forced reconnects, reconnect-success and p95 gates, orphan cleanup accounting, bounded reservoir samples, fail-closed remote-target confirmation, production denylisting, disposable credentials, and machine-readable JSON.

**Primary files.** `shinobij.client/scripts/staging-load-harness.mjs`, `shinobij.client/scripts/staging-load-core.mjs`, their tests, and [staging-load-and-reconnect-runbook.md](staging-load-and-reconnect-runbook.md).

**Verification.** A disposable local release-gate run completed 40 HTTP requests at 1.63 ms p95 with zero request/server/status errors. Both requested sockets connected and produced snapshots; 40 presence updates ran; all 6 forced reconnect attempts succeeded at 400.22 ms p95; socket errors, unexpected disconnects, and local orphans were all zero. Load-generator RSS growth was -1.03%. This is a safe local proof of the protocol and gates, not a claim about Railway capacity.

**Residual risk.** The release runbook still requires a longer disposable staging run plus Railway CPU/RSS/event-loop review. Public APIs cannot directly expose server-side presence-store orphan counts, so server telemetry remains part of approval.

### Reproducible external-tool handoffs

**What and why.** Generated, source-derived JSON handoffs give designers and economy reviewers reproducible inputs without making an external account a runtime or source-of-truth dependency. The design export contains 180 CSS tokens, 6 responsive ranges, and 48 adaptive authority queries. The economy export inventories 88 faucets, 149 sinks, and 126 shop/catalog items from code-owned constants. A check mode detects drift.

**Primary files.** `scripts/export-tooling-handoffs.mjs`, `docs/generated/design-tokens.json`, `docs/generated/economy-model.json`, `docs/FIGMA_HANDOFF.md`, `docs/MACHINATIONS_HANDOFF.md`, and [EXTERNAL_TOOL_WORKFLOWS.md](EXTERNAL_TOOL_WORKFLOWS.md).

**Verification.** `npm run check:tooling-handoffs` regenerated in memory and matched both committed artifacts. The Figma workflow was shaped by the repository's existing design system and a disposable v0 prototype-review boundary; neither tool was added to runtime.

**Residual risk.** External imports remain review workflows, not round trips. If canonical code changes without regenerating, the drift check must fail CI/review before the handoff is trusted.

### Narrative, asset, and multiplayer decisions

**What and why.** [NARRATIVE_TOOLING_ADR.md](NARRATIVE_TOOLING_ADR.md) preserves TypeScript/server authority and defines the evidence, stable-ID, intermediate-schema, localization, validation, save-compatibility, and ownership gates required before an Arcweave pilot. [MULTIPLAYER_BACKEND_ADR.md](MULTIPLAYER_BACKEND_ADR.md) compares the current stack, a Socket.IO adapter, Colyseus, and Nakama; it retains one Railway service and defines measurable scaling/recovery triggers. Meshy, Rive, BrowserStack, and v0 receive constrained external workflows or adoption gates rather than speculative packages.

**Verification.** The decisions are tied to inspected repository authorities and official [Socket.IO multi-node](https://socket.io/docs/v4/using-multiple-nodes/), [Socket.IO recovery](https://socket.io/docs/v4/connection-state-recovery), [Colyseus room/state](https://docs.colyseus.io/room), and [Nakama authoritative multiplayer](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/) documentation. The existing pet pipeline certified 160 forms across 160 assets; 18 roster angle, 18 roster motion, 2 starter angle, and 2 starter motion contact sheets were generated, with no form requiring multi-angle silhouette review.

**Residual risk.** Presence/rooms remain process-local, so Railway remains intentionally pinned to one replica. Crossing an ADR trigger starts a measured architecture investigation; it does not authorize a migration.

## Deferred and rejected candidates

| Candidate | Decision | Evidence-based reason | Re-evaluate when |
|---|---|---|---|
| BrowserStack | Document for later | Three browser engines and mobile/touch/tablet viewports already run; no physical-device defect or credentials were supplied | A reproducible device/browser-cloud-only defect or quantified device requirement exists |
| Percy | Reject as duplicate | Native Playwright supplies deterministic screenshot comparison and artifacts | Native rendering becomes materially insufficient across required platforms |
| Grafana k6 | Reject as duplicate | Existing Node harness speaks real Socket.IO, guards remote targets, and produces JSON gates | A protocol/load need cannot be represented safely by the existing harness |
| Machinations | Export/workflow only | Code and server telemetry remain economy authority | A named review owner requests a model and approves its non-authoritative role |
| Figma | Export/workflow only | Code-owned tokens/adaptive authorities are canonical | A design owner accepts the generated handoff and reconciliation process |
| Rive | Defer | No approved `.riv`, state machine, license, reduced-motion fallback, or bundle allocation | A real owned asset and measured target surface are supplied |
| Arcweave | Defer | No real export, stable-ID proof, source-of-truth decision, or upload approval | All adoption gates in the narrative ADR are met |
| Meshy | Export/workflow only | The local GLB gate already validates geometry, rigs, clips, materials, bounds, and shipping surfaces | A specific missing asset-production capability and upload approval are documented |
| Colyseus | Architectural defer | A second room authority would duplicate battle/auth/settlement boundaries without a scaling trigger | A multiplayer ADR trigger is reproduced and the smallest isolated proof is approved |
| Nakama | Reject for current problem | It would duplicate/migrate auth, sessions, storage, social, queues, economy, admin, and match logic | A separately funded platform migration has quantified benefits and a rollback/data plan |
| v0 | Export/workflow only | Useful for disposable prototypes, not repository-specific auth/server/deploy authority | A prototype can be adapted through normal review without replacing canonical systems |

## Environment variables

All production variables below are optional and default to disabled/empty. Sentry and product analytics can be enabled independently on server and client. `VITE_*` values are build-time public configuration embedded by Vite; the Dockerfile now declares their Railway build arguments.

| Variable | Phase | Secret? | Default / required value | Failure behavior |
|---|---|---:|---|---|
| `SENTRY_DSN` | Server runtime | No privileged read access; protect configuration integrity | Empty disables server Sentry | Server runs normally; SDK load/init/capture failures fail open |
| `NODE_ENV` | Server runtime | No | Existing environment; Sentry label falls back to `production` | Only affects environment labeling here |
| `RAILWAY_GIT_COMMIT_SHA`, `BUILD_COMMIT`, `GIT_COMMIT_SHA`, `SOURCE_VERSION` | Server runtime/build metadata | No | First valid 7-64 hex value becomes release; otherwise omitted | Events still send without release grouping |
| `VITE_SENTRY_DSN` | Client build | No; embedded in browser bundle | Empty removes reporting/network | Error reporting is a no-op; app behavior is unchanged |
| `VITE_SENTRY_RELEASE`, `VITE_BUILD_COMMIT` | Client build | No | Release label; first is preferred | Events still send without a useful release label |
| `PRODUCT_ANALYTICS_ENABLED` | Server runtime | No | Exact `1` plus valid provider/key/host enables | Any other/missing value is a no-op |
| `PRODUCT_ANALYTICS_PROVIDER` | Server runtime | No | Exact provider `posthog` | Unknown/missing provider is a no-op |
| `POSTHOG_PROJECT_KEY` | Server runtime | Public ingestion token, not an admin API secret | Required only when server pilot is enabled | Missing key disables; dispatch failure never affects gameplay |
| `POSTHOG_HOST` | Server runtime | No | Exact HTTPS project-region origin | Invalid credentials/path/query/HTTP remote host disables |
| `VITE_PRODUCT_ANALYTICS_ENABLED` | Client build | No | Exact `1` plus valid provider/key/host enables | Disabled build keeps only the no-op boundary |
| `VITE_PRODUCT_ANALYTICS_PROVIDER` | Client build | No | Exact `posthog` | Unknown/missing provider disables |
| `VITE_POSTHOG_KEY` | Client build | Public ingestion token; embedded | Required only when client pilot is enabled | Missing key disables |
| `VITE_POSTHOG_HOST` | Client build | No | Exact HTTPS project-region origin | Invalid host disables; send failure is bounded/fail-open |
| `PLAYWRIGHT_PORT`, `COMBAT_LAYOUT_PORT`, `LIVE_E2E_PORT` | Test runtime | No | Unset: `4173`/`4183`/`4183` under CI, otherwise a per-worktree port derived in `shinobij.client/e2e-ports.ts` | An invalid/occupied override makes Playwright fail without disturbing another process |

The staging harness uses QA-only variables; none belong in production service configuration.

| QA variable(s) | Default / requirement | Safety or failure behavior |
|---|---|---|
| `LOAD_TARGET_URL` | Required absolute HTTP(S) origin | Missing/invalid URL fails before traffic |
| `LOAD_CONFIRM_TARGET_HOST` | Required exact host for non-local targets | Mismatch fails closed |
| `LOAD_DENY_HOSTS`, `PRODUCTION_HOST`, `PUBLIC_HOST`, `CANONICAL_HOST`, `CANONICAL_ORIGIN` | Optional denylist inputs | Any resolved target match fails closed |
| `LOAD_DURATION_SECONDS`, `LOAD_CONCURRENCY`, `LOAD_RPS` | `300`, `5`, `10` | Strict bounded integers; invalid values exit 2 |
| `LOAD_REQUEST_TIMEOUT_MS`, `LOAD_SAMPLE_LIMIT`, `LOAD_MAX_RESPONSE_BYTES` | `10000`, `50000`, `1048576` | Bound time, memory, and response consumption |
| `LOAD_ENDPOINTS_JSON` | Default is weighted `GET /health` | Mutations/auth/save-reward entries require disposable proof and explicit bodies |
| `LOAD_SOCKET_CLIENTS`, `LOAD_SOCKET_SECTOR`, `LOAD_SOCKET_SECTOR_SPREAD` | `0`, `40`, `1` | Sockets require disposable credentials; sector range is bounded |
| `LOAD_SOCKET_RAMP_SECONDS`, `LOAD_SOCKET_PRESENCE_INTERVAL_MS` | `5`, `5000` | Bounded ramp and ordinary presence cadence |
| `LOAD_SOCKET_CONNECT_TIMEOUT_SECONDS`, `LOAD_SOCKET_RECONNECT_SECONDS` | `20`, `30` | Reconnect p95 must remain below 5000 ms |
| `LOAD_DISPOSABLE_SCENARIO`, `LOAD_PLAYER_NAME`, `LOAD_MUTATION_CONFIRM` | Exact `1`, disposable name, `DISPOSABLE:<name>` | Missing/mismatched proof fails before protected traffic |
| `LOAD_PLAYER_TOKEN` | Required for sockets/protected endpoints; **secret** | Never written to the JSON report; missing token fails before traffic |

## Performance and bundle impact

The CI-equivalent comparison used the same dummy Sentry settings at the audit baseline and final branch. The totals below include the separately authored, already-shipped combat HUD commit `0e4c146b0`; they are not attributed solely to tooling.

| Gate | Baseline | Final | Delta | Threshold/result |
|---|---:|---:|---:|---|
| Entry JavaScript | 637,867 B | 638,276 B | +409 B (+0.064%) | 640,000 B; pass with 1,724 B margin |
| Budgeted product JS/CSS | 7,223,487 B | 7,224,926 B | +1,439 B (+0.020%) | 7,225,000 B; pass with **74 B margin** |
| Lazy Sentry vendor | N/A in product budget | 83,793 B | Optional/lazy | 100,000 B; pass; absent from initial graph |
| Initial graph | about 1.36 MB raw / 362.6 KB gzip | about 1.36 MB raw / 362.7 KB gzip | negligible | 1.5 MB raw / 385 KB gzip; pass |

The extremely small product-code margin is a release risk, not a reason to raise the threshold. The next product change should drain code from the graph before adding more. Analytics and Sentry remain disabled by default; enabled analytics provider code and Sentry are dynamically loaded away from first paint.

## Verification results

| Check | Result |
|---|---|
| Clean dependency installs | Root and client `npm ci` passed; zero reported vulnerabilities |
| Root test suite | 4,958 passed, 0 failed |
| Focused observability/analytics | Sentry 7/7; analytics 8/8 |
| Client lint | Passed; only Babel's informational >500 KB component formatting notice |
| Final Sentry-enabled production build | Server TypeScript, client typecheck/Vite, `verify:dist`, and size gates all passed |
| Dist integrity | Server 95.5 KB; client 284.8 MB; no authoring sources; no Vercel config |
| Default Playwright matrix | 38 passed, 74 skipped, 0 failed across Chromium/Firefox/WebKit and compact/mobile/tablet projects |
| Live real-Express Playwright | 9 passed, 1 intentional skip, 0 failed in 3.7 minutes |
| Native visual pilot | 4/4 passed; 2,634,130 bytes total |
| Local Socket.IO/reconnect release gates | Passed; exact counters recorded above |
| Release certification | 61/61 checks passed |
| Release assets | 65 referenced assets, 165 badge PNGs, and 21 Pet Home WebPs passed |
| Generated handoffs | Current and reproducible (`check:tooling-handoffs` passed) |
| Railway deployment config | 6/6 focused tests plus runtime config check passed: one replica, Dockerfile, `node dist/server.js`, `/health` |

## Risks and rollback

- **Analytics:** leave all eight analytics variables absent for immediate rollback/opt-out. The internal metrics remain canonical. If enabled delivery misbehaves, disabling either client or server gate removes traffic on the next build/deploy without affecting settlement.
- **Sentry:** remove `SENTRY_DSN` and/or `VITE_SENTRY_DSN`. Capture is already fail-open and owns no gameplay state. No source-map uploader or privileged Sentry API credential was introduced.
- **Browser/visual/load tooling:** test-only changes have no production runtime path. Revert the individual test commit if infrastructure becomes unstable; do not update screenshots to hide a regression.
- **Generated handoffs/ADRs:** these are non-runtime artifacts. Revert or regenerate from code; never import them as game authority.
- **Bundle margin:** 74 bytes remains under the existing product ceiling. Do not raise the ceiling to land unrelated work; perform a measured drain and rerun the Sentry-enabled build.
- **Realtime topology:** one Railway replica remains mandatory until the multiplayer ADR evidence gates, shared-state design, and rollback proof are complete.
- **Source maps and external accounts:** source-map upload, PostHog enablement, BrowserStack, Rive, Arcweave, Figma/Machinations account imports, Colyseus, and Nakama all require explicit owner decisions not granted by this pass.

## Small commits

The implementation was split by concern for review and rollback:

| Commit | Concern |
|---|---|
| `0d47405fb` | Audit baseline and full decision matrix |
| `42e57663a` | Sentry privacy, request correlation, and tests |
| `583b6231c` | Optional aggregate analytics boundary and call sites |
| `c9c3e0cc1` | Real-Express golden account journey |
| `3d2d52200` | Realtime soak and reconnect gates |
| `38378efd9` | Generated Figma/Machinations handoffs |
| `cde0c6a93` | Narrative/multiplayer/external-tool decisions |
| `f3ca37628` | Native visual pilot and baselines |
| `d75e5b2f2` | Optional-tooling bundle drain and lazy boundaries |
| `9b40e796d` | Golden relog/unload error cleanup |
| `7a17116a2` | Isolated Playwright preview ports |
| `de9eb7712` | Railway client-analytics build wiring |

Commit `0e4c146b0` (`refactor combat HUD across PvP and PvE`) was authored separately and was already on `main` before publication. The tooling branch was rebased onto it; it is included in final bundle totals but is not part of this tooling implementation.
