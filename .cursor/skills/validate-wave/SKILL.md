---
name: validate-wave
description: Orchestrates deterministic NegotAItions post-implementation validation through the Luna validation-runner. Use after implementation to select required checks, keep raw green logs out of the parent context, and handle failures safely.
---

# Validate a NegotAItions Wave

Use this Skill after implementation. It orchestrates validation; it does not replace `AGENTS.md`, scoped rules, or repository testing policy.

## Select the manifest

1. Inspect changed files and task scope. Read only the relevant testing guidance and scoped rules; use `test-explorer` when the cheapest sufficient regression set is unclear.
2. Select focused unit/API/integration checks first. Determine required repository gates from the changed scope and current authoritative policy. When multiple standard gates are required, preserve this order: `validate:fast` → `validate:deploy` → `test:e2e:smoke` → `test:e2e:smoke:browser`.
3. Do not assume every non-doc change requires all four gates. Narrow reviewed remediation may use focused revalidation only when repository policy or review evidence explicitly permits it. Include E2E DB preflight and migration status only when applicable.
4. Do not add observer scaling/layout, live-provider, tunnel, full-suite, or production checks unless the changed scope and authoritative policy require them. Classify E2E DB isolation, migration, provider, and production impact.

## Delegate execution

The parent (default Grok 4.6; see `docs/testing/agent-model-routing.md`) delegates the explicit deterministic manifest to Luna `validation-runner`; the parent does not run long successful validation merely to collect logs. The delegation supplies worktree/branch, changed scope, commands in required order, applicable preflights, and requested evidence. `validation-runner` retains raw successful logs and returns either `VALIDATION EVIDENCE` or a `FAILURE CAPSULE`; it must not modify product source.

On success, use evidence containing focused and required results (counts/status and practical durations), DB/E2E isolation, migration status when relevant, `git diff --check`, skipped suites with reasons, provider/production classification, warnings/manual checks, `git diff --stat`, and `git status --short`.

## Failure loop

The parent decides remediation. After a fix, delegate only: the directly failing focused test, the affected required gate, then remaining still-required gates. Do not restart already-green gates without a dependency reason. If evidence shows an unrelated failure, classify it narrowly, record separate validation debt when justified, and continue only where policy permits.

## Review boundary

Deterministic validation is not architectural or security review. The parent handles ordinary remediation and reporting. Escalate to Terra or Sol only when `docs/testing/agent-model-routing.md` criteria are met, using a localized diff/evidence packet—not raw logs or a repository-wide reread.

Read `docs/testing/validation-checklist.md`, `docs/testing/e2e-strategy.md`, and `docs/testing/observer-test-execution-policy.md` only when their scope applies.
