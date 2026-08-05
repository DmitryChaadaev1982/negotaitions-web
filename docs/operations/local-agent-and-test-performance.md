# Local agent and test performance

Concise runbook for Cursor agents and local validation on the multi-worktree Windows workstation.

## Hardware / workspace baseline (measured)

| Fact | Value |
|------|-------|
| CPU | 16 logical processors |
| RAM | 31.9 GB |
| Docker | 29.6.2 |
| Power plan | Balanced |
| Node | v24.17.0 |
| npm | 11.13.0 |
| Registered Git worktrees | 24 |
| Root workspace | `C:\Projects\Negotiations AI` (folder workspace, not `.code-workspace`) |
| `npm ci` (cold worktree) | 79.8 s (install only; excluded from gate timings) |
| `git status --short` | 105 ms |
| Baseline `npm run validate:deploy` | **135.1 s** |
| After `npm run validate:agent -- --mode=deploy` | **115.0 s** (includes extra email template validate) |
| Measured comparable improvement | **14.9%** faster (1.17×); warm-machine caveat |
| Inactive generated artifacts (dry-run) | **~27.53 GB** reclaimable across 23 worktrees; no deletion performed |

Inactive worktrees must remain visible in Explorer. They may be excluded from search, indexing, and file watching.

## npm dependency graph (summary)

- `validate:fast` = lint + prisma validate + prisma generate + `test:unit` + `test:e2e:list`
- `validate:deploy` = **entire** `validate:fast` + `next build`
- Running `test:unit` + `validate:fast` + `validate:deploy` repeats unit/lint/prisma work up to **3×**
- `@smoke` and `@browser-smoke` are **distinct** assurances; never merge them
- Observer layout / full Playwright / tunnel / live-provider remain opt-in

Artifacts:

- `docs/tooling/validation-dependency-graph.json`
- `docs/tooling/validation-dependency-graph-audit.md`

## Canonical agent validation

```bash
npm run validate:agent -- --plan
npm run validate:agent -- --mode=deploy
npm run validate:agent -- --mode=full
npm run validate:agent -- --mode=full --with=stage310
npm run validate:agent -- --mode=full --json
```

Modes:

| Mode | Primitives (once each) |
|------|------------------------|
| `fast` | lint, prisma validate/generate, unit, e2e list, email templates |
| `deploy` (default) | fast + production build |
| `runtime` | `@smoke` then `@browser-smoke` |
| `full` | deploy union + runtime smokes |
| `tooling` | agent tooling unit tests |

Behavior: fail-fast, sequential, within-process dedup only, sanitized logs, no cross-SHA cache.

Backward compatible: existing `validate:fast` / `validate:deploy` / smoke scripts remain unchanged.

## Future prompt convention

1. Focused implementation: targeted unit/lint only for the changed scope (+ `npm run validate:agent -- --mode=tooling` when editing agent scripts).
2. One final deployment-equivalent gate: `npm run validate:agent -- --mode=deploy` (do **not** also run `validate:fast` + `validate:deploy`).
3. Browser smoke: either `npm run validate:agent -- --mode=runtime` or include them via `--mode=full`.
4. Stage extensions: `--with=stage310` / `--with=stage313c` / `--with=stage313c-remediation` explicitly.

Do **not** chain overlapping composites sequentially.

## Active worktree configuration (root local files)

```powershell
powershell -ExecutionPolicy Bypass -File `
  scripts/local/set-active-negotaitions-worktree.ps1 `
  -ActiveWorktree "C:\Projects\Negotiations AI\negotiations-web-agent-performance"
```

WhatIf:

```powershell
powershell -ExecutionPolicy Bypass -File `
  scripts/local/set-active-negotaitions-worktree.ps1 `
  -ActiveWorktree "C:\Projects\Negotiations AI\negotiations-web-agent-performance" `
  -WhatIf
```

Rollback:

```powershell
powershell -ExecutionPolicy Bypass -File `
  scripts/local/set-active-negotaitions-worktree.ps1 `
  -Restore
```

Effects:

- Updates root `.vscode/settings.json` (`files.watcherExclude`, `search.exclude`, `git.scanRepositories`)
- Updates root `.cursorignore` managed block
- Does **not** use `files.exclude` for worktree folders (Explorer stays populated)
- Does **not** commit root local config
- Reload the Cursor window manually after apply

No root launcher script was found under `C:\Projects\Negotiations AI`; use the command above when switching worktrees.

## Inactive artifact cleanup (dry-run default)

```powershell
powershell -ExecutionPolicy Bypass -File `
  scripts/local/clean-inactive-worktree-artifacts.ps1 `
  -ActiveWorktree "C:\Projects\Negotiations AI\negotiations-web-agent-performance"
```

Apply (explicit, destructive):

```powershell
powershell -ExecutionPolicy Bypass -File `
  scripts/local/clean-inactive-worktree-artifacts.ps1 `
  -ActiveWorktree "C:\Projects\Negotiations AI\negotiations-web-agent-performance" `
  -Apply -Force
```

## Commands that remain intentionally separate

- `test:e2e:smoke` vs `test:e2e:smoke:browser` (different grep tags)
- Stage suites (`test:stage310`, `test:stage313c*`, verifiers)
- `test:e2e:observer:layout` (geometry-only; see observer policy)
- Tunnel / live-provider / full Playwright
- Production migration / SSH / real email

## Hardware changes not currently justified

Do not auto-change Defender, BIOS, Docker resources, or power plan. Optional manual only during long runs: Windows Best Performance power mode. Dev Drive / Defender performance mode may be evaluated later; not required for this tooling change.

## Residual limitations

- Cloud model latency dominates many agent turns; local gates cannot remove that
- Next production build remains CPU-bound and sequential
- Managed Playwright still cold-starts Next on port 3100 per suite
- Root watcher/search gains require a Cursor window reload
- Cross-run gate caching is intentionally out of scope
