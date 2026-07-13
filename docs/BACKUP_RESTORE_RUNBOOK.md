# ShinobiX backup and restore runbook

Production must have Supabase platform backups or PITR enabled, with the plan and retention recorded in release evidence. Repository snapshots are not a substitute for a database recovery control.

## One-command isolated restore drill

Production is a two-store system: transactional/snapshot data is in Postgres, while live `save:*`, `shared:images*`, and `shared:imgfields*` records are on the authenticated cPanel disk overlay. A database-only export is intentionally rejected as incomplete.

Create a new, disposable Supabase project and apply [`supabase-schema.sql`](../supabase-schema.sql) through its SQL editor. The drill refuses a bare or incorrectly secured table: the expected columns, indexes, RLS setting, `kv_store_anon_select` policy, and read-only anon grant must all be present. Create an empty local directory for the isolated overlay. Never point `TARGET_DATABASE_URL` at production. Set the credentials locally (do not paste them into chat or commit them), then run:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
$env:KV_PROXY_URL = 'https://theravensark.com/api/kv'
$env:KV_PROXY_TOKEN = '<production proxy token>'
$env:TARGET_DATABASE_URL = '<disposable target pooler URL>'
$env:TARGET_DISK_KV_DIR = "$env:TEMP\shinobix-restore-overlay"
$env:ALLOW_ISOLATED_RESTORE = '1'

node scripts/kv-backup.mjs drill `
  --out "$env:TEMP\shinobix-prelaunch-backup.json.gz" `
  --evidence-out "$env:TEMP\shinobix-backup-restore-evidence.json"
```

For named representative records, repeat `--representative-key`. The evidence hashes these keys so usernames are not recorded:

```powershell
node scripts/kv-backup.mjs drill `
  --out "$env:TEMP\shinobix-prelaunch-backup.json.gz" `
  --evidence-out "$env:TEMP\shinobix-backup-restore-evidence.json" `
  --representative-key 'save:<new-account>' `
  --representative-key 'save:<midgame-account>' `
  --representative-key 'save:<endgame-account>' `
  --representative-key 'save:clan-<clan-slug>'
```

The drill captures Postgres and all disk-routed production prefixes, refuses a matching database or non-empty overlay target, restores the base store inside a transaction, restores the production disk format into the isolated directory, verifies both complete datasets with independent SHA-256 hashes, verifies representative values individually, and writes a redacted JSON evidence artifact with source/target identity, timings, counts, and hashes. It requires two identical overlay reads bracketed by identical Postgres reads. If production keeps changing throughout all retry windows, temporarily set `FREEZE_ECONOMY_REWARDS=1`, wait for in-flight mutations to drain, run the export, then immediately unset the flag.

Store the backup outside the repository in encrypted, access-restricted storage. After the command passes, start ShinobiX with `DATABASE_URL=$env:TARGET_DATABASE_URL`, `DISK_KV_DIR=$env:TARGET_DISK_KV_DIR`, and `REQUIRE_DISK_OVERLAY=1`; require `/health/db` to return HTTP 200. Exercise authenticated reads for representative new, midgame, endgame, clan, PvP, receipt, and image records present in the recovery point.

## Evidence required for GO

- Supabase backup/PITR plan, retention, and latest recovery point.
- Independent export timestamp, separate Postgres/overlay checksums and counts, operator, and protected storage location.
- Isolated target identity proving it differed from production.
- Successful restore output and generated evidence JSON.
- Isolated `/health/db` result and authenticated representative-account checks.
- Measured restore duration, recovery-point age, RPO, and RTO.
- Cleanup confirmation for the disposable project and removal of temporary credentials.

Unset connection strings when finished:

```powershell
Remove-Item Env:DATABASE_URL, Env:KV_PROXY_URL, Env:KV_PROXY_TOKEN, Env:TARGET_DATABASE_URL, Env:TARGET_DISK_KV_DIR, Env:ALLOW_ISOLATED_RESTORE -ErrorAction SilentlyContinue
```
