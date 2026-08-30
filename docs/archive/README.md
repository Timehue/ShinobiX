# docs/archive — point-in-time records

These files are **historical snapshots**, not current guidance. Do not treat
anything here as describing how the system works today — read the live docs
(`../`, `../../CLAUDE.md`, `../../RAILWAY_SETUP.md`) instead.

Kept only for audit trail. Safe to delete wholesale once the history is no
longer interesting.

## beta-2026-07/

A single July 2026 documentation sweep (the "Beta Patch 1" cluster): ~25
point-in-time audit reports written in adjacent commits that changed no game
code (`BETA_PATCH_1_RECOMMENDATION` states outright "Balance And Economy Values
Changed: None"). Every balance number in them is invalidated by the pending
pre-launch data wipe. Superseded by the live `docs/BETA_LIVE_OPERATIONS.md` and
`docs/BETA_RELEASE_CERTIFICATION.md`.

## root-audits-2026-08/

Seventeen audit, handoff, map and report files that had accumulated at the
REPOSITORY ROOT, moved here in August 2026. They were the bulk of what a visitor
saw when opening the repo — twenty-one markdown files at root, of which only six
were live guidance.

They are archived rather than deleted because the audit trail is occasionally
useful, but nothing depends on them. Before moving, every one was checked: no
test, no workflow and no script reads any of them, and there is not a single
markdown LINK to any of them anywhere in the tree — the only mentions are prose.

Most of the cluster was already citing only itself. `HARDENING_PROGRESS.md` had
zero inbound references while itself pointing at seven of the others, so
`ARCHITECTURE_MAP`, `COMBAT_REGRESSION_MATRIX`, `ECONOMY_FLOW_MAP`,
`ITEM_CREATION_MAP`, `PERFORMANCE_AUDIT`, `SCALING_AUDIT`, `SECURITY_AUDIT` and
`SOURCE_OF_TRUTH_AUDIT` were reachable only through a document nothing pointed
at. `CODEX_AAA_HANDOFF`, `FULL_GAME_SIMULATION_REPORT`,
`MISSION_ELIGIBILITY_FIX_REPORT` and `PERFORMANCE_LOADING_AUDIT_2026-07-10` had
no inbound references at all.

`COMBAT_PARITY_AUDIT.md` is the one worth flagging: two LIVE docs still mention
it, and both mention it to say it is wrong.
`docs/architecture/verified-mode-authority.md` records that "both the diagnosis
and proposed owner are stale", and `docs/aaa-program-status.md` notes it is
"bannered as superseded". Those references still read correctly with the file
here.

What deliberately STAYED at root, and why: `README.md` and `CLAUDE.md`;
`RELEASE_CHECKLIST.md` and `FEATURE_FLAG_RELEASE_MATRIX.md`, both named in
`.github/workflows/clan-boss-operation.yml` path filters, so moving them would
silently change which pushes run that certification;
`PUBLIC_BETA_LAUNCH_RECOMMENDATION.md`, still cited by
`docs/LIVE_PRODUCT_STATUS.md`; and `RAILWAY_SETUP.md`, which documents the live
host.
