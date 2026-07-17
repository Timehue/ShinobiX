# Controlled Beta Release Certification

This is the repeatable certification gate for a deployed staging or isolated-test environment. It is a persistence, reward-integrity, and operations test; it is not a mobile layout pass.

## Safety envelope

- Use a dedicated account whose marker begins with `beta-cert-`.
- Do not run destructive mutation checks against an ordinary production player.
- Record the deployed commit, deep-health `saveStore`, request IDs, and the final cleanup disposition.
- Run `npm run release:health -- https://staging-host` first with `HEALTH_DEEP_TOKEN`, `EXPECTED_SAVE_STORE=base-store`, and `REQUIRE_FRESH_BACKUP=1`.
- Leave `KV_PROXY_URL`, `KV_PROXY_TOKEN`, `DISK_KV_DIR`, and `REQUIRE_DISK_OVERLAY` unset. The cPanel overlay is retired; a passing deep-health response must report `saveStore="base-store"` and `checks.backupFresh=true`.
- Copy `docs/BETA_RELEASE_CERTIFICATION_TEMPLATE.json` to `release-audit/evidence/<safe-name>.json`, fill evidence as each step passes, then run `npm run beta:certify -- <safe-name>.json`. The CLI intentionally accepts a filename only and will not read outside that local evidence directory.

## Required journey

The evidence validator requires all 19 steps: register, login, character creation, first save, reload, intro/Academy, starter companion, stat training, jutsu equip, item equip, Academy spar, hospital/heal, first reward, Logbook, sector entry, village return, logout, second login, and final restore comparison.

For the final comparison, capture aggregate/state hashes or redacted field summaries for progression, inventory, training, companion, mission state, position, and currencies. Never place a password or bearer token in the evidence file. First-save and first-reward steps require request IDs.

## Hostile/retry cases

Run these only with disposable records:

1. Submit the same reward claim twice. The second request must return the original result or a non-paying duplicate response.
2. Submit the settlement with another dedicated test account. It must be rejected and neither account may change.
3. Submit an expired token/session. It must fail without reward or item consumption.
4. Interrupt/retry one claim. The resulting save and receipt must show exactly one payout and exactly one deduction.

## Evidence and cleanup

Store only the redacted certification JSON, relevant receipt IDs, request IDs, commit SHA, timestamps, and pass/fail notes. Delete the dedicated account or retain it clearly labeled for recurring staging checks. The validator fails if cleanup is unknown.

The validator proves evidence completeness, not the truth of a staging action. A release operator must still inspect the actual save and reward receipts.
