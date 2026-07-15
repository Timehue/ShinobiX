# Deployment and rollback runbook

ShinobiX deploys from `main` to one Railway replica. A rollback is safe only while database and save changes use expand-contract compatibility: the previous server must still understand records written by the new server.

## Before deployment

1. Require `npm test`, `npm run build:server`, `npm run check:rollback-readiness`, and the client production build to pass.
2. Record the current Railway deployment/commit as the rollback target.
3. Confirm `/health` and authenticated `/health/db`, the snapshot freshness marker, Better Stack, and Sentry are healthy.
4. For any schema or save-shape change, deploy only additive fields/tables/indexes. Readers must accept both missing old fields and present new fields. Writers must preserve unknown stored fields.
5. Take or verify a fresh backup before an economy, save sanitizer, storage, or schema deployment.

## Deployment verification

Deploy the new commit, then verify `/health`, authenticated `/health/db`, login/save round-trip, one purchase/settlement replay, presence reconnect, one representative battle, images, and scheduled-job health. Do not increase replicas during the same change.

## Application rollback

1. Set `FREEZE_ECONOMY_REWARDS=1` if the incident can duplicate, lose, or corrupt value. Use `MAINTENANCE_MODE=1` only when reads/login are unsafe too.
2. In Railway, choose the recorded prior healthy deployment and select **Rollback**. Do not remove the current deployment until the rollback is healthy.
3. Require `/health` and authenticated `/health/db` to pass, then test an existing account whose save was written by the newer build. Confirm its unknown/new fields remain present after the old build saves.
4. Confirm presence reconnects, settlement replay remains single-application, images load, and cron health is fresh.
5. Remove the freeze only after Sentry, Better Stack, database connections, and economic reconciliation remain healthy.

## Database rollback rule

Do not reverse a database change by dropping a table or column during an incident. Roll the application back while leaving additive schema in place. Destructive contract cleanup belongs in a later release after the previous application is no longer a rollback target and a restore drill has passed. If data itself is corrupt, keep writes frozen and follow `BACKUP_RESTORE_RUNBOOK.md`; restoring production is a separate owner-authorized incident action.

## Evidence

Record the before/new/rollback commit IDs, timestamps, health results, representative account used, save checksums or redacted field-presence proof, Sentry/Better Stack state, cron marker age, freeze duration, and operator. A dashboard button existing is not evidence; the rollback must be exercised on a disposable target before unrestricted launch.

## Launch-week incident assignment

Before invites open, write these values into the private launch record (never place personal phone numbers or credentials in the repository):

- Primary rollback operator and backup operator.
- Incident commander, private incident channel, and out-of-band contact method.
- Person authorized to set/remove freezes and approve a production data restore.
- Player-communications owner and public status location.
- Evidence custodian and encrypted evidence location/retention date.

Opening player notice:

> We are investigating an issue affecting [system]. [Purchases/rewards/gameplay] are temporarily paused to protect progress. Player data is being verified. Next update: [UTC time].

Recovery notice:

> The affected system is restored and verification is complete. Service resumed at [UTC time]. We will contact any affected players after reconciliation; please do not repeat failed transactions unless the game confirms they are pending.

The incident commander records every flag change, deploy/rollback action, health result, reconciliation decision, player update, and evidence location on the UTC timeline. The rollback operator cannot self-approve a production data restore; that requires the named restore approver.
