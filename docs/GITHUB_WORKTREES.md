# Isolated GitHub publishing

Every task gets its own branch and filesystem directory. This prevents a push,
rebase, build, or cleanup from changing the checkout used by another task.

## Start a task

From any checkout of this repository:

```powershell
powershell -File scripts/new-github-worktree.ps1 -Name mission-rewards
```

This fetches `origin`, creates `codex/mission-rewards` from `origin/main`, and
checks it out under the sibling `NinjaK-worktrees` directory. Do all edits,
builds, commits, rebases, and conflict resolution inside the printed path.

Use `-Base <ref>` when the task must start somewhere other than `origin/main`.
Names and paths must be unique because Git permits a branch to be checked out in
only one worktree.

## Publish a task

From the task's worktree:

```powershell
powershell -File scripts/push-github-worktree.ps1 -DryRun
powershell -File scripts/push-github-worktree.ps1
```

The publisher pushes the current commit with an explicit refspec. It never
switches branches, stashes files, merges, resets, or changes another worktree.
It refuses dirty worktrees by default and never force-pushes. A rejected push is
resolved in the same task worktree, usually with:

```powershell
git fetch origin
git rebase origin/main
powershell -File scripts/push-github-worktree.ps1
```

For a deliberately detached checkout, supply the destination explicitly:

```powershell
powershell -File scripts/push-github-worktree.ps1 -Branch codex/mission-rewards
```

## Retire a finished task

Run removal from a different checkout after the branch is merged and the task
worktree is clean:

```powershell
git worktree remove C:\path\printed\when\created
git branch -d codex/mission-rewards
git worktree prune
```

Do not use `--force` for routine cleanup: an unclean worktree may belong to an
active task.
