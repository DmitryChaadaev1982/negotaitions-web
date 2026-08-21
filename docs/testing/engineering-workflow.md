# Engineering Workflow

This is the authoritative process contract for planning and executing
**meaningful** NegotAItions engineering changes.

It does not replace `AGENTS.md`, scoped Cursor rules, current-state architecture,
requirement manifests under `docs/requirements/`, or the deployment runbook.
Those remain the domain, safety, and product authorities. This document
decides **how work is decomposed, routed, evidenced, and validated**.

Do not copy deploy, database, privacy, or access rules into this file. Point
to the existing documents.

## When this applies

Use this workflow for meaningful work: behavior, schema, access, publication,
lifecycle, provider integration, historical compatibility, multi-file process
changes, or any change whose blast radius is not obvious from the diff.

Skip a persisted CIA for a trivial one-line typo or an isolated comment.
If the work might be meaningful, write a compact CIA rather than skipping.

This is not a second planning system. Capture approved product requirements in
the existing `docs/requirements/` manifest style. Use this contract to turn
those requirements into change units, evals, and a validation ladder.

## Execution chain

```
Requirement
→ Change Impact Analysis
→ Change Units
→ Change Graph
→ High-Risk Kernel
→ Strategy Selection
→ Eval Selection
→ Validation Plan
→ Implementation
→ Validation Execution
→ Checkpoint
→ Operator Acceptance where applicable
→ Final Validation
→ Deploy Safety
```

Eval selection and the Validation Plan happen **before** implementation.
Validation Execution applies that plan to the actual implementation/diff
**after** code. The L1–L4 ladder is how both the plan and the execution are
scoped; it is not a post-hoc substitute for planning.

Stop at a checkpoint when the approved packet says STOP. Do not silently
continue into the next change unit or into deploy.

## Change Impact Analysis

Mandatory for meaningful changes. Think richly; persist compactly.

Answer at least:

**A. CHANGE** — What actually changes?

**B. INVARIANTS** — What must remain true?

**C. IMPACT MAP** — Which layers are touched? Include only relevant rows:

- DB / schema / migrations
- Prisma
- server / domain
- API
- client
- polling / refetch
- projections
- roles / access
- lifecycle
- publication
- AI currentness / material AI inputs
- provider integration
- ENV / deployment
- historical data
- tests / evals

**D. CHANGE UNITS** — Decompose before assigning risk.

**E. HIGH-RISK KERNEL** — Which units need maximum caution/reasoning?

