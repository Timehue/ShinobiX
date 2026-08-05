# ShinobiX tooling integration audit

- **Starting branch:** `main` (work performed on `codex/tooling-observability-gap-audit`)
- **Starting commit SHA:** `4d533bb61cb4c7c1b843f441dfef3f0da539deae`
- **Date of audit:** 2026-08-05
- **Current deployment topology:** one Railway replica builds `Dockerfile`, starts `node dist/server.js`, and serves the Express API, Socket.IO, scheduled jobs, and the React SPA from one process. Supabase/Postgres is the durable store. `railway.json`, `Dockerfile`, `server.ts`, and `scripts/check-deployment-config.mjs` are the deployment authorities. Vercel and cPanel are retired.
- **Current client/server stack:** Node 22, TypeScript, Express 5, Socket.IO 4, Supabase/Postgres, React 19, Vite 8, Three.js/React Three Fiber, and Playwright 1.61.

## Inspection and validation commands

The audit used the following commands from the repository root unless a working directory is shown:

```text
git fetch origin main --prune
git rev-parse HEAD
git rev-parse origin/main
git status --short --branch
Get-Content -Raw CLAUDE.md
Get-Content -Raw shinobij.client/CLAUDE.md
rg --files ...
rg -n "Sentry|analytics|Playwright|Socket.IO|telemetry|..." ...
Get-Content -Raw package.json
Get-Content -Raw shinobij.client/package.json
Get-Content -Raw .env.example
Get-Content -Raw .github/workflows/*.yml
npm ci
cd shinobij.client; npm ci
$env:VITE_SENTRY_DSN='https://public@example.invalid/1';
  $env:VITE_SENTRY_RELEASE='baseline';
  $env:VITE_BUILD_COMMIT='4d533bb61cb4c7c1b843f441dfef3f0da539deae';
  npm run build
```

The root `npm ci` completed successfully with zero reported vulnerabilities. The first client `npm ci`, and consequently the first baseline build, were unable to unlink the native Rolldown binding because a pre-existing `vite preview` process on port 4173 held it open. This is a recorded environment limitation, not a passing build claim. Verification results will be appended after the preview process is released.

## Decision matrix

