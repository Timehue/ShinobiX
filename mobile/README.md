# Shinobi Journey for Android (Flutter shell)

This is the Play Store app. It is a thin native shell around the live website:
one WebView loads `https://shinobijourney.com`, and the game, server and database
are exactly the ones the browser uses. A website deploy reaches app players with
no store update. The shell only needs a new build for native changes.

It replaces the old Trusted Web Activity (the Bubblewrap project in
`C:\Users\Tyler R\source\repos\shinobi-twa`, documented in
`docs/ANDROID_TWA_SETUP.md`). It keeps the same package, `com.shinobijourney.app`,
and the same upload key, so on Play it is simply a new version of the same app.

## What the shell does that a bare WebView would not

- **Tells the website it is the app.** It appends `ShinobiJourneyApp/1` to the
  WebView's User-Agent. `shinobij.client/src/lib/surface.ts` reads that, so the shop
  shows "not available in this version of the app yet" instead of the Tebex web
  checkout, which Play's payments policy forbids inside a Play app. The token is
  client-set, so the server never trusts it for anything.
- **Runs Google sign-in in a Chrome Auth Tab.** Google refuses to sign in inside
  a WebView. The website asks the server for an app return
  (`client: 'android-app'`), the server sends the result to
  `shinobijourney://auth`, and the shell loads it back into the WebView that holds
  the sign-in nonce. See `docs/auth-and-anti-cheat-patterns.md`.
- **Keeps documents out of the game.** Legal pages, other paths on the site and
  every new window open in a Custom Tab over the game. Foreign sites and `mailto:`
  go to other apps. Tebex, `about:blank` and unknown schemes are blocked. The
  rules are in `lib/src/navigation_policy.dart`.
- **Handles Android's back button** the way the TWA did. On a `#/screen` it
  always hands back to the page, which may refuse (an unresolved battle), so back
  never closes the app from inside the game.
- **Asks for Play reviews and installs Play updates** with the same limits the TWA
  used (three sessions and 90 days for reviews, a day between update prompts).
- **Survives a WebView renderer crash** by rebuilding the WebView instead of
  closing the app.

## One-time setup (already done on the main dev PC)

- Flutter **3.47.5** stable at `C:\src\flutter`, with the pub cache at
  `C:\src\pub-cache` and Gradle's home at `C:\src\gradle-home`. These paths have
  no spaces. CI (`.github/workflows/android-shell.yml`) pins the same version;
  move both together.
- A 64-bit JDK 17 or newer. Bubblewrap's JDK is 32-bit and cannot run this build.
  The PC uses Microsoft's OpenJDK 21 from Visual Studio:
  `flutter config --jdk-dir "C:\Program Files\Android\openjdk\jdk-21.0.8"`.
- The Android SDK at `C:\Users\Public\bubblewrap\android_sdk`, with NDK
  `28.2.13676358` and command-line tools **19.0**. Version 23 turned `sdkmanager`
  into a wrapper around the new Android CLI, which cannot install the NDK that
  Gradle asks for. Do not upgrade them until that is fixed.

Before moving to a newer Flutter, note that the build warns that
`flutter_web_auth_2` and `in_app_review` still apply the Kotlin Gradle Plugin,
which a future Flutter release will reject. Check that both plugins have moved to
Built-in Kotlin first.

## Build a release

1. Raise the number after the `+` in `pubspec.yaml`'s `version`. It is the Play
   versionCode, and it must be higher than every build already uploaded, including
   the TWA's 4.
2. In your own PowerShell window, run the build script. It asks for the keystore
   passwords, builds, and checks that the bundle is signed with the Play upload
   key.

   ```powershell
   powershell -ExecutionPolicy Bypass -File mobile\tools\build-release.ps1
   ```

3. Upload `mobile\build\app\outputs\bundle\release\app-release.aab` to
   **Internal testing** first. Install it on your phone from Play, as an upgrade
   over the old app, and go through the checklist below.
4. Promote that same release to **Closed testing – Alpha**. Do not rebuild for
   it: every rebuild uses up a versionCode. A new release on the same closed track
   does not restart the 14-day tester clock.

## Device checklist

Run it for every shell release on a real phone, with the build installed from
Play as an upgrade over the previous one. An emulator, reading the code or
`flutter test` does not count: the tests pin the settings behind these rows,
and only a phone shows what they do.

Copy the table into a dated note next to this file (for 2.0.1 (6) it is
[RETEST-2.0.1.md](RETEST-2.0.1.md)). Fill in every Result with `PASS`,
`FAIL: <what you saw>` or `N/A: <why>`; a blank Result counts as a fail. Keep a
screenshot for rows 1–3 and for every FAIL. Record first: the phone, its Android
version, the Android System WebView version (Settings → Apps → Android System
WebView) and the app version (Settings → Apps → Shinobi).

