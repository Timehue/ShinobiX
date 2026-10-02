# Legacy current-main release

Status: validated for the user's authorized direct-main publication on
2026-10-02. This isolated release began at
`3bc4d138475a16afbf8856d682bd53a1dc63f1a6`, preserved subsequent save-writer and
First Pact updates, and was rebased onto
`4cc0d291b539bd1c0c764602223ab0f001840d84` before publication. The release carries
only this audit's Legacy corrections and evidence. Main's newer mission reward
recovery, run-specific mission receipts and Era/Tower contracts are retained.
Valid paths finishing at level 96+ remain valid.

The release readback reproduced two authenticated world-session requests
overlapping on one battle ID. A losing request overwrote the published winner's
guard roles. [The failing actual-endpoint test](guard-race-before.txt) records
the issue. The correction serializes session/proof publication with a
fail-closed lease, uses immutable NX evidence with exact-role readback, and
binds terminal credit to `worldAttacker.side/name` and the opposing fighter.
NX also protects main's older storage adapter when a request resumes after
lease expiry. No session field or private proof body is added.

Validation completed with Node 24.21.0 and isolated in-memory test storage:

- The complete required unit runner passed **13,054/13,054** tests, with zero
  failures, cancellations or skips: [final full run](release-full-final.txt).
  This run used main `0607d562f9c45f3906f25dfa2e558651f86407bb` plus the Legacy
  patch. The subsequent main changes affected mission reward recovery and
  generated token metadata; no client runtime or dependency changed.
- After rebasing onto `4cc0d291b`, all **441/441** affected mission, settlement
  and Legacy journey tests passed, with zero failures, cancellations or skips:
  [latest-main integration run](release-final-main-missions.txt). Server
  compilation passed again: [latest-main server build](release-final-main-server.txt).
- Focused Legacy handler and roster validation passed **163/163**:
  [focused integration](release-focused-final.txt). The guard publication,
  overlap and expired-lease regressions also passed:
  [guard integration](guard-race-after.txt).
- The actual Card Clash endpoint passed **14/14**, including renewal of full
  opponent credit on the next UTC day: [Card Clash](release-card-clash-final.txt).
  Combat effect ordering and applied PvE facts passed **11/11**:
  [combat regressions](release-combat-order-final.txt).
- Client lint passed with **0 errors and 14 existing warnings**:
  [final lint](release-rebased-lint.txt).
- Server and production-flag client builds, emitted asset validation and the
  unchanged bundle budget passed: [production build](release-rebased-build.txt).
  Budgeted product JS/CSS measured **9,113,019 bytes**; the combined tracked
  product measured **9,879,794 bytes**. The matching production flag lengths
  use public synthetic CI values, without production credentials.

The first release full run exposed four outdated Card Clash/heal-log test
expectations. Those were corrected against the implemented daily decay and
actual HP restored, and the final full run above passed. Earlier failing logs
are historical evidence, not the release result.

No screen/component, Supabase schema, SQL, storage structure, auth or reward
rate is changed by this Legacy patch. No emitted `dist/` is committed. Git
staging and rebasing occurred only in the isolated release checkout; the
shared dirty checkout and the other active game changes were preserved.

The public pre-release `/health` returned `ok: true` at
`f495ac7aec528fe6589a15c68f230784a7c83752`. Publication is followed by remote-main
SHA verification and a fresh public health read. A successful main push and a
verified live cutover are distinct: Railway waits for GitHub checks before
deployment. The final user-facing release report records the observed state.
