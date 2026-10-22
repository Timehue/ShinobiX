# iPhone installation and Safari usability audit — October 22, 2026

## Changes

- Added an expandable **Play on iPhone or iPad** guide below the landing-page play actions and in Settings. It covers Safari, Share, Add to Home Screen, Open as Web App, reopening the game, existing accounts, internet access, and protecting guest progress. Installed Apple web apps show an installed-state explanation. The Android Play shell does not show this promotion.
- Set the Apple Home Screen title to **Shinobi**, using the existing Apple touch icon and standalone manifest.
- Increased ordinary mobile paragraph/list/form text from 15px to 16px, bottom-navigation captions from 10px to 12px, and destination-menu labels from 13px to 15px. Menu rows now have a 60px minimum height.
- Reflowed portrait-phone status into two rows. HP, Chakra and Stamina have named, 20px-tall bars with 12px text across the full width. The 96px header clearance follows the same shared shell contract as the visible header. Short landscape retains its existing composition.
- Added left/right safe-area clearance to ordinary pages, the persistent status bar and Tavern.
- Made chat follow the VisualViewport while a text field is focused and a keyboard-sized viewport reduction is present. The bottom navigation hides while typing; the Tavern artwork/gossip yields to a compact room heading, village exit and composer. Pinch zoom is excluded from keyboard detection. Listeners, root attributes and CSS properties are cleaned up when the viewport hook unmounts.
- Removed the older theme rule that forced Tavern height back to `auto !important`, overriding keyboard-aware sizing. The landscape recheck also found and removed the facility back button's extra header margin while typing.

## Coverage

Playwright uses the real client with isolated, mocked API/save responses. No production player accounts or live data were changed. Normal effects are enabled in the dedicated audit; service workers are blocked to keep its network fixtures deterministic.

| Profile | Engine | CSS viewport |
| --- | --- | --- |
| Small iPhone / SE | WebKit | 320 × 568 |
| iPhone 13 | WebKit | 390 × 664 |
| iPhone 13 Pro Max | WebKit | 428 × 746 |
| iPhone landscape | WebKit | 750 × 342 |
| iPad Mini | WebKit | 768 × 1024 |
| Android / Pixel 5 | Chromium | 393 × 727 |

The device descriptors reserve space for browser chrome; these are content viewport sizes, not hardware screen resolutions. Rotation checks also resize to 844 × 390 and back to 390 × 844.

The broad Safari screen audit passed **38 checks**: 31 game routes plus five Central dialogs and two Central destinations. Checks cover horizontal overflow, clipped or undersized controls, missing visible art, meaningful content and runtime errors. Screens include inventory, profile, training, missions, world map, clan, Town Hall, economy, story, pets, chat, messages, professions and guides.

The initial device matrix exposed a landscape chat-composer overflow. The corrected keyboard test passed on all six profiles. The full-width resource-bar correction also passed on all six, with an explicit label-clipping assertion.

Initial audit validation:

- **42/42** installation, Home Screen state, resource readability, rotation, keyboard, menu, Android-shell exclusion and sign-in checks passed across the six profiles.
- **38/38** broad mobile Safari route/dialog checks passed.
- **10/10** additional portrait/landscape visual checks passed for Village, Training, Jutsu Training, world map and pets. Screenshots were captured and representative map/menu/resource/guide/keyboard images inspected.
- **9/9** existing combat HUD checks passed in mobile WebKit against an immutable production-build snapshot, including phone HUDs, jutsu cooldown visibility, zoom and populated action-card accessibility. These are HUD fixtures, not live multiplayer battle certification.
- **37/37** focused CSS, adaptive-layout, mobile navigation and audio checks passed; **28/28** platform/layout checks also passed. The final shell-only recheck passed **12/12**. These groups overlap and are not added into a unique unit-test total.
- Client TypeScript checking, lint on changed implementation/audit files, story-content consistency, production Vite build and runtime asset minification passed. The production size gate passed with its existing advisory total-bundle warning.
- The initial browser total above is **99 checks**. Additional focused reruns and evidence captures are not added to that total.

Evidence: [small-phone inventory](screenshots/iphone-safari-2026-10-22/iphone-small-inventory.png), [destination menu](screenshots/iphone-safari-2026-10-22/iphone-menu.png), [world map](screenshots/iphone-safari-2026-10-22/iphone-world-map.png), [iPad install guide](screenshots/iphone-safari-2026-10-22/ipad-install-guide.png), and [landscape chat with simulated keyboard geometry](screenshots/iphone-safari-2026-10-22/iphone-landscape-keyboard.png).

