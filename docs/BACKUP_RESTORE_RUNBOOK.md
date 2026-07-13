# ShinobiX backup and restore runbook

Production must have Supabase platform backups or PITR enabled, with the plan and retention recorded in release evidence. Repository snapshots are not a substitute for a database recovery control.

## One-command isolated restore drill

Create a new, disposable Supabase project. Never point `TARGET_DATABASE_URL` at production. Set the two connection strings locally (do not paste them into chat or commit them), then run:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
$env:TARGET_DATABASE_URL = '<disposable target pooler URL>'
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

The drill captures a gzip export, refuses a matching or non-empty target, restores inside a transaction, verifies the complete dataset with SHA-256, verifies representative values individually, and writes a redacted JSON evidence artifact with source/target identity, timings, counts, and hashes.

Store the backup outside the repository in encrypted, access-restricted storage. After the command passes, start ShinobiX against the isolated target and require `/health/db` to return HTTP 200. Exercise authenticated reads for representative new, midgame, endgame, clan, PvP, and receipt records present in the recovery point.

## Evidence required for GO

- Supabase backup/PITR plan, retention, and latest recovery point.
- Independent export timestamp, checksum, counts, operator, and protected storage location.
- Isolated target identity proving it differed from production.
- Successful restore output and generated evidence JSON.
- Isolated `/health/db` result and authenticated representative-account checks.
- Measured restore duration, recovery-point age, RPO, and RTO.
- Cleanup confirmation for the disposable project and removal of temporary credentials.

Unset connection strings when finished:

```powershell
Remove-Item Env:DATABASE_URL, Env:TARGET_DATABASE_URL, Env:ALLOW_ISOLATED_RESTORE, Env:ALLOW_RESTORE_OVERWRITE -ErrorAction SilentlyContinue
```

