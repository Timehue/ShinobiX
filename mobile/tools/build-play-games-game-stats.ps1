$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$uploadRoot = Join-Path $repoRoot 'mobile\play-games\stats-upload'
$iconRoot = Join-Path $repoRoot 'mobile\play-games\stats-icons\png'
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("shinobi-pgs-stats-" + [guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $uploadRoot 'shinobi-game-stats.zip'

New-Item -ItemType Directory -Path $stageRoot | Out-Null
try {
    node (Join-Path $PSScriptRoot 'render-play-games-stat-icons.mjs') $iconRoot
    foreach ($fileName in @('PlayerGameEvent.csv', 'RepetitiveStatsConfig.csv', 'ProgressionStatConfig.csv')) {
        Copy-Item -LiteralPath (Join-Path $uploadRoot $fileName) -Destination $stageRoot
    }
    foreach ($fileName in @('contracts.png', 'pvp.png', 'ai_victories.png', 'pet_matches.png', 'story.png', 'level.png')) {
        Copy-Item -LiteralPath (Join-Path $iconRoot $fileName) -Destination $stageRoot
    }
    Compress-Archive -Path (Get-ChildItem -LiteralPath $stageRoot -File | ForEach-Object FullName) -DestinationPath $zipPath -CompressionLevel Optimal -Force
    Write-Output "Built $zipPath"
}
finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedStage = [System.IO.Path]::GetFullPath($stageRoot)
    if ($resolvedStage.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedStage -Leaf).StartsWith('shinobi-pgs-stats-', [System.StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}
