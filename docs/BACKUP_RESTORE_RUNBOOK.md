# ShinobiX backup and restore runbook

The production Supabase project must have platform backups or PITR enabled with retention recorded in the release evidence. Repository snapshots are not substitutes for that control.

Before launch, also create an independent application-data export:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
# Leave KV_PROXY_URL / KV_PROXY_TOKEN UNSET. Since the cPanel retirement (2026-07-17),
# save:* / shared:images* / shared:imgfields* live in the Supabase base store and are
# captured from DATABASE_URL directly. Setting KV_PROXY_URL points the export at the
# retired cPanel proxy (theravensark.com) and fails.
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

The command refuses a target matching the source and always refuses a non-empty target; there is intentionally no overwrite override. It restores the Postgres base into `TARGET_DATABASE_URL` and prints `targetOverlayDir`, the temporary isolated disk-overlay directory containing restored `save:*` and image records. Verification occurs before the database transaction commits. For the isolated application check, point ShinobiX at the target database, set `DISK_KV_DIR` to `targetOverlayDir`, set `REQUIRE_DISK_OVERLAY=1`, and leave production `KV_PROXY_URL`/`KV_PROXY_TOKEN` unset. Require `/health/db` to return 200, then verify representative new, midgame, endgame, clan, PvP, and receipt records through authenticated reads.

To capture a fresh source, restore it, verify it, and emit redacted drill evidence in one command:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
# Leave KV_PROXY_URL / KV_PROXY_TOKEN UNSET. Since the cPanel retirement (2026-07-17),
# save:* / shared:images* / shared:imgfields* live in the Supabase base store and are
# captured from DATABASE_URL directly. Setting KV_PROXY_URL points the export at the
# retired cPanel proxy (theravensark.com) and fails.
$env:TARGET_DATABASE_URL = '<empty isolated target pooler URL>'
$env:ALLOW_ISOLATED_RESTORE = '1'
npm run drill:restore -- --out backups/launch-week-YYYYMMDD.shinobix-backup.json.gz --evidence-out release-audit/evidence/backup-restore-YYYYMMDD.json
```

After the isolated health and representative-record checks, delete the disposable database project, remove `targetOverlayDir`, securely remove the sensitive gzip from the workstation after it reaches approved encrypted storage, and remove or rotate temporary credentials. Do not commit the gzip, connection strings, proxy token, raw keys, or player identifiers.

Release evidence must include:

- Supabase backup/PITR plan, retention, and latest recovery point.
- Independent export timestamp, checksum, counts, and protected storage location.
- Isolated target identity and proof it differed from production.
- Restore output, `/health/db` result, representative-account checks, elapsed restore time, measured RPO, and measured RTO.
- Cleanup confirmation for the isolated project and rotation/removal of temporary credentials.
