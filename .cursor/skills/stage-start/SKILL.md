---
name: stage-start
description: Starts or resumes a NegotAItions engineering Change Unit through the Engineering Orchestrator. Use when asked to start a stage, create a worktree, or begin Product engineering work.
---

# Start a NegotAItions Stage

This Skill is a thin convenience wrapper. It is not a worktree, environment,
or lifecycle engine.

Start or resume the Product engineering Change Unit through EO
(`CONTINUE_CHANGE_UNIT` / `eo change-unit continue`). Do not manually create
or reuse a worktree. Do not copy env files.

EO resolves the current `origin/deploy/yandex-poc` baseline, a fresh sibling
workspace, branch, and the TYPED_IMPORT environment contract. Return or block
on that EO bootstrap result.

Success means EO reported workspace/environment readiness for the Change Unit.
Blocked means stop and report the EO block; do not improvise Git or `.env`
repair.

This Skill does not override scoped safety rules, `AGENTS.md`, or EO hard
execution safety.
