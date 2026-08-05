<#
.SYNOPSIS
  Configure Cursor/VS Code root workspace search, watcher, and indexing exclusions
  so one Git worktree stays active while inactive worktrees remain visible in Explorer.

.DESCRIPTION
  Updates only local root files outside the Git repository:
    - <Root>\.vscode\settings.json
    - <Root>\.cursorignore

  Does not use files.exclude for worktree directories (Explorer stays populated).
  Does not modify Git branches, worktree contents, or application env files.
  Does not restart or terminate Cursor.

.PARAMETER ActiveWorktree
  Absolute path to the registered Git worktree that should remain searchable/indexable.

.PARAMETER Root
  Root folder workspace path. Default: C:\Projects\Negotiations AI

.PARAMETER WhatIf
  Show proposed changes without writing files.

.PARAMETER Restore
  Restore the newest timestamped backup pair (settings + cursorignore).

.PARAMETER BackupStamp
  Optional explicit backup stamp (yyyyMMdd-HHmmss) for Restore.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/local/set-active-negotaitions-worktree.ps1 `
    -ActiveWorktree "C:\Projects\Negotiations AI\negotiations-web-agent-performance"
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $false)]
    [string]$ActiveWorktree,

    [Parameter(Mandatory = $false)]
    [string]$Root = "C:\Projects\Negotiations AI",

    [Parameter(Mandatory = $false)]
    [switch]$Restore,

    [Parameter(Mandatory = $false)]
    [string]$BackupStamp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ManagedSettingsBegin = "// BEGIN NEGOTAITIONS-ACTIVE-WORKTREE"
$ManagedSettingsEnd = "// END NEGOTAITIONS-ACTIVE-WORKTREE"
$ManagedCursorBegin = "# BEGIN NEGOTAITIONS-ACTIVE-WORKTREE"
$ManagedCursorEnd = "# END NEGOTAITIONS-ACTIVE-WORKTREE"

$GeneratedExcludePatterns = @(
    "**/node_modules/**",
    "**/.next/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/.cache/**",
    "**/dist/**",
    "**/build/**",
    "**/tmp/**",
    "**/.tmp/**",
    "**/local-performance-results/**",
    "**/artifacts/**",
    "**/.agent/**",
    "**/voxengine-ci/**",
    "**/.voxengine-ci/**"
)

function Write-Info([string]$Message) {
    Write-Host $Message
}

function Normalize-Path([string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return ""
    }
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\', '/')
}

function Get-RelativeWorktreeName([string]$RootPath, [string]$WorktreePath) {
    $rootNorm = Normalize-Path $RootPath
    $wtNorm = Normalize-Path $WorktreePath
    if (-not $wtNorm.StartsWith($rootNorm, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Worktree is outside root workspace: $WorktreePath"
    }
    $relative = $wtNorm.Substring($rootNorm.Length).TrimStart('\', '/')
    if ([string]::IsNullOrWhiteSpace($relative)) {
        throw "Active worktree cannot be the root folder itself."
    }
    return $relative.Replace('\', '/')
}

function Get-RegisteredWorktrees([string]$SeedRepo) {
    if (-not (Test-Path -LiteralPath $SeedRepo)) {
        throw "Seed repository not found: $SeedRepo"
    }
    $lines = @(git -C $SeedRepo worktree list --porcelain)
    $paths = @()
    foreach ($line in $lines) {
        if ($line -like "worktree *") {
            $raw = $line.Substring("worktree ".Length).Replace('/', '\')
            $paths += (Normalize-Path $raw)
        }
    }
    return $paths | Select-Object -Unique
}

function Get-JsoncSettingsObject([string]$RawText) {
    # Strip // managed markers and line comments outside strings is hard;
    # require JSONC that remains parseable after removing // and /* */ comments naively.
    $withoutBlock = [regex]::Replace($RawText, "/\*[\s\S]*?\*/", "")
    $withoutLine = [regex]::Replace($withoutBlock, "(?m)^\s*//.*$", "")
    # Also remove inline // comments that are not inside quotes (best-effort).
    $cleanedLines = foreach ($line in ($withoutLine -split "`r?`n")) {
        $inString = $false
        $escaped = $false
        $chars = New-Object System.Collections.Generic.List[char]
        for ($i = 0; $i -lt $line.Length; $i++) {
            $ch = $line[$i]
            if ($escaped) {
                $chars.Add($ch) | Out-Null
                $escaped = $false
                continue
            }
            if ($ch -eq '\') {
                $chars.Add($ch) | Out-Null
                $escaped = $true
                continue
            }
            if ($ch -eq '"') {
                $inString = -not $inString
                $chars.Add($ch) | Out-Null
                continue
            }
            if (-not $inString -and $ch -eq '/' -and ($i + 1) -lt $line.Length -and $line[$i + 1] -eq '/') {
                break
            }
            $chars.Add($ch) | Out-Null
        }
        -join $chars
    }
    $jsonText = ($cleanedLines -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($jsonText)) {
        return [pscustomobject]@{}
    }
    try {
        return ($jsonText | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        throw "Unable to parse settings JSONC safely: $($_.Exception.Message)"
    }
}

function ConvertTo-PrettyJson($Object) {
    return ($Object | ConvertTo-Json -Depth 20)
}

function Ensure-ParentDirectory([string]$FilePath) {
    $dir = Split-Path -Parent $FilePath
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
}

function Backup-File([string]$FilePath, [string]$Stamp, [string]$BackupRoot) {
    if (-not (Test-Path -LiteralPath $FilePath)) {
        return $null
    }
    Ensure-ParentDirectory (Join-Path $BackupRoot "dummy")
    $name = Split-Path -Leaf $FilePath
    $dest = Join-Path $BackupRoot "$name.$Stamp.bak"
    Copy-Item -LiteralPath $FilePath -Destination $dest -Force
    return $dest
}

function Remove-ManagedBlock([string]$Text, [string]$Begin, [string]$End) {
    if ([string]::IsNullOrEmpty($Text)) {
        return ""
    }
    $pattern = "(?ms)" + [regex]::Escape($Begin) + ".*?" + [regex]::Escape($End) + "\r?\n?"
    return [regex]::Replace($Text, $pattern, "").TrimEnd() + "`r`n"
}

function Build-CursorIgnoreContent(
    [string]$Existing,
    [string[]]$InactiveRelativeNames,
    [string[]]$GeneratedPatterns
) {
    $preserved = Remove-ManagedBlock $Existing $ManagedCursorBegin $ManagedCursorEnd
    $blockLines = @(
        $ManagedCursorBegin
        "# Managed by scripts/local/set-active-negotaitions-worktree.ps1"
        "# Inactive worktrees excluded from Cursor indexing; Explorer visibility unchanged."
    )
    foreach ($name in ($InactiveRelativeNames | Sort-Object)) {
        $blockLines += "$name/"
    }
    $blockLines += ""
    $blockLines += "# Generated / noisy directories"
    foreach ($pattern in $GeneratedPatterns) {
        $blockLines += $pattern
    }
    $blockLines += $ManagedCursorEnd
    $block = ($blockLines -join "`r`n") + "`r`n"

    if ([string]::IsNullOrWhiteSpace($preserved)) {
        return $block
    }
    return ($preserved.TrimEnd() + "`r`n`r`n" + $block)
}

function Merge-SettingsObject(
    $ExistingObject,
    [string]$ActiveRelative,
    [string[]]$InactiveRelativeNames,
    [string[]]$GeneratedPatterns
) {
    $settings = if ($null -eq $ExistingObject) { [pscustomobject]@{} } else { $ExistingObject }

    # Preserve unrelated settings; only rewrite watcher/search exclude maps and optional git scan hint.
    $watcher = @{}
    $search = @{}

    foreach ($pattern in $GeneratedPatterns) {
        $watcher[$pattern] = $true
        $search[$pattern] = $true
    }
    foreach ($name in $InactiveRelativeNames) {
        $watcher["$name/**"] = $true
        $search["$name/**"] = $true
    }

    # Keep active worktree searchable: ensure it is not present in excludes.
    $null = $watcher.Remove("$ActiveRelative/**")
    $null = $search.Remove("$ActiveRelative/**")

    $settings | Add-Member -NotePropertyName "files.watcherExclude" -NotePropertyValue ([pscustomobject]$watcher) -Force
    $settings | Add-Member -NotePropertyName "search.exclude" -NotePropertyValue ([pscustomobject]$search) -Force

    # Opt-in Git scan narrowing: prefer the active worktree without disabling Git globally.
    $settings | Add-Member -NotePropertyName "git.enabled" -NotePropertyValue $true -Force
    $settings | Add-Member -NotePropertyName "git.autoRepositoryDetection" -NotePropertyValue "subFolders" -Force
    $settings | Add-Member -NotePropertyName "git.scanRepositories" -NotePropertyValue @($ActiveRelative) -Force
    $settings | Add-Member -NotePropertyName "git.repositoryScanMaxDepth" -NotePropertyValue 0 -Force
    $settings | Add-Member -NotePropertyName "git.detectWorktrees" -NotePropertyValue $false -Force
    $settings | Add-Member -NotePropertyName "git.detectSubmodules" -NotePropertyValue $false -Force
    $settings | Add-Member -NotePropertyName "git.openRepositoryInParentFolders" -NotePropertyValue "never" -Force

    # Helpful terminal default into the active worktree (does not hide others).
    $activeFull = Join-Path $Root $ActiveRelative.Replace('/', '\')
    $settings | Add-Member -NotePropertyName "terminal.integrated.cwd" -NotePropertyValue $activeFull -Force
    $settings | Add-Member -NotePropertyName "terminal.integrated.splitCwd" -NotePropertyValue "initial" -Force

    return $settings
}

function Write-SettingsFile([string]$Path, $SettingsObject, [string]$ActiveRelative) {
    $json = ConvertTo-PrettyJson $SettingsObject
    $content = @(
        $ManagedSettingsBegin
        "// Managed active worktree: $ActiveRelative"
        "// Generated by scripts/local/set-active-negotaitions-worktree.ps1"
        "// Do not hand-edit the managed keys below without updating the script."
        $ManagedSettingsEnd
        $json
    ) -join "`r`n"
    Set-Content -LiteralPath $Path -Value $content -Encoding utf8
}

# --- main ---

$Root = Normalize-Path $Root
if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw "Root workspace not found: $Root"
}

$settingsPath = Join-Path $Root ".vscode\settings.json"
$cursorIgnorePath = Join-Path $Root ".cursorignore"
$backupRoot = Join-Path $Root ".vscode\negotaitions-worktree-backups"

if ($Restore) {
    $stamp = $BackupStamp
    if ([string]::IsNullOrWhiteSpace($stamp)) {
        $candidates = @(Get-ChildItem -LiteralPath $backupRoot -Filter "settings.json.*.bak" -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending)
        if ($candidates.Count -eq 0) {
            throw "No settings backups found in $backupRoot"
        }
        # settings.json.yyyyMMdd-HHmmss.bak
        $stamp = $candidates[0].Name.Replace("settings.json.", "").Replace(".bak", "")
    }

    $settingsBackup = Join-Path $backupRoot "settings.json.$stamp.bak"
    $cursorBackup = Join-Path $backupRoot "cursorignore.$stamp.bak"

    if (-not (Test-Path -LiteralPath $settingsBackup)) {
        throw "Settings backup missing: $settingsBackup"
    }

    if ($PSCmdlet.ShouldProcess($settingsPath, "Restore from $settingsBackup")) {
        Ensure-ParentDirectory $settingsPath
        Copy-Item -LiteralPath $settingsBackup -Destination $settingsPath -Force
        if (Test-Path -LiteralPath $cursorBackup) {
            Copy-Item -LiteralPath $cursorBackup -Destination $cursorIgnorePath -Force
        }
        Write-Info "Restored root settings from stamp $stamp"
        Write-Info "Reload the Cursor window to apply changes."
    }
    return
}

if ([string]::IsNullOrWhiteSpace($ActiveWorktree)) {
    throw "ActiveWorktree is required unless -Restore is specified."
}

$ActiveWorktree = Normalize-Path $ActiveWorktree
if (-not (Test-Path -LiteralPath $ActiveWorktree -PathType Container)) {
    throw "Active worktree path not found: $ActiveWorktree"
}

$registered = @(Get-RegisteredWorktrees -SeedRepo $ActiveWorktree)
if ($registered -notcontains $ActiveWorktree) {
    throw "Active worktree is not a registered Git worktree: $ActiveWorktree"
}

$activeRelative = Get-RelativeWorktreeName -RootPath $Root -WorktreePath $ActiveWorktree
$inactive = @()
foreach ($wt in $registered) {
    try {
        $rel = Get-RelativeWorktreeName -RootPath $Root -WorktreePath $wt
    }
    catch {
        # Nested/outside paths are skipped from exclusion management.
        continue
    }
    if ($rel -ne $activeRelative) {
        $inactive += $rel
    }
}
$inactive = @($inactive | Sort-Object -Unique)

Write-Info "Root workspace:     $Root"
Write-Info "Active worktree:    $ActiveWorktree"
Write-Info "Active relative:    $activeRelative"
Write-Info "Inactive worktrees: $($inactive.Count)"
Write-Info "Explorer visibility: preserved (files.exclude not applied to worktrees)"

$existingSettingsRaw = ""
if (Test-Path -LiteralPath $settingsPath) {
    $existingSettingsRaw = Get-Content -LiteralPath $settingsPath -Raw -ErrorAction Stop
}

$existingCursor = ""
if (Test-Path -LiteralPath $cursorIgnorePath) {
    $existingCursor = Get-Content -LiteralPath $cursorIgnorePath -Raw -ErrorAction Stop
}

try {
    $existingObject = if ([string]::IsNullOrWhiteSpace($existingSettingsRaw)) {
        [pscustomobject]@{}
    } else {
        Get-JsoncSettingsObject $existingSettingsRaw
    }
}
catch {
    $proposedPath = Join-Path $Root ".vscode\settings.proposed.active-worktree.json"
    $merged = Merge-SettingsObject -ExistingObject ([pscustomobject]@{}) -ActiveRelative $activeRelative `
        -InactiveRelativeNames $inactive -GeneratedPatterns $GeneratedExcludePatterns
    $merged | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $proposedPath -Encoding utf8
    Write-Info "MANUAL_INTERVENTION_REQUIRED"
    Write-Info "Could not safely parse existing settings. Proposed file written to:"
    Write-Info $proposedPath
    throw
}

