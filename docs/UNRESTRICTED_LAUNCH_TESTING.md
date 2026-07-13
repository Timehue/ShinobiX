# Unrestricted launch testing

The limited beta remains capped at 25 invited concurrent players on one replica. Raising that cap requires authenticated presence and settlement evidence from a disposable environment.

## Authenticated presence and reconnect load

Prepare a local, ignored JSON manifest containing disposable player session tokens:

```json
[
  { "name": "load-player-001", "token": "temporary-session-token" },
  { "name": "load-player-002", "token": "temporary-session-token" }
]
```

Never commit this file. `load-accounts*.json` is ignored by Git. Use accounts created only in the disposable target and remove them after the run.

Run the first 25-client gate:

```powershell
$env:ALLOW_REMOTE_LOAD = '1'
npm run drill:presence-load -- `
  --base-url https://disposable-staging.example.com `
  --accounts load-accounts.staging.json `
  --clients 25 `
  --duration-seconds 300 `
  --emit-ms 2000 `
  --reconnect-fraction 0.25 `
  --evidence-out presence-load-evidence.25.json
Remove-Item Env:ALLOW_REMOTE_LOAD
```

Repeat at 50, 100, and 300 clients only after the preceding tier passes. Record connection and reconnect p95, snapshot volume, maximum roster size, application p95, database connections, 5xx rate, memory, CPU, and restart count.

The harness refuses remote targets unless `ALLOW_REMOTE_LOAD=1`. It separately refuses `shinobijourney.com` and `theravensark.com` unless `ALLOW_PRODUCTION_LOAD=1`, and production is hard-capped to 25 clients for 60 seconds. Production runs do not satisfy the unrestricted-launch gate.

## Pass criteria

- Every client connects successfully.
- Every forced reconnect succeeds.
- Every client receives sector snapshots.
- No socket or authentication errors occur.
- Gameplay API p95 stays below 2 seconds and 5xx stays below 2%.
- No restart, connection-pool exhaustion, presence split, or stale roster persists after the run.

## Remaining suites

After presence passes, use the same disposable accounts and target for parallel save/purchase/training/mission settlement, two-client PvP, simultaneous Clan Boss/Village War/ANBU actions, cron interruption, deployment rollback/schema compatibility, and authenticated viewport journeys. Never run destructive settlement or rollback suites against production.
