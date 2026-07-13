# Public Secret-History Remediation

## Status and verified dry run

Procedure reference: [GitHub — Removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

GitHub secret-scanning alert 1 identifies an OpenAI API key in the deleted file
`ShinobiJ.Server/appsettings.Development.json` as publicly leaked. Revoke the
provider key before rewriting history; a rewrite cannot make a copied secret safe.

On 2026-07-12, an isolated mirror rewrite was completed with the official
`git-filter-repo` v2.47.0 `--sensitive-data-removal` workflow. No remote refs
were modified. The dry run proved:

- 3,176 of 3,177 reachable commits would be rewritten;
- first changed commit: `f316dc14a93aca2ab6ff09e5a8288037fb95fc64`;
- 25 branch refs and six closed pull-request refs are affected;
- no tags, forks, or open pull requests are currently affected;
- the exact leaked file path is absent from every rewritten commit;
- rewritten `main` has the same current tree as production `main`;
- a redacted Gitleaks 8.28.0 rescan found zero OpenAI-key findings;
- the 12 remaining Gitleaks candidates are previously reviewed local-storage
  identifiers and deterministic test tokens, not credentials;
- GitHub push mechanics passed a force/mirror dry run.

The history rewrite is intentionally not performed automatically. It changes
every descendant commit ID, invalidates existing worktrees/clones, breaks old
commit links and signatures, and requires GitHub Support to purge closed-PR and
cached references.

## Preconditions

1. Revoke the exposed OpenAI key in the provider dashboard.
2. Replace Railway's `OPENAI_API_KEY` if it matches the exposed credential and
   verify one bounded admin image operation plus Sentry/cost telemetry.
3. Announce a repository write freeze. Merge or close every open pull request.
4. Confirm there are no forks. Identify every clone, automation checkout, and
   Codex worktree that must be discarded or carefully rebased afterward.
5. Record production `/health`, the active Railway deployment, and all branch
   tips immediately before cloning. Do not reuse the earlier dry-run mirror.

## Rewrite

Run from a fresh temporary directory with `git-filter-repo` 2.47.0 or newer:

```powershell
git clone --mirror https://github.com/Timehue/ShinobiX.git ShinobiX.git
Set-Location ShinobiX.git
git filter-repo --force --sensitive-data-removal `
  --path 'ShinobiJ.Server/appsettings.Development.json' `
  --invert-paths
```

Verify before pushing:

```powershell
git log --all -- 'ShinobiJ.Server/appsettings.Development.json'
git rev-list --objects --all |
  Select-String 'ShinobiJ.Server/appsettings.Development.json$'
```

Both commands must return nothing. Run Gitleaks with redaction against the
rewritten mirror and require zero `openai-api-key` findings. Compare the old and
new `main^{tree}` hashes; they must match, proving the current release contents
did not change.

`git-filter-repo` removes `origin`. Re-add it only after every verification:

```powershell
git remote add origin https://github.com/Timehue/ShinobiX.git
git push --dry-run --force --mirror origin
git push --force --mirror origin
```

Temporarily relax any branch force-push rule or repository multi-ref push limit
only for the scheduled rewrite window, then restore it immediately. GitHub will
reject `refs/pull/*` because those refs are read-only; every branch and tag ref
must succeed, and no other failure is acceptable.

## GitHub server cleanup

Open a GitHub Support sensitive-data-removal request after the push. Provide:

- repository: `Timehue/ShinobiX`;
- first changed commit: `f316dc14a93aca2ab6ff09e5a8288037fb95fc64`;
- six affected closed pull-request refs: 1, 2, 3, 4, 6, and 7;
- no affected forks and no LFS objects;
- confirmation that every writable branch/tag ref was replaced.

Ask Support to remove the closed-PR references, cached views, and unreachable
objects and to run repository garbage collection. History is not fully purged
until that server-side work is confirmed.

## Clone and deployment recovery

1. Discard and freshly clone normal development copies wherever possible.
2. Recreate every Git worktree from the rewritten refs. Never merge an old branch
   into the rewritten history; that can reintroduce the exposed commit.
3. Reconnect Railway/GitHub deployment tracking if it retains an old commit ID.
   Confirm `/health` on the rewritten `main` commit and run the release smoke.
4. Rerun the full test suite and redacted full-history Gitleaks scan from a fresh
   clone.
5. Resolve GitHub secret-scanning alert 1 as revoked only after provider
   revocation is confirmed. Retain repository secret scanning and push protection.

## Rollback boundary

Archive the pre-rewrite ref mapping privately for incident forensics, never as a
public Git ref. Do not roll the remote back to old commits after the force-push;
doing so republishes the secret. If the rewritten repository has a functional
problem, fix forward on rewritten `main` using the identical current source tree.