| Candidate | Existing repository coverage | Verified gap | Expected value | Implementation cost | Runtime risk | Privacy/security risk | Ongoing cost | Decision | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Sentry | Optional server SDK; lazy error-only React SDK; global browser listeners; React boundaries; Express error capture; CI dummy-DSN bundle gate | No reusable event scrubber; client helper permits display-name `username`; server 500 capture lacks request-ID/route scope; no private source-map upload | High: safer actionable failures and request correlation | Low | Low when fail-open | Medium before hardening; low after redaction | Existing free/paid Sentry plan | `IMPLEMENT NOW` | `server.ts:328-356,523-569,1615-1640`; `shinobij.client/src/lib/sentry.ts`; `sentry-runtime.ts`; `components/ErrorBoundary.tsx`; `release-readiness.test.ts`; `.github/workflows/ci.yml` |
| PostHog / product analytics | Aggregate internal beta metrics, economy transactions, war telemetry, request percentiles, and anonymous performance beacons already answer operational/economy questions | No vendor-neutral explicit product-event boundary or optional aggregate external product pilot; existing metrics are not a substitute for all UX entry/drop-off questions | Medium if kept anonymous and sparse | Medium | Low when disabled by default | Medium; consent, retention, and policy language are owner decisions | Optional provider account | `PILOT OPTIONAL` | `api/_beta-metrics.ts`; `api/_economy.ts`; `api/_war-telemetry.ts`; `api/_request-metrics.ts`; `api/perf-beacon.ts`; `shinobij.client/src/lib/perfTelemetry.ts`; `screens/LegalPage.tsx` |
| Playwright | Seven default browser/device projects; accessibility, overflow, broken-image, Central Hub, creator, pet, adaptive, live Express combat, refresh/retry, and 22-size combat/adaptive matrices | UI creation is mocked while authoritative registration/save certification is API-driven; no single browser test proves actual UI registration through first authoritative save and restore against the real Express memory backend | High: catches a player-blocking seam | Medium | Test-only | Low with isolated generated accounts | Free/open source | `IMPLEMENT NOW` | `shinobij.client/playwright.config.ts`; `playwright.live.config.ts`; `e2e/release-smoke.spec.ts`; `e2e/central-hub-authenticated.spec.ts`; `e2e-live/solo-pve-express.spec.ts`; `scripts/release-certification.mjs` |
| BrowserStack | Chromium, Firefox, and WebKit already run in CI; mobile/touch/tablet viewports are covered | No physical-device/browser-cloud evidence; current need is not quantified and credentials are unavailable | Medium only for confirmed device-specific failures | Medium | None in runtime | Test data/account capture must be governed | Paid account and minutes | `DOCUMENT FOR LATER` | `.github/workflows/ci.yml`; `shinobij.client/playwright.config.ts`; `docs/ui/adaptive-layout-authority-map.md` |
| Percy | Playwright captures failure screenshots, traces, and videos, but has no small committed screenshot assertion suite | Deterministic visual assertions for a few release-critical static surfaces | Medium | Low with native Playwright | Test-only | Low with synthetic/local data | Paid service unnecessary for pilot | `REJECT AS DUPLICATE` | `shinobij.client/playwright.config.ts`; existing screenshot calls in `e2e/**`; native pilot will use `toHaveScreenshot` |
| Playwright native visual regression | Failure evidence exists, but not baseline comparison | Three to six deterministic release surfaces need explicit baselines, animation control, and a manual update command | High for CSS regressions | Medium | Test-only | Low | Free/open source | `IMPLEMENT NOW` | Existing Playwright configs/specs and `docs/ui/adaptive-layout-authority-map.md` |
| Grafana k6 | Two Node load systems already model actual HTTP behavior; the staging harness uses the real Socket.IO client protocol and emits machine-readable JSON with release gates | Existing staging Socket.IO path lacks normal periodic presence traffic, configurable connection ramp/sector spread, unexpected-disconnect accounting, and a reconnect p95 gate | High if existing harness is extended; little value from duplicating it in k6 | Low for Node extension; medium for k6 | Test-only, remote guard already fail-closed | Credentials require disposable staging policy | k6 operation/hosting if adopted | `REJECT AS DUPLICATE` | `scripts/load-soak.mjs`; `shinobij.client/scripts/staging-load-harness.mjs`; `staging-load-core.mjs`; `staging-load-core.test.mjs`; `docs/staging-load-and-reconnect-runbook.md` |
| Machinations | Economy constants and telemetry are canonical in code; no external model export | Operators cannot reproduce a model without manually copying live constants | Medium for balance review, with no runtime coupling | Low | None | Low; generated values are public game constants | Optional account | `EXPORT/WORKFLOW ONLY` | `api/_economy.ts`; `_war-economy.ts`; `missions/_mission-catalog.ts`; `pvp/_item-catalog.ts`; `pet/_breeding.ts`; `shared/shrines.ts` |
| Figma | CSS tokens, adaptive-shell authorities, viewport contract, component/surface inventory, and accessibility rules exist in code/docs | No reproducible machine-readable token handoff or concise import/reconciliation workflow | Medium for design/engineering handoff | Low | None | Low | Optional account | `EXPORT/WORKFLOW ONLY` | `shinobij.client/src/styles/tokens.css`; `src/styles/layout/adaptive-*.css`; `docs/ui-design-system.md`; `docs/ui/adaptive-layout-authority-map.md` |
| Rive | No approved `.riv` asset or target state machine found | Asset ownership, state inputs, reduced-motion fallback, and bundle budget are undecided | Low without a real asset | Medium | Bundle/runtime risk if installed speculatively | Asset licensing decision required | Tool/account and asset production | `DEFER — REQUIRES ASSET/ACCOUNT/POLICY DECISION` | No `.riv` file or Rive dependency in either lockfile; current motion is CSS/canvas/Three.js |
| Arcweave | Story data is authored in TypeScript and exported to review PDF from live data | No real Arcweave export sample or source-of-truth/round-trip policy | Potentially medium for narrative authoring | High | Save/story compatibility risk | Proprietary story upload/account decision | External account | `DEFER — REQUIRES ASSET/ACCOUNT/POLICY DECISION` | `scripts/gen-story-pdf.mjs`; `scripts/_story-pdf-build.py`; `api/_story-*.ts`; `shinobij.client/src/data/story*.ts`; `shared/story-card-sources.ts` |
| Meshy | Local GLB certification parses GLB, validates geometry, triangles, bounds, UV/normals, rigs/bones/weights, clip names/durations, materials/textures, size, and writes reports; contact sheets and browser surface tests exist | No justified runtime/API gap; automatic third-party upload would be a regression in ownership/privacy | Existing local pipeline already supplies the value | None | Third-party runtime coupling would be harmful | Proprietary asset upload needs explicit approval | External credits/account | `EXPORT/WORKFLOW ONLY` | `shinobij.client/scripts/pet-model-certification.mjs`; `build-pet-model-contact-sheets.mjs`; `scripts/pet-model-shipping.test.ts`; `src/lib/pet-3d-*.test.ts` |
| Colyseus | Socket.IO rooms, authenticated presence, reconnect, pet duel/lobby, HTTP fallback, game loop, single-instance guard, and load tests already exist | Horizontal scaling and live-match recovery have not crossed a measured migration trigger | Low now; possible future tactical-match value | High | High: dual authority and migration risk | Auth/save duplication risk | Additional service/operations | `DEFER — ARCHITECTURAL MIGRATION` | `api/_realtime/socket.ts`; `pet-duel-socket.ts`; `online-store.ts`; `game-loop.ts`; `shinobij.client/src/lib/presence-socket.ts`; `railway.json` |
| Nakama | Existing auth, save, social, matchmaking-like queues, presence, settlement, and admin APIs are substantial | No quantified requirement that warrants duplicating or migrating those systems | Low at current scale | Very high | Very high | Auth/storage migration creates new boundaries | New service and maintenance | `DEFER — ARCHITECTURAL MIGRATION` | `api/_auth.ts`; `api/_storage.ts`; `api/_realtime/**`; `api/pvp/*queue*`; `server.ts` |
| v0 | Existing React architecture, CSS design system, accessibility gates, lazy screen boundaries, auth, and server-authoritative APIs are repository-specific | No runtime gap. Generated output needs an isolated review/adaptation workflow | Medium for disposable UI prototypes only | Low if kept external | High if generated app/auth/deploy assumptions are merged blindly | Generated code must not alter auth or leak data | Optional external workflow | `EXPORT/WORKFLOW ONLY` | `shinobij.client/CLAUDE.md`; `docs/ui-design-system.md`; `src/App.size.test.ts`; no v0 package/config |

