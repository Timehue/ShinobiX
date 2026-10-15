# Continuous integration operations

This guide describes the repository-owned Phase 1 CI contract. The workflow
files are the executable source of truth:

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) owns build, test,
  certification, smoke, and browser checks.
- [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml) owns the two
  CodeQL analyses.
- [`required-branch-protection.md`](required-branch-protection.md) defines the
  desired external protection for `main`. Its presence does not prove that the
  GitHub setting has been applied.

## Triggers and cancellation

`CI` runs on GitHub-hosted runners for pull requests, pushes to `main`, and
manual dispatches. Every job that sets up Node reads the version from `.nvmrc`,
the repository's single Node pin, and `scripts/ci-workflow-contract.test.mjs`
fails on any workflow that hardcodes one instead. One concurrency group is
maintained per workflow and ref, and a newer run cancels an older run for that
same ref.

A superseded run may be expected operationally, but a cancelled job is never a
pass. Branch protection must use the completed replacement run. A missing final
summary, zero-test discovery, missing required artifact, or timed-out job is also
a failure.

## Stable CI checks

The job display names below are the workflow-declared GitHub check contexts.
Their first hosted emission is still an external verification item. Rename one
only with the branch-protection migration procedure in this guide.

`scripts/ci-doc-contract.test.mjs` fails when this section stops matching
ci.yml: a row's check name or timeout, a job it leaves out, a matrix's check
names or shard counts, or the number of live Express steps. Change the doc in the
same commit as the workflow.

| Required check context | Job ID | Timeout | Responsibility |
| --- | --- | ---: | --- |
| `CI / server-contracts` | `server_contracts` | 15 min | Fail-closed aggregate over the three root test shards (see below). Locked root install; deployment, rollback, mission, asset, pet-breeding, and tooling contracts; then requires every shard to have succeeded. |
| `CI / server-build-security` | `server_build_security` | 30 min | Locked root install; backup/restore contract, root audit, one server build, checksum/provenance generation, and server artifact production. A high-severity advisory fails the audit at once; only an audit endpoint that returns no verdict is retried, for up to three attempts. |
| `CI / pg-integration` | `pg_integration` | 10 min | Locked root install; runs `kv.compareSetMany` (the multi-key compare-and-set every currency-moving save write commits through) against a real `postgres:16` service container: jsonb equality, `ON CONFLICT ... WHERE`, `FOR SHARE` holds, rollback, opposite-order batches, and lock-lease fencing. The schema is read from `supabase-schema.sql`. `PG_INTEGRATION_REQUIRED=1` fails the job if the suite would skip. Required through `CI / test-build` (see below), not yet as its own context. |
| `CI / client-quality` | `client_quality` | 35 min | Locked root/client installs; shipped pet rig/animation, Warfront/Rally LOD, and Warfront impostor certification ahead of the build; lint, story-content/TypeScript/production build, build-size and visual-baseline-size gates, client audit (with the same retry rule as the root audit), and checksum-backed client artifact production. |
| `CI / release-certification` | `release_certification` | 15 min | Downloads and verifies the exact compiled release artifacts, then runs the fresh-account/combat certification against them. |
| `CI / concurrency-smoke` | `concurrency_smoke` | 15 min | Downloads and verifies the release artifacts, then runs the short real-server concurrent-player smoke. It is not a database capacity test. |
| `CI / e2e-responsive` | `e2e_responsive` | 5 min | Fail-closed aggregate requiring all eight responsive browser shards, including their CSP, Stronghold, and dedicated suites, to succeed. |
| `CI / e2e-combat` | `e2e_combat` | 5 min | Fail-closed stable aggregate requiring all three combat browser shards to succeed. |
| `CI / e2e-warfront` | `e2e_warfront` | 29 min | Warfront positional-mode browser coverage on seven Chromium viewport projects, including renders of eight real skinned rigs, and adaptive-layout evidence. |
| `CI / e2e-village-stores` | `e2e_village_stores` | 35 min | Ten live Express player-journey steps in Chromium, each against its own real server started from the release artifact (see below). |

