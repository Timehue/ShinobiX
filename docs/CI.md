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

`CI` runs for pull requests, pushes to `main`, and manual dispatches. It pins
Node `22.23.1` on GitHub-hosted runners. One concurrency group is maintained per
workflow and ref, and a newer run cancels an older run for that same ref.

A superseded run may be expected operationally, but a cancelled job is never a
pass. Branch protection must use the completed replacement run. A missing final
summary, zero-test discovery, missing required artifact, or timed-out job is also
a failure.

## Stable CI checks

The job display names below are the workflow-declared GitHub check contexts.
Their first hosted emission is still an external verification item. Rename one
only with the branch-protection migration procedure in this guide.

| Required check context | Job ID | Timeout | Responsibility |
| --- | --- | ---: | --- |
| `CI / server-contracts` | `server_contracts` | 29 min | Locked root/client installs; the complete root auto-discovered suite and deployment, rollback, mission, asset, pet-breeding, and tooling contracts. CI uses `npm run test:ci`, the same runner as `npm test` without repeating the already-completed client install hook. |
| `CI / server-build-security` | `server_build_security` | 15 min | Locked root install; backup/restore contract, root audit, one server build, checksum/provenance generation, and server artifact production. |
| `CI / client-quality` | `client_quality` | 20 min | Locked root/client installs; lint, story-content/TypeScript/production build, build-size and visual-baseline-size gates, client audit, and checksum-backed client artifact production. |
| `CI / release-certification` | `release_certification` | 15 min | Downloads and verifies the exact compiled release artifacts, then runs the fresh-account/combat certification against them. |
| `CI / concurrency-smoke` | `concurrency_smoke` | 15 min | Downloads and verifies the release artifacts, then runs the short real-server concurrent-player smoke. It is not a database capacity test. |
| `CI / e2e-responsive` | `e2e_responsive` | 20 min | Cross-browser responsive and accessibility coverage on Chromium, Firefox, and WebKit. |
| `CI / e2e-combat` | `e2e_combat` | 5 min | Fail-closed stable aggregate requiring all three combat browser shards to succeed. |
| `CI / e2e-warfront` | `e2e_warfront` | 20 min | Warfront positional-mode browser coverage and adaptive-layout evidence. |

`CI / release-artifact` (`release_artifact`, 10 minutes) is an internal join that
assembles and verifies the server and client outputs and distribution contract
for downstream jobs. The build-size contract remains in `CI / client-quality`.
The join is
not a separately required context because every required artifact consumer fails
closed if that join or its inputs fail.

The actual combat work runs as the `e2e_combat_matrix` job with the emitted names
`CI / e2e-combat / chromium`, `CI / e2e-combat / firefox`, and
`CI / e2e-combat / webkit`. Each shard has a 29-minute ceiling and retains its own
Playwright and layout evidence. Require the stable `CI / e2e-combat` aggregate,
not each matrix child, so future safe sharding changes do not silently rename the
branch-protection contract.

`CI / test-build` (`test_build`, 5 minutes) is the compatibility aggregate for
the former monolithic check. Keep it required while branch protection migrates
to the split contexts. It performs no substitute testing: it succeeds only when
all split jobs it depends on succeeded.

The separate path-filtered `Clan Boss operation certification / certify` and
manual-only `Visual regression (manual) / visual` workflows remain useful
evidence, but they must not be globally required on every pull request because
they do not run for every change.

## CodeQL checks

The advanced CodeQL workflow has two independent, stable contexts:

- `CodeQL / Analyze (javascript-typescript)`
- `CodeQL / Analyze (actions)`

Both run on pull requests and pushes to `main`, on manual dispatch, and on the
weekly schedule. Both are required by the desired branch policy. A green workflow
run is evidence for that revision; it is not proof that the repository's default
setup, ruleset, or alert inventory is configured correctly. Those are external
GitHub settings and must be inspected by an authorized operator.

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
4. Reproduce with the command printed by the failed step, using Node 22 and the
   locked install for that package. Do not weaken, skip, or silently move the
   failing gate.
5. For browser failures, inspect the Playwright report, trace, screenshots, video
   when present, and the job-specific layout evidence before changing a baseline.
   Snapshot regeneration requires a diagnosed, intentional UI change.
6. For an apparent runner or network failure, rerun the failed job as a new run
   attempt and retain both attempts. Repeated infrastructure failures still need
   a workflow fix; they are not a product pass.
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

Every ordinary job has a hard timeout below 30 minutes. The 29-minute budgets on
root contracts and combat E2E are ceilings, not targets. If a required job nears
its ceiling, split or shard the work and preserve coverage; do not restore the old
45-minute serial job or raise a timeout without a measured, documented reason.

The internal artifact join and compatibility aggregate are intentionally short.
Staging/database capacity, restore, and multi-human exercises remain operator
gates outside this credential-free workflow and must not be inferred from the
local concurrency smoke.

## Required-check rollout

1. Land the split workflow while retaining `CI / test-build`.
2. On a pull request, verify that all eight split contexts and both CodeQL
   contexts appear and complete with their exact documented names.
3. Add the new contexts to the `main` protection rule while retaining
   `CI / test-build`. Do not add a context before GitHub has observed it, or pull
   requests can remain stuck at “Expected”.
4. Require the branch to be up to date, and observe at least one normal pull
   request and one `main` run through the new policy.
5. Remove `CI / test-build` from the required list only after the split contexts
   are proven stable. The compatibility job can be removed in a later reviewed
   workflow change.
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