$mergedSettings = Merge-SettingsObject -ExistingObject $existingObject -ActiveRelative $activeRelative `
    -InactiveRelativeNames $inactive -GeneratedPatterns $GeneratedExcludePatterns
$newCursor = Build-CursorIgnoreContent -Existing $existingCursor -InactiveRelativeNames $inactive `
    -GeneratedPatterns $GeneratedExcludePatterns

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

if (-not $PSCmdlet.ShouldProcess($settingsPath, "Update active-worktree exclusions")) {
    Write-Info ""
    Write-Info "WHATIF / preview"
    Write-Info "Would backup to: $backupRoot\*.$stamp.bak"
    Write-Info "Would set files.watcherExclude + search.exclude for $($inactive.Count) inactive worktrees"
    Write-Info "Would keep active worktree searchable: $activeRelative"
    Write-Info "Would update git.scanRepositories to: $activeRelative"
    Write-Info "Would update .cursorignore managed block"
    Write-Info "files.exclude for worktrees: NOT applied"
    return
}

Ensure-ParentDirectory $settingsPath
Ensure-ParentDirectory (Join-Path $backupRoot "dummy")

$null = Backup-File -FilePath $settingsPath -Stamp $stamp -BackupRoot $backupRoot
if (Test-Path -LiteralPath $cursorIgnorePath) {
    $cursorBackupName = Join-Path $backupRoot "cursorignore.$stamp.bak"
    Copy-Item -LiteralPath $cursorIgnorePath -Destination $cursorBackupName -Force
}

Write-SettingsFile -Path $settingsPath -SettingsObject $mergedSettings -ActiveRelative $activeRelative
Set-Content -LiteralPath $cursorIgnorePath -Value $newCursor -Encoding utf8

Write-Info ""
Write-Info "ACTIVE_WORKTREE_CONFIGURED"
Write-Info "Backup stamp: $stamp"
Write-Info "Settings:     $settingsPath"
Write-Info "Cursorignore: $cursorIgnorePath"
Write-Info "Reload the Cursor window to apply watcher/search/index changes."
Write-Info "Rollback: powershell -ExecutionPolicy Bypass -File scripts/local/set-active-negotaitions-worktree.ps1 -Restore -BackupStamp $stamp"
