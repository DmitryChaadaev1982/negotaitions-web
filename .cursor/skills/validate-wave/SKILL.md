---
name: validate-wave
description: Reconciles and executes a NegotAItions Validation Plan in the primary agent context. Use after implementation. Canonical validate:fast / validate:build / validate:deploy stay on the primary agent or operator PowerShell — never a Cursor subagent.
---

# Validate a NegotAItions Wave

Use this Skill **after implementation** to **execute** the Validation Plan.
It does not replace `AGENTS.md`, scoped rules, or repository testing policy.
Eval selection and the Validation Plan belong **before** implementation; see
[`docs/testing/engineering-workflow.md`](../../../docs/testing/engineering-workflow.md).
Ladder command mapping and canonical execution policy live in
[`docs/testing/validation-checklist.md`](../../../docs/testing/validation-checklist.md).

Parent model and escalation policy:
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
`validate:fast` → `validate:build` → `test:e2e:smoke` →
`test:e2e:smoke:browser`. `validate:deploy` remains the complete standalone
deploy validation (`validate:fast` + `validate:build`) and must not be treated
as build-only.

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

## Primary execution (mandatory)

The **primary / orchestrating agent** runs the selected commands in its own
terminal/tool context. Do **not** delegate these to a Cursor subagent:

- `npm run validate:fast`
- `npm run validate:build`
- `npm run validate:deploy`
- any future validation command expected to exceed a short focused-test
  interval

Reason: Cursor’s subagent-return path has repeatedly remained stuck after
`scripts/validation-runner.mjs` already finished and released locks. The
kernel is healthy; keep the result attached to the primary context.

`.cursor/agents/validation-runner.md` is allowed only for short focused
tests. It must refuse the canonical long gates above.

If the primary agent cannot reliably execute or observe a long canonical
command: **STOP** and give the operator the PowerShell recipe in
`docs/testing/validation-checklist.md`. Prefer operator PowerShell for
standalone `validate:deploy` when independent release-gate evidence is
desired.

On success, record focused and required results (counts/status and practical
durations), DB/E2E isolation, migration status when relevant,
`git diff --check`, skipped suites with reasons, provider/production
classification, warnings/manual checks, `git diff --stat`, and
`git status --short`.

## Failure loop

The parent decides remediation. After a fix, rerun only: the directly
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
