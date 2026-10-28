# Settings release — 2026-09-18

This release adds Settings beside Logout on desktop and mobile, with the Cinematic/Classic preference, master volume and mute, Google linking, account-name and password changes, recovery codes, and account deletion. Character and guest notices no longer duplicate these controls. Intro, card, and pet battle audio controls now use the shared preference managed by Settings.

Account deletion requires an authenticated request, a server-enforced 24-hour wait, and explicit confirmation afterward. The request remains cancellable while the save exists. Existing password, Google, guest, partial-deletion retry, and credential-revocation paths remain compatible. No database schema migration is required.

The release was prepared in an isolated checkout of current main, including `262f4b5d7`. It preserves the newer image hydration, portrait framing, WebGL renderer retirement, story, pet, and landing changes. The generated design-token handoff was refreshed. Browser sign-in tests now use the visible desktop or mobile navigation entry; alert assertions select the exact button inside the dialog. Settings checkboxes retain compact native artwork while their labels provide the full touch target, including on phones.

## Local validation

- Root production build and distribution verification pass. The final client rebuild and size checks pass: **8,628,943 bytes** of budgeted product JS/CSS. This release does not raise any budget.
- Full lint: **0 errors, 14 warnings**. Updated browser-test helpers also pass focused lint.
- Full root tests: **11,351 passed, 1 failed**. The sole failure was the old landing hover count captured before the main-branch fix was incorporated. Both touch-hover checks pass after incorporating `ce9624991`, including its tighter limit of 58.
- Settings: **35 browser tests passed** across all seven configured projects.
- Deferred feature loading: **4/4 browser tests passed** on desktop and mobile. The reader test now uses the saved Cinematic preference in place of the removed in-scene switch and retains its fullscreen styling assertions.
- Account/navigation integration: **46 passed, 2 intentional skips**, with six phone-checkbox sizing failures subsequently corrected. The final focused recheck passed **12/12**, covering all nine checkbox viewport/browser combinations plus Settings preference persistence in Chromium desktop/mobile and mobile WebKit. The corrected mobile screenshot was inspected. No failure remains in these selected cases.
- Real local Express release certification: **90/90 checks passed** with isolated memory storage.
- Live Express login journeys: **13/13 passed** after replacing obsolete landing navigation selectors in Academy, daily-reward, defeat-recovery, and clean-device login tests. The instrumented Academy audit also resolves the shared navigation helper from its generated location. These are test-tooling corrections; account and gameplay behavior are unchanged.
- Generated handoff drift and Railway configuration checks pass.
- The preceding Settings audit completed strict combat layout verification: **20 passed, 10 intentional skips, 0 failures**. The pushed revision is also subject to the full CI browser, combat, server, and production-image gates before Railway deploys it.

Earlier shared-checkout findings in [the Settings audit](settings-exclusivity-audit.md) are historical; the release build above includes newer main-branch fixes. No production account was changed or deleted during local validation. Production deployment is verified by the intended commit in `/health` and the authenticated post-deploy health check.
