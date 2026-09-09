# Server registration refactor — 2026-09-08

`server-api-routes.ts` now owns the explicit API handler imports and registrations. `server.ts` calls `registerApiRoutes(route)` at the original position between the operator restart route and static/SEO serving. The entry point is reduced from 1,911 to 1,096 physical lines.

The inventory found 275 registration statements, all simple calls to the existing route adapter. They have no other local dependencies. All 278 imports in the original handler block retain their order, including the three startup helpers re-exported to the entry point. The outbound IPv4 initializer remains the first entry import. No handler, auth policy, lock, storage layout or write sequence changes.

The original route adapter still mounts bare and `/api` paths with all methods, merges route params into the real request query, applies launch controls and forwards errors. All nine retained entry-point functions have unchanged bodies, including health probes and graceful shutdown. Middleware, CORS, compression, static fallback, Railway startup and background-job lifecycle remain in the entry point; the inventory did not justify moving those responsibilities in this pass.

Route coverage tests now read registration source at its actual position in the entry point. Existing client-route coverage, handler inventory, dynamic params, SEO, unknown-API 404, health and lifecycle assertions are retained. A new assertion checks that the registration is invoked once in the correct position. Domain source contracts follow the new route owner, and release-flag scanning covers both server files.

The focused server suite passes 95 cases, and 38 follow-up source contracts pass. Production server compilation, deployment configuration and rollback-readiness checks pass. The canonical pet-simulation mirror passes all three generation/parity checks without regeneration or expected-snapshot changes. Four live Express cases pass: both Academy journeys, Village Stores, and route aliases/CORS/JSON 404 behavior. An isolated local server rejects unauthorized restart requests, finishes the authorized response, drains and exits with code zero. Final combined gate results are recorded in the completion audit.

Legacy code is retained where compatibility evidence requires it: the three-lane renderer is used by Pet Ladder, generated simulations remain intentional mirrors, and dormant deployment/storage adapters still support the documented rollback paths. This pass introduces no deletion based only on a file's age, and no migration or deployment is required.

Local evidence: `.tmp/refactor-screens/server-route-inventory.json`, `server-route-parity.json`, `server-focused.log`, `server-build.log`, `server-deployment.log`, `server-rollback.log` and `pet-sim-parity.log`.
