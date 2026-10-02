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
# Every key, including save:* / shared:images* / shared:imgfields*, lives in the
# Supabase base store and is captured from DATABASE_URL directly.
node scripts/kv-backup.mjs export --out backups/prelaunch-YYYYMMDD.shinobix-backup.json.gz
```

Store the resulting gzip outside the repository in encrypted restricted storage. Record its SHA-256, row count, save count, timestamp, operator, and storage location without recording credentials.

The `--legacy-overlay` capture from the retired cPanel KV proxy was removed with the overlay on 2026-10-02; passing it to `export` or `drill` now fails with an explanation.

Restore only into a newly created isolated Supabase project. Apply [supabase-schema.sql](../supabase-schema.sql), then run:

```powershell
$env:DATABASE_URL = '<source URL used only for same-target refusal>'
$env:TARGET_DATABASE_URL = '<isolated target pooler URL>'
$env:ALLOW_ISOLATED_RESTORE = '1'
node scripts/kv-backup.mjs restore --in backups/prelaunch-YYYYMMDD.shinobix-backup.json.gz
```

The command refuses a target matching the source and always refuses a non-empty target; there is intentionally no overwrite override. On shared Supabase pooler hosts, same-target detection uses the project reference encoded in the connection identity instead of treating the shared host as one database. It verifies the complete base before the database transaction commits, then reports `applicationValidation.expectedSaveStore` = `base-store`. Point ShinobiX at `TARGET_DATABASE_URL` and require `/health/db` to return 200 with `saveStore=base-store`.

The v2 backup format still carries an overlay section, which every export since the 2026-07-17 cutover records empty. A file captured before the cutover, while saves lived on the cPanel disk overlay, still validates and can be read with `inspect`. A restore refuses it before connecting to the target, because the server removed overlay support on 2026-10-02 and restoring only its base rows would silently drop those saves. Restoring such a file needs a checkout from before the overlay removal.

Verify representative new, midgame, endgame, clan, PvP, and receipt records through authenticated reads.

To capture a fresh source, restore it, verify it, and emit redacted drill evidence in one command:

```powershell
$env:DATABASE_URL = '<production pooler URL>'
$env:TARGET_DATABASE_URL = '<empty isolated target pooler URL>'
$env:ALLOW_ISOLATED_RESTORE = '1'
npm run drill:restore -- --out backups/launch-week-YYYYMMDD.shinobix-backup.json.gz --evidence-out release-audit/evidence/backup-restore-YYYYMMDD.json
```

A caught transaction or verification failure rolls the target back. A failed `drill` cannot delete an already-populated isolated database project, so the operator must still delete that project.

After the isolated health and representative-record checks, delete the disposable database project. Securely remove the sensitive gzip from the workstation after it reaches approved encrypted storage, and remove or rotate temporary credentials. Do not commit the gzip, connection strings, raw keys, or player identifiers.

Release evidence must include:

- Supabase backup/PITR plan, retention, and latest recovery point.
- Independent export timestamp, checksum, counts, and protected storage location.
- Isolated target identity and proof it differed from production.
- Restore output, `/health/db` result, representative-account checks, elapsed restore time, measured RPO, and measured RTO.
- Cleanup confirmation for the isolated project and rotation/removal of temporary credentials.
