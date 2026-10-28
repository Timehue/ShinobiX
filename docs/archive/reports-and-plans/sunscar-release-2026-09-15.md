# Sunscar release preparation

## Live baseline

Prepared on `e8fdfc9048f8f2414d71ba1056c88f8dc7bc76b8`, the current production commit at the start of the release. Public `/health` returned HTTP 200 and that exact revision. Its [post-deploy health run](https://github.com/Timehue/ShinobiX/actions/runs/34925132528) completed both the revision check and authenticated deep-health probe; the latter requires a fresh backup.

## Included work

- Pet Rally, Caravan Run, their authored content, recovery paths, authoritative rewards and festival presentation.
- Existing combat renderer and engine, including the corrected Scorpion Queen native sprite direction. The current-main combat screen remains unchanged.
- Shared battle-history formatting and persistent Caravan records; bounded unload-save recovery.
- Mobile controls and viewport recovery. New hover styles use the live app's hover-capability gate; the review harness installs App's viewport contract.
- New server-owned Rally and Caravan save domains. Existing legacy counter protections remain intact for rollback compatibility. No database/schema migration is required.

The current-main Exchange implementation, Fate Shard trading, seller notices, clan recovery receipts and unrelated local work are preserved. The release was assembled in an isolated checkout.

## Verification before release gates

- Node 22.23.2, freshly installed locked dependencies.
- Complete production build, client/server TypeScript and full frontend lint passed (zero lint errors; 14 existing warnings).
- Festival, existing Exchange and save-ownership integration tests: **81 passed**.
- Rollback-readiness and runtime-mode documentation checks passed.
- Product JS/CSS: **8,417,704 B raw / 2,366,632 B gzip**. Initial graph: **1,432,862 B raw / 380,733 B gzip**. Startup budgets remain unchanged.

The full repository, smoke and strict combat-layout suites validate this integrated release. GitHub CI and Production Image provide commit-bound results before promotion to `main`; production verification checks the resulting revision and authenticated post-deploy health. Earlier feature-level evidence is in [the mobile audit](sunscar-mobile-ux-audit.md) and [implementation notes](sunscar-overhaul.md).
