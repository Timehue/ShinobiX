# Unmapped Coast painting masters

The seven `coast-*` folders beside this file hold the source of the coast's art. Their PNG masters (161 files, 355 MB) are **not in git**: `.gitignore` leaves them out, because the game never loads them and the repository's size has already broken deploys. What is tracked in each folder is its README, its prompts, its delivery receipt with the shipped files' sizes and hashes, and the script that exports the WebPs.

The game ships the exported WebPs under `shinobij.client/public/` and `shinobij.client/src/assets/`. Those are in git and are all the build needs. No test and no CI job reads a master.

## Where the masters are

On the owner's machine, outside every checkout and worktree:

```
C:\Users\Tyler R\source\repos\NinjaK-art-masters\unmapped-coast\<folder>\...
```

That copy was made on 2026-11-22 and checked file by file against the originals by hash. It is the only copy once the worktree that painted them is removed, so it should be backed up somewhere off the machine.

## To re-export a painting

Copy the folder's masters back to the same paths here, then run that folder's `export.cjs` as its README describes. The delivery receipt's hashes say whether the result matches what shipped.
