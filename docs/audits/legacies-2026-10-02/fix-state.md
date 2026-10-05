# Legacy audit correction work

Status: Legacy corrections and release validation completed. The user
authorized checking and pushing live main. The [release record](release.md)
owns current-main validation; the [correction record](resolution.md) owns the
resulting behavior and historical failure evidence. Original audit artifacts
preserve the before state.

Confirmed decisions: preserve accepted identities, completed stage receipts
and earned totals. Keep valid paths that finish at level 96+. Use current
server authorities, sealed combat facts and existing storage shapes. Recheck
eligibility before first acceptance; retain sealed replay. Rotate offers,
disclose activity families, provide non-PvP trials for paths without mandatory
PvP qualification, and renew opponent attribution each UTC day.

Completed: acquisition audit fixes, generated roster, authoritative combat
and Dungeon credit, recovery receipt retention, and handler-level integration
readback. Guard evidence is recorded before session publication; immutable NX
proof and exact-role readback prevent a losing or expired creator from
reversing the winner's roles. Later map notification cannot overwrite it.
Terminal delivery validates the ordered server-sealed attacker and opposing
fighter. No new persisted PvP field, storage structure, SQL or auth change was
introduced.

The isolated release preserved newer main changes through
`4cc0d291b539bd1c0c764602223ab0f001840d84`. Its complete unit runner passed
13,054/13,054, followed by 441/441 affected checks after the final rebase.
Focused Legacy integration passed 163/163. Final lint reported 0 errors and
14 existing warnings. Server compilation, production client build, emitted
asset checks and the unchanged bundle budget passed. See the release record
for exact test scope and raw evidence. No active local jobs remain.

The main game audit independently owns the combined uncommitted game changes
in the shared checkout and their broader build/browser gates. Those changes
are outside this release. Git staging, reset, stash and rebase operations did
not alter that shared checkout. The Legacy shared source/test/asset cutoff
and completed release checks were sent to that owner.

The direct-main publication uses the clean isolated branch. The final release
response records the pushed SHA and observed deployment state; successful
push alone does not establish that Railway has finished its cutover.