## Existing coverage verified in code

### Sentry and request observability

- `shinobij.client/src/main.tsx` calls `initSentry()` before render, but `src/lib/sentry.ts` contains no eager `@sentry/react` import. It dynamically imports `sentry-runtime.ts` only after an error. `src/lib/release-readiness.test.ts` and `e2e/release-smoke.spec.ts` enforce the lazy healthy-player path.
- Client initialization sets environment, release, `tracesSampleRate: 0`, `sendDefaultPii: false`, and removes duplicate global handlers because lightweight `error` and `unhandledrejection` listeners trigger the first load.
- `ErrorBoundary.tsx` and `ScreenErrorBoundary.tsx` report caught render errors. `chunk-load-recovery.ts` recognizes stale dynamic-import failures and performs one session-guarded refresh; expected stale-chunk errors are deliberately not sent.
- `server.ts` loads `@sentry/node` only when `SENTRY_DSN` exists, sets environment/release, disables tracing/default PII, and fails open if the package cannot initialize. The Express terminal error middleware captures handler failures.
- `server.ts` accepts a bounded inbound `x-request-id` or creates an eight-character UUID prefix, echoes it in the response, and records route-grouped p50/p95/p99/5xx metrics through `api/_request-metrics.ts`.
- Sentry source-map upload is not configured. No `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, upload plugin, or private upload workflow exists. Adding upload without verified organization/project credentials and a post-upload map deletion rule would overstate readiness; it is documented as optional manual setup rather than implemented here.

### Internal telemetry and analytics

- `api/perf-beacon.ts` accepts a bounded anonymous one-page-load payload, applies a rate limit and no-store response, and logs no account identity. `shinobij.client/src/lib/perfTelemetry.ts` uses one best-effort beacon/fetch after observing navigation and vitals.
- `api/_beta-metrics.ts` stores bounded daily aggregate onboarding, combat, reward, and release-readiness counts; `api/admin/beta-metrics.ts` exposes aggregate admin reporting.
- `api/_economy.ts` records server-computed faucet/sink deltas and bounded transaction evidence. War telemetry (`api/_war-telemetry.ts`), settlement journals, combat receipts, and request SLO metrics answer operational and integrity questions internally.
- These systems remain canonical. The optional external analytics pilot will bridge selected canonical events instead of re-defining every endpoint event.

### Browser and responsive QA

- Default Playwright projects cover Chromium, Firefox, WebKit, compact/mobile/touch, and tablet (`playwright.config.ts`). CI installs all three engines and runs the suite.
- `e2e/release-smoke.spec.ts` covers landing/creator, broken images, overflow, serious/critical axe findings, public legal routes, focus containment, and lazy Sentry failure behavior.
- `e2e/central-hub-authenticated.spec.ts` creates a deterministic mocked account and checks authenticated Central destinations and dialogs.
- `e2e/adaptive-shell.spec.ts` verifies navigation authority, 22 viewport sizes, capacity/error/long-content states, modal containment, mobile storage clearance, and world-map DPR alignment. `adaptive-layout-contract.test.ts` guards authority ownership.
- `e2e-live/solo-pve-express.spec.ts` uses the built client and real Express in-memory backend for mission start/action/resume/settle, a deliberately lost response, replay safety, refresh, relogin, and no unexpected browser/5xx errors. The root `scripts/release-certification.mjs` certifies fresh account/save/reward/refresh/relog and Academy combat through real handlers.
- The verified gap is the seam between those two suites: actual character-creator UI submitting to the real Express memory backend and restoring the resulting authoritative save.

### Load and realtime QA

- `scripts/load-soak.mjs` provisions isolated local-memory accounts, exercises register/login, saves, optimistic conflicts, rate limiting, HTTP heartbeats, save reads, reward claims, ramp and sector spread, p50/p95/p99 latency, generator event-loop lag, and pass/fail output. Its console report is human-readable rather than JSON.
- `shinobij.client/scripts/staging-load-harness.mjs` produces JSON, has hard remote-target confirmation/production denylisting, bounded time/rate/concurrency/response samples, optional authenticated endpoints, real Socket.IO clients, room presence requests, forced transport interruption, reconnect measurement, generator memory, and release thresholds.
- The staging harness does not yet ramp socket connections, spread them across sectors, emit ordinary periodic presence after connection, distinguish expected forced disconnects from unexpected churn, or enforce reconnect p95. Those are the scoped improvements. A raw-WebSocket k6 script would not certify Socket.IO and is rejected.

### Assets, design, narrative, and deployment

- `shinobij.client/scripts/pet-model-certification.mjs` is a real GLB intake gate rather than a filename check. It validates GLB structure, decoded accessors, geometry/component budgets, bounds, UV/normals, skeleton/weights/bones, approved animation clips and durations, materials/textures, and writes certification artifacts. Contact-sheet and browser/model surface tests cover visual intake. Meshy API coupling adds no confirmed value.
- `docs/ui-design-system.md`, `src/styles/tokens.css`, `styles/layout/adaptive-shell.css`, `adaptive-stages.css`, `adaptive-tools.css`, and `docs/ui/adaptive-layout-authority-map.md` define the design/adaptive source of truth. Figma should receive generated tokens and a handoff, never become runtime authority.
- Story authority is code (`api/_story-*.ts`, `api/story/**`, `shinobij.client/src/data/story*.ts`). `scripts/gen-story-pdf.mjs` and `_story-pdf-build.py` export the live story for review. No Arcweave sample exists, so an importer would be guesswork.
- `server.ts` explicitly registers every API handler and attaches Socket.IO to the same HTTP server. `scripts/check-deployment-config.mjs` pins Railway to one replica while presence remains process-local. No second multiplayer backend or deployment target is justified in this pass.

## Tier 1 implementation scope established by the audit

1. Add a shared, allowlist-oriented Sentry sanitization boundary; remove client display-name identity; propagate safe request/route tags server-side; and test no-DSN, lazy graph, request correlation, and serialized redaction.
2. Add an explicit, disabled-by-default, provider-neutral analytics API. The optional PostHog transport will use bounded direct capture with aggregate anonymous identity, no SDK/autocapture/replay, and no initial-graph provider code. Selected existing beta events remain the server source of truth.
3. Add one real-Express browser golden path for UI registration, first save, refresh, and password relogin. Existing mature mission/combat/pet/adaptive suites remain unchanged except for shared failure assertions where useful.
4. Add a three-to-six-surface native Playwright screenshot pilot with a separate config/script, explicit baseline update command, one baseline platform, deterministic masks/time/motion, and failure artifacts. No Percy dependency.
5. Extend the real Socket.IO staging harness with the confirmed traffic/ramp/sector/disconnect/reconnect thresholds. Do not add k6.
6. Generate source-derived design/economy artifacts and add Figma/Machinations handoffs. Document Rive, Arcweave, Meshy, v0, Colyseus, and Nakama without runtime integration.

No accepted item requires a database migration, authentication change, balance change, paid-service credential, or new production deployment target.
