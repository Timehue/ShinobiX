# Battle Tower, arena and clan boss behavior — 2026-10-19

## Expected behavior

Entry opens the accepted encounter, recovery restores that same fight, and a
terminal result remains recoverable until its required server writes finish.
Result text and controls describe the mode and saved outcome. Planning another
Tower floor stays in its lobby; leaving returns to the entry origin. Practice
returns to Battle Arena without spending the character's real health. Clan
assaults return to their operation status and bank contribution exactly once.

## Findings and changes

### Fixed: completed clan assaults remained available to rejoin

The real start/settle/recovery handlers reproduced this for both a win and a wipe
against all four clan bosses. Damage and awards were saved, but the shared combat
session still carried pending reward settlement. `/towers/my-run` therefore
continued returning a finished assault as unfinished recovery.

`assault-settle` now projects final settlement under the existing session mutation
lock after delivery. Recovery stops returning the completed operation. A failed
final write retains the run for retry; it cannot re-bank damage or grant awards
twice. Used-supply deductions, participation/victory credit, profession delivery
and party completion must finish before the final marker closes recovery.
The retry message plainly states that contribution is saved but the assault
result still needs finalizing.

### Fixed: clan results described the Tower instead of the assault

Before: `Floor 9001`, `Battle Towers`, `Return to the Tower`, and a Tower reward
paragraph that could remain on `Saving your rewards…` after clan banking finished.

After: the authored boss name, `Weekly Clan Boss`, `Assault ended` (or `Clan boss
defeated` only for a confirmed depleted clan pool), the saved remaining clan
health and `Return to Clan Boss`. The result uses that boss's artwork. Individual
boss and guard visuals continue resolving from their own sealed actors.

An unconfirmed/refused receipt cannot announce saved contribution or clan victory.
The operation status refreshes on return; the old unconditional all-results-saved
flash is removed.

The active-assault leave prompt also names `Clan Hall → Boss` as its recovery
destination. It previously instructed clan players to reopen Battle Towers.
The clan browser journeys now explicitly leave the active view and rejoin the
same accepted operation before testing refresh and settlement recovery.

### Fixed: Tower exit labels implied a lobby return

The result's exit callback leaves the Tower screen and returns to its entry
origin. The labels now say `Leave the Tower` and `Leave the Spire`. The separate
`Plan next floor` action keeps the player in the Tower lobby. Both actions clear
the finished run's active/recovery breadcrumbs.

The Spire's next-floor/conquered message is also withheld until its paid result
is confirmed. A failed or pending settlement no longer announces an unlock.

### Matches expected behavior: arena

Practice entry failure offers Retry or Return; an accepted fight uses the sealed
board and survives reload. Win and loss settlement failures expose Retry. Once
confirmed, both return to Battle Arena and preserve saved HP without admission.
Ranked queue changes remain serialized. Real Express two-player journeys cover
match entry, actions, refresh, terminal results and lost claim/acknowledgement
responses; cancellation releases travel. Participant recovery cannot use browser
Back to abandon an unresolved duel; spectator exits clear their breadcrumb and
return to the spectator origin.

## Verification and scope

- Focused initial Tower/arena/clan lifecycle regression selection: **143 passed**.
- Final clan delivery/recovery selection: **23 passed**. This includes the eight
  real handler cases, an interrupted final write, a missing-save retry, profession
  rules and the shared settled-save writers.
- Clan receipt presentation checks: **3 passed**.
- Real Express desktop/phone PvP journeys: **6 passed**;
  `.tmp/tower-arena-clan-live.log`.
- Arena mounted-App checks: **9 passed, 3 intentional project skips**;
  `.tmp/arena-final-behavior.log`.
- Final combined mounted-App checks: **33 passed, 3 intentional project skips**;
  `.tmp/tower-arena-clan-browser-final.log`.
- Final Tower/Spire/clan checks with the unlock guard and actual clan start shape:
  **12 passed**; `.tmp/tower-clan-confirmed-final.log`.
- A final built-preview clan check also passed, including a decoded, correctly
  identified Oni image. Its result screenshot was visually inspected;
  `.tmp/tower-clan-built-review.log` and
  `shinobij.client/test-results/tower-clan-built-review/`.
- Final built-client Tower/Spire/clan win/loss journeys, including the corrected
  active clan leave prompt and manual rejoin: **12 passed** across desktop and
  phone; `.tmp/tower-clan-last-prompt.log`. The two directly affected lifecycle
  and receipt unit suites also passed again (**13 checks**).
- Build, size budget and distribution verification passed. Full frontend lint
  passed with **0 errors and 23 existing warnings**; changed modules also passed
  targeted lint. Final broader regression/gate results are recorded separately.
- Earlier full Node regression suite: **16,204 passed, 28 skipped, zero failures or
  cancellations**, 16,232 total; `.tmp/tower-arena-clan-full-suite-certified.log`.