`CI / release-artifact` (`release_artifact`, 20 minutes) is an internal join that
assembles and verifies the server and client outputs and distribution contract
for downstream jobs. Its ceiling was raised from 10 minutes because downloading,
verifying, packaging, and uploading the joined outputs sometimes took longer on
hosted runners. The build-size contract remains in `CI / client-quality`. The
join is not a separately required context because every required artifact
consumer fails closed if that join or its inputs fail.

The root suite runs as the `server_contracts_matrix` job, with the emitted names
`CI / server-contracts / 1` through `CI / server-contracts / 3`, each with a
29-minute ceiling. Each shard runs `npm run test:ci`, the same runner as
`npm test` without repeating the already-completed client install hook. With
`TEST_SHARD_INDEX` and `TEST_SHARD_TOTAL` set, the runner deals the sorted,
auto-discovered test files round-robin, so every file runs in exactly one shard
and a shard that matches no files fails. A local `npm test` sets neither and runs
everything. The split replaced a single job whose suite took 17 minutes on a fast
runner and was cancelled at 29 minutes on a slow one, before its trailing
contracts ran. On run `32454050576` the slowest shard took 15.9 minutes,
9.6 of them in one Warfront parity test. Runner speed varies by about 1.7x, so
the shards keep the 29-minute ceiling rather than a tighter one. The contracts
run once, in the aggregate: each takes under a minute, and running them in every
shard would only triple them. Require the stable `CI / server-contracts`
aggregate rather than individual shards.

Responsive coverage runs as eight `e2e_responsive_matrix` shards, named
`CI / e2e-responsive / 1-of-8` through `CI / e2e-responsive / 8-of-8`. Each has a
35-minute ceiling, because hosted Playwright browser downloads alone can take
more than 15 minutes on a slow runner. The complete Playwright suite is
partitioned with `--shard=N/8`. Before its slice, shard 1 checks the built CSP in
Chromium and WebKit, and shard 2 runs all three Stronghold modes sequentially.
After their slices, shards 1, 3, 4, and 5 run dedicated suites:

- Shard 1: Pet Gauntlet playback and renderer recovery.
- Shard 3: sector controls and spectator integration; era campaigns and
  admission refresh; the profession scroll purchase and change flow.
- Shard 4: village transfer purchase and recovery; named forge purchase and
  recovery; Rally renderer recovery.
- Shard 5: the Dojo Circuit gamepad flow; fishing and the Fracture Chain;
  Chronicle pack purchase and recovery.

A failed step skips every later check on its shard, so a red shard says nothing
about the suites after the failure. The suite moved from two shards to three
when run `35326317976` exhausted shard 2's budget at test entry 824 of 875, after
its Stronghold checks had passed. It moved to five when three-shard run
`36622735387` exhausted shards 1 and 2 before every browser case ran. Each split
kept the whole suite. It moved to eight after run `38762907081` exhausted
five-way shard 2 near the end of its 665 cases without an assertion failure.
An actual Playwright discovery comparison covered all 3,324 cases exactly once
across the eight slices (416 each in shards 1–4; 415 each in shards 5–8), with
zero missing or duplicate cases. The 35-minute ceiling and all dedicated audits
remain enforced. Require the
stable `CI / e2e-responsive` aggregate rather than individual matrix children.

The actual combat work runs as the `e2e_combat_matrix` job with the emitted names
`CI / e2e-combat / chromium`, `CI / e2e-combat / firefox`, and
`CI / e2e-combat / webkit`. Each shard has a 29-minute ceiling and retains its own
Playwright and layout evidence. Require the stable `CI / e2e-combat` aggregate,
not each matrix child, so future safe sharding changes do not silently rename the
branch-protection contract.

