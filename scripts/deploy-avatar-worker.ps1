<#
.SYNOPSIS
Deploy the Make Model worker (Modal app shinobix-avatar-sprites) and prove it works before players reach it.

.DESCRIPTION
The one way to deploy the worker. Before 2026-11-25 every deploy used a one-off script in a gitignored folder, and
a worker that deployed cleanly and passed its local tests broke every portrait check for three days
(2026-11-21 to 11-24). This script:

  1. finds the intake, movement and recognition-pool bundles by the hashes the release pins, wherever they are;
  2. runs the worker's local tests, including the import guard that would have caught that outage;
  3. records the live version, then deploys, tagged with the git commit;
  4. runs the four per-image health checks and one real portrait read on the deployed app (smoke_read.py);
  5. if any of that fails, rolls Modal back to the version that was live before, and exits non-zero.

Cost per run: one portrait read on a GPU and four CPU health checks, a few cents. Nothing runs per player.
Needs the Modal venv at %LOCALAPPDATA%\shinobix-modal-1.6.3 (signed in) and this repo's node_modules.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts/deploy-avatar-worker.ps1
#>
param(
    [string]$Intake,
    [string]$Movement,
    [string]$Pool,
    [string]$Environment = 'shinobix-avatar-staging',
    [string]$SmokePortrait = 'shinobij.client/public/npc-portraits/daigo.avif',
    # Run the checks against the live worker without deploying. Versions before the health checks existed
    # (v18 and older) always fail them; their portrait read result is still printed.
    [switch]$SmokeOnly
)
$ErrorActionPreference = 'Stop'
$App = 'shinobix-avatar-sprites'
$PoolSha256 = 'cf8cce7d053b8982b773d75304625dc861122e791da3497b093527516067a31c'
$RecognitionModel = 'gpt-5.4-mini-2026-03-17'

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Fail([string]$text) { Write-Host "FAILED: $text" -ForegroundColor Red; exit 1 }

$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root
$venv = Join-Path $env:LOCALAPPDATA 'shinobix-modal-1.6.3'
$modal = Join-Path $venv 'Scripts\modal.exe'
$python = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $modal)) { Fail "No Modal venv at $venv." }
# PowerShell 5.1 turns a native tool's stderr (Modal's DeprecationWarnings) into errors under 'Stop'.
$ErrorActionPreference = 'Continue'
& $modal profile current 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Modal is not signed in on this PC.' }

