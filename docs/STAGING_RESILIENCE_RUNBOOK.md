# Staging resilience certification

This gate proves the multiplayer and restart seams that a hermetic in-memory run
cannot prove: two independently authenticated accounts see each other through the
real Socket.IO service, recover from a transport loss, survive a replacement
worker, retain durable saves, and rehydrate process-local presence from the
persistent handoff snapshot.

It is staging-only. The harness requires `SHINOBIX_DEPLOYMENT_TIER=staging`, binds
the selected origin to `STAGING_APP_FINGERPRINT`, requires a non-empty
`PRODUCTION_APP_FINGERPRINTS` deny set, refuses an origin in that set, requires an
exact host confirmation, and rejects every configured production/public/canonical
host. It also requires two disposable accounts with independently issued tokens and
needs a second exact confirmation before it will call the restart endpoint. It never
registers, deletes, travels, settles rewards, or writes a player save. The only
mutations are disposable presence heartbeats, bounded deep-health probe records,
and the explicitly armed staging worker restart.

## Account preparation

Create two disposable staging accounts through the normal UI. Leave both idle in
the same sector with no active battle, travel, training, expedition, or breeding.
Record each session token from the staging login flow. Do not use production
accounts or copy production credentials into the shell.

The result is a single JSON document. Account names and tokens are never printed;
players are represented by 16-character SHA-256 labels. Exit code `0` means every
requested gate passed, `1` means a runtime assertion failed, and `2` means the
configuration was unsafe or incomplete.

## Local acceptance before staging

The built-Express suite provides deterministic preflight coverage without any
external credentials:

```powershell
cd shinobij.client
npx playwright test -c playwright.live.config.ts e2e-live/realtime-resilience-express.spec.ts --project=chromium-desktop-live
npx playwright test -c playwright.live.config.ts e2e-live/first-session-onboarding-express.spec.ts --project=chromium-desktop-live
```

The first spec opens two independently authenticated Socket.IO sessions and forces
a transport reconnect. The second performs the full server-authoritative Academy
journey once to avoid duplicating a long stateful scenario across projects, then
switches to `390x844` for inspect-before-travel, mobile controls, logout, and a real
second-session login. The broader responsive matrix remains in
`e2e/adaptive-shell.spec.ts`, including a dedicated mobile world-map inspector
contract.

## Realtime and storage preflight (no process restart)

From `shinobij.client` in PowerShell:

```powershell
$HostName = 'your-staging-host.up.railway.app'
$PlayerA = 'resilience-alpha'
$PlayerB = 'resilience-bravo'
$env:SHINOBIX_DEPLOYMENT_TIER = 'staging'
$env:RESILIENCE_TARGET_URL = "https://$HostName"
$env:RESILIENCE_CONFIRM_TARGET_HOST = $HostName
$env:RESILIENCE_DENY_HOSTS = 'play.your-live-domain.example,your-production-host.up.railway.app'
$env:STAGING_APP_FINGERPRINT = '<20-character staging app fingerprint>'
$env:PRODUCTION_APP_FINGERPRINTS = '<comma-separated production app fingerprints>'
$env:RESILIENCE_DISPOSABLE_SCENARIO = '1'
$env:RESILIENCE_PLAYER_A_NAME = $PlayerA
$env:RESILIENCE_PLAYER_A_TOKEN = '<disposable-token-a>'
$env:RESILIENCE_PLAYER_B_NAME = $PlayerB
$env:RESILIENCE_PLAYER_B_TOKEN = '<disposable-token-b>'
$env:RESILIENCE_MUTATION_CONFIRM = "DISPOSABLE:$PlayerA`:$PlayerB@$HostName"
$env:RESILIENCE_HEALTH_TOKEN = '<staging HEALTH_DEEP_TOKEN>'
$env:RESILIENCE_SECTOR = '40'
npm run test:staging-resilience > "$env:TEMP\shinobix-staging-resilience.json"
```

Generate each non-secret origin fingerprint from the repository root with
`STAGING_BASE_URL` set to that exact origin and `npm run maintenance:fingerprint`.
Copy the staging result into `STAGING_APP_FINGERPRINT`; generate every production
origin separately and place all results in `PRODUCTION_APP_FINGERPRINTS`. Never
reuse the staging value in the production deny set.

This proves plain health, the real database/KV probe, two owner-authenticated save
reads, independent socket authentication, reciprocal sector visibility, forced
transport loss, automatic reconnect, and unchanged durable fingerprints/save
versions.

## Armed staging restart

After the preflight passes, add the dedicated staging `RESTART_TOKEN` and the
restart-specific acknowledgement:

```powershell
$env:RESILIENCE_RUN_RESTART = '1'
$env:RESILIENCE_RESTART_TOKEN = '<staging RESTART_TOKEN>'
$env:RESILIENCE_RESTART_CONFIRM = "RESTART:$HostName"
npm run test:staging-resilience > "$env:TEMP\shinobix-staging-restart.json"
```

Before calling `/api/restart`, the harness removes presence from both reconnect
handshakes. It then requires all of the following:

- `/health.startedAt` changes while the commit remains the same;
- both established sockets observe a disconnect and reconnect;
- both players are cross-visible before either client sends another presence beat,
  proving the persistent presence snapshot restored them;
- deep database/KV health passes on the replacement worker;
- both save versions and durable economy/inventory/equipment/jutsu/pet/receipt
  fingerprints remain byte-identical.

If `backupFresh` is false in the JSON, the realtime/restart proof can still pass,
but release approval must stop until the scheduled backup marker is healthy and a
real isolated restore drill passes.

## Real backup and restore contract

Run `npm run drill:restore -- --out <backup.json.gz> --evidence-out
<evidence.json>` from the repository root using the source `DATABASE_URL`, an empty
isolated `TARGET_DATABASE_URL`, `ALLOW_ISOLATED_RESTORE=1`, the exact
`RESTORE_CONFIRM_TARGET=EMPTY-ISOLATED:<target-database-fingerprint>`, and a
`RESTORE_DENY_DATABASE_FINGERPRINTS` list containing every production database
project. A dedicated-host `RESTORE_DENY_HOSTS` list is optional extra defense. Follow
`docs/BACKUP_RESTORE_RUNBOOK.md` for the full application-level representative
record check.

The drill refuses the source database, denylisted identities/hosts, a target without the exact
acknowledgement, a non-empty target, a schema/RLS mismatch, an incomplete backup,
and any full-dataset or representative checksum mismatch. It has no overwrite
switch.

## Cleanup

Disconnect/delete the two disposable staging accounts using the normal staging
operator process, then remove secrets from the current shell:

```powershell
Remove-Item Env:RESILIENCE_PLAYER_A_TOKEN,Env:RESILIENCE_PLAYER_B_TOKEN,Env:RESILIENCE_HEALTH_TOKEN,Env:RESILIENCE_RESTART_TOKEN -ErrorAction SilentlyContinue
```

Retain the JSON evidence with the release candidate. Never retain raw shell
history, tokens, database URLs, or restart secrets in repository artifacts.
