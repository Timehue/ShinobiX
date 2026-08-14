# Staging load and reconnect release gate

For two-account cross-visibility, persistent presence across a real worker
replacement, and durable save observation, run the companion
`STAGING_RESILIENCE_RUNBOOK.md` gate after this capacity harness passes.

This harness is deliberately unable to choose a remote target on its own. A remote
run requires an exact `LOAD_CONFIRM_TARGET_HOST`, and any host in
`LOAD_DENY_HOSTS`, `PRODUCTION_HOST`, `PUBLIC_HOST`, `CANONICAL_HOST`, or
`CANONICAL_ORIGIN` is refused even when confirmed. Keep the live hostname in that
denylist. Run only against an isolated staging deployment and disposable player.

The default endpoint mix is one read-only `GET /health`; Socket.IO is disabled.
Authenticated requests, save/reward-class requests, Socket.IO presence, and all
non-GET/HEAD methods additionally require all of:

- `LOAD_DISPOSABLE_SCENARIO=1`
- `LOAD_PLAYER_NAME` and `LOAD_PLAYER_TOKEN` for a disposable staging player
- `LOAD_MUTATION_CONFIRM=DISPOSABLE:<the exact player name>`

The runner writes progress to stderr and one machine-readable JSON document to
stdout. It exits 0 when all applicable gates pass, 1 when measurements fail, and 2
for unsafe or invalid configuration.

## Release thresholds

The JSON `releaseGate` applies strict (not inclusive) thresholds:

| Gate | Pass condition |
|---|---:|
| HTTP 5xx rate | `< 0.1%` |
| Normal endpoint p95 | `< 500 ms` |
| Save/reward endpoint p95 | `< 1,000 ms` |
| Load-generator steady-state RSS growth | `< 10%` |
| Request/4xx errors | `0` |
| Socket initial connections and presence snapshots | all requested clients |
| Socket presence emits | at least one per requested client |
| Socket connection errors | `0` |
| Unexpected socket disconnects | `0` |
| Forced reconnect success | `100%` |
| Forced reconnect p95 | `< 5,000 ms` |
| Connected local sockets after cleanup | `0` |

The RSS gate catches growth in the bounded load generator; the JSON reports its
scope explicitly. Release approval must also compare the staging container's
Railway memory at steady-state baseline and test end and require `<10%` growth.
Server-side presence-store orphan counts are not exposed by the public API, so the
harness records that as unobservable; confirm that presence returns to baseline in
server telemetry after the 45–60 second expiry window.

## Safe read-only smoke

From the repository root in PowerShell:

```powershell
$env:LOAD_TARGET_URL = 'https://your-staging-host.up.railway.app'
$env:LOAD_CONFIRM_TARGET_HOST = 'your-staging-host.up.railway.app'
$env:LOAD_DENY_HOSTS = 'play.your-live-domain.example,your-production-host.up.railway.app'
$env:LOAD_DURATION_SECONDS = '60'
$env:LOAD_RPS = '10'
$env:LOAD_CONCURRENCY = '5'
node --expose-gc shinobij.client/scripts/staging-load-harness.mjs > "$env:TEMP\shinobix-load-smoke.json"
```

No player credentials or mutations are used. The save/reward and socket checks are
marked skipped in the result.

## Five-minute staging spike

Create a disposable player in staging, authenticate it normally, and put its token
only in the current shell. This mix is still read-only over HTTP: nine shallow
health reads for each authenticated save read. The save read is classified under
the 1,000 ms save/reward latency gate, while ten Socket.IO clients exercise
connection, roster delivery, forced transport loss, reconnect, and cleanup.