- The final server/error-copy recheck completed with **16,202 passed, 2 failed,
  28 skipped**; `.tmp/tower-arena-clan-full-suite-last-copy.log`. Both failures
  were resolved and retested: a second Tower source contract still expected the
  previous leave-warning sentence (**all 14 resilience checks passed** after
  updating that assertion); the unchanged runtime-metrics file passed in
  isolation (**2 passed**) after its wall-clock CPU threshold failed under load
  (`cpu 0.125`). Logs: `.tmp/tower-arena-clan-resilience-final.log` and
  `.tmp/tower-arena-clan-metrics-isolated-retry.log`. No Node failures remain
  unresolved; the timing test's code and thresholds were not changed.
- Strict combat layout gate, rerun on the final prompt-corrected build:
  **20 passed, 10 intentional skips**;
  `.tmp/tower-arena-clan-combat-last-prompt.log`. Solo PvE, PvP and the shared Tower
  shell cover all six browser/DPR projects. The additional real-server party PvE
  and multiplayer PvP authority journeys run once in `chromium-layout`; their
  other five configurations are deliberately skipped by the suite.
- Full seven-project browser matrix: **2,669 passed, 1,003 intentional skips,
  23 failed initially** (3,695 cases). All **23 previously failed cases passed**
  in the closing `--last-failed` run against the final frozen build. Combined
  matrix coverage is **2,692 passed, 1,003 skipped**, with no unresolved cases.
  Logs: `.tmp/tower-arena-clan-smoke-final.log` and
  `.tmp/tower-arena-clan-smoke-retry-final.log`. The whole matrix's immutable
  snapshot preceded the final active-clan leave-prompt correction; that affected
  path also passed the final 12-case built-client journeys and the strict
  combat gate before the closing retry.

Stale test assumptions were corrected during broader validation. The Tower
source contract counted two copies of a recovery control; it now checks one
shared control used by both result layouts (**10 lifecycle checks passed**).
The Awakening builder spec still expected Poison's old tooltip wording; its
updated checks verify duration, capped resource-spend HP damage and free casts
against the current combat rule (**4 passed, 17 intended project skips**).
Gear equip/sale specs now check the corrected weapon and diminishing-return armor
descriptions; both transactions still pass on desktop and phone (**4 passed,
10 intended project skips**).
Tower-menu and story pending-record locators were also updated to the current
mode description and `Retry saving progress` label. These corrections preserve
the underlying entry, save, replay and transaction assertions (**13 passed,
22 intended project skips**). The World News entry assertion now uses its clear
difficulty/contribution wording (**4 passed, 10 intended project skips**).

The full smoke run also exposed a test-harness mismatch after rebuilding:
asset-loading specs read filenames from mutable `dist` while the browser used
its immutable preview snapshot. Four such specs now read their preview's own
manifest (and CSS). The two affected WebKit chunk-recovery cases passed on retry
with real failure injection restored; `.tmp/tower-arena-clan-chunk-retry.log`.
The three related asset/deferred-navigation specs also passed against the final
frozen build on Chromium desktop/phone and WebKit desktop (**34 passed,
5 intentional project skips**); `.tmp/tower-arena-clan-manifest-retry.log`.
Manifest reads occur during test setup, after the preview exists. A clean
collection with an unused preview port and no snapshot folder discovered all
105 cases across the four files. The two setup-adjusted files then passed
again (**28 passed, 5 intentional skips**);
`.tmp/tower-arena-clan-clean-collection.log` and
`.tmp/tower-arena-clan-asset-hooks-final.log`.

A phone-only Inventory assertion also reproduced fractional viewport intersection
rounding (0.9993489). Its 100% intersection check now tolerates the subpixel edge
at 0.999 while retaining the 44px touch-size and actual dismissal checks. All
eight desktop/phone sale and recovery cases passed afterward;
`.tmp/tower-arena-clan-inventory-confirmed.log`. No Inventory product code changed
for this audit.

One mobile WebKit Back/Forward test reported a socket access-control error
during reload after reaching the expected screens. Its unchanged isolated retry
passed (**1 passed**); `.tmp/tower-arena-clan-webkit-navigation-retry.log`.
It also passed again in the closing failed-case retry; this is recorded as transient
browser/mock transport behavior rather than a production fix.

The mounted-App tests use actual hosts, encounter builders, public floor DTOs,
round initialization and navigation. They supply controlled terminal projections
and settlement outages to isolate lifecycle behavior. These are not balance
simulations or complete Tower climbs. The clan handler tests use isolated memory
storage and real start, settlement and discovery handlers for every boss and
outcome. The Express PvP journeys use isolated test accounts and real endpoints.
The clan reload journey follows Clan Hall → Boss → Rejoin your accepted operation;
it verifies manual recovery rather than assuming an automatic fight reopen
(**4 final built-preview cases passed**, desktop/phone × win/loss).
No production accounts or live campaigns are modified.

New regression files: `api/clan-boss/assault-lifecycle.integration.test.ts`,
`shinobij.client/e2e/tower-clan-behavior.spec.ts` and
`shinobij.client/src/lib/clan-boss-result.test.ts`. Practice completion cases were
added to `shinobij.client/e2e/arena-authenticated.spec.ts`.
