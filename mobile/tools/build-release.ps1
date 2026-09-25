<#
.SYNOPSIS
  Build the signed Play upload bundle (AAB) for the Shinobi Journey Android app.

.DESCRIPTION
  Run this yourself, in your own PowerShell window: it asks for the keystore
  passwords, and they never touch a file. They live only in this process's
  environment for the length of the build and are cleared afterwards.

  The upload key is the one the old TWA was signed with. Play only accepts an
  upload signed by that key, so this script checks the finished bundle's
  certificate against it before telling you it is ready.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File mobile\tools\build-release.ps1
#>
param(
    [string]$Keystore = 'C:\Users\Tyler R\source\repos\shinobi-twa\android.keystore',
    [string]$KeyAlias = 'android',
    [string]$Flutter = 'C:\src\flutter\bin\flutter.bat',
    [string]$PubCache = 'C:\src\pub-cache',
    [string]$GradleHome = 'C:\src\gradle-home',
    # Passed to Flutter and Gradle explicitly rather than trusting `flutter
    # config`, which lives in one Windows profile and is invisible to another
    # (an elevated window, a different account).
    [string]$AndroidSdk = 'C:\Users\Public\bubblewrap\android_sdk',
    # 64-bit JDK 17+. Bubblewrap's own JDK is 32-bit and cannot run this build.
    [string]$JavaHome = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
)

$ErrorActionPreference = 'Stop'

# SHA-256 of the Play upload certificate (also listed in /.well-known/assetlinks.json).
$ExpectedUploadCert = 'BD:60:BB:94:AC:51:CF:C2:05:8F:35:42:86:9D:9A:37:99:8B:4E:4F:E2:84:60:02:DB:A8:58:7B:73:4E:97:8A'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path $Keystore)) { throw "Keystore not found: $Keystore" }
if (-not (Test-Path $Flutter)) { throw "Flutter not found: $Flutter" }
if (-not (Test-Path (Join-Path $AndroidSdk 'platform-tools'))) { throw "Android SDK not found: $AndroidSdk" }
if (-not (Test-Path (Join-Path $JavaHome 'bin\java.exe'))) { throw "Java not found: $JavaHome" }

# Flutter keeps these in %APPDATA%\.flutter_settings, and a window whose APPDATA
# differs sees none of them ("No Android SDK found"). Record them from THIS
# window, every run; the values are the same each time.
& $Flutter config --android-sdk $AndroidSdk --jdk-dir $JavaHome | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'flutter config failed' }

$version = (Select-String -Path (Join-Path $repo 'mobile\pubspec.yaml') -Pattern '^version:\s*(\S+)').Matches[0].Groups[1].Value
Write-Host "Building Shinobi Journey $version (name+versionCode)." -ForegroundColor Cyan
Write-Host 'The versionCode after the + must be higher than every build already uploaded to Play.'

function Read-Secret([string]$prompt) {
    $secure = Read-Host -Prompt $prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$storePassword = Read-Secret 'Keystore password'
$keyPassword = Read-Secret 'Key password (press Enter if it is the same)'
if ([string]::IsNullOrEmpty($keyPassword)) { $keyPassword = $storePassword }

# Build through a short drive letter: no spaces and no deep paths for Gradle.
$used = (Get-PSDrive -PSProvider FileSystem).Name
$letter = @('S', 'Q', 'W', 'Y', 'X', 'V') | Where-Object { $used -notcontains $_ } | Select-Object -First 1
if (-not $letter) { throw 'No free drive letter for the build.' }
subst "$($letter):" $repo
if ($LASTEXITCODE -ne 0) { throw "subst $($letter): failed" }

try {
    $env:SJ_UPLOAD_STORE_FILE = $Keystore
    $env:SJ_UPLOAD_STORE_PASSWORD = $storePassword
    $env:SJ_UPLOAD_KEY_ALIAS = $KeyAlias
    $env:SJ_UPLOAD_KEY_PASSWORD = $keyPassword
    $env:PUB_CACHE = $PubCache
    $env:GRADLE_USER_HOME = $GradleHome
    $env:ANDROID_HOME = $AndroidSdk
    $env:ANDROID_SDK_ROOT = $AndroidSdk
    $env:JAVA_HOME = $JavaHome
    # Java puts a socket file in a temp folder; a profile path with a space in
    # it has failed that before ("Unable to establish loopback connection").
    $socketDir = Join-Path $GradleHome 'jvm-tmp'
    New-Item -ItemType Directory -Force $socketDir | Out-Null
    $env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$($socketDir.Replace('\', '/'))"

    Push-Location "$($letter):\mobile"
    try {
        & $Flutter pub get
        if ($LASTEXITCODE -ne 0) { throw 'flutter pub get failed' }
        & $Flutter build appbundle --release
        if ($LASTEXITCODE -ne 0) { throw 'flutter build appbundle failed' }
    }
    finally { Pop-Location }
}
finally {
    foreach ($name in 'SJ_UPLOAD_STORE_FILE', 'SJ_UPLOAD_STORE_PASSWORD', 'SJ_UPLOAD_KEY_ALIAS', 'SJ_UPLOAD_KEY_PASSWORD', 'JAVA_TOOL_OPTIONS') {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    $storePassword = $null
    $keyPassword = $null
    subst "$($letter):" /D | Out-Null
}

$aab = Join-Path $repo 'mobile\build\app\outputs\bundle\release\app-release.aab'
if (-not (Test-Path $aab)) { throw "No bundle at $aab" }

# The same keytool that signs Java archives can read the bundle's certificate.
$keytool = Join-Path $JavaHome 'bin\keytool.exe'
$cert = & $keytool -printcert -jarfile $aab 2>$null | Select-String -Pattern 'SHA256:\s*(\S+)' | Select-Object -First 1
$actual = if ($cert) { $cert.Matches[0].Groups[1].Value } else { '' }

if ($actual -ne $ExpectedUploadCert) {
    Write-Host ''
    Write-Host 'STOP: the bundle is NOT signed with the Play upload key.' -ForegroundColor Red
    Write-Host "  expected $ExpectedUploadCert"
    Write-Host "  got      $actual"
    Write-Host 'Play will reject this upload. Check the keystore path and alias.'
    exit 1
}

Write-Host ''
Write-Host "Ready to upload: $aab" -ForegroundColor Green
Write-Host "Signed with the Play upload key ($actual)."
Write-Host 'Upload it to Internal testing first; see mobile\README.md for the checklist.'