`CI / e2e-village-stores` keeps the name of its first journey, the Village Stores
economy loop, but it now runs ten live Express steps in Chromium. Each step
starts its own real server from the release artifact with a fresh in-memory
store, so each step gets its own budget under the real registration limit of 25
accounts per IP per 15 minutes. The steps are:

- Village Stores economy, Academy persistence, and server route wiring (desktop).
- Defeat, landing, and daily-login recovery: one step on desktop, one on mobile.
- The hospital ward and the roaming Weekly Boss (desktop and mobile).
- Authored missions (desktop and mobile).
- PvP cancellation and settlement, the ranked queue, and Kage challenges
  (desktop and mobile, realtime).
- Gathering, recipes, crafting settlement, and wild pet binding (desktop and
  mobile, realtime).
- Exchange and sector-war player journeys (desktop).
- Two-client sector presence and tavern push (realtime). The desktop project
  drives a desktop client, and each spec opens its own phone client.
- The Hollow Gate "Send pet" duel (desktop and mobile).

Realtime steps turn on the server's Socket.IO transport, which the other steps
leave off. The ceiling went from 30 to 35 minutes on 2026-10-10, after fifteen
green runs took 21.8 to 25.9 minutes, to make room for the presence step. On
2026-10-13 and 14, before the Hollow Gate step joined, 24 green runs took 23.3
to 28.5 minutes; that step's four cases took 1.6 minutes locally.

`CI / test-build` (`test_build`, 5 minutes) is the compatibility aggregate for
the former monolithic check. Keep it required while branch protection migrates
to the split contexts. It performs no substitute testing: it succeeds only when
all split jobs it depends on succeeded.

`CI / pg-integration` was added after the ten contexts above were made required.
It gates merges through `CI / test-build`, which lists it in `needs`. Adding it
to the protection rule directly is optional, and it follows the rollout below:
only after GitHub has observed the context on a real run.

The separate path-filtered `Clan Boss operation certification / certify` and
manual-only `Visual regression (manual) / visual` workflows remain useful
evidence, but they must not be globally required on every pull request because
they do not run for every change.

## Real Postgres tests locally

