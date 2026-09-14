# Performance and health: next pass

Reviewed on the refactor branch at `330f9cbdd`. This proposal records the evidence before implementation. The user selected priorities **3 and 4**, focusing on actual loading and resource-lifetime improvements. Priorities 1 and 2 were declined for this pass. Implementation and measured results are recorded in [the performance improvement report](performance-improvements-2026-09-08.md).

## Current evidence

- The integration audit passed 9,701 unit/contract tests and four live Express cases. The broader browser evidence and its two focused reruns are recorded in [the refactor completion audit](refactor-roadmap-completion-audit.md).
- The production startup graph is 382,769 B gzip. Its global stylesheet is 114,385 B gzip / 588,893 B raw: approximately 30% of compressed startup JS/CSS. Three.js remains lazy.
- A fresh local soak provisioned all 100 requested accounts. With 30 seconds of configured load, a five-second ramp and completion of outstanding loops, it measured 1,987 calls over 46 seconds. Health latency was p95 4 ms / p99 6 ms; heartbeat p95 9 ms / p99 13 ms; autosave p95 6 ms / p99 7 ms.
- There were no unexpected HTTP errors. Autosave returned 759 successful writes and 100 expected version conflicts; all 100 conflict refetches succeeded. The harness treats 409/429 as designed responses and reports their counts separately.
- This soak used isolated in-memory QA storage on local port 25219. It measures handler/locking/process behavior for this workload, not production Postgres capacity, GPU performance, or real player concurrency. Evidence: `.tmp/refactor-final/performance-health-soak-100.log`.

The July audit is historical: sector-indexed presence, projected roster reads, build budgets, filtered production assets and single-replica deployment checks already exist. Reimplementing those would duplicate working controls.

## Recommended sequence

| Priority | Work | Current evidence | Completion criterion |
|---|---|---|---|
| 1 | Make release health evaluate service quality | `server.ts` exposes `requestMetrics.slo` through deep health, but `scripts/release-health-check.mjs` checks storage/backup/commit and ignores it. | Add a deliberate post-load SLO check that distinguishes healthy, unhealthy and insufficient samples; test all three. Keep Railway liveness cheap and independent of transient database latency. |
| 2 | Measure performance throughout a session | `perfTelemetry.ts` sends one boot beacon. Later transitions and long tasks remain in local counters; `api/perf-beacon.ts` only accepts the boot summary. No interaction-latency or layout-shift metric is collected there. | Add bounded, sampled, anonymous session summaries with release/device context, plus interaction latency and layout shifts. Verify tab hiding, restoration and long sessions without duplicate sends or unbounded arrays. Keep current telemetry's lack of KV writes and player data. |
| 3 | Reduce mobile startup work | The global CSS manifest still eagerly imports feature styles. `App.tsx` also warms the PvP screen and arena art after 650 ms on logged-in/restoring screens. | Capture cold/refresh/Academy/first-battle network and CPU traces. Move only proven feature-exclusive CSS behind its owner, preserving cascade order. Test later or conditional PvP warmup against both startup and first-battle latency. Require a measured improvement and unchanged responsive/combat checks. |
| 4 | Extend long-session and 3D lifecycle coverage | Archive resource-cycle tests and short Colosseum remount checks exist. Remaining hook warnings include `PetModel3D` cleanup and the Rite stage effect dependencies. | Run repeated combat entry, exit, quality changes and background/resume cycles; compare successive warmed windows of heap, listeners, textures and geometry. Review the two hook warnings with those tests before changing dependencies. A warning alone is not proof of a leak. |
| 5 | Establish database-backed capacity | The local soak is healthy for its tested workload, while request metrics expose global latency percentiles and per-route averages, without database-pool pressure or event-loop delay. | Add bounded runtime diagnostics, then run an isolated staging load mix covering saves, travel, rewards and combat against Postgres. Use latency/error budgets and version/settlement correctness to set a supported capacity range. Retain the current single-instance presence invariant. |

The selected implementation slice is priorities 3 and 4. Priority 3 is the strongest directly visible download/CPU candidate; its savings must be measured rather than inferred from file size alone. Priority 4 should fix reproducible resource retention while keeping the shared asset cache usable across battles.

For frontend targets, use loading, interaction and visual-stability measurements together. Google's field guidance defines good LCP as at most 2.5 s, INP at most 200 ms, and CLS at most 0.1 at the 75th percentile, segmented by device class. These are proposed targets, not measured results for this game. [Web Vitals guidance](https://web.dev/articles/vitals).

Node provides event-loop delay and utilization measurements suitable for the bounded server diagnostics proposed above. Verify implementation against the deployed Node 22 API, preserve explicit startup/shutdown ownership, and expose operational detail through the existing protected health surface. [Node performance APIs](https://nodejs.org/api/perf_hooks.html).

## Validation boundaries

- Preserve balance, server-authoritative rewards, save versions and battle admission during every performance change.
- Rebuild and run client lint plus the complete responsive and strict combat suites for screen/component changes; include Warfront for renderer changes.
- Exercise normal and delayed Academy persistence, route aliases and relevant save/concurrency contracts after telemetry or health integration changes.
- Keep startup and lazy-loading budgets unchanged. Retain before/after traces and separate device classes; do not compare an idle desktop run with a loaded mobile run.
- Production telemetry configuration and Postgres behavior were not inspected in this review. A staging URL and its existing test-account setup are needed for the database-backed capacity phase.
