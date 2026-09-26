# Device retest: Shinobi Journey 2.0.1 (6)

**READY FOR OWNER DEVICE RETEST**, prepared 2026-09-25. Nothing is certified
until the table below is filled in on a real phone. Emulators, code reading and
`flutter test` are not device evidence.

## The build

- **2.0.1 (6)**: versionName 2.0.1, versionCode 6, package
  `com.shinobijourney.app`. It is on Internal testing and was submitted to Closed
  testing – Alpha. No other build is named 2.0.1, so "2.0.1" in Settings → Apps →
  Shinobi identifies it. (2.0.0 (5) was never sent.)
- Its shell sources are `mobile/` as of `d87d8275f` ("Stop the Android WebView
  zooming out and enlarging small text"), shipped to `main` in `73f99803e`
  (PR #221). Nothing under `mobile/lib`, `mobile/android` or the pubspec has
  changed since. The next upload needs versionCode 7 or higher.

## What 2.0.1 fixed

The first device test found the game clipped and mis-sized. Two Android WebView
defaults that Chrome does not have caused it. Overview mode zoomed the whole
page out when any element was a pixel too wide. An 8px minimum font enlarged the
game's smallest labels (card text, badges, HUD counters) past their boxes. 2.0.1
turns off overview mode and sets the minimum font to 1. Rows 1–3 check exactly
that; the other rows re-check everything else the shell does natively.

## Proven without a phone (2026-09-25)

| Check | Result |
| --- | --- |
| `flutter analyze` (Flutter 3.47.5) | No issues. |
| `flutter test` | 43 of 43 passed. `test/webview_settings_test.dart` (new) pins every WebView setting, the callbacks, the deny-all permission handler, Back handling, the manifest and the build values. Flipping `loadWithOverviewMode` back to `true` fails it. |
| Release build with no secrets | `flutter build appbundle --release` built the 50.5 MB bundle in 119 s. With no upload key it is debug-signed, so `build-release.ps1` would refuse it. That is the upload-key check working. |
| `tools/build-release.ps1` (read and parsed, not run) | Parses cleanly. It reads the passwords as secure strings and clears them afterwards. It passes the SDK and the 64-bit JDK 21 to Flutter and Gradle explicitly, and it stops unless the bundle's certificate is the upload key (`BD:60:…:97:8A`). |

## Known issues to watch for

These come from reading the code. The rows named here record what really
happens.

1. **Camera in the image picker attaches nothing (row 12).** The WebView plugin
   (flutter_inappwebview 6.2.0-beta.3) offers the camera in the picker. It saves
   the photo through a file provider that neither the plugin nor this app
   declares, so the photo's address is empty and the page gets no file. There is
   no error message. Gallery and file picks are not affected. The merged
   manifest of the 2.0.1 (6) release build confirms it: its only provider is
   `androidx-startup`. The fix for build 7, still to be proven on a phone, is
   to declare the provider in `android/app/src/main/AndroidManifest.xml`
   (inside `<application>`):

   ```xml
   <provider
       android:name="com.pichillilorenzo.flutter_inappwebview_android.InAppWebViewFileProvider"
       android:authorities="${applicationId}.flutter_inappwebview_android.fileprovider"
       android:exported="false"
       android:grantUriPermissions="true">
       <meta-data
           android:name="android.support.FILE_PROVIDER_PATHS"
           android:resource="@xml/provider_paths" />
   </provider>
   ```

   and add `android/app/src/main/res/xml/provider_paths.xml`, where the plugin
   writes the photo (`getExternalFilesDir(null)`):

   ```xml
   <paths><external-files-path name="captures" path="." /></paths>
   ```

   Add an assertion for the provider to `test/webview_settings_test.dart` in
   the same change.
2. **The website's shop through a legal page (row 5).** Legal pages open in a
   Chrome tab, and their "← Back to Home" link loads the full website in that
   tab. The app's User-Agent token is absent there. Whether the website still
   hides Tebex depends on the referrer Chrome sends when the app opens the tab.
   If Tebex appears, the fix belongs to the website, since the shell cannot
   steer a Chrome tab.
3. **No splash timeout after a renderer crash (row 18).** The rebuilt WebView
   keeps the splash up until the page loads or fails. The 8-second timeout runs
   only at launch and on Try again. On a slow network this can look like a hang.
4. **Back after logout (row 9)** walks the WebView's history. It must never
   show the game as if the player were still signed in.

## Checklist

- Tester and date:
- Phone and Android version:
- Android System WebView version (Settings → Apps → Android System WebView):
- App version (Settings → Apps → Shinobi):

Fill in every Result with `PASS`, `FAIL: <what you saw>` or `N/A: <why>`. A blank
Result counts as a fail. Keep a screenshot for rows 1–3 and for every FAIL.

| # | Area | Do this | Pass if | Result |
| --- | --- | --- | --- | --- |
| 1 | No zoom-out or clipping | Open the start screen, the village hub and the world map in portrait. | Each fills the width exactly: no blank strip at the right or bottom, nothing looks zoomed out, and pinching does not zoom. | |
| 2 | Sub-8px labels: combat | Start any battle. | Every jutsu card's cost line (like `40 AP · R4 · CD 7`) ends with its cooldown number, not `…`. The action-bar captions and the HP, chakra and stamina labels stay inside their boxes. | |
| 3 | Sub-8px labels: card duel, Pet Warfront | Open a card duel, then a Pet Warfront placement board. | Card element badges, zone labels and pile counts stay inside their boxes. The board's route labels (left edge) and depth labels (top) do not overlap the grid. | |
| 4 | Shop blocked | Open the Fate Shard shop. | It says "Fate Shard purchases are not available in this version of the app yet." Tebex never appears. | |
| 5 | Shop blocked | Signed out, tap a legal link in the start screen's footer. In the tab that opens, tap ← Back to Home, sign in and open the shop. | Tebex never appears. If it does, write FAIL: the tab is Chrome, but the app opened it, so it is a Play payments-policy risk. | |
| 6 | Google | Sign in with Google. Sign up a new account with Google. On a password account, Settings → Link Google account. | Each returns to the game signed in, or linked. | |
| 7 | Google: cancel and delay | Start a Google sign-in and close its tab with X. Start again and press Cancel on Google's page. Start again and wait more than 5 minutes before finishing. | Each returns to the game with a message, and the next attempt works. | |
| 8 | Back in combat | In a battle, press Back five times. | You stay in the battle and the app stays open. | |
| 9 | Back in navigation | Open two screens from the hub and press Back twice. Then log out and press Back. | Back goes screen by screen. After logout, Back never shows your game as if you were still signed in. | |
| 10 | Back on the start screen | Force-stop the app, open it signed out, and press Back on the start screen. | The app closes. | |
| 11 | Legal and external links | During character creation (row 6's new account), tap Terms of Service and close the tab. Tap Community ↗ or Discord. | The terms open over the game and the half-made character is still there. Discord opens in its app or the browser. | |
| 12 | Image picker and permissions | On row 6's new account, change the avatar: cancel the picker once, then pick an image from the gallery. If the picker offers Camera, take a photo. | Cancel keeps the old avatar and the gallery image is accepted. The app never asks for camera, microphone or location permission. Record what Camera does (known issue 1). | |
| 13 | Keyboard and chat | Open tavern chat, tap the message box, type and send. | The keyboard never covers the box, and the message sends. | |
| 14 | Clipboard | On row 6's new account: Settings → Generate a recovery code → Copy, then paste into another app. | The code pastes. (A native confirm dialog appears only on the error screen's Reset Local Save; if you meet one, Cancel must change nothing.) | |
| 15 | Audio | With music playing, press Home for 10 seconds and come back. Lock the screen and unlock it. | Music is silent while the app is hidden and plays again when it is back. | |
| 16 | 3D performance | Play a Pet Warfront round, then pan the world map for a minute. | It stays playable: no black screen, freeze or app close. | |
| 17 | Offline first launch | Force-stop the app, turn on airplane mode and open it. Turn airplane mode off and tap Try again. | The offline screen appears (never a blank page or an endless splash), and Try again loads the game. | |
| 18 | Renderer recovery | Rooted phone only: `adb shell`, `su`, then `kill $(pidof com.google.android.webview:sandboxed_process0)` (the name varies by device). | The game reloads and the app does not close. Without root, write `N/A: needs root`. | |
| 19 | Upgrade | Open the app from a home-screen icon pinned before the upgrade. | The old icon opens the app. | |

The Play review card and update prompt are not part of this retest. The review
card needs three sessions at least 30 minutes apart. The update prompt needs a
build newer than 6 on the track.

## Sign-off

- Every row is `PASS` or a justified `N/A`: record the tester, date and phone
  above. 2.0.1 (6) is then device-checked and can go further on Play.
- Any `FAIL`: list the rows and screenshots here. A shell fix needs build 7.
  A website fix (for example row 5) needs no Play release.
