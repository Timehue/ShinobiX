# ShinobiX backup and restore runbook

The production Supabase project must have platform backups or PITR enabled with retention recorded in the release evidence. Repository snapshots are not substitutes for that control.

## Launch-wipe day checklist (run IMMEDIATELY before the reset)

The wipe is the single most dangerous operation on the launch calendar. In
order, on the day, before touching any data:

1. **Supabase dashboard** → Database → Backups: confirm today's daily restore
   point exists. (Seven daily points were confirmed 2026-07-12; re-verify — do
   not trust that snapshot of evidence on wipe day.)
2. **Nightly in-DB snapshots are healthy**: the deep health probe
   (`GET /health/db` with `HEALTH_DEEP_TOKEN`) must report `backupFresh: true`,
   or query `backup:save-snapshots:last-success` directly — `completedAt` must
   be within 24h and `skipped: 0`. (Verified green 2026-08-21: 113/113 saves,
   0 skipped.)
3. **Take the independent offsite export** with the command below, using
   `DATABASE_URL` from Railway's environment variables. Record the SHA-256 and
   store the gzip outside the repository BEFORE the wipe begins.
4. Only after all three: proceed with the reset.

Before launch, also create an independent application-data export:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
# Leave KV_PROXY_URL / KV_PROXY_TOKEN UNSET. Since the cPanel retirement (2026-07-17),
# save:* / shared:images* / shared:imgfields* live in the Supabase base store and are
# captured from DATABASE_URL directly. A stale KV_PROXY_URL makes this command fail
# unless the reviewed legacy-overlay intent described below is explicit.
node scripts/kv-backup.mjs export --out backups/prelaunch-YYYYMMDD.shinobix-backup.json.gz
```

Store the resulting gzip outside the repository in encrypted restricted storage. Record its SHA-256, row count, save count, timestamp, operator, and storage location without recording credentials.

Only a deliberate rollback capture may read the retired overlay. Record the rollback approval, set the reviewed proxy credentials, and opt in explicitly:

```powershell
$env:DATABASE_URL = '<rollback source pooler URL>'
$env:KV_PROXY_URL = 'https://theravensark.com/api/kv'
$env:KV_PROXY_TOKEN = '<temporary legacy proxy token>'
node scripts/kv-backup.mjs export --out backups/rollback-legacy-YYYYMMDD.shinobix-backup.json.gz --legacy-overlay
```

Without `--legacy-overlay`, any populated `KV_PROXY_URL` fails closed before a proxy read. Conversely, `--legacy-overlay` without `KV_PROXY_URL` also fails. The same option is available on `drill` for an approved legacy rollback drill; it must not be used for a normal post-retirement production backup.

Restore only into a newly created isolated Supabase project. Apply [supabase-schema.sql](../supabase-schema.sql), then run:

```powershell
$env:DATABASE_URL = '<source URL used only for same-target refusal>'
$env:TARGET_DATABASE_URL = '<isolated target pooler URL>'
$env:ALLOW_ISOLATED_RESTORE = '1'
node scripts/kv-backup.mjs restore --in backups/prelaunch-YYYYMMDD.shinobix-backup.json.gz
```

The command refuses a target matching the source and always refuses a non-empty target; there is intentionally no overwrite override. On shared Supabase pooler hosts, same-target detection uses the project reference encoded in the connection identity instead of treating the shared host as one database. Backup validation requires the exact unique overlay-prefix set and rejects a split topology when enabling an overlay would hide any base-only disk-routed `save:*`, `shared:images*`, or `shared:imgfields*` key. It verifies the complete base and any retired overlay before the database transaction commits. Its `applicationValidation` result is the authority for configuring the isolated application check:

- **Current base-store backup:** `expectedSaveStore` is `base-store`, `enableDiskOverlay` and `requireDiskOverlay` are `false`, `targetOverlay.kind` is `none`, and `targetOverlayDir` is `null`. Point ShinobiX at `TARGET_DATABASE_URL`; leave `DISK_KV_DIR`, `REQUIRE_DISK_OVERLAY`, `KV_PROXY_URL`, and `KV_PROXY_TOKEN` unset. Do not create or enable an empty overlay, because doing so would hide the restored `save:*` rows in PostgreSQL. Require `/health/db` to return 200 with `saveStore=base-store`.
- **Retired-overlay rollback backup:** `expectedSaveStore` is `disk`, both overlay booleans are `true`, and `targetOverlayDir` contains the restored legacy `save:*`/image records. Point ShinobiX at `TARGET_DATABASE_URL`, set `DISK_KV_DIR` to that exact directory and `REQUIRE_DISK_OVERLAY=1`, and leave `KV_PROXY_URL`/`KV_PROXY_TOKEN` unset. Require `/health/db` to return 200 with `saveStore=disk`. This path exists only to validate a deliberately captured pre-retirement/rollback backup.

In both cases, verify representative new, midgame, endgame, clan, PvP, and receipt records through authenticated reads. The reported `saveCount` is taken from the store the application will actually use; `baseSaveCount` and `overlaySaveCount` remain separate evidence so stale compatibility copies are never double-counted.

To capture a fresh source, restore it, verify it, and emit redacted drill evidence in one command:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
# Leave KV_PROXY_URL / KV_PROXY_TOKEN UNSET. Since the cPanel retirement (2026-07-17),
# save:* / shared:images* / shared:imgfields* live in the Supabase base store and are
# captured from DATABASE_URL directly. A stale KV_PROXY_URL makes this command fail
# unless the reviewed legacy-overlay intent is explicit.
$env:TARGET_DATABASE_URL = '<empty isolated target pooler URL>'
$env:ALLOW_ISOLATED_RESTORE = '1'
npm run drill:restore -- --out backups/launch-week-YYYYMMDD.shinobix-backup.json.gz --evidence-out release-audit/evidence/backup-restore-YYYYMMDD.json
```

A caught overlay-staging, transaction, or verification failure removes its partial or completed managed temporary overlay automatically. A failed `drill` also removes the overlay if failure occurs after restore; it cannot delete the already-populated isolated database project, so the operator must still delete that project. A successful retired-overlay restore retains `targetOverlayDir` for the isolated application check.

After the isolated health and representative-record checks, delete the disposable database project. Remove `targetOverlayDir` only when the successful result is non-null (the retired-overlay case). Securely remove the sensitive gzip from the workstation after it reaches approved encrypted storage, and remove or rotate temporary credentials. Do not commit the gzip, connection strings, proxy token, raw keys, or player identifiers.

Release evidence must include:

- Supabase backup/PITR plan, retention, and latest recovery point.
- Independent export timestamp, checksum, counts, and protected storage location.
- Isolated target identity and proof it differed from production.
- Restore output, `/health/db` result, representative-account checks, elapsed restore time, measured RPO, and measured RTO.
- Cleanup confirmation for the isolated project and rotation/removal of temporary credentials.