function Find-Bundle([string]$given, [string]$sha256, [string]$label, [string[]]$names) {
    if ($given) {
        $actual = (Get-FileHash $given -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $sha256) { Fail "$label $given hashes $actual; the release pins $sha256." }
        return (Resolve-Path $given).Path
    }
    # The main checkout, then every worktree's and the Codex worktrees' evidence folders.
    $main = Split-Path (git rev-parse --path-format=absolute --git-common-dir).Trim()
    $places = @("$main\.ci-evidence", "$env:LOCALAPPDATA\shinobix-avatar-bundles") +
        @(Get-ChildItem "$main\.vs\NinjaK\.claude\worktrees\*\.ci-evidence" -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName) +
        @(Get-ChildItem "$env:USERPROFILE\.codex\worktrees\*\NinjaK\.ci-evidence" -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName)
    foreach ($place in $places | Where-Object { Test-Path $_ }) {
        foreach ($file in Get-ChildItem $place -Recurse -File -Include $names -ErrorAction SilentlyContinue) {
            if ((Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLower() -eq $sha256) { return $file.FullName }
        }
    }
    Fail "No $label bundle hashes $sha256. Pass -$label <path>, or rebuild it (workers/avatar-model/README.md)."
}

$pins = Get-Content 'workers\avatar-model\sprite-worker-painted-review.json' -Raw | ConvertFrom-Json
$head = (git rev-parse --short HEAD).Trim()
$dirty = @(git status --porcelain -- workers/avatar-model).Count

if (-not $SmokeOnly) {
    Step 'Bundles (located by their pinned hashes)'
    $Intake = Find-Bundle $Intake $pins.intake 'Intake' @('*intake*.zip', '*fit*.zip')
    $Movement = Find-Bundle $Movement $pins.movement 'Movement' @('*movement*.zip', '*motion*.zip')
    $Pool = Find-Bundle $Pool $PoolSha256 'Pool' @('recognition-pool*.zip')
    "intake   $Intake"; "movement $Movement"; "pool     $Pool"

    Step 'Local worker tests'
    $env:OPENAI_API_KEY = ''
    $env:PYTHONPATH = "$root\workers\avatar-model"
    foreach ($pattern in 'test_paint_step_errors.py', 'test_paint_execution.py', 'test_dispatch_read.py', 'test_dispatch_stage.py') {
        & $python -W ignore -m unittest discover -s workers/avatar-model/tests -p $pattern 2>&1 | Select-Object -Last 3 | ForEach-Object { "  $_" }
        if ($LASTEXITCODE -ne 0) { Fail "$pattern failed. Nothing was deployed." }
    }
    Remove-Item Env:OPENAI_API_KEY
}

Step 'Live version before this run'
$history = (& $modal app history $App --env $Environment --json 2>$null | Out-String) | ConvertFrom-Json
$previous = @($history)[0].version
if (-not $previous) { Fail "Could not read $App's deploy history." }
"live: $previous"

if (-not $SmokeOnly) {
    Step "Deploy $head ($dirty uncommitted worker files)"
    $env:SPRITE_PAINTED_COSTUMES = '1'
    $env:SPRITE_OPENAI_SECRET = 'openai-secret'
    $env:SPRITE_INTAKE_ZIP = $Intake
    $env:SPRITE_MOVEMENT_ZIP = $Movement
    $env:SPRITE_RECOGNITION_POOL_ZIP = $Pool
    $env:SPRITE_RECOGNITION_POOL_SHA256 = $PoolSha256
    $env:SPRITE_RECOGNITION_MODEL = $RecognitionModel
    $tag = if ($dirty) { "$head-dirty" } else { $head }
    & $modal deploy --env $Environment --tag $tag workers/avatar-model/modal_sprite_worker.py 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { Fail "modal deploy exited $LASTEXITCODE. The live version is still $previous." }
}

Step 'Health checks and one portrait read on the deployed worker'
$png = Join-Path ([IO.Path]::GetTempPath()) "avatar-worker-smoke-$PID.png"
$frameHash = (node --import tsx scripts/avatar-worker-smoke-frame.ts $SmokePortrait $png 2>&1 | Select-Object -Last 1).ToString().Trim()
if ($LASTEXITCODE -ne 0 -or $frameHash -notmatch '^[a-f0-9]{64}$') { $report = $null; $smokeError = "frame hash: $frameHash" }
else {
    $env:PYTHONPATH = "$root\workers\avatar-model"
    $line = & $python -W ignore workers/avatar-model/smoke_read.py $Environment $png $frameHash 2>$null | Select-Object -Last 1
    $smokeExit = $LASTEXITCODE
    Remove-Item $png -ErrorAction SilentlyContinue
    try { $report = $line | ConvertFrom-Json } catch { $report = $null }
    $smokeError = if (-not $report) { "no report (exit $smokeExit): $line" } else { $null }
}
if ($report) {
    foreach ($check in $report.health.PSObject.Properties) {
        $state = if ($check.Value.ok) { 'ok' } else { 'FAILED ' + (($check.Value.failures + $check.Value.detail) -join '; ') }
        "  $($check.Name): $state"
    }
    $read = if ($null -eq $report.read.declined) { "accepted ($($report.read.style))" } else { "FAILED $($report.read.declined) $($report.read.detail)" }
    "  portrait read: $read"
}
if ($report -and $report.ok) {
    Write-Host ''
    Write-Host ($(if ($SmokeOnly) { "WORKER-OK: $previous passes." } else { "DEPLOY-OK: $head is live and passed every check." })) -ForegroundColor Green
    exit 0
}
if ($smokeError) { "  $smokeError" }
if ($SmokeOnly) { Fail "The live worker ($previous) fails its checks." }

Step "Rolling back to $previous"
& $modal app rollback $App $previous --env $Environment 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Fail "The new worker failed its checks AND the rollback to $previous failed. Roll back by hand: modal app rollback $App $previous --env $Environment" }
Fail "The new worker failed its checks, so $previous is live again. Fix the failure above and deploy again."
