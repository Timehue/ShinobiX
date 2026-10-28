# Journey recovery and settlement repairs

Hollow Gate settlement now preserves currency earned from trusted sources outside the active dive. Currency writers record that provenance with the versioned player save; entry/checkpoint-bound refund receipts distinguish returned spending from new income. Bank transfers preserve the same distinction.

Hollow Gate wallet changes also store the pending run effect in the same save write. A retry can recover an uncertain commit exactly once, without paying twice or rewinding newer run state. Settlement receipts and pending operation fields remain server-owned. Starting another dive cannot replace an active run, and delayed client responses must pass the existing account, session, version, and run checks before changing state or navigation.

Clan kick, upgrades, and treasury transfers use current membership and appointed leadership, with authority checked inside the mutation lock. Raw clan saves cannot grant leadership or overwrite authoritative upgrades. Chronicle card-pack purchases preserve the original request identity through ambiguous replies and expose recovery in the Shop, including after reload or when the remaining balance is zero.

Integration retains current main's clan-first transfer locking, source budgets, save ownership protections, and browser settings. The Exchange's two new hover rules now apply only to hover-capable devices, and its generated design-token export includes the new responsive breakpoints. Browser regressions cover delayed onboarding, pack recovery, mission recovery, and flee persistence; the flee fixture reads authoritative saved vitals after its pre-boot achievement initialization.

Validation:

- Full root tests: 10,749/10,749 passed; production build passed; full client lint passed with 14 existing warnings.
- Compiled Express memory certification: 90/90 passed.
- Journey browsers: 10 passed and two existing mobile onboarding skips; both corrected desktop/mobile flee cases then passed separately with zero retries.
- Full strict combat matrix: 20 passed, 10 existing skips, zero retries.
- Full responsive matrix: 662 passed, 511 existing skips, one mobile map hover-setup failure. The unchanged failing case also failed in isolation. Its test helper now re-aims at the live pin position on each poll, retaining actual hover, paint, and timeout assertions. All eight applicable follow-up cases passed across mobile Chromium/WebKit and desktop Chromium/Firefox/WebKit, with 12 existing platform skips and zero retries. The original failure did not record enough geometry to prove the precise timing cause; this follow-up changed test setup only. Focused lint passed.

Both browser matrices and the corrected follow-ups used the same product build: 5,579 files, manifest SHA-256 `170e873155d30a43101647767096cfd5f74ed3985b897bcd065bb98b38de4103`.

Gameplay verification uses isolated local memory storage. This does not certify PostgreSQL persistence or a production MMO load soak.
