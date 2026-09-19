# Settings exclusivity audit — 2026-09-18

For the integration with current main and release validation, see [the release notes](settings-release-2026-09-18.md). The measurements below describe the earlier shared checkout.

Settings is the single in-game location for player account management, reader mode, and audio preferences. Desktop and mobile menus place it beside Logout. Character contains no account-management cards.

| Control | Owner | Integration checked |
| --- | --- | --- |
| Cinematic / Classic | Settings | Cinematic defaults; saved explicit Classic choice survives reload |
| Master volume and mute | Settings | Music, ambience, story score, card effects, and pet effects use the shared preference |
| Link Google account | GoogleLinkCard, mounted only by Settings | Guest notices direct players to Settings; linking retains the existing authenticated OAuth flow |
| Account name | ChangeAccountNameCard, mounted only by Settings | Existing versioned character update callback remains connected |
| Change password | ChangePasswordCard, mounted only by Settings | Existing account-status and password endpoints remain connected |
| Recovery code | RecoveryCodeCard, mounted only by Settings | One-time reveal remains within the Settings account flow |
| Delete account | AccountDeletionCard, mounted only by Settings | Server-owned 24-hour wait, cancellation, reload persistence, then explicit final confirmation |

## Duplicates removed in the follow-up audit

- Seven audio buttons across IntroCinematic, ChronicleDuelBoard, PetArenaBattlefield, the coliseum frame renderer, PetShowdownBattle, and PetColiseum (two buttons).
- The Google-link action in GuestSocialLock, shared by the tavern, both message composers, and clan chat. These notices now explain where to manage the account without repeating its controls.
- Dead styles for the removed audio buttons. The intro Skip button retains a 44-pixel minimum touch target.

The old `petSfxMuted` and `chronicleSfx.v1` flags no longer suppress effects independently. Compatibility accessors delegate to `audioMuted`, so unmuting in Settings cannot leave card or pet effects silently muted by an obsolete preference.

Login and forgotten-password recovery still work before signing in. Administrator maintenance acts on other accounts. These are separate authentication/support flows, not duplicate player Settings panels. Chat moderation's mute action restricts chat, not game audio. Reader accessibility and battle presentation controls retain their existing purpose.

## Verification

The source audit found reader/audio preference writes only in Settings, Google-link initiation only in GoogleLinkCard, and account-card mounts only in Settings. Focused backend, routing, audio, touch-target, navigation, and App-size checks passed: **51 tests, 0 failures**. The audio checks include conflicting legacy flags and both compatibility setter paths.

The final Settings browser run passed **35 of 35 tests** across all seven configured browser/viewport projects (one worker, 2.2 minutes). It covers removal from Character and guest notices, desktop/mobile menu entry, preference persistence, Google linking, password changes, one-time recovery-code display, deletion request/cancellation, and masked final confirmation. An earlier navigation-readiness race was corrected; a subsequent Firefox browser-shutdown timeout did not recur in the final run. Updated desktop and mobile screenshots are in `docs/settings-evidence/`.

Full lint passed with **0 errors and 14 warnings**. Client production compilation and server compilation passed. The isolated client artifact still fails the checkout's size gate: **8,621,277 bytes** against **8,600,000**, and initial gzip **380.7 KB** against **379.9 KB**. No budget was raised.

The strict combat layout run passed: **20 passed, 10 intentionally skipped, 0 failures** in **34.2 minutes**, with `COMBAT_LAYOUT_STRICT=1` and after-change captures. It covers Chromium pixel-density variants, Firefox, and WebKit against the built local server and isolated client artifact. The skipped cases are variants deliberately limited to the primary Chromium project; their shared shell remains covered across browsers.

The required broad smoke command was started with six workers and stopped at test **440 of 1,904**, with **27 recorded failures** outside the Settings test file. The run was incomplete, not green. Failures include landing/login selectors, admin-art publishing, first-contract navigation, logout recovery, image recovery/artwork coverage, profession/pet UI, alert focus, and story-memory assertions. The failing run was stopped to reduce machine load and allow the final isolated Settings run to complete; its log and evidence remain under `.tmp/settings-exclusive-full-browser.log` and `.tmp/settings-exclusive-full-results/`.

Browser checks use local deterministic account fixtures; no real Google account was linked, password changed, recovery code issued, or account deleted. The backend waiting-period checks use the real handlers with isolated memory storage.

The production browser artifact is isolated under `shinobij.client/.tmp/settings-exclusive-dist`, so concurrent work cannot replace its hashed assets. Removing the unused `primePetSfx` import after this build changes no runtime behavior.

See [Settings and account deletion](settings-and-account-deletion.md) for the original implementation contract and previous validation results. This audit is local and does not deploy the changes.