| # | Do this | Pass if | Result |
| --- | --- | --- | --- |
| 1 | Open the start screen, the village hub and the world map in portrait. | Each fills the width exactly: no blank strip at the right or bottom, nothing looks zoomed out, and pinching does not zoom. | |
| 2 | Start any battle. | Every jutsu card's cost line (like `40 AP · R4 · CD 7`) ends with its cooldown number, not `…`. The action-bar captions and the HP, chakra and stamina labels stay inside their boxes. | |
| 3 | Open a card duel, then a Pet Warfront placement board. | Card element badges, zone labels and pile counts stay inside their boxes. The board's route labels (left edge) and depth labels (top) do not overlap the grid. | |
| 4 | Open the Fate Shard shop. | It says "Fate Shard purchases are not available in this version of the app yet." Tebex never appears. | |
| 5 | Signed out, tap a legal link in the start screen's footer. In the tab that opens, tap ← Back to Home, sign in and open the shop. | Tebex never appears. If it does, write FAIL: the tab is Chrome, but the app opened it, so it is a Play payments-policy risk. | |
| 6 | Sign in with Google. Sign up a new account with Google. On a password account, Settings → Link Google account. | Each returns to the game signed in, or linked. | |
| 7 | Start a Google sign-in and close its tab with X. Start again and press Cancel on Google's page. Start again and wait more than 5 minutes before finishing. | Each returns to the game with a message, and the next attempt works. | |
| 8 | In a battle, press Back five times. | You stay in the battle and the app stays open. | |
| 9 | Open two screens from the hub and press Back twice. Then log out and press Back. | Back goes screen by screen. After logout, Back never shows your game as if you were still signed in. | |
| 10 | Force-stop the app, open it signed out, and press Back on the start screen. | The app closes. | |
| 11 | During character creation (row 6's new account), tap Terms of Service and close the tab. Tap Community ↗ or Discord. | The terms open over the game and the half-made character is still there. Discord opens in its app or the browser. | |
| 12 | On row 6's new account, change the avatar: cancel the picker once, then pick an image from the gallery. If the picker offers Camera, take a photo. | Cancel keeps the old avatar and the gallery image is accepted. The app never asks for camera, microphone or location permission. Record what Camera does. | |
| 13 | Open tavern chat, tap the message box, type and send. | The keyboard never covers the box, and the message sends. | |
| 14 | On row 6's new account: Settings → Generate a recovery code → Copy, then paste into another app. | The code pastes. (A native confirm dialog appears only on the error screen's Reset Local Save; if you meet one, Cancel must change nothing.) | |
| 15 | With music playing, press Home for 10 seconds and come back. Lock the screen and unlock it. | Music is silent while the app is hidden and plays again when it is back. | |
| 16 | Play a Pet Warfront round, then pan the world map for a minute. | It stays playable: no black screen, freeze or app close. | |
| 17 | Force-stop the app, turn on airplane mode and open it. Turn airplane mode off and tap Try again. | The offline screen appears (never a blank page or an endless splash), and Try again loads the game. | |
| 18 | Rooted phone only: `adb shell`, `su`, then `kill $(pidof com.google.android.webview:sandboxed_process0)` (the name varies by device). | The game reloads and the app does not close. Without root, write `N/A: needs root`. | |
| 19 | Open the app from a home-screen icon pinned before the upgrade. | The old icon opens the app. | |

Two Play prompts are checked only when due; otherwise write `N/A: not due`. The
review card needs three sessions at least 30 minutes apart, then waits 90 days,
and Google may still decline to show it. The update prompt appears only when a
build newer than the installed one is on the track.

## Tests

```powershell
cd mobile
C:\src\flutter\bin\flutter.bat analyze
C:\src\flutter\bin\flutter.bat test
```

`test/parity_test.dart` reads the website's source. It fails if the User-Agent
token, the Google return URL, the review intent or the redirecting hosts drift
apart between this app and the site.

`test/webview_settings_test.dart` reads the shell's own sources. It pins every
WebView setting, the WebView callbacks, the deny-all permission handler, Back
handling, the manifest (permissions, backups, launcher alias, no web App Links,
package queries) and the package, API level, versionCode floor and plugin pin.
Changing one fails it on purpose. Update the test, then re-run the device
checklist.

A release build needs no secrets to prove it compiles. Without the `SJ_UPLOAD_*`
variables Gradle signs with the debug key, so the bundle can never be uploaded:

```powershell
cd mobile
C:\src\flutter\bin\flutter.bat build appbundle --release
```

On this PC, run it through a `subst` drive as `tools\build-release.ps1` does
(the worktree path is too long for Gradle).

## Rollback

- A website bug needs no Play release. Fix and deploy the site.
- A shell bug means going back to the TWA. Rebuild it from `shinobi-twa` with a
  versionCode above the newest Flutter one, then upload it. That takes about an
  hour, plus Play review.
- Keep the `ANDROID_APP_*` asset-links environment variables and the referrer
  branch in `surface.ts` for as long as any TWA install could still exist.

## Icons and splash

`node mobile/tools/gen-android-assets.mjs` rebuilds the launcher icons and splash
art from `shinobij.client/public/icon-512.png` and `icon-maskable-512.png`, at the
sizes the TWA shipped.
