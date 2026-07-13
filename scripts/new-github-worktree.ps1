[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._/-]*$')]
    [string]$Name,

    [string]$Base = 'origin/main',

    [string]$Root,

    [switch]$NoFetch
)

$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = (Invoke-Git rev-parse --show-toplevel | Select-Object -Last 1).Trim()
$commonDir = (Invoke-Git rev-parse --git-common-dir | Select-Object -Last 1).Trim()
$repoName = Split-Path $repoRoot -Leaf
$safeName = $Name -replace '[^A-Za-z0-9._-]', '-'
$branch = if ($Name.StartsWith('codex/')) { $Name } else { "codex/$Name" }

if (-not $Root) {
    $Root = Join-Path (Split-Path $repoRoot -Parent) "$repoName-worktrees"
}
$Root = [System.IO.Path]::GetFullPath($Root)
$path = Join-Path $Root $safeName

if (Test-Path -LiteralPath $path) {
    throw "Worktree path already exists: $path"
}

& git show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) {
    throw "Local branch already exists: $branch"
}

if (-not $NoFetch) {
    Invoke-Git fetch --prune origin
}

Invoke-Git rev-parse --verify "$Base^{commit}" | Out-Null
New-Item -ItemType Directory -Force -Path $Root | Out-Null
Invoke-Git worktree add -b $branch $path $Base

Write-Output "Created isolated worktree:"
Write-Output "  Path:   $path"
Write-Output "  Branch: $branch"
Write-Output "  Base:   $Base"
Write-Output ""
Write-Output "Work only in that directory. Publish with:"
Write-Output "  powershell -File scripts/push-github-worktree.ps1"
