# Settings and account deletion

The desktop right menu and mobile menu now expose **Settings** immediately beside Logout. Account controls have moved out of Character, including account-name changes. Settings contains the Cinematic/Classic reader preference, master volume, mute, Google linking, password changes, recovery codes, and account deletion.

The [follow-up exclusivity audit](settings-exclusivity-audit.md) records the remaining intro/combat audio and guest-link controls removed afterward, the unified legacy audio preferences, and the latest validation results.

Cinematic remains the default. Existing explicit Classic preferences remain valid. Reader-mode switching and the audio button were removed from the cinematic stage; its reading-accessibility controls remain available. Audio and reader preferences remain device-local. Master volume scales battle music, story music, ambience, and sound effects while preserving the separate mute preference.

## Deletion contract

1. The authenticated player requests deletion in Settings. The server records the request time on the existing auth record.
2. A 24-hour waiting period starts. Repeating the request preserves its original timestamp. The player can keep playing and can cancel the request.
3. After the wait, the player must return to Settings and explicitly confirm permanent deletion. Nothing is deleted automatically.
4. The existing credential-aware confirmation remains: password accounts enter a masked password; Google-only and guest accounts use their session credentials. Save removal precedes credential revocation, and a partially completed deletion remains retryable.

`GET/POST /api/player/account-deletion` reads, requests, and cancels only the caller's own request. Request and cancellation use the same outer save lock as deletion. The legacy save-deletion route refuses early requests before writing fences or detaching references. The auth-only route cannot remove credentials while a live save exists, and cannot bypass a pending waiting period. Missing-save signup recovery, deliberate administrator actions, and the existing inactive-guest sweep retain their separate purposes.

This adds an optional server-owned timestamp to the existing auth record. It does not require a database schema migration or a scheduler. Client-supplied timestamps and account names cannot set or shorten the wait.

## Initial implementation validation

- Focused account, authentication, routing, audio, and App-size checks: **83 passed**.
- Navigation checks after relocating the mute assertion to Settings: **6 passed**.
- Source mobile Settings checks: **3 passed**.
- Production Settings checks: **28 passed** across all seven configured browser/viewport projects. These exercise menu access, removal from Character, preference persistence, request/cancel/reload, masked final confirmation, Google-link initiation, password changes, and one-time recovery-code display.
- Final isolated build Settings recheck: **28 passed** after adding a navigation-readiness wait to avoid choosing the mobile test path before the desktop menu renders. Screenshots below come from this final run.
- Updated account-location, scrolling, and default-cinematic checks: **29 passed, 5 intentionally skipped, 1 timed out** under concurrent load. The single WebKit scroll case passed unchanged when rerun alone. The older tests now navigate to Settings through the appropriate desktop or mobile menu and wait for its lazy screen to render.
- Deletion-client compatibility, masked confirmation, navigation, and App-size recheck after the lazy extraction: **13 passed**.
- Full unit suite: **11,289 passed, 2 failed**. The outdated right-menu mute assertion was corrected and passed its recheck. The remaining touch-hover budget failure reports 64 ungated hover rules against a limit of 61; this Settings change adds no hover rules.
- Final client typecheck passed. Full lint passed with **0 errors and 14 existing warnings**.
- Strict combat layout suite: **20 passed, 10 skipped, 0 failures** across the configured browser and pixel-density matrix (31.1 minutes). The suite used the isolated production build and real local Express server with memory storage.
- Full seven-project smoke suite: **1,183 passed, 664 skipped, 50 failed** in 50.0 minutes. Six failures came from obsolete account-location/reader-switch assumptions or the Settings navigation-readiness race; the fixes passed the focused reruns above. The broad run's original failures remain recorded rather than being presented as a clean run.
- The final guest sign-in/privacy copy cleanup points to Settings and passes focused lint. These text-only corrections followed the browser artifact build.

Browser account services use deterministic local fixtures. No real Google account was linked, production password changed, recovery secret issued, or player account deleted during validation. Backend waiting-period checks execute the real handlers against the isolated memory store, including token and password-only authentication, exact boundary times, cross-account attempts, cancellation, partial retries, and session revocation.

The broad browser run also exposes issues outside this Settings change: landing/login selectors and alert-selector ambiguity, a phone storage notice intercepting the login target, the pet page's undersized Back to Village button, and a story-finale completion assertion. The Tamer portrait case passed unchanged on Firefox and WebKit when rechecked. The combined pet/Sunscar WebKit case still reaches its 45-second timeout around the market listing/inspection flow. These are not counted as a clean release gate.

## Build evidence and limits

The root server/client build compiled and distribution validation passed. A concurrent build modified the shared output directory during its size check, so subsequent browser checks use isolated outputs under `shinobij.client/.tmp/`. The three manifest-dependent browser specs now accept `PLAYWRIGHT_BUILD_DIR` so their expected hashed assets match the served build.

The initial implementation's isolated production build compiles, but the checkout's bundle gate remains red: product JS/CSS is **8,620,432 bytes** against an **8,600,000-byte** limit, and the initial graph is also slightly above its gzip limit. No size limit was raised. Deletion-only client code is loaded on demand, with compatibility exports preserved for existing callers. The follow-up audit linked above records the newer artifact's measurements.

This is a local implementation; no deployment or production-account mutation was performed.

## Screenshots

- [Desktop Settings beside Logout](settings-evidence/desktop-settings.png)
- [Mobile password and recovery controls](settings-evidence/mobile-account.png)
- [Mobile cancellable deletion wait](settings-evidence/mobile-deletion-wait.png)