**F. EVAL IMPLICATIONS** — Which evidence classes (and later Eval IDs) are
required before implementation? See [Eval selection](#eval-selection).

**G. STRATEGY** — A, B, or C, with WHY KEEP TOGETHER / WHY SPLIT.

**H. VALIDATION PLAN** — Which L1–L4 level and which evals are expected at
the current boundary. Execution comes after implementation.

Persisted CIA should fit on one screen. Example:

```
CHANGE: additive nullable fingerprint on AiAnalysis
INVARIANTS: historical NULL rows remain readable; no backfill
IMPACT: DB/migration, Prisma, server/domain, AI currentness, historical data, tests
UNITS: CU-schema, CU-read-path, CU-first-mutation, CU-ui-copy
KERNEL: CU-schema + CU-first-mutation
EVAL: MIGRATION_COMPATIBILITY, HISTORICAL_READ, HISTORICAL_FIRST_MUTATION, TRANSITION
STRATEGY: B — stabilize schema/currentness contract first
VALIDATION_PLAN: L1 per CU; L2 on kernel; L3 at checkpoint; L4 at final
                 code/config package or deploy boundary (not docs-only)
```

Do not turn CIA into a 30-field form.

## Change Units

Do **not** assign one LOW / MEDIUM / HIGH label to an entire user story by
default. Decompose into Change Units first, then assess risk on each unit or
on a tightly coupled execution batch.

A Change Unit is a separable slice of work with a bounded blast radius. It is
not automatically a separate agent, commit, or validation wave.

Where relevant, assess:

- risk
- coupling
- regression overlap
- context overlap
- validation separability
- validation setup reuse
- blast radius
- historical data impact
- interaction criticality
- DB / schema impact
- external side effects
- concurrency / race potential
- access / privacy impact

Risk sets a **minimum** reasoning/review floor per Change Unit or execution
batch. It does not rigidly equal model effort: complexity, coupling, context
size, ambiguity, or regression breadth may justify raising effort even when
product risk is low. A HIGH kernel still does not put the entire stage on the
highest-cost model.

## Change Graph

A lightweight dependency/coupling model. Do not require graph-rendering tools
or automatic generation.

It exists to answer:

**WHY KEEP TOGETHER?**

or

**WHY SPLIT?**

Keep units together when coupling, shared context, or regression overlap would
make a split more expensive or less safe. Split when those are low and
validation is independently separable.

Record the rationale in the stage/change plan. Multiple Change Units are not a
reason to launch multiple agents.

## High-Risk Kernel

The High-Risk Kernel is the smallest set of Change Units that need maximum
caution. Typical NegotAItions kernel material includes:

- DB schema / migrations
- auth
- access / privacy
- publication and recipient grants
- AI currentness
- material AI inputs
- historical compatibility
- concurrency
- provider writer ownership
- irreversible / cost side effects
- production ENV
- deploy sequencing
- destructive lifecycle transitions

**A HIGH kernel does not imply the entire stage must run on the highest-cost
model.** Route HIGH effort to the kernel; cheaper lanes may follow after the
kernel is stable.

Preserve existing scoped safety for kernel areas. See
`.cursor/rules/database-migration-safety.mdc`,
`.cursor/rules/ai-publication-privacy.mdc`,
`.cursor/rules/deployment-production-safety.mdc`,
`docs/architecture/09-security-and-access-control.md`,
`docs/architecture/10-data-storage-and-retention.md`,
and `docs/operations/deployment-runbook.md`.

## Execution strategies

Choose one and write **WHY KEEP TOGETHER / WHY SPLIT**.

**STRATEGY A — INTEGRATED / STAGED**

Use when coupling is high, context is strongly shared, regression overlap is
high, or splitting would duplicate expensive setup/context.

**STRATEGY B — HIGH-FIRST → FAST LANE**

Use when a high-risk contract can be stabilized first, and remaining
medium/low work becomes cheaper and more isolated afterward.

**STRATEGY C — SPLIT**

Use when coupling, context overlap, and regression overlap are low, and
validation is independently separable.

Do not spawn an agent team merely because Change Units exist. Prefer one
orchestrator, one implementation context, deterministic/specialized evals, and
an optional independent reviewer.

## Eval selection

Select the **class of evidence** before implementation. Named invariant-level
eval IDs live in `docs/testing/eval-registry.json`. Name the class and, when
an ID exists, the Eval ID.

Do not require a Registry entry for every unit test. Update the Registry when
an important invariant is introduced, materially changed, retired, found
stale, or found missing because of a defect.

**STATE** — static known state, render, or domain result.

**TRANSITION** — actual A → B behavior.

**MOUNTED_TRANSITION** — the same already-mounted client/component:

```
backend A
→ client sees A
→ backend changes to B
→ polling / refetch
→ same mounted UI converges to B
```

Reload or remount is not a substitute.

**HISTORICAL_READ** — READ/open historical-shape data.

**HISTORICAL_FIRST_MUTATION** — the first applicable **changing** operation
performed by new code on historical-shape data. Where applicable: EDIT,
RERUN, PUBLISH, REVOKE, MIGRATE. READ is not a mutation.

A compatibility matrix may list READ plus mutation operations, but the two
eval classes remain distinct:

**historical READ PASS does not prove historical FIRST MUTATION PASS.**

**MIGRATION_COMPATIBILITY** — explicit reasoning about:

```
OLD CODE + OLD DB
OLD CODE + NEW DB
NEW CODE + NEW DB
NEW CODE + OLD DB
```

NEW CODE + OLD DB must either work or be explicitly prevented by deployment
ordering/gate.

**INTERACTION** — the real user surface, not only API/helper coverage.
Potential surfaces: buttons, forms, application `ConfirmDialog`, native
browser dialogs, disabled/loading/pending states, banners/toasts, polling,
navigation, retry/cancel, destructive confirmations, browser permissions.

**PROVIDER / INTEGRATION** — external boundary semantics, mocks versus
live-provider, side effects and cost. Follow
`docs/testing/e2e-strategy.md` for opt-in live/tunnel suites.

**MANUAL / PRODUCTION ACCEPTANCE** — human evidence or production
wiring/runtime verification when automation is not the correct proof.

Critical rule:

**STATE FIXTURE ≠ TRANSITION FIXTURE.**

Static A PASS + static B PASS does not prove A → B.

## Historical compatibility

When historical data is relevant, this question is mandatory:

**WHAT HAPPENS ON FIRST MUTATION UNDER NEW CODE?**

That is a HISTORICAL_FIRST_MUTATION question, not a HISTORICAL_READ question.
Historical compatibility is not merely “old row opens.” Use realistic
synthetic historical **shapes**, not production data copies.

## Async AI classification

Classify async AI/provider work as:

- **MANDATORY GATE** — user progress cannot continue until it finishes or
  fails closed.
- **OPTIONAL ACCELERATOR** — preferred improvement; the current usable result
  remains valid if it fails or times out.
- **BACKGROUND ENRICHMENT** — must not block the visible workflow.

If optional or background work delays visible user progress, record an
explicit UX latency budget where appropriate. Do not invent generic timeout
infrastructure from this contract.

Keep separate:

- technical race / correctness controls
- how long the user is allowed to be blocked

## Model routing

Routing is per Change Unit or execution batch, not per whole user story or
stage.

Durable rules:

- Risk sets a **minimum** reasoning/review floor.
- Complexity, coupling, context size, ambiguity, or regression breadth may
  justify **raising** effort even when product risk is low.
- A HIGH kernel does **not** automatically put the entire stage on the
  highest-cost model.
- Independent review is justified only for meaningful high-risk boundaries
  (for example DB/migration, auth/privacy/access, publication, concurrency,
  irreversible external side effects, or a high-risk production/deploy diff).
  It is not mandatory for every stage.

Current model identities, available effort modes, the validation-execution
model, and escalation policy live in
`docs/testing/agent-model-routing.md`. Do not duplicate that configuration
here.

Deterministic validation execution is delegated through
`.cursor/skills/validate-wave/SKILL.md` and
`.cursor/agents/validation-runner.md`.

## Multi-agent policy

Prefer:

1. one orchestrator
2. one implementation context
3. deterministic / specialized evals
4. optional independent reviewer

Do not encourage agent-team explosion. Skills and subagents are for cheaper
discovery or log isolation, not parallel product implementation.

## Human acceptance

**Presentation / UI-only change:** focused validation → local render →
operator visual acceptance → broad validation at a meaningful boundary.
Do not spend L4 before the operator accepts an obviously subjective
presentation change.

**Destructive interaction:** test the real button/dialog interaction, not
only a seeded final state.

**High-risk product stages before deploy, where practical:**

- 1 realistic historical session
- 1 new happy-flow session

Do not apply that product-session rule mechanically to methodology or
docs-only stages.

Operator acceptance is a checkpoint, not a substitute for required final
validation of code that existing repository policy still gates.

## Validation plan and execution

**Validation Plan** (before implementation): which eval classes / Eval IDs
and which L1–L4 level are required at the current boundary.

**Validation Execution** (after implementation): run that plan against the
actual implementation/diff.

The actual diff **may raise** the required level or add evals. It must **not**
silently lower an approved/planned validation requirement because the
resulting diff looks small. Any justified reduction from an approved material
plan must be explained explicitly, not inferred post hoc.

## Validation ladder

Authoritative ladder semantics and command mapping live in
`docs/testing/validation-checklist.md`. Summary:

| Level | Purpose | Typical evidence |
| --- | --- | --- |
| **L1 Focused** | Fast proof for the current Change Unit | targeted unit, helper, component, or static guard |
| **L2 Relevant / coupled** | Completed cluster, kernel, or important transition group | relevant integration, Lab subset, focused E2E, historical cohort, migration verifier |
| **L3 Checkpoint** | Accumulated engineering checkpoint | existing `validate:fast`, plus focused/relevant evals for the changed area |
| **L4 Final / deploy-level** | Final code/config/test/runtime package boundary where repository policy requires broad gates, or a material high-risk / deploy-readiness boundary | existing `validate:fast` then `validate:build` (standalone `validate:deploy` remains fast + build) and required smoke/browser/deploy gates |

`validate:fast` is the current L3 checkpoint gate. It is **not** universally
exhaustive; see the checklist coverage note. The cheap unit gate includes
deterministic tests under `lib/**`, `app/**`, `components/**`, and
`scripts/__tests__/**`. Playwright specs and other browser/provider suites stay
outside that gate. The L4 sequence uses `validate:fast` then `validate:build`
so `validate:fast` is not re-executed inside the final package boundary.
`validate:deploy` remains the complete standalone deploy validation
(`validate:fast` + `validate:build`).

L4 is **not** every commit. Docs-only and audit-only changes use applicable
documentation/focused evidence. Presentation/UI work may reach operator visual
acceptance before expensive L4. Code/config/test/runtime changes still receive
applicable L4 gates at their final package/deploy boundary.

The ladder optimizes **when** broad validation runs. It does not waive L4 or
scoped high-risk gates.

Record in the stage/change plan, without new automation. At STOP/review
boundaries, use the [Checkpoint evidence template](#checkpoint-evidence-template).

## Checkpoints and STOP

A checkpoint is a meaningful accumulated boundary, not every file save.
It is not a second planning system. CIA, Change Units, Eval Selection, and
the Validation Plan remain the planning contract above.

Default STOP conditions:

- approved packet says STOP for operator review
- High-Risk Kernel is implemented and needs acceptance before cheaper lanes
- presentation change needs visual acceptance before L4
- a safety invariant cannot be preserved without operator judgment

Do not commit, push, or deploy without explicit operator authorization.

Requirement completeness (`verify-requirements`,
`docs/testing/requirement-completeness.md`) remains a separate gate from
correctness/regression validation (`validate-wave`). Do not collapse them.

### Checkpoint evidence template

Paste or reference this compact packet in Cursor reports for **meaningful**
stage/checkpoint work. A trivial docs typo does not need every field.
Do not build a `stage:checkpoint` platform, automatic finalizer, or second
stage-plan format. Existing `agent:preflight` / git commands remain evidence
sources; do not duplicate their implementation.

Metrics are **manual**. They exist to compare later stages/pilots (is the
workflow cheaper and earlier?), not for telemetry or dashboards.

```
CHECKPOINT:
CHANGE_UNITS:

PLANNED_EVALS:
RECONCILED_EVALS:

PLANNED_VALIDATION_LEVEL:
ACTUAL_VALIDATION_LEVEL:

VALIDATION_EVIDENCE:

OPERATOR_ACCEPTANCE:
  REQUIRED: REQUIRED | NOT_REQUIRED
  STATUS: PENDING | PASS | N/A

UNRESOLVED_FINDINGS:

DEFECT_DISCOVERY:
  (omit if none)
  LAYER: UNIT | INTEGRATION | LAB_STATE | LAB_TRANSITION | MOUNTED_UI |
         MANUAL_CHECKPOINT | HISTORICAL_ACCEPTANCE | NEW_SESSION_ACCEPTANCE |
         PRODUCTION
  NOTE:

METRICS:
  CURSOR_IMPLEMENTATION_ITERATIONS:
  BROAD_VALIDATION_RUNS:
    L3_VALIDATE_FAST:
    L4_VALIDATE_BUILD:
    L4_SMOKE:
    L4_BROWSER_SMOKE:
    STANDALONE_VALIDATE_DEPLOY:
  DEFECTS_BY_DISCOVERY_LAYER:
  ESCAPED_DEFECTS_AFTER_ACCEPTANCE:
  MODEL_EFFORT_BY_CU_OR_BATCH:
  HUMAN_INTERVENTIONS:

GIT_STATE:
  BRANCH:
  HEAD:
  TREE: dirty | clean
  DIFF_CHECK: PASS | FAIL

AUTHORIZATION:
  COMMIT: AUTHORIZED | NOT_AUTHORIZED
  PUSH: AUTHORIZED | NOT_AUTHORIZED
  DEPLOY: AUTHORIZED | NOT_AUTHORIZED
```

`CURSOR_IMPLEMENTATION_ITERATIONS` counts meaningful implementation/remediation
loops for the checkpoint, not every chat turn.

`BROAD_VALIDATION_RUNS` makes repeated L3/L4 executions visible. Count the
normal command graph: `validate:fast` as `L3_VALIDATE_FAST`, then L4
`validate:build`, `test:e2e:smoke`, and `test:e2e:smoke:browser`. Record
standalone `validate:deploy` (`validate:fast` + `validate:build`) only when
that composite command actually ran. Do not treat `validate:deploy` as the
normal L4 build step.

`DEFECTS_BY_DISCOVERY_LAYER` uses only the vocabulary above unless repository
evidence strongly requires another value.

`ESCAPED_DEFECTS_AFTER_ACCEPTANCE` is a simple integer.

`MODEL_EFFORT_BY_CU_OR_BATCH` records the actual routing/effort class used
for Change Units or batches in this checkpoint, including work that is still
awaiting operator acceptance. Do not invent token-cost accounting.

`HUMAN_INTERVENTIONS` is optional: meaningful operator returns or rework
decisions, not every message.

## Deploy safety

Do not duplicate the runbook. Follow:

- `docs/operations/deployment-runbook.md`
- `docs/architecture/11-deployment-architecture.md`
- `docs/architecture/10-data-storage-and-retention.md`
- `.cursor/rules/deployment-production-safety.mdc`

Workflow-level rules only:

- no deploy without explicit operator authorization
- migration compatibility and order are decided before deployment
- production blockers fail closed
- production ENV changes are targeted named-variable updates, never wholesale
  local-env copies
- a high-risk deploy diff may justify independent review
