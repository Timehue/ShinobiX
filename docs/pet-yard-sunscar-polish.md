# Pet Yard and Sunscar visual refresh

The Pet Yard, Sunscar Festival, and Sunscar Exchange now share the game's painted location artwork, display typography, dark panels, and aged gold accents.

Pet Yard replaces its long management wall with five focused activities: Care, Growth & training, Equipment, Battle & techniques, and Expeditions. One companion roster controls the whole page. Duplicate expedition selectors, obsolete instructions, empty roster placeholders, and decorative emoji labels were removed. Rename, release management, and recent expedition reports are disclosed only when needed. Existing deployment, growth, equipment, training, expedition settlement, and release safeguards remain connected.

Sunscar has illustrated destinations, current daily availability, and a distinct trading quarter. The Exchange has readable item artwork, a restrained category rail, clearer prices, and matching inspection and listing dialogs. Layouts adapt to the game column and phone screens.

## Previews

- [Pet Yard](screenshots/refined-pages/pet-yard-desktop.png)
- [Expeditions](screenshots/refined-pages/expeditions-desktop.png)
- [Equipment](screenshots/refined-pages/equipment-desktop.png)
- [Sunscar Festival](screenshots/refined-pages/sunscar-festival-desktop.png)
- [Trading quarter](screenshots/refined-pages/sunscar-trading-quarter-desktop.png)
- [Sunscar Exchange](screenshots/refined-pages/sunscar-market-desktop.png)
- [Pet care on a phone](screenshots/refined-pages/pet-care-phone.png)
- [Broker reward](screenshots/refined-pages/broker-reward-desktop.png)
- [Broker reward on a phone](screenshots/refined-pages/broker-reward-phone.png)

## Verification

- Production Vite build, TypeScript project check, and ESLint passed.
- Seven existing Pet Yard reliability checks passed.
- Browser flows passed at 1440, 1100, 390, and 320 pixels, covering the five Pet Yard activities, growth drafts, expedition notification entry, market filters, item inspection, buying, listing, and cancellation.
- Axe WCAG A/AA scans reported no violations within the three landing screens at those widths. Browser checks also verified artwork loading, no document overflow, and no uncaught page errors.
- Phone flows were repeated after the final native-control and filter sizing adjustments.

Browser tests use local API fixtures, including transactions, so they do not spend a live player's currency. The focused browser configuration is `shinobij.client/playwright.refined-pages.config.ts`; it expects a local game server at port 5187, or `GAME_QA_URL`.

## Integration and UX follow-up

The second audit fixed these issues:

- Preserved overflow companions can collect existing expeditions, while new departures remain blocked until they return to the carried roster.
- Companion updates run one at a time; rapid rename clicks cannot submit duplicate charges. Changing companions clears the previous nickname draft. Empty rosters have a direct World Map action without irrelevant activity navigation.
- Sunscar destinations open at the top with keyboard focus on their heading. Returning restores the festival position and the destination button. Narrow Pet Yard activity navigation brings the selected controls into view below the mobile HUD.
- The Broker reveal uses the standard game modal, including keyboard containment, background interaction blocking, Escape dismissal, focus return, and reduced motion. Rewards clearly state that they were already credited. The daily crate count follows the current server day.
- Market pagination moves focus to the new results; completed trades bring their confirmation into view. Failed trades retain the saved request for retry.
- Equipment empty-state labels and expedition risk descriptions have readable contrast.
- Equipped collars and arena gear remain removable even when no matching item is in the backpack.

The expanded browser scenarios cover failed training collection and recovery, growth commits, rename double clicks, equipment changes, overflow expedition retry, empty rosters, Rally/Caravan navigation, crate keyboard interaction, unavailable market data, insufficient funds, pagination, missing artwork, and uncertain trade retry. Accessibility scans now include every Pet Yard activity and the market dialogs. Existing battle-readiness and roster-capacity browser scenarios were also rerun.

For the battle-readiness subset, set `GAME_QA_TESTS` to `Pet battle readiness|a base roster` and use the `desktop` project with the same Playwright configuration.

Final follow-up verification passed: production build, TypeScript, ESLint, 80 distinct server/unit checks, eight browser workflow/viewport cases, and two battle-readiness/capacity cases. The deeper integration cases run on desktop and touch; their four duplicates are intentionally skipped at the two extra visual widths. No WCAG A/AA violations were reported by the targeted scans across the five Pet Yard activities, Sunscar hub, market, inspection/sale dialogs, and Broker reward.

## Main release verification — September 18

The release was assembled in an isolated checkout of `b107c26228dbdeebd358fc7f60d9f55f56ae6fdc`, preserving the newer profession and cinematic artwork changes on main. Production `/health` was healthy at `0b51ed81968dd61c6e2d2946094810f728fe1fc0` while that main revision's CI was still running.

The full client/server build, TypeScript, changed-file lint, 80 focused integration tests, four-width browser audit, deployment configuration, and rollback-readiness checks passed on the integrated candidate. Recovery scenarios now also run in the regular Chromium desktop/mobile CI projects; the extended visual case has an explicit timeout for its nine accessibility scans.

Retired roster, expedition-selector, and Exchange seal/tag styling was removed. With the Production Image workflow's public build arguments, product JS/CSS measures **8,647,097 B raw / 2,430,666 B gzip**. The total installed-game ceiling increases from 8.64 to 8.66 MB for the lazy screen presentation and recovery controls. Startup limits are unchanged: the initial graph measures **1,453,747 B raw / 388,326 B gzip**.

Before publishing, the candidate was rebased onto `a9474ece9` (two test-path corrections, with no product changes); all ten affected tests passed. A final cross-browser and Pet Home lifecycle run passed 15 cases across Chromium, Firefox, and desktop/mobile WebKit, including Sanctuary, battle admission, and roster overflow. The 30 inapplicable project/case combinations were skipped intentionally.