```powershell
$Player = 'release-load-disposable'
$env:LOAD_TARGET_URL = 'https://your-staging-host.up.railway.app'
$env:LOAD_CONFIRM_TARGET_HOST = 'your-staging-host.up.railway.app'
$env:LOAD_DENY_HOSTS = 'play.your-live-domain.example,your-production-host.up.railway.app'
$env:LOAD_DISPOSABLE_SCENARIO = '1'
$env:LOAD_PLAYER_NAME = $Player
$env:LOAD_PLAYER_TOKEN = '<disposable-staging-token>'
$env:LOAD_MUTATION_CONFIRM = "DISPOSABLE:$Player"
$env:LOAD_ENDPOINTS_JSON = (@(
  @{ name = 'health'; method = 'GET'; path = '/health'; kind = 'normal'; weight = 9 },
  @{ name = 'save-read'; method = 'GET'; path = "/api/save/$Player"; kind = 'saveReward'; requiresAuth = $true; weight = 1 }
) | ConvertTo-Json -Compress -Depth 5)
$env:LOAD_DURATION_SECONDS = '300'
$env:LOAD_RPS = '25'
$env:LOAD_CONCURRENCY = '10'
$env:LOAD_SOCKET_CLIENTS = '10'
$env:LOAD_SOCKET_RAMP_SECONDS = '10'
$env:LOAD_SOCKET_SECTOR = '40'
$env:LOAD_SOCKET_SECTOR_SPREAD = '5'
$env:LOAD_SOCKET_PRESENCE_INTERVAL_MS = '5000'
$env:LOAD_SOCKET_RECONNECT_SECONDS = '30'
node --expose-gc shinobij.client/scripts/staging-load-harness.mjs > "$env:TEMP\shinobix-load-spike.json"
```

## Sixty-minute 2× soak

Reuse the verified staging-only configuration above and double the spike request,
worker, and socket levels. The harness bounds duration to one hour, rate to 2,000
requests/second, workers to 500, sockets to 200, response bytes, request timeouts,
and retained latency samples.

```powershell
$env:LOAD_DURATION_SECONDS = '3600'
$env:LOAD_RPS = '50'
$env:LOAD_CONCURRENCY = '20'
$env:LOAD_SOCKET_CLIENTS = '20'
$env:LOAD_SOCKET_RAMP_SECONDS = '20'
$env:LOAD_SOCKET_SECTOR_SPREAD = '10'
$env:LOAD_SOCKET_PRESENCE_INTERVAL_MS = '5000'
$env:LOAD_SOCKET_RECONNECT_SECONDS = '30'
node --expose-gc shinobij.client/scripts/staging-load-harness.mjs > "$env:TEMP\shinobix-load-soak-2x.json"
```

After either authenticated run, revoke/delete the disposable staging player and
clear its shell values:

```powershell
Remove-Item Env:LOAD_PLAYER_TOKEN,Env:LOAD_MUTATION_CONFIRM -ErrorAction SilentlyContinue
```

Do not add a mutating endpoint unless its payload is designed for safe repetition
against disposable staging data. `LOAD_ENDPOINTS_JSON` accepts up to 20 weighted
objects with `name`, `method`, `path`, `kind` (`normal` or `saveReward`), `weight`,
optional `requiresAuth`, and an explicit JSON `body` for non-GET/HEAD methods. It
does not accept arbitrary headers or cross-origin URLs.

Socket clients are likewise bounded and explicit. `LOAD_SOCKET_RAMP_SECONDS`
spreads connection attempts evenly instead of creating an accidental thundering
herd. `LOAD_SOCKET_SECTOR` is the first room and
`LOAD_SOCKET_SECTOR_SPREAD` distributes clients round-robin across consecutive
rooms. `LOAD_SOCKET_PRESENCE_INTERVAL_MS` emits ordinary presence plus roster
requests throughout the run. The JSON includes emit/request counts, disconnect
reasons, connection errors, unexpected disconnects, reconnect successes and p95.
The forced transport close used for the reconnect exercise and final cleanup are
marked expected; any other disconnect fails the gate.

## Deployment topology guard

Realtime presence is currently process-local, so Railway must remain single
instance until a shared presence store and Socket.IO adapter are implemented. CI
must run:

```text
node scripts/check-deployment-config.mjs
```

The check fails unless `railway.json` has `deploy.numReplicas` exactly `1`, starts
the compiled server with exactly `node dist/server.js`, and builds the repository
`Dockerfile`.
