---
name: stage-start
description: Prepares a safe new NegotAItions development stage worktree from the authoritative baseline. Use when asked to start a stage, create a worktree, or establish a new stage branch.
---

# Start a NegotAItions Stage

Prepare the workspace only; do not implement features, run broad tests, access production, deploy, commit, or discard unrelated work.

1. Read `AGENTS.md`, current Git/worktree policy, and only the current environment guidance needed for copying local configuration. Verify the current worktree and branch before changing anything.
2. Fetch remote refs with `git fetch origin`. Unless the task explicitly names another baseline, use the current `origin/deploy/yandex-poc`; verify the ref exists and record its SHA. Never branch from an arbitrary current worktree HEAD.
3. Derive concise lowercase kebab-case branch and folder names from the requested stage/task. Retain a supplied stage number. Create the worktree as a direct sibling under `C:\Projects\Negotiations AI\`, never inside a repository or worktree. Legacy nested worktrees are not a template. When naming or baseline choice is materially ambiguous, show the proposed path and branch before creating it.
4. Create the worktree and verify the requested branch is checked out, HEAD is recorded, tracking/upstream state is understood, and the new worktree is clean. Do not reset, discard, or repair unrelated work.
5. Copy `.env` only when current repository policy explicitly confirms its authoritative source. For the documented local setup, that candidate is `C:\Projects\Negotiations AI\negotiations-web-server-stop-main\.env`; if policy does not confirm it, stop and report the missing authority. Safely verify source and destination existence, never print values, keep `.env` ignored/untracked, and do not create `.env.local` unless the task explicitly requires a policy-compliant temporary override.

## Start report

Return: worktree path; branch; baseline ref and SHA; current HEAD; upstream/tracking state; env copied or verified (without values); `git status`; and `READY` or `BLOCKED`. On a safety, baseline, path, or env-policy blocker, stop rather than improvising destructive Git or environment actions.

For detailed policy, follow `AGENTS.md`, `docs/operations/deployment-runbook.md`, and the applicable scoped rules; this Skill does not override them.
