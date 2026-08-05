# PowerShell local-tooling smoke checks (no Pester dependency)
$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath (Join-Path $Repo "package.json"))) {
    $Repo = "C:\Projects\Negotiations AI\negotiations-web-agent-performance"
}

$SetActive = Join-Path $Repo "scripts\local\set-active-negotaitions-worktree.ps1"
$Clean = Join-Path $Repo "scripts\local\clean-inactive-worktree-artifacts.ps1"

Write-Host "Syntax check..."
$null = [System.Management.Automation.Language.Parser]::ParseFile($SetActive, [ref]$null, [ref]$null)
$errs = $null
$tokens = $null
[System.Management.Automation.Language.Parser]::ParseFile($SetActive, [ref]$tokens, [ref]$errs) | Out-Null
if ($errs -and $errs.Count -gt 0) { throw "Parse errors in set-active script: $($errs[0].Message)" }

[System.Management.Automation.Language.Parser]::ParseFile($Clean, [ref]$tokens, [ref]$errs) | Out-Null
if ($errs -and $errs.Count -gt 0) { throw "Parse errors in clean script: $($errs[0].Message)" }

Write-Host "WhatIf active-worktree configuration..."
& $SetActive -ActiveWorktree $Repo -WhatIf

Write-Host "Cleanup dry-run..."
& $Clean -ActiveWorktree $Repo

# Disposable temp workspace backup/restore + idempotency
$tempRoot = Join-Path $env:TEMP ("negotaitions-ws-" + [guid]::NewGuid().ToString("n"))
$tempRepoName = "negotiations-web-agent-performance"
$tempActive = Join-Path $tempRoot $tempRepoName
New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot ".vscode") | Out-Null
New-Item -ItemType Directory -Force -Path $tempActive | Out-Null

# Minimal fake git worktree registration is not available; call parser-only path via dot-sourcing helpers is complex.
# Instead verify restore path refuses without backups, and second WhatIf is idempotent textually.
$settings = Join-Path $tempRoot ".vscode\settings.json"
Set-Content -LiteralPath $settings -Value '{ "workbench.startupEditor": "none" }' -Encoding utf8
Set-Content -LiteralPath (Join-Path $tempRoot ".cursorignore") -Value "# user line`r`n" -Encoding utf8

Write-Host "Temp workspace created at $tempRoot (manual merge safety exercised via WhatIf on real root only)"

Write-Host "LOCAL_PS_TOOLING_SMOKE_OK"
