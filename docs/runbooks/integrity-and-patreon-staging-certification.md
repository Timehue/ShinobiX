# Integrity and Patreon Staging Certification

This runbook closes the data-dependent release gates without treating a local
fixture as production evidence. Both tools reject a production target. All
write modes are staging-only, default to off, and require independent CLI and
environment acknowledgements.

## Safety contract

- Run from a disposable staging service whose storage points only at staging.
- Set `SHINOBIX_DEPLOYMENT_TIER=staging` on that service. Do not set it in
  production.
- Generate non-secret target fingerprints with `npm run maintenance:fingerprint`.
  Set the staging fingerprints from the staging shell and configure the
  production fingerprints as mandatory deny sets. The maintenance commands
  require the actual selected database project identity and app origin to match
  those values, then require the same fingerprints again on the CLI. A copied
  tier label therefore cannot authorize a production target.
- Keep database URLs, Patreon secrets, and the full-admin session token in the
  service/operator environment. Never pass secret values on the command line or
  paste them into an audit artifact.
- Run read-only modes first and retain their JSON output as the before artifact.
- The integrity repair creates missing forged registries with create-if-absent
  semantics and advances stale currency projections while holding the exact
  save lock. It never edits a player save and never overwrites a same-version,
  ahead-of-save, or definition conflict. Missing canonical content is reported
  for the versioned admin publish flow; the scanner does not author it.
- The Patreon write journey uses random, marker-owned fixture names and removes
  only those exact saves, link fields, and member records in a `finally` block.

## 1. Confirm key presence without displaying values

Required for the integrity scan:

- one storage configuration: `DATABASE_URL`, `SUPABASE_POSTGRES_URL`, or the
  Supabase REST pair;
- `SHINOBIX_DEPLOYMENT_TIER=staging`.
- `STAGING_STORAGE_FINGERPRINT` and `PRODUCTION_STORAGE_FINGERPRINTS`.

Required for Patreon certification:

- `STAGING_BASE_URL`
- `PATREON_STAGING_ADMIN_TOKEN` (ephemeral full-admin session token)
- `PATREON_CLIENT_ID`
- `PATREON_CLIENT_SECRET`
- `PATREON_WEBHOOK_SECRET`
- `PATREON_REDIRECT_URI`
- `PATREON_APP_RETURN_URL`
- `PATREON_CAMPAIGN_ID`
- `SESSION_SECRET`
- `STAGING_APP_FINGERPRINT` and `PRODUCTION_APP_FINGERPRINTS`

`PATREON_REDIRECT_URI` must be exactly the staging origin plus
`/api/patreon/oauth-callback`. `PATREON_APP_RETURN_URL` must remain on that same
origin. The certification script reports missing **key names only**.

## 2. Read-only integrity baseline

```powershell
npm run scan:data -- --target=staging --confirm-storage=$env:STAGING_STORAGE_FINGERPRINT --json
npm run ledger:audit -- --target=staging --confirm-storage=$env:STAGING_STORAGE_FINGERPRINT --json
```

The combined scan reports exact totals even when samples are capped. Player
names are pseudonymized by default. Use `--include-identifiers` only in a
restricted operator shell when a named record must be investigated.
`--limit=<n>` is diagnostic sampling only: JSON records the available count,
requested limit, and `completeScan: false`, the command exits non-zero, and its
output cannot be retained as cutover certification.

The scan blocks cutover for:

- missing or conflicting forged-item registry definitions;
- missing, stale, divergent, or ahead-of-save currency ledgers;
- missing or divergent canonical admin content;
- legacy saves with incomplete stat-ledger shapes or no save version;
- dangling/unowned equipment, impossible balances, and duplicate pet ids.

Do not repair `ledgerDivergent`, `ledgerAhead`, forged conflicts, content
divergence, or dangling gear automatically. Those are contradictory truths and
need an owner decision backed by history.

## 3. Additive staging backfill

