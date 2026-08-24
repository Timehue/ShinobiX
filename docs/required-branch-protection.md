# Required protection for `main`

Status: **desired external policy; application not verified**

This file defines the Phase 1 protection contract for `main`. Repository files
cannot prove GitHub branch-protection or ruleset state. No local inspection in
this worktree established that these settings are enabled, and this document
must not be cited as proof that they are applied.

See [`CI.md`](CI.md) for job responsibilities, artifacts, triage, and the
required-check migration procedure.

## Required status contexts

Require these checks, with “branch must be up to date before merging” enabled:

- `CI / server-contracts`
- `CI / server-build-security`
- `CI / client-quality`
- `CI / release-certification`
- `CI / concurrency-smoke`
- `CI / e2e-responsive`
- `CI / e2e-combat`
- `CI / e2e-warfront`
- `CI / e2e-village-stores`
- `CodeQL / Analyze (javascript-typescript)`
- `CodeQL / Analyze (actions)`

During migration, also require `CI / test-build`. Remove that compatibility
context only after GitHub has observed every split context, all ten permanent
contexts have completed successfully on a pull request, and at least one merged
revision has completed them on `main`.

Do not globally require `CI / release-artifact`; it is an internal dependency of
required consumers. Do not globally require the path-filtered Clan Boss workflow
or manual visual workflow, because an unrelated pull request does not emit those
contexts.

## Exact policy settings

Configure a branch rule or ruleset targeting the exact branch `main`:

| Setting | Required value |
| --- | --- |
| Require a pull request before merging | Enabled |
| Required approving reviews | 1 |
| Dismiss stale approvals on new reviewable commits | Enabled |
| Require approval of the most recent reviewable push | Enabled |
| Require conversation resolution before merging | Enabled |
| Require status checks | Enabled, using the exact contexts above |
| Require branches to be up to date before merging | Enabled |
| Allow force pushes | Disabled |
| Allow branch deletion | Disabled |
| Permit direct pushes to `main` | Disabled except the documented emergency administrator path |
| Bypass actors | Repository administrators only, for emergency recovery |
| Require successful deployments | Disabled until a stable staging deployment context exists |

The repository currently has no `.github/CODEOWNERS` file. Consequently,
“Require review from Code Owners” cannot yet provide sensitive-path ownership and
must not be represented as active protection. A later reviewed change should add
owners for authentication, storage, economy, combat settlement, workflow, and
migration paths; enable Code Owner review only after that file is present and its
teams/users are valid for the repository.

No approval count, bypass use, or required check may be weakened merely to merge
a failing product change. Emergency bypass is for recovery from a broken external
rule or unavailable check context, must be limited to administrators, and must be
recorded with the SHA, operator, reason, and follow-up repair.

## Safe rollout

1. Merge or otherwise make the split workflow observable while the existing
   `CI / test-build` requirement remains in force.
2. Confirm on an actual pull request that GitHub emits all eight split CI checks
   and both CodeQL checks with the exact spelling above.
3. Add the ten permanent contexts to the protection rule and retain
   `CI / test-build` temporarily.
4. Enable strict up-to-date branches, review requirements, conversation
   resolution, and force-push/deletion restrictions.
5. Verify one pull request merge and its subsequent `main` run without bypass.
6. Remove only the `CI / test-build` requirement. Keep the compatibility workflow
   job until a separate reviewed cleanup confirms no integration still depends on
   the old context.

Adding a required context before GitHub has observed it can leave pull requests
permanently waiting for an “Expected” check. Apply context changes in the order
above.

## Rollback

If protection references a renamed or missing new context, restore or retain
`CI / test-build`, remove only the non-emitting new context, fix the workflow, and
repeat the rollout after a real successful run. Coordinate any workflow revert
with the external required-context list so GitHub never requires a check that the
active workflow cannot emit.

Do not use this rollback procedure for a genuine test, security, audit, or browser
failure. Fix that failure and obtain green evidence.

## External verification record

An authorized operator must inspect GitHub and replace the unknowns below only
after observing the settings. Until then they remain explicitly unverified.

| Item | Current record |
| --- | --- |
| Branch-protection or ruleset identifier | Unknown / not inspected |
| Policy applied | Unknown / not inspected |
| Required contexts match this file | Unknown / not inspected |
| Strict up-to-date requirement enabled | Unknown / not inspected |
| Force pushes and deletion disabled | Unknown / not inspected |
| Administrator bypass scope | Unknown / not inspected |
| CodeQL default/advanced setup state | Unknown / not inspected |
| Verified by / date | Not recorded |

Read-only inspection examples for an authorized GitHub CLI session:

```text
gh api repos/Timehue/ShinobiX/branches/main/protection
gh api repos/Timehue/ShinobiX/rulesets
gh api repos/Timehue/ShinobiX/code-scanning/default-setup
```

After applying or changing protection, record the returned rule/ruleset ID and
the exact contexts GitHub reports. Do not mark this document “applied” based on a
local file change or an unverified operator instruction.
