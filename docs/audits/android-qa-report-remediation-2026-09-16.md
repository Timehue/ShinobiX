# Android QA report remediation — 16 September 2026

Source: `Shinobi-QA-Report.pdf`, Teekam's QA Team, September 2026 (12 pages).
All nine numbered findings, including the two requested Play enhancements, have
implementations in the local web/server and Android sources. Release acceptance
on a Play-installed Android device remains pending; this is not a device certification.

The user confirmed that profile editing must change the login/account name too.
Document contents were treated as findings to investigate, not independent instructions.

## Findings and integration

| Finding | Implementation | Verification |
| --- | --- | --- |
| 1: Profile-name editing | Profile's Change Account Name form calls an authenticated, versioned server mutation. The new name works for password login and recovery and appears in the profile, remembered accounts, player directory and leaderboards. Immutable account IDs keep existing saves, tokens, Google links, clan membership and economy references connected. New aliases are reserved against registration and concurrent renames; generic saves cannot forge or revert them. Typed friend, block, message, transfer and bounty recipients resolve to the existing account. | API tests cover ownership, collisions, concurrent claims, interrupted-name reservations, passwordless accounts, old/new login, recovery, password changes, save protection, social references, messages and transfers. Browser checks cover form submission, reload, login with the new name and loading the original save. |
| 1: Gallery restriction shown too late | Non-supporters see the requirement before interaction, with a disabled upload button and no file input. Supporters open the picker from an accessible button. The handler still checks entitlement. | Browser checks verify both entitlement states and the Supporter file chooser. |
| 2: Clipping, alignment and navigation | Shortened the Profile current-password placeholder and moved its explanation below the field. Corrected password targets and mobile checkbox sizing. Mobile navigation suppresses repeated taps only on the same destination, so quickly switching to another destination works. | Compared the supplied Profile screenshot. Browser checks cover portrait/landscape Profile layouts and rapid Items, Village, Travel and You → Profile navigation. |
| 3: Password Show/Hide alignment | Creator and login toggles stay centered within their fields, including hover. Added accessible pressed state and labels. The Profile checkbox has a compact visual control inside a 44px label target. | Browser geometry checks at mobile portrait and landscape sizes; focused lint and type checks. |
| 4: Scrollbar present but scrolling frozen | The recording identifies the mobile You sheet. Its body now has a constrained, touch-scrollable flex area; the header and Close button remain reachable. Closing restores page scrolling. | Browser wheel checks at 360×640, 844×390 and 667×320, plus an injected finger swipe after portrait-to-landscape rotation. |
| 5: Audio continues when minimized or leaving scenes | Shared visibility/page lifecycle handling pauses battle/story music, silences and suspends Web Audio, stops SFX and fading ambience, and rejects late decode callbacks. Foregrounding resumes only the current scene's music/ambience and respects mute. Scene exit while hidden clears resume state. | Lifecycle, mute, audio-channel and delivery regressions pass. Physical Android background/resume acceptance remains pending. |
| 6: Landscape clips content | The recording identifies the opening cinematic world reveal. Compact landscape rules keep actors above dialogue, constrain artwork to the viewport, and make choices scrollable. The pet confirmation action also fits short landscape screens. | Browser checks and inspected screenshots at 844×390 and 667×320 cover initial actors, choices, pet confirmation and the world reveal. |
| 7: Old Android launcher icon | Rebuilt native launcher, adaptive-maskable, splash and local store artwork from the current web emblem. The supplied launcher recording and the previous native store icon showed the old purple design. Maintained sources and a repeatable sync script live in this repository. | Native resources compile into debug APK and release AAB. Installed-device launcher appearance and published Play listing comparison remain release checks. |
| 8: Play in-app updates | Native launcher checks Play before opening gameplay. Normal releases use flexible updates; priority 4–5 releases and interrupted immediate updates use the immediate flow. Downloaded flexible updates offer Restart/Later on the next launch. Cancellation has a 24-hour cooldown; failure or a 3.5-second check timeout allows gameplay. | Android compilation and update-policy tests pass. A Play test-track upgrade is required to exercise the actual installation UI. |
| 9: Play in-app review | Continue after a verified, non-replayed win can open the native review activity after sufficient play: native session count ≥3, level ≥5, three eligible wins, foreground user gesture and a 90-day cooldown. The wrapper advertises availability; older wrappers and ordinary browsers do nothing. Google owns whether its review card is displayed. | Web bridge and eligibility tests, native cooldown tests, manifest integration and Android builds pass. Actual Play review behavior requires a Play-installed build. |

Account IDs intentionally remain stable; historical chat/battle/clan snapshots are
not rewritten. Current login names are server-owned aliases, not replacement save keys.

