# ShinobiX backup and restore runbook

The production Supabase project must have platform backups or PITR enabled with retention recorded in the release evidence. Repository snapshots are not substitutes for that control.

Before launch, also create an independent application-data export:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
node scripts/kv-backup.mjs export --out backups/prelaunch-YYYYMMDD.shinobix-backup.json.gz
```

Store the resulting gzip outside the repository in encrypted restricted storage. Record its SHA-256, row count, save count, timestamp, operator, and storage location without recording credentials.

Restore only into a newly created isolated Supabase project. Apply [supabase-schema.sql](../supabase-schema.sql), then run:

```powershell
$env:DATABASE_URL = '<source URL used only for same-target refusal>'
$env:TARGET_DATABASE_URL = '<isolated target pooler URL>'
$env:ALLOW_ISOLATED_RESTORE = '1'
node scripts/kv-backup.mjs restore --in backups/prelaunch-YYYYMMDD.shinobix-backup.json.gz
```

The command refuses a non-empty target unless `ALLOW_RESTORE_OVERWRITE=1`, refuses a target matching the source, verifies every restored row against the backup checksum, and reports row/save counts. Afterward, start ShinobiX against the isolated target, require `/health/db` to return 200, and verify representative new, midgame, endgame, clan, PvP, and receipt records through authenticated reads.

Release evidence must include:

- Supabase backup/PITR plan, retention, and latest recovery point.
- Independent export timestamp, checksum, counts, and protected storage location.
- Isolated target identity and proof it differed from production.
- Restore output, `/health/db` result, representative-account checks, elapsed restore time, measured RPO, and measured RTO.
- Cleanup confirmation for the isolated project and rotation/removal of temporary credentials.
