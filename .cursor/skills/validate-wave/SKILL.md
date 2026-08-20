---
name: validate-wave
description: Orchestrates deterministic NegotAItions validation execution through the Luna validation-runner. Use after implementation to execute the planned checks, keep raw green logs out of the parent context, and handle failures safely.
---

# Validate a NegotAItions Wave

Use this Skill **after implementation** to **execute** the Validation Plan.
It does not replace `AGENTS.md`, scoped rules, or repository testing policy.
Eval selection and the Validation Plan belong **before** implementation; see
[`docs/testing/engineering-workflow.md`](../../../docs/testing/engineering-workflow.md).
Ladder command mapping lives in
[`docs/testing/validation-checklist.md`](../../../docs/testing/validation-checklist.md).

Parent model, validation-runner model, and escalation policy:
[`docs/testing/agent-model-routing.md`](../../../docs/testing/agent-model-routing.md).

## Reconcile the plan with the actual diff

Do **not** start by inspecting changed files and deciding afterward what
seems necessary.

1. Read the approved CIA / stage manifest / Change Unit plan.
2. Read planned eval classes / Eval IDs and the planned validation level.
3. Inspect the actual diff and implementation.
4. Reconcile planned evidence with actual impact.
5. The actual implementation/diff **may raise** the required validation
   level or add evals. It must **not** silently lower an approved/planned
   validation requirement because the resulting diff looks small. Any
   justified reduction from an approved material plan must be explained
   explicitly, not inferred post hoc.

## Execute the selected ladder level

- **L1 Focused** — targeted unit/API/integration/component proof for the
  current Change Unit.
- **L2 Relevant / coupled** — the completed cluster, High-Risk Kernel, or
  important transition group.
- **L3 Checkpoint** — usually `validate:fast`, plus focused/relevant evals
  for the changed area. `validate:fast` is not universally exhaustive.
- **L4 Final / deploy-level** — a final **code / configuration / test /
  runtime** package boundary where repository policy requires broad gates,
  or a material high-risk / deploy-readiness boundary. **Not every commit.**
  Docs-only and audit-only work still do not require product L4 suites.
  Presentation/UI-only work should reach operator visual acceptance before
  expensive L4.

When L4 **is** required, preserve this order:
`validate:fast` → `validate:deploy` → `test:e2e:smoke` →
`test:e2e:smoke:browser`.

L1–L3 never waive L4. Risk changes **when** broad validation runs. It does
not let an operator skip required final validation because the current
change was labeled low risk. High-risk DB/auth/privacy/access/publication/
concurrency/migration/deployment work keeps existing scoped safety
requirements.

Include E2E DB preflight and migration status only when applicable. Do not
add observer scaling/layout, live-provider, tunnel, full-suite, or
production checks unless the changed scope and authoritative policy require
them. Use `test-explorer` when the cheapest sufficient regression set for
the planned evals is unclear.

## Delegate execution

The parent delegates the explicit deterministic manifest to
`validation-runner`. The parent does not run long successful validation
merely to collect logs. The delegation supplies worktree/branch, changed
scope, selected ladder level, planned vs reconciled evals, commands in
required order, applicable preflights, and requested evidence.
`validation-runner` retains raw successful logs and returns either
`VALIDATION EVIDENCE` or a `FAILURE CAPSULE`; it must not modify product
source.

On success, use evidence containing focused and required results
(counts/status and practical durations), DB/E2E isolation, migration status
when relevant, `git diff --check`, skipped suites with reasons,
provider/production classification, warnings/manual checks,
`git diff --stat`, and `git status --short`.

## Failure loop

The parent decides remediation. After a fix, delegate only: the directly
failing focused test, the affected required gate, then remaining
still-required gates. Do not restart already-green gates without a dependency
reason. If evidence shows an unrelated failure, classify it narrowly, record
separate validation debt when justified, and continue only where policy
permits.

## Review boundary

Deterministic validation is not architectural or security review. The parent
handles ordinary remediation and reporting. Escalate only when
`docs/testing/agent-model-routing.md` criteria are met, using a localized
diff/evidence packet.

Read `docs/testing/e2e-strategy.md` and
`docs/testing/observer-test-execution-policy.md` only when their scope
applies.