## Validation completed

- 150 targeted Node tests pass across authentication, account renaming, public
  indexing, save ownership, messages, trades, login/session handling, native review,
  audio and entitlements.
- A separate 20-test contract run passes for save ownership, version echoes and
  session loading (three session tests overlap the 150-test run).
- 16 Chromium browser checks pass against the current Vite application with
  isolated API fixtures; server behavior is tested separately above. The renamed
  login/navigation check also passes after the final session-identity adjustment.
- Client and server TypeScript checks and focused ESLint pass. The production
  Vite build completes successfully.
- Native `:app:testDebugUnitTest`, `:app:assembleDebug` and `:app:bundleRelease`
  complete successfully. Both native policy tests pass.
- The release AAB is unsigned; it has not been uploaded or deployed.

Durable regressions include `api/player/account-name.test.ts`,
`shinobij.client/src/lib/audio-lifecycle.test.ts`,
`shinobij.client/src/lib/native-play.test.ts`,
`shinobij.client/e2e/android-qa-report.spec.ts`, and
`android/twa/src/test/java/com/shinobijourney/app/PlayExperiencePolicyTest.java`.

The report's linked screenshot and scroll, landscape and launcher recordings were
retrieved and inspected. Local evidence and extracted contact sheets are under
`tmp/qa-evidence/`; browser artifacts are generated under
`tmp/qa-report-browser-results/`. These scratch files are not release assets.

## Release acceptance still required

The adjacent native project is `C:\Users\Tyler R\source\repos\shinobi-twa`.
See [the native maintenance instructions](../../android/twa/README.md) for the
sync command, update/review policy and build steps. Changed native files were
backed up there before replacement.

Use the existing signing/release process and a Play internal track to verify:

1. Launcher artwork and startup on installed Android devices.
2. Flexible update acceptance/cancellation, downloaded-update restart, critical
   immediate update and interrupted-update recovery against a newer track build.
3. Eligible review invocation after a win; cancellation or quota suppression must
   leave the player in the game without lost progress.
4. Minimize/resume audio and rotation/scroll behavior on the reported device range.

The initial implementation pass was local and uncommitted. The user subsequently
authorized publication to live main; that integration is recorded below. The
Android bundle remains unsigned and has not been published to Play.

## Current-main release integration

The candidate starts from `203bf7e1018548e28ac0c7f96f5bd3584e1b7636`, which both
remote main and public production health reported before integration. Work was
isolated in `.tmp/android-qa-live-20260916` on
`codex/android-qa-live-20260916`; unrelated work in the original checkout was
preserved. The change includes the maintained Android source overlay, not a Play
binary release.

Current-main integration also adds `accountName` to the client save-ownership
mirror, retains the newer mobile style rules while keeping the Profile checkbox
compact, and gates hover corrections to hover-capable devices. Remembered-login
orchestration moved into `player-login.ts`; `App.tsx` stays within its unchanged
6,520-line limit. Generated design-token references were refreshed for the CSS
changes. No dependency, gameplay balance, deployment setting or budget changed.

Release validation using Node 22.23.1 and fresh locked dependencies:

- Full root regression suite: **11,100 passed, zero failures or skips**. The first
  integration run found four failures; the ownership mirror, touch-hover rules
  and two exact-source login assertions were corrected before this clean rerun.
- Full production build: server/client TypeScript, generated story content,
  distribution verification and size checks pass. Product JS/CSS is 8,484,124 B
  raw / 2,387,319 B gzip.
- Full client lint: zero errors and 14 existing warnings; focused lint on the
  final changed test/mirror files also passes.
- Local release certification: **90/90 real-HTTP checks passed** against an
  isolated server, including authentication, saves and two-account PvP.
- Production-bundle QA browser matrix: 108 passed and three intentional
  Chromium-protocol skips. Its sole remaining failure was Firefox reporting a
  44px target as 43.999969px. After correcting only that precision assertion,
  both creator viewport cases passed three repetitions each (six passes).
  Earlier CSS and fixture failures are retained in the initial run's log.
- The browser spec now exercises real onboarding rather than a development-only
  preview. It returns from fullscreen Travel through the map's actual Village
  control. Mobile WebKit uses scroll-into-view for geometry checks because its
  automation protocol has no wheel input; Chromium separately checks finger input.
- Deployment configuration, rollback-readiness and tooling-handoff checks pass.
- Current-main icon sources exactly match those used for the validated native build.

Local publication evidence is retained under `tmp/android-qa-publication/`.
Publication must use a normal fast-forward push and verify the resulting live
revision; no force push or deployment gate bypass is needed.
