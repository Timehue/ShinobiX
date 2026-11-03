Retain and qualify exact world-boss candidate/recovery images using disposable PostgreSQL. This is isolated test tooling, not production publishing. PR #42 stays release-blocked.

`pins.json` fixes candidate e80b87ff7d0ae07b9d0b3841f558d2100760016b and compatible recovery 9851d8b25fce230ef48968f0678fe16d0a6977f4. Both retain the same reviewed production implementation; their differences are test follow-ups. This does not qualify an unfixed legacy writer or arbitrary rollback.

Image source modes

`image-source.json` currently selects retained mode: producer run 41696495552, candidate artifact 13266778001 and recovery artifact 13268765077. `resolve-images.mjs` verifies the producer's successful run/workflow/head/repository and both artifacts' immutable IDs, names, digests, expiry and provenance against the reviewed pins. Mismatch, deletion, expiry or changed pins fail closed. No rebuild or upload replaces those images. `download-artifact@v8` uses the verified run/artifact IDs and digest-mismatch:error; the runner then verifies loaded image IDs, layers and archive/schema hashes, including the separately pinned retained identities.

Explicit mode build retains the original build/export/upload path and emits new artifact IDs. It is appropriate for a newly reviewed source or input pair. A changed pin cannot silently reuse old bytes. The existing archive is not mutated by either mode. Artifacts last 14 days and are not permanent recovery storage.

The workflow runs manually or for same-repository PRs touching its listed files. Fork jobs are skipped. Checkouts never persist credentials. Tokens have contents:read and actions:read only, supporting the same-repository cross-run artifact download. No production credentials, registry pushes, Railway actions, deployment branch changes or production queries are included. New report metadata records both the original producer identity and the recheck run/tooling/event identities.

Runtime and gameplay proof

The app keeps its exact default PID1 command node dist/server.js, Node 24.21.0, UID1000 and read-only filesystem. Fixture control is mounted read-only outside /app. App and PostgreSQL use a sole internal bridge with no published ports; host HTTP targets only the inspected private address. PostgreSQL readiness requires an authenticated TCP query and a wrong-password rejection, avoiding its temporary initialization socket. Stops must retire all app database sessions before the next role starts. Diagnostics precede complete container/network cleanup, with synthetic secret redaction.

Seven required scenario groups cover two authenticated players joining the same encounter; known/unattributed Wound damage; exact active state/expiry across candidate-to-recovery handoff; fresh human actions and a natural raid-encounter boss defeat; idempotent action replay; failure after shared HP banking but before match receipt publication; resumed settlement; leaderboard credit; once-only rewards/save versions; and replay of the newly issued recovery command after returning to candidate. The active encounter is prepared last and tested first after recovery starts, with actual clocks/TTLs unchanged. Bounded 503 join/status/active-settlement retries retain their initial statuses and counts; every active settlement attempt checks HP, reward and receipt uniqueness. Exhaustion or other errors still fail.

The helper's ordinary container interface remains one JSON stdin command. A guarded IPC mode supports private host rehearsal only: it requires fork IPC, QUAL_APP_ROOT, the disposable database guard and 127.0.0.1, and adds no network endpoint. Reusing that helper avoids repeated cold imports. These setup commands are not production routes.

After all seven scenarios, exact runtime retirement and cleanup, `isolatedQualification` reports a scoped pass or failure. Missing scenarios, active/replay proof, identities, retirement or cleanup force failure and a nonzero job exit. Immutable build-stage qualified:false flags remain unchanged; railwayImageIdentityVerified and productionReleaseEligible remain false. No broad qualification claim is inferred from a build manifest.

Evidence and limitations

The earlier image run 41696495552 passed six narrower checks, with encounters already done before handoff. Those artifacts/results stay immutable. The expanded host rehearsal passed seven checks on PostgreSQL 16.15/Node 24.15.0 using one compiled implementation for both roles: fresh active handoff at 45.0 seconds, two fresh commands, 10000 damage banked once, 2500 reward once, and exact replay/save/event checks. That validates fixture logic only; the expanded retained-image run is still required.

The suite uses prepared Wound fixtures. Global event victory/top-cache distribution, pet/reflect, simultaneous workers, complete socket/producer/device coverage, intended production build/runtime inputs, actual Railway image identity, durable retention and operational writer/admission/drain proof remain outside this result. The old fixed implementation must not overlap incompatible unfixed writers. No successful isolated check removes #42's release block or authorizes production changes.

Official artifact method: https://docs.docker.com/build/ci/github-actions/share-image-jobs/ and https://github.com/actions/download-artifact .
