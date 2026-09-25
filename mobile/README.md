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

Run this on a real phone for every shell release:

- The shop says "not available in this version of the app yet" and never shows
  Tebex.
- Google sign-in, Google signup and linking Google all work. Also try closing the
  sign-in tab with X, cancelling on Google's page, and waiting more than five
  minutes before finishing. Each of these should return to the game with a
  message.
- In a battle, back pressed five times does not leave the battle or close the
  app. On the start screen, back closes the app.
- A legal link opened during character creation opens over the game, and the
  creation is still there afterwards.
- Changing the avatar or a clan image opens a picker, and cancelling it works.
- Copying a recovery code works. The browser-style confirm dialog (for example
  "reset local save" in the recovery tools) shows and returns the right answer.
- The keyboard in tavern chat does not cover the input.
- Music stops when the app goes to the background and resumes after.
- Pet Warfront and the world map run smoothly.
- With no connection on first launch, the offline screen appears and Try again
  works once the connection is back.
- `adb shell am crash` is not enough to test the renderer. Kill it with
  `adb shell "kill $(pidof com.google.android.webview:sandboxed_process0)"` (the
  process name varies by device). The game should reload rather than the app
  closing.
- From Play only: the launcher icon survives the upgrade, the review prompt
  appears through internal app sharing, and the update prompt appears when a newer
  build is published.

## Tests

```powershell
cd mobile
C:\src\flutter\bin\flutter.bat analyze
C:\src\flutter\bin\flutter.bat test
```

`test/parity_test.dart` reads the website's source. It fails if the User-Agent
token, the Google return URL, the review intent or the redirecting hosts drift
apart between this app and the site.

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
