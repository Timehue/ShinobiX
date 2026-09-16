# Maintained Android wrapper additions

These sources implement the Android QA report's native update and review requests.
The generated Bubblewrap project lives beside this repository at
`C:\Users\Tyler R\source\repos\shinobi-twa`. Keep these sources here so that a
Bubblewrap regeneration does not become the only copy of the changes.

From the NinjaK repository, reapply the sources and current web branding:

```powershell
node scripts/sync-android-qa.mjs "C:\Users\Tyler R\source\repos\shinobi-twa"
```

The script checks the package ID, backs up every existing file it replaces under
`.backup-qa-<timestamp>`, copies Java sources/tests, adds Play dependencies and the
review activity, and regenerates launcher/splash/store artwork from the web icons.
It upgrades the original version 3 configuration to version 4 without reducing a
later version. Future Play releases still need their usual unique version code.
It does not read or change signing credentials.

## Behavior

- `LauncherActivity` checks Play before launching the TWA. It permits gameplay
  after a failed check or a 3.5-second deadline. Update priorities 4–5 use an
  immediate flow; other available releases use a flexible flow. A downloaded
  flexible update offers Restart/Later on the next cold launch. An accepted
  interrupted immediate flow resumes even during the normal 24-hour prompt cooldown.
- `PlayExperiencePolicy` requires three sessions, separated by at least 30 minutes,
  and a 90-day app-level review cooldown. Google applies its own additional quota.
- The launch URL advertises `playNative=1` and whether review is currently due.
  The website invokes `shinobijourney://review` through an explicit Android intent
  only from Continue after sufficient verified wins and a foreground gesture.
  Existing wrappers do not advertise this activity and remain compatible.
- `PlayReviewActivity` returns to the existing TWA. Only the request for review
  information has a timeout; a displayed Google review card is never dismissed
  programmatically. Failures and quota suppression do not change game rewards.

## Local build

Use the configured Java 17 and Android SDK. On this workstation the explicit temp
directory avoids a JDK Unix-domain socket failure in the default temporary path:

```powershell
$env:JAVA_HOME = 'C:\Users\Public\bubblewrap\jdk\jdk-17.0.11+9'
$env:ANDROID_HOME = 'C:\Users\Public\bubblewrap\android_sdk'
$env:JAVA_TOOL_OPTIONS = '"-Djdk.net.unixdomain.tmpdir=C:\Users\Tyler R\source\repos\NinjaK\tmp"'
Set-Location 'C:\Users\Tyler R\source\repos\shinobi-twa'
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:bundleRelease --console=plain --no-daemon
```

The 16 September build passed and produced:

- `app/build/outputs/apk/debug/app-debug.apk`
- `app/build/outputs/bundle/release/app-release.aab` — **unsigned**, not uploaded.

An unsigned/local build cannot establish that Play update or review UI works on
an installed release. Use the existing release signing process and an internal
track to test a real upgrade, review invocation, return to gameplay, and launcher
artwork. The critical-update branch depends on the release's Play update priority.

References: [Play updates](https://developer.android.com/guide/playcore/in-app-updates/kotlin-java),
[Play review](https://developer.android.com/guide/playcore/in-app-review/kotlin-java),
and [Chrome Android intents](https://developer.chrome.com/docs/android/intents).
