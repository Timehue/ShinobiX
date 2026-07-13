[CmdletBinding()]
param(
    [string]$Branch,
    [string]$Remote = 'origin',
    [switch]$AllowDirty,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Read-Git {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    $output = & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
    return ($output | Select-Object -Last 1).Trim()
}

$repoRoot = Read-Git rev-parse --show-toplevel
$commonDir = Read-Git rev-parse --git-common-dir
$head = Read-Git rev-parse --verify 'HEAD^{commit}'
$currentBranch = (& git symbolic-ref --quiet --short HEAD)

if (-not $Branch) {
    if ($LASTEXITCODE -ne 0 -or -not $currentBranch) {
        throw 'Detached HEAD: pass -Branch codex/<name> explicitly.'
    }
    $Branch = $currentBranch.Trim()
}

if ($Branch -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -or $Branch.Contains('..') -or $Branch.EndsWith('/')) {
    throw "Invalid destination branch: $Branch"
}

$dirty = & git status --porcelain=v1
if ($LASTEXITCODE -ne 0) { throw 'Unable to read worktree status.' }
if ($dirty -and -not $AllowDirty) {
    throw 'This worktree has uncommitted changes. Commit them first, or pass -AllowDirty to push the existing HEAD only.'
}

$worktreeCount = ((& git worktree list --porcelain | Select-String '^worktree ').Count)
$destination = "refs/heads/$Branch"
$arguments = @('push', '--porcelain')
if ($DryRun) { $arguments += '--dry-run' }
$arguments += @($Remote, "HEAD:$destination")

Write-Output "Publishing without changing any checkout:"
Write-Output "  Worktree: $repoRoot"
Write-Output "  Commit:   $head"
Write-Output "  Target:   $Remote/$Branch"
Write-Output "  Shared worktrees left untouched: $worktreeCount"

& git @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Push rejected. Fetch/rebase in this worktree; no other worktree was changed."
}

if ($DryRun) {
    Write-Output 'Dry run succeeded; nothing was pushed.'
} else {
    Write-Output "Published $head to $Remote/$Branch."
}