Local Playwright output directories: `test-results/iphone-final`, `test-results/iphone-screen-audit`, `test-results/iphone-visual`, `test-results/iphone-keyboard-visual` and `test-results/iphone-small-evidence`. The production combat run used the normal smoke suite. Temporary output may be cleared by later runs; the linked representative images are retained with this report.

## Regression protection

- `playwright.iphone.config.ts` provides the six-profile matrix and the existing screen audit with full effects. `IPHONE_AUDIT_BUILT=1` runs against a hash-verified immutable production snapshot; omitting it provides the development-server workflow.
- `iphone-experience.spec.ts` covers guide discovery, Settings, installed-state detection, resource readability, rotation, keyboard viewport changes, pinch zoom, menu focus/scrolling, Android-shell exclusion, sign-in field readability/password toggling, manifest/icon delivery, missing optional mobile CSS, and app-return viewport recovery.
- The ordinary `webkit-mobile` project now includes the broad non-combat walkthrough that was previously skipped.
- CI responsive-flow shard 12 sets `IPHONE_AUDIT_BUILT=1` and runs the dedicated matrix against the release artifact. A CI contract test verifies this gate runs exactly once and feeds the required responsive aggregate. Its log and existing test-result artifacts are retained with that flow's evidence.

```powershell
npm run build:client
$env:IPHONE_AUDIT_BUILT='1'
npm run test:e2e:iphone --prefix shinobij.client -- iphone-experience.spec.ts
npm run test:e2e:iphone --prefix shinobij.client -- non-combat-ui-audit.spec.ts --project=iphone --grep 'is production-sized and artwork-safe'
```

## Integration follow-up

A second integration review closed three gaps:

1. Critical header sizing and its shared height/navigation/gutter variables now live in the eager adaptive shell. The optional mobile presentation stylesheet can arrive late or fail without leaving content behind the status bar. The missing-stylesheet browser regression exercises this failure path.
2. Viewport geometry refreshes on `pageshow` and `visibilitychange`, in addition to resize/focus events. The app-return regression preserves a typed chat message while restoring keyboard geometry without relying on a resize event.
3. The dedicated CI device matrix now verifies the built release rather than only development modules. The install test checks the shipped Home Screen title, standalone manifest/start URL/scope and the actual PNG signature of the Apple icon.

The source checks for these three paths passed, as did **31 CI contract checks**, **16 shared layout/navigation checks**, **9 existing Google redirect checks**, the client TypeScript check, lint, the fresh production build and size gate.

The complete expanded matrix passed **60/60 browser checks against the production build** in 8.1 minutes, with no retries or skipped cases. This includes all six device profiles and the stylesheet-failure, manifest/icon and app-return cases. The preview verified an immutable 5,606-file snapshot with manifest hash `a695d0dbbf53696c237da75ac35c10e3beb3b9966db0ffa1537c8ecbd9d5a293`. Local results are in `shinobij.client/test-results/iphone-integration-built`; CI runs the same built-release mode. These results supersede the initial development-server-only matrix for release integration.

## Limits and physical-device handoff

Desktop WebKit emulation is not a physical iPhone or the shipping Safari app. The keyboard regression supplies VisualViewport geometry through the real event path; it cannot open a real iOS keyboard. Safe-area CSS was inspected, but the desktop runtime does not emulate an actual notch. Home Screen installed-state detection is simulated; the system Share sheet and installation require a phone.

Before release, use a real older/small iPhone and a current notched iPhone to verify:

1. Install from Safari, reopen the icon, test both password and Google sign-in, quit/reopen and verify the same character and progress. In particular, check Google's external browser return on real iOS; desktop emulation cannot certify the operating system's handoff between Safari and a Home Screen app.
2. Type/send chat with the real keyboard in portrait and landscape; dismiss it and confirm navigation returns.
3. Rotate the world/sector map and a battle, including movement and jutsu selection.
4. Lock/unlock and switch apps during music and gameplay; confirm audio and saved state recover correctly.
5. Play for 15–20 minutes to assess memory pressure, heat, battery consumption and full-effects performance.

This report records the local pre-release audit. Production deployment status is tracked by GitHub/Railway; App Store publication is outside this change.

The production-configured Docker gate subsequently measured 9,591,567 B of product JS/CSS, 8,498 B above the preceding Docker baseline. The aggregate budget accounts for this intentional iPhone feature growth at 9,595,000 B. The independently enforced startup, individual chunk, CSS and asset limits are unchanged; the measured initial graph is 1,398,719 B raw / 395,632 B gzip. The earlier local size result did not include all production environment-dependent code paths.
