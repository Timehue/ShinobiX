# Deployment topology and cPanel retirement record

## Current operating topology — 2026-08-03

Railway is the active deployment direction. The active server command is
`node dist/server.js` from the container image, and the health path is
`/health`. The active base store is PostgreSQL through `DATABASE_URL` (with
the repository's supported Supabase PostgreSQL fallback variable where used).

Vercel is retired and compatibility-only. cPanel/Passenger is retired from
normal traffic and retained only for rollback and data-recovery work while its
data is intentionally preserved. The cPanel `app.js` entry point, disk overlay,
route aliases, and migration utilities must not be treated as current Railway
operating instructions. Do not run the historical steps below unless a new
operator explicitly starts a rollback or migration procedure with the required
approval and backup.

The repository does not claim live Railway, production PostgreSQL, or cPanel
state verification in this document; those require an authorized operational
check outside this code change.

---

## Historical cutover record — not a current operating procedure

The following record documents the 2026-07-17 cPanel overlay retirement and
remains for rollback/data recovery. It is deliberately preserved rather than
deleted because the old store may still be needed to recover data safely.

# Retire cPanel — move `save:*` off the disk overlay into Postgres (Option B)

> **STATUS: ✅ COMPLETED 2026-07-17.** The cutover ran successfully: all 118
> disk-routed keys copied cPanel→Postgres (read-back verified, byte-identical),
> `KV_PROXY_URL` + `REQUIRE_DISK_OVERLAY` removed on Railway, `saveStore=base-store`
> confirmed, real player saves writing to Postgres post-flip. Now in the **soak
> window** — cPanel data retained for rollback (re-add `KV_PROXY_URL` +
> `REQUIRE_DISK_OVERLAY=1`, redeploy) until the cPanel service is decommissioned.
> Remaining cleanup: shut down cPanel, remove `KV_PROXY_TOKEN` + `FORCE_DEPLOY`,
> flip release-health `EXPECTED_SAVE_STORE` remote-proxy→base-store, and later
> delete the now-dead overlay/proxy code. The steps below are kept as the record
> and for the rollback path.


Historical goal: stop routing player saves through the cPanel disk overlay (`KV_PROXY_URL`)
and serve them from the Postgres base store, so cPanel can be decommissioned.
Chosen because it removes the most moving parts, is the only option that works
if you ever run more than one server instance, and lowers cost (drops the cPanel
bill; Postgres storage stays inside Supabase Pro's included quota).

**Reversible by design:** the copy NEVER deletes the cPanel data. Rollback is a
one-variable env change + redeploy at any point until you decommission cPanel.

Historical confirmed starting state (from Railway vars, 2026-07-16): `KV_PROXY_URL` set,
`KV_PROXY_TOKEN` set, `REQUIRE_DISK_OVERLAY` set, `DATABASE_URL` set, no
`DISK_KV_DIR`. So saves currently live on cPanel via the proxy.

---

## What moves

The three disk-routed prefixes (`_DISK_PREFIXES` in `api/_storage.ts`):
`save:*`, `shared:images*`, `shared:imgfields*`. `save-snapshot:*` is already
base-primary (untouched — it stays your recovery copy). Everything else is
already in Postgres.

## Tooling

- **`POST /api/admin/migrate-to-base`** (full-admin) — copies overlay → base.
  `?dry=1` reports what would copy without writing. A live run requires
  `KV_MIGRATION_WRITE_FROZEN=1`, which is an operator acknowledgement set only
  after every overlay writer is independently stopped and verified. It is not a
  write fence by itself. Response `ok:true` + `mismatches:[]` means every
  key was copied AND byte-verified in Postgres. Idempotent; never deletes overlay.
- **`GET /health?deep=1`** (with `HEALTH_DEEP_TOKEN`) — reports `saveStore`
  (`remote-proxy` before, `base-store` after) and exercises a real save read/write.
- `npm run backup:kv` — pre-flight backup of overlay + base with digests.

---

## Runbook (do during a quiet window; the data is tiny so the copy is minutes)

Replace `$HOST`, `$ADMIN_PW`, `$DEEP_TOKEN` with your values. No secrets belong in
this file or in any log.

**1. Fresh backup.** `npm run backup:kv` locally (or trigger the snapshot cron).
Keep the output; it's your floor.

**2. Dry-run the copy** (safe, writes nothing):
```
curl -sS -X POST "$HOST/api/admin/migrate-to-base?dry=1" -H "x-admin-password: $ADMIN_PW"
```
Confirm `sourceCount` looks right (≈ your player count + a few image keys).

**3. Stop and verify every overlay writer.** This cutover is blocked until that
condition is real. At minimum, in Railway set:

- `MAINTENANCE_MODE=1` to reject all Express player traffic, including reads;
- `DISABLE_SCHEDULED_JOBS=1` to prevent save/reward cron writers at boot;
- `DISABLE_REALTIME=1` to prevent Socket.IO travel/pet writers at boot;
- `DISABLE_PRESENCE_STATE_JOBS=1` to prevent presence snapshots and the
  sleeper-camp/travel-lease game-loop writer at boot.

Redeploy, wait for the replacement container to become healthy and the prior
container to drain, and verify there is only one intended Railway replica and no
other process or operator writing the overlay. Only then set
`KV_MIGRATION_WRITE_FROZEN=1` and redeploy. That final variable is an explicit
operator acknowledgement that the independently enforced stop was verified; it
does not stop a writer and `MAINTENANCE_MODE` alone is insufficient.

**4. Live copy:**
```
curl -sS -X POST "$HOST/api/admin/migrate-to-base" -H "x-admin-password: $ADMIN_PW"
```
Require `"ok": true` and `"mismatches": []`. If any mismatch is listed, STOP —
do not flip the env; re-run, and if it persists investigate those exact keys.

**5. Verify the stopped source remains stable.** Re-run step 4 once more
(idempotent) and require `ok:true`, `mismatches:[]` again. If source values change
between the two verified passes, STOP: the writer stop is not real. Do not call a
second copy a substitute for quiescence.

**6. (I verify Postgres-side.)** Confirm `select count(*) from kv_store where key
like 'save:%'` matches the copied count, and spot-check a couple of representative
players/clans/images. (Ask me — I have read-only DB access.)

**7. Flip the env OFF the overlay.** In Railway:
- **remove** `KV_PROXY_URL`
- **remove** `REQUIRE_DISK_OVERLAY` (or the app refuses to boot without an overlay — that guard is working as intended)
- **remove** `KV_MIGRATION_WRITE_FROZEN`
- keep `MAINTENANCE_MODE`, `DISABLE_SCHEDULED_JOBS`, `DISABLE_REALTIME`, and
  `DISABLE_PRESENCE_STATE_JOBS` through validation
- keep `DATABASE_URL`, `KV_PROXY_TOKEN` (harmless leftover; remove after decommission)

Redeploy.

**8. Verify live:**
```
curl -sS "$HOST/health?deep=1" -H "authorization: Bearer $DEEP_TOKEN"
```
Require `"saveStore": "base-store"` and all `checks` true. Then load several real
players in-game and confirm progress/inventory are intact. Also change your
release-health expectation from `EXPECTED_SAVE_STORE=remote-proxy` to
`EXPECTED_SAVE_STORE=base-store` (docs/BETA_RELEASE_CERTIFICATION.md) — and drop
`REQUIRE_DISK_OVERLAY=1` from that command.

**9. Resume.** Remove `MAINTENANCE_MODE`, `DISABLE_SCHEDULED_JOBS`,
`DISABLE_REALTIME`, and `DISABLE_PRESENCE_STATE_JOBS`, then redeploy and verify
player traffic, scheduled-job health, realtime reconnect, and presence/game-loop
startup. You're now cPanel-free for saves.

**10. Soak (a few days).** Keep the cPanel data untouched for investigation and
recovery evidence, but treat it as stale after base-store traffic resumes. Do not
re-point live routing to the old overlay without an explicit reconciliation or
restore plan.

**11. Decommission.** Once confident: stop the cPanel service, remove `KV_PROXY_TOKEN`
from Railway. In a later cleanup PR the now-dead overlay/proxy code
(`_makeRemoteKv`, the routing wrapper, `api/kv-proxy.ts`) can be removed.
Note `app.js` is NOT overlay code — it is the cPanel/Passenger bootstrap
(DNS bypass + `require('./dist/server.js')`) and only goes away if/when the
cPanel deploy target itself is dropped (CLAUDE.md currently says keep it).

---

## Rollback (any time before step 11)

Re-add `KV_PROXY_URL` (and `REQUIRE_DISK_OVERLAY=1`) in Railway and redeploy.
Saves read/write cPanel again — its data was never deleted, so nothing to restore.
Any save written to Postgres during the base-store window would be the newer copy;
if you roll back after players have progressed on Postgres, re-run the copy in the
OTHER direction first (`/api/admin/migrate-kv`) to carry those forward. Rolling back
immediately after step 7 (before players write) needs no reconciliation.

## Risks & mitigations

- **Incomplete copy → a player looks wiped.** Mitigated by the freeze (no writes
  mid-copy), the per-key read-back verification (`mismatches` must be empty to
  proceed), the straggler re-run, and the Postgres-side count check. And cPanel is
  never deleted, so worst case is a one-variable rollback.
- **Large image blobs in Postgres.** Fine on Railway — it uses the direct `pg`
  path (no REST size limit), and Cloudflare still fronts image serving.
- **DR after cutover.** Live saves + snapshots both in Supabase; Supabase's own
  daily backups / PITR are the separate recovery domain. Before public launch,
  consider an independent offsite backup (or move large images to object storage).

## Post-cutover: DR note

`save-snapshot:*` continues nightly (unchanged). The `saveStore=base-store` value
that deep-health used to flag as "misrouted" is now the intended state on this host.
