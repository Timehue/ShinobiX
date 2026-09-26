# PvE AI — superseded plan

This file used to hold a 2026-06-18 design for a smarter PvE AI inside the
browser's `Arena.tsx` reducer. That reducer no longer exists: standard PvE runs
on the server's Solo-PvE runtime, and the enemy AI is decided there.

**Read [`docs/pve-ai.md`](pve-ai.md) instead.** It describes the current
architecture, the bracket policy that shipped on 2026-09-25, its tests and
simulation, the compatibility map across modes, and what is deferred.

The old plan is kept only in git history (`git log -- docs/pve-ai-smarter-plan.md`).
Do not implement its phases: its "client-only, no `api/` change" constraint and
its file references are all obsolete.