Use Postgres 16 binaries (`initdb` and `pg_ctl`) to match the hosted service.
An existing installation or the [official Windows portable binaries](https://www.enterprisedb.com/download-postgresql-binaries)
work; this command does not install software or register a system service.
From the repository root, after installing the root and client dependencies:

```powershell
npm run test:ci:postgres -- --pg-bin=.tmp/pg-local/pgsql/bin
```

Replace `--pg-bin` with your binaries directory. The helper creates a fresh
cluster beneath workspace `.tmp`, uses a random password with SCRAM authentication,
binds only `127.0.0.1` on an automatically selected port, and runs the same full,
unsharded runner as `test:ci` with `PG_INTEGRATION_REQUIRED=1`. It stops the server
and removes its temporary cluster afterward. It never uses an existing database
URL. Add `--integration-only` to run just the 14 storage integration tests.

Two additional modes use the same isolated cluster and the canonical KV table
and function definitions from `supabase-schema.sql`:

```powershell
npm run test:ci:postgres -- --pg-bin=.tmp/pg-local/pgsql/bin --stronghold-multiplayer
npm run test:ci:postgres -- --pg-bin=.tmp/pg-local/pgsql/bin --underground-api
```

The multiplayer mode exercises separately authenticated mobile browsers, both
strongholds, reward settlement/replay, and 24 concurrent players per stronghold.
It requires the existing client Playwright dependencies and browsers.
`--output=PATH` selects its evidence directory relative to `shinobij.client`.
The API mode runs the eight Anbu async/queue cases and seven cave traveler/collision
cases in separate fresh databases. Direct SQL checks prove persistence;
queued telemetry drains before storage closes. Ordinary auto-discovered API
tests retain their isolated memory mode unless this dedicated fixture is enabled.

The ordinary `npm run test:ci` still skips these optional local tests unless
`PG_INTEGRATION_DATABASE_URL` is supplied. The hosted `CI / pg-integration` job
already supplies its disposable service and requires the tests; its workflow
and assertions are unchanged.

## CodeQL checks

The advanced CodeQL workflow has two independent, stable contexts:

- `CodeQL / Analyze (javascript-typescript)`
- `CodeQL / Analyze (actions)`

Both run on pull requests and pushes to `main`, on manual dispatch, and on the
weekly schedule. Both are required by the desired branch policy. A green workflow
run is evidence for that revision; it is not proof that the repository's default
setup, ruleset, or alert inventory is configured correctly. Those are external
GitHub settings and must be inspected by an authorized operator.

The check is green when the analysis succeeds, whether or not GitHub accepts the
upload. On 2026-10-10 the repo was private on a free plan for about an hour, and
code scanning was switched off: every upload got a 403, the check went red, and
Railway cancelled every rollout. Since then the analysis runs with `upload: never`, and
a separate `continue-on-error` step tries the upload. That step resumes on its
own when code scanning is available again. Each run also keeps its SARIF as a
`codeql-sarif-*` artifact for 7 days, best effort, so a full storage quota
cannot redden the check. A red upload step inside a green check
means code scanning is still off. Check it with
`gh api repos/Timehue/ShinobiX/code-scanning/default-setup`.

If production Python is added outside the excluded offline script area, add a
Python analysis deliberately and migrate branch protection only after its check
context has completed successfully at least once.

## Build reuse and evidence retention

CI builds the server and client once, packages each output as a tar archive, and
records a SHA-256 sidecar. Artifact consumers verify the digest before running.
The names bind revision, run, and run attempt:

- `server-dist-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}`
- `client-dist-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}`
- `release-dist-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}`

Build artifacts are retained for 14 days. Every split, internal, and aggregate
job uploads an always-produced evidence bundle named
`evidence-<job>-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}`
for 14 days. Combat shards use
`evidence-e2e-combat-<shard>-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}`.
The stable combat aggregate uses
`evidence-e2e-combat-aggregate-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}`.
Dependency jobs run with `always()` and explicit upstream-result guards, so an
upstream red becomes an explicit downstream red with retained provenance instead
of silently skipping the required context.
Browser evidence includes the relevant Playwright reports and `test-results`;
Warfront additionally retains the repository-root
`.playwright-mcp/aaa-adaptive`. Combat retains its layout captures. Evidence
upload does not turn a failed test into a pass.

Fourteen-day Actions retention is a triage window, not a release archive or a
backup. Evidence needed for an incident, release decision, or audit must be copied
to the approved durable evidence store before expiry, without credentials or
player data.

## Triage procedure

1. Confirm the exact SHA and run attempt. Do not combine steps from different
   attempts or treat a superseded/cancelled run as green.
2. Open the first failed required job and verify that its test command produced a
   non-zero test count and a final summary. A timeout or missing summary is the
   primary failure, even when earlier steps were green.
3. Download that job's evidence bundle. For artifact-consuming jobs, also verify
   that the expected server/client archive and SHA-256 sidecar exist.
4. Reproduce with the command printed by the failed step, using the Node
   version pinned in `.nvmrc` and the locked install for that package. Do not
   weaken, skip, or silently move the failing gate.
5. For browser failures, inspect the Playwright report, trace, screenshots, video
   when present, and the job-specific layout evidence before changing a baseline.
   Snapshot regeneration requires a diagnosed, intentional UI change.
6. For an apparent runner or network failure, rerun the failed job as a new run
   attempt and retain both attempts. Repeated infrastructure failures still need
   a workflow fix; they are not a product pass. **On `main`, a rerun does not
   revive the deploy.** Railway reads the check suite once; if it was red, the
   rollout is skipped permanently and a later green attempt never re-triggers it.
   The signature is the `Railway App` check suite sitting at `queued`/null,
   timestamped at the original push, while every GitHub Actions suite reads
   success (`gh api repos/OWNER/REPO/commits/SHA/check-suites`). Recovery is a
   manual Redeploy in the Railway dashboard, or a new commit re-tipping `main`.
   Confirm with `curl -fsS https://shinobijourney.com/health` and compare the
   `commit` field; do not treat a green `Post-deploy health` as that evidence,
   because it self-skips to success while `PRODUCTION_URL` and
   `HEALTH_DEEP_TOKEN` are unset.
7. After a fix, require the entire affected stable check to finish. Use the
   compatibility aggregate only as migration protection, never as evidence that
   an omitted split job ran.

Useful read-only commands for an authorized GitHub session are:

```text
gh run list --workflow CI --limit 20
gh run view <run-id> --log-failed
gh run download <run-id> --dir <empty-evidence-directory>
```

## Time-budget policy

Every ordinary job has a hard timeout below 36 minutes, and
`scripts/ci-workflow-contract.test.mjs` fails on any that is not. Each timeout is
a ceiling, not a target. If a required job nears its ceiling, split or shard the
work and preserve coverage; do not restore the old 45-minute serial job or raise
a timeout without a measured, documented reason.

`e2e-warfront` moved from 20 to 29 minutes on 2026-09-09 under that rule. Its
measurement: green runs took 14m09s and 16m50s, and the run that carried the
change took 19m09s, leaving 51 seconds under the old ceiling. Within it,
`model-resource-lifecycle.spec.ts` costs 170s, 208s and 218s across those runs
on `desktop` and `phone` because every one of its ~40 samples is gated on eight
rendered frames of eight skinned rigs, so its budget is 360s rather than 180s.
Both numbers are ceilings over a rising measurement, not targets; if the spec
passes ~250s again, shard or reduce its cycles rather than raise them further.

The bound itself was 30 minutes until 2026-09-04, when both npm audit steps
gained a three-attempt retry. One failing attempt can spend about 5 minutes in
npm's own retrying, so `server-build-security` went from 15 to 30 minutes and
`client-quality` from 20 to 35, and the bound moved to 36 to fit them. The
responsive shards and `e2e-village-stores` have since reached 35 for the measured
reasons recorded under [Stable CI checks](#stable-ci-checks). The root test
shards, the combat shards, and `e2e-warfront` remain at 29.

The compatibility aggregate and the responsive and combat aggregates are
intentionally short, at 5 minutes, because they only read upstream results. The
internal artifact join has 20 minutes because it downloads, verifies,
repackages, and uploads both build outputs. Staging/database capacity, restore,
and multi-human exercises remain operator gates outside this credential-free
workflow and must not be inferred from the local concurrency smoke.

## Required-check rollout

1. Land the split workflow while retaining `CI / test-build`.
2. On a pull request, verify that every split context in
   [Stable CI checks](#stable-ci-checks) and both CodeQL contexts appear and
   complete with their exact documented names.
3. Add the new contexts to the `main` protection rule while retaining
   `CI / test-build`. Do not add a context before GitHub has observed it, or pull
   requests can remain stuck at “Expected”.
4. Require the branch to be up to date, and observe at least one normal pull
   request and one `main` run through the new policy.
5. Remove `CI / test-build` from the required list only after the split contexts
   are proven stable, and only after adding `CI / pg-integration`, which is
   required solely through it today. The compatibility job can be removed in a
   later reviewed workflow change.
6. Record the ruleset/protection identifier, operator, date, and resulting exact
   required contexts in [`required-branch-protection.md`](required-branch-protection.md).

## Required-check rollback

If the migration itself blocks merges because a context was renamed, never
emitted, or wired incorrectly, keep or restore `CI / test-build`, remove only the
broken new context from the external required list, repair the workflow, obtain a
real green run, and repeat the rollout. Do not remove a required context merely
because its underlying tests fail.

If the split workflow must be reverted, revert workflow and protection changes as
one coordinated operation so `main` is never left requiring a context that no
workflow emits. Emergency administrator bypass is reserved for repository
recovery, must be narrowly scoped, and must be recorded. It is not a substitute
for green evidence.