Set the short-lived latch in the staging shell, run the exact confirmation, and
unset the latch immediately afterward:

```powershell
$env:ALLOW_STAGING_INTEGRITY_REPAIR = '1'
npm run scan:data -- --target=staging --confirm-storage=$env:STAGING_STORAGE_FINGERPRINT --repair --confirm-additive-repair=ADD_SIDE_CARS_ONLY --json
Remove-Item Env:ALLOW_STAGING_INTEGRITY_REPAIR
```

The repair creates missing `forged-item:*` records and advances stale
`ledger:currency:*` projections under the save lock, reads each result back,
and counts only verified writes. Missing `content:*` must be published through
the versioned admin content flow. Re-run the read-only commands; both must return
zero unresolved cutover blockers. Preserve the before, repair, and after JSON
artifacts with the deployment record.

Do not enable `STRICT_RAW_SAVE_LEDGER` from one clean snapshot. Exercise the
named candidate accounts on staging (training completion, mastery/loadout save,
pet acquisition/selection, inventory equip/unequip, reconnect) and repeat the
read-only scan after the journey. Keep the flag off if incomplete stat ledgers,
versionless saves, or any contradictory side-car remain.

## 4. Patreon deployed preflight

The default command is read-only apart from normal rate-limit accounting:

```powershell
npm run certify:patreon:staging -- --confirm-app=$env:STAGING_APP_FINGERPRINT --json
```

It checks the deployed authenticated status route and OAuth-start route without
printing the authorize URL or state. It verifies HTTPS, Patreon host/path,
client id, exact staging callback, signed state presence, and all membership
scopes.

## 5. Patreon disposable-fixture journey

```powershell
$env:ALLOW_STAGING_PATREON_SMOKE = '1'
npm run certify:patreon:staging -- --confirm-app=$env:STAGING_APP_FINGERPRINT --confirm-storage=$env:STAGING_STORAGE_FINGERPRINT --execute-fixtures --confirm-fixtures=CREATE_DISPOSABLE_PATREON_FIXTURES --json
Remove-Item Env:ALLOW_STAGING_PATREON_SMOKE
```

The journey certifies against real staging storage and deployed routes:

- Base 12/3/1 caps and custom-avatar denial;
- already-expired admin comp reads inactive;
- invalid webhook signature rejection;
- active Supporter 15/5/2 caps and custom-avatar access;
- reconnect/idempotent refresh with no save-version churn;
- paid refresh removing stale admin source/expiry metadata;
- lapse with non-destructive pet, mastery, and bloodline preservation;
- reactivation;
- player relink and Patreon-identity replacement;
- stale displaced-user webhook rejection;
- member deletion/expiry back to Base caps;
- exact marker-owned fixture cleanup.

Any cleanup failure is a failed certification. Investigate the namespaced
`maintenance:patreon-smoke:*` marker before rerunning; never bulk-delete by
prefix.

## 6. Manual OAuth proof that automation intentionally does not fake

The harness validates OAuth configuration and exercises the same link/apply
core, but it does not store patron passwords, automate Patreon consent, or
manufacture an authorization code. Before public beta, use two disposable
Patreon staging identities and representative game accounts to record:

1. real consent and callback for an active member;
2. reconnect of the same pair;
3. relink to the second game account and immediate old-account revocation;
4. replacement by the second Patreon identity;
5. tier lapse/reactivation delivered by Patreon;
6. status and in-game caps after a service restart.

Record timestamps, HTTP result categories, save-version changes, and redacted
account aliases. Never retain access tokens, authorization codes, webhook
signatures, session tokens, or raw Patreon payloads in the evidence bundle.

## Release gate

The gate is green only when the post-repair integrity scan is clean, the
fixture journey passes with cleanup, and the two-account real OAuth proof is
complete on the candidate deployment. Until then, keep
`STRICT_RAW_SAVE_LEDGER` off and describe Patreon as staging-validated rather
than production-certified.
