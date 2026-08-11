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
# Prints only a 20-character database identity and its exact confirmation; it
# never connects and never prints the URL or credentials.
node scripts/kv-backup.mjs fingerprint
$env:ALLOW_ISOLATED_RESTORE = '1'
$env:RESTORE_CONFIRM_TARGET = 'EMPTY-ISOLATED:<target-database-fingerprint>'
$env:RESTORE_DENY_DATABASE_FINGERPRINTS = '<production-database-fingerprint>,<every-other-never-restore-database-fingerprint>'
# Optional extra defense for dedicated database hosts. Do not list a shared
# *.pooler.supabase.com hostname here; distinguish those projects by fingerprint.
$env:RESTORE_DENY_HOSTS = '<dedicated-production-db-host>'
node scripts/kv-backup.mjs restore --in backups/prelaunch-YYYYMMDD.shinobix-backup.json.gz
```

The command requires the exact `EMPTY-ISOLATED:<target-database-fingerprint>` acknowledgement and a non-empty `RESTORE_DENY_DATABASE_FINGERPRINTS` containing every production database identity. The fingerprint includes the Supabase project discriminator, so two isolated projects may safely use the same shared pooler hostname; a shared-pooler URL without that discriminator fails closed. `RESTORE_DENY_HOSTS` remains an optional additional block for dedicated hosts. The restore also compares live database identity, refuses a target matching the source, and always refuses a non-empty target; there is intentionally no overwrite override.

Verification occurs before the database transaction commits. Follow the returned `runtimeTopology` exactly for the isolated application check:

- `base-only`: leave `DISK_KV_DIR`, `REQUIRE_DISK_OVERLAY`, `KV_PROXY_URL`, and `KV_PROXY_TOKEN` unset. Current post-cPanel backups use this topology; all restored `save:*` and image records are already in the target Postgres base.
- `base-plus-disk-overlay`: set `DISK_KV_DIR` to the returned `targetOverlayDir`, set `REQUIRE_DISK_OVERLAY=1`, and leave `KV_PROXY_URL`/`KV_PROXY_TOKEN` unset.

On a failed restore the tool removes its exact temporary overlay workspace so plaintext player data is not stranded in the OS temp directory. On a successful overlay-backed drill the directory is intentionally retained for the isolated application check and must be removed during cleanup. Require `/health/db` to return 200, then verify representative new, midgame, endgame, clan, PvP, Sanctuary, and receipt records through authenticated reads.

To capture a fresh source, restore it, verify it, and emit redacted drill evidence in one command:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
# Leave KV_PROXY_URL / KV_PROXY_TOKEN UNSET. Since the cPanel retirement (2026-07-17),
# save:* / shared:images* / shared:imgfields* live in the Supabase base store and are
# captured from DATABASE_URL directly. Setting KV_PROXY_URL points the export at the
# retired cPanel proxy (theravensark.com) and fails.
$env:TARGET_DATABASE_URL = '<empty isolated target pooler URL>'
node scripts/kv-backup.mjs fingerprint
$env:ALLOW_ISOLATED_RESTORE = '1'
$env:RESTORE_CONFIRM_TARGET = 'EMPTY-ISOLATED:<target-database-fingerprint>'
$env:RESTORE_DENY_DATABASE_FINGERPRINTS = '<production-database-fingerprint>,<every-other-never-restore-database-fingerprint>'
$env:RESTORE_DENY_HOSTS = '<optional-dedicated-production-db-host>'
npm run drill:restore -- --out backups/launch-week-YYYYMMDD.shinobix-backup.json.gz --evidence-out release-audit/evidence/backup-restore-YYYYMMDD.json
```

After the isolated health and representative-record checks, delete the disposable database project, remove `targetOverlayDir` when an overlay-backed restore returned one, securely remove the sensitive gzip from the workstation after it reaches approved encrypted storage, and remove or rotate temporary credentials. Do not commit the gzip, connection strings, proxy token, raw keys, or player identifiers.

Release evidence must include:

- Supabase backup/PITR plan, retention, and latest recovery point.
- Independent export timestamp, checksum, counts, and protected storage location.
- Isolated target identity and proof it differed from production.
- Restore output, `/health/db` result, representative-account checks, elapsed restore time, measured RPO, and measured RTO.
- Cleanup confirmation for the isolated project and rotation/removal of temporary credentials.
