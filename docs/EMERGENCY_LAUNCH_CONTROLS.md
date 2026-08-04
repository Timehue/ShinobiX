# ShinobiX Emergency Launch Controls

These controls are Railway environment variables. Their normal state is
**unset**. Set a control to the exact string `1`, allow Railway to deploy the
replacement container, verify the expected response, and record the operator,
time, reason, and commit in the incident log.

| Control | Effect | Recovery access retained |
| --- | --- | --- |
| `MAINTENANCE_MODE=1` | Returns non-cacheable HTTP 503 for every player API route, including reads and login. | Health, restart, admin, manual snapshot, and KV-proxy paths remain available. |
| `DISABLE_NEW_REGISTRATIONS=1` | Rejects only `player-auth` registration with HTTP 503. Existing login and gameplay continue. | Existing player authentication and all operator paths. |
| `FREEZE_ECONOMY_REWARDS=1` | Rejects every unsafe gameplay mutation (`POST`, `PUT`, `PATCH`, `DELETE`) at the shared route boundary. This intentionally freezes more than known reward routes so a new endpoint cannot escape the incident stop. | Read-only gameplay, player auth, telemetry, admin, manual snapshot, and KV-proxy paths. |
| `DISABLE_SCHEDULED_JOBS=1` | Prevents the snapshot, ranked-season, Clan Boss, Village War, era, mercenary, and durable-settlement reconciliation timers from starting. | Authenticated manual snapshot and settlement inspection routes remain available. |
| `DISABLE_SNAPSHOT_CRON=1` | Stops only snapshot boot and catch-up scheduling. Ranked season, Clan Boss, Village War, era, mercenary, and settlement-reconciliation jobs continue. | Authenticated manual snapshot and every non-snapshot scheduled job remain available. |
| `DISABLE_SETTLEMENT_RECONCILIATION=1` | Stops only the five-minute stale-settlement scanner. It does not alter or clear existing journals. | Same-request settlement recovery and the full-admin settlement inspection/scan route remain available. |

Every blocked response includes `Cache-Control: no-store`, `Retry-After`, and a
machine-readable code. The controls are implemented in `api/_launch-controls.ts`
and enforced by the Express route boundary. Registration is also checked inside
`api/player-auth.ts`, so it cannot be bypassed by a direct handler invocation.

## Activation and verification

1. Record the current `/health` commit and the incident reason.
2. Add only the required variable in Railway and wait for a successful deploy.
3. Confirm `/health` is still HTTP 200 on the new commit.
4. Verify the control with a harmless request:
   - maintenance: unauthenticated `GET /api/player/roster` returns 503 with code `maintenance_mode`;
   - registrations: a deliberately invalid registration body returns 503 with code `registrations_disabled` before validation or storage;
   - economy freeze: unauthenticated `POST /api/shop/settle` returns 503 with code `gameplay_mutations_frozen` before authentication or storage;
   - jobs: startup logs state that all scheduled jobs are disabled.
5. Confirm the protected `/health/db` check remains healthy and alerts remain armed.

Do not send a valid player mutation merely to test a switch. The pre-authentication
checks above prove the shared gate without changing player data.

## Recovery

1. Fix or contain the incident while the appropriate switch remains active.
2. Review economy reconciliation, duplicate receipts, audit logs, deep health,
   database connections, and the relevant Sentry events.
3. Remove the environment variable and wait for another successful Railway deploy.
4. Repeat `/health`, `/health/db`, login, one read-only gameplay request, and one
   bounded staff-account mutation before announcing recovery.

## Global player-session invalidation

Rotate `SESSION_SECRET` to a new cryptographically random value and redeploy.
Tokens signed with the prior value immediately fail verification; players can
authenticate again with their passwords and receive new tokens. Never remove the
secret as an invalidation shortcut: an absent value forces expensive password
verification on every authenticated request. Account-specific invalidation uses
password change/admin reset, which increments that account's durable session epoch.

## Evidence retention

Retain the Railway deployment URL/commit, variable name (never its value), UTC
activation and recovery times, operator, reason, validation responses, alert
delivery, relevant audit/Sentry identifiers, and any reconciliation output.
