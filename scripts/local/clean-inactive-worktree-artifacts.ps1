<#
.SYNOPSIS
  Report (and optionally delete) generated build/test artifacts in inactive Git worktrees.

.DESCRIPTION
  Default mode is dry-run (-WhatIf semantics). Never deletes unless -Apply is specified
  together with -Force or interactive confirmation.

  Never uses git clean. Never deletes outside an allowlisted generated directory name.
  Never touches .env files, source, migrations, or .git metadata.

.PARAMETER Root
  Root folder containing worktrees.

.PARAMETER ActiveWorktree
  Worktree to exclude from cleanup.

.PARAMETER Apply
  Actually delete allowlisted generated folders after confirmation.

.PARAMETER Force
  Skip interactive confirmation when used with -Apply.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/local/clean-inactive-worktree-artifacts.ps1 `
    -ActiveWorktree "C:\Projects\Negotiations AI\negotiations-web-agent-performance" -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $false)]
    [string]$Root = "C:\Projects\Negotiations AI",

    [Parameter(Mandatory = $true)]
    [string]$ActiveWorktree,

    [Parameter(Mandatory = $false)]
    [switch]$Apply,

    [Parameter(Mandatory = $false)]
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AllowlistedNames = @(
    "node_modules",
    ".next",
    "playwright-report",
    "test-results",
    "coverage",
    ".turbo",
    ".cache",
    "dist",
    "build",
    "tmp",
    ".tmp",
    "local-performance-results",
    "artifacts",
    "voxengine-ci",
    ".voxengine-ci"
)

function Normalize-Path([string]$PathValue) {
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\', '/')
}

function Get-RegisteredWorktrees([string]$SeedRepo) {
    $lines = @(git -C $SeedRepo worktree list --porcelain)
    $paths = @()
    foreach ($line in $lines) {
        if ($line -like "worktree *") {
            $raw = $line.Substring("worktree ".Length).Replace('/', '\')
            $paths += (Normalize-Path $raw)
        }
    }
    return @($paths | Select-Object -Unique)
}

function Get-DirectorySizeBytes([string]$DirectoryPath) {
    # Stream-ish accumulation via Get-ChildItem; compatible with Windows PowerShell 5.1.
    $total = [int64]0
    try {
        Get-ChildItem -LiteralPath $DirectoryPath -Recurse -File -Force -ErrorAction SilentlyContinue |
            ForEach-Object {
                try {
                    $total += [int64]$_.Length
                }
                catch {
                    # Skip inaccessible files.
                }
            }
    }
    catch {
        return [int64]0
    }
    return $total
}

function Format-Size([int64]$Bytes) {
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

$Root = Normalize-Path $Root
$ActiveWorktree = Normalize-Path $ActiveWorktree

if (-not (Test-Path -LiteralPath $ActiveWorktree)) {
    throw "Active worktree not found: $ActiveWorktree"
}

$registered = Get-RegisteredWorktrees -SeedRepo $ActiveWorktree
if ($registered -notcontains $ActiveWorktree) {
    throw "Active worktree is not registered: $ActiveWorktree"
}

$inactive = @($registered | Where-Object { $_ -ne $ActiveWorktree })
Write-Host "Active worktree excluded: $ActiveWorktree"
Write-Host "Inactive worktrees scanned: $($inactive.Count)"
Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })"

$findings = @()
$totalBytes = [int64]0

foreach ($wt in $inactive) {
    if ($wt -notlike "$Root*") {
        continue
    }
    foreach ($name in $AllowlistedNames) {
        $candidate = Join-Path $wt $name
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
            continue
        }
        $size = Get-DirectorySizeBytes $candidate
        $totalBytes += $size
        $findings += [pscustomobject]@{
            Worktree = $wt
            Folder = $candidate
            Name = $name
            Bytes = $size
            Size = (Format-Size $size)
        }
    }
}

$findings = @($findings | Sort-Object Bytes -Descending)

Write-Host ""
Write-Host "Generated folders found: $($findings.Count)"
Write-Host "Reclaimable space (estimated): $(Format-Size $totalBytes)"
Write-Host ""

$findings |
    Select-Object Size, Name, Folder |
    Format-Table -AutoSize

if (-not $Apply) {
    Write-Host "No deletion performed (dry-run)."
    Write-Host "Apply command:"
    Write-Host ("powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Root `"$Root`" -ActiveWorktree `"$ActiveWorktree`" -Apply -Force")
    return
}

if (-not $Force) {
    $answer = Read-Host "Type DELETE to permanently remove the listed allowlisted folders"
    if ($answer -ne "DELETE") {
        Write-Host "Aborted; no deletion performed."
        return
    }
}

foreach ($item in $findings) {
    if (-not ($AllowlistedNames -contains $item.Name)) {
        throw "Refusing to delete non-allowlisted path: $($item.Folder)"
    }
    $leaf = Split-Path -Leaf $item.Folder
    if ($leaf -ne $item.Name) {
        throw "Safety check failed for $($item.Folder)"
    }
    if ($PSCmdlet.ShouldProcess($item.Folder, "Remove-Item -Recurse -Force")) {
        Remove-Item -LiteralPath $item.Folder -Recurse -Force -ErrorAction Stop
        Write-Host "Deleted: $($item.Folder)"
    }
}

Write-Host "Cleanup apply complete."
