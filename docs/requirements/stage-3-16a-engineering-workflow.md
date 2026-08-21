# Stage 3.16A Authoritative Requirement Manifest

## Authority and use

This is the authoritative, implementation-independent requirement manifest for
Stage 3.16A — Engineering Workflow Optimization.

This is an engineering/process/tooling stage. Approved decisions in the
Stage 3.16A implementation packet are the process authority. Current
architecture, testing, and operations documents remain the domain/safety
authorities. Historical stage reports and the accepted pre-implementation
audit are supporting evidence; they cannot add, weaken, or replace a
requirement.

Do not silently weaken an `APPROVED` requirement. If implementation proves an
`APPROVED` requirement impossible or unsafe, set `DECISION_REQUIRED` and stop
for operator decision.

This manifest extends the existing `docs/requirements/` stage-manifest system.
Do not create a second planning format.

Status values used in this stage:

- `APPROVED` — accepted stage scope
- `PROPOSED` — not yet accepted
- `OUT_OF_SCOPE` — forbidden or explicitly excluded
- `DECISION_REQUIRED` — implementation proved the requirement impossible or unsafe
- `PASS` — finished review with evidence (operator-accepted)
- `DEFERRED` — later checkpoint; still expected unless superseded

Checkpoint authorization is separate from status. A later Change Unit may be
`APPROVED` stage scope and still `NOT_AUTHORIZED` for the current Cursor run.

Evidence types used here:

| Type | Meaning |
| --- | --- |
| `DOC` | Current-state workflow / testing / requirements documentation |
| `SKILL` | Cursor Skill or `AGENTS.md` routing change |
| `CODE` | Repository tooling/script change when a later CU requires it |
| `TEST` | Deterministic validator or targeted test when a later CU requires it |
| `MANUAL` | Operator checkpoint in this conversation |

## Stage identity

```
STAGE_ID = 3.16A
STAGE_NAME = Engineering Workflow Optimization
STAGE_KIND = engineering / process / tooling
PRODUCT_BEHAVIOR_CHANGE = NO
```

## Objective

Higher confidence at lower:

- human effort
- Cursor iterations
- AI / model cost
- repeated broad validation
- production-escaped defects

## Explicit non-scope

| ID | Requirement | Status |
| --- | --- | --- |
| S316A-NS-001 | No product feature redesign. | `OUT_OF_SCOPE` |
| S316A-NS-002 | No production business-behavior change for methodology work. | `OUT_OF_SCOPE` |
| S316A-NS-003 | No workflow platform, dashboard, or CI rebuild. | `OUT_OF_SCOPE` |
| S316A-NS-004 | No automatic deployment. | `OUT_OF_SCOPE` |
| S316A-NS-005 | No agent-team explosion. | `OUT_OF_SCOPE` |
| S316A-NS-006 | No full finalizer platform. | `OUT_OF_SCOPE` |
| S316A-NS-007 | Do not replace `docs/requirements/` with a second planning system. | `OUT_OF_SCOPE` |
| S316A-NS-008 | Do not weaken existing deploy / DB / privacy / access rules. | `OUT_OF_SCOPE` |

## Approved workflow architecture

```
Requirement
→ CIA
→ Change Units
→ Change Graph
→ High-Risk Kernel
→ Strategy
→ Eval Selection
→ Validation Plan
→ Implementation
→ Validation Execution
→ Checkpoint
→ Operator Acceptance
→ Final Validation
→ Deploy Safety
```

Authoritative contract: `docs/testing/engineering-workflow.md`.

## Stage CIA (compact)

```
CHANGE: authoritative engineering workflow contract, Stage 3.16A manifest,
        and validation-ladder wiring into existing validation guidance
INVARIANTS: no product/runtime behavior change; existing requirement manifests
            remain the planning system; deploy/DB/privacy/access rules stay
            authoritative and are referenced, not copied; L4/final gates are
            not waived
IMPACT: tests/evals (docs + Cursor skills + AGENTS.md pointer). No DB,
        Prisma, API, client, polling, projections, roles, lifecycle,
        publication, provider, or ENV/deployment runtime change in
        Checkpoint 1.
UNITS: CU-01 .. CU-12
KERNEL: CU-01 + CU-04
EVAL: DOC + SKILL inspection; git diff --check; no product Lab / E2E / deploy
STRATEGY: B then C — keep kernel together first; split cheaper lanes after
          kernel acceptance
VALIDATION_PLAN: L1 for docs/skill kernel; L4 not justified until a later
                 code/tooling package boundary
```

## Change Units

| ID | Change Unit | Risk | Checkpoint | Implementation authorization | Status |
| --- | --- | --- | --- | --- | --- |
| CU-01 | Authoritative engineering workflow contract | HIGH | 1 | `AUTHORIZED` | `PASS` |
| CU-02 | Stage 3.16A requirement / change-plan manifest skeleton | MEDIUM | 1 | `AUTHORIZED` | `PASS` |
| CU-03 | Eval Registry | MEDIUM | 2 | `AUTHORIZED` | `PASS` |
| CU-04 | Validation ladder wiring | HIGH | 1 | `AUTHORIZED` | `PASS` |
| CU-05 | Stale agent / model-routing cleanup | LOW | 3 | `AUTHORIZED` | `APPROVED` |
| CU-06 | Checkpoint template standardization | LOW | 3 | `AUTHORIZED` | `APPROVED` |
| CU-07 | Native-dialog guard | MEDIUM | 4 | `NOT_AUTHORIZED` | `APPROVED` |
| CU-08 | Lab I03 ConfirmDialog alignment | MEDIUM | 4 | `NOT_AUTHORIZED` | `APPROVED` |
| CU-09 | Documentation navigation / code-map | LOW | 3 | `AUTHORIZED` | `APPROVED` |
| CU-10 | Minimal metrics fields | LOW | 3 | `AUTHORIZED` | `APPROVED` |
| CU-11 | Eval Registry structural validator | LOW | 2 | `AUTHORIZED` | `PASS` |
| CU-12 | Fast/final validation integrity and cost | MEDIUM | 4 | `NOT_AUTHORIZED` | `APPROVED` |

```
HIGH_RISK_KERNEL = CU-01 + CU-04
```

CU-02 is kept with the kernel cluster because the manifest is the operational
record that ties CU-01/CU-04 to explicit requirements and STOP boundaries. It
is not itself kernel-risk.

## Execution strategy

Hybrid: **STRATEGY B** for Checkpoint 1, then **STRATEGY C** where validation
is separable.

**WHY KEEP TOGETHER (Checkpoint 1: CU-01 + CU-02 + CU-04)**

- The contract, the stage manifest, and the ladder must not diverge.
- Validation-ladder wording has to match the contract or agents will keep
  running every broad gate after every small change.
- Shared context is the existing validation/requirements docs; splitting now
  would duplicate that reading and create contradictory gate text.

**WHY SPLIT (after kernel acceptance)**

- CU-03/CU-11 (Eval Registry) are separable from prompt/routing hygiene.
- CU-05/CU-06/CU-09/CU-10 are low-coupling documentation/tooling cleanup.
- CU-07/CU-08/CU-12 are tooling/integrity work with their own evals and must
  not be pulled into the kernel diff.

Do not launch multiple implementation agents merely because twelve CUs exist.

## Checkpoints / phases

```
CHECKPOINT_1 = HIGH_RISK_KERNEL
CHECKPOINT_1_SCOPE = CU-01 + CU-02 skeleton + CU-04
CHECKPOINT_1_IMPLEMENTATION = PASS
CHECKPOINT_1_OPERATOR_ACCEPTANCE = PASS
CHECKPOINT_1_OPERATOR_REVIEW = 2026-08-20 architecture PASS; required small
                               kernel corrections applied in the combined
                               Checkpoint 1+2 run
CHECKPOINT_1_STOP = YES — accepted; later CUs follow authorized packets

CHECKPOINT_2 = EVAL_REGISTRY
CHECKPOINT_2_SCOPE = CU-03 + CU-11
CHECKPOINT_2_STATUS = PASS
CHECKPOINT_2_OPERATOR_ACCEPTANCE = MANUAL 2026-08-21
CHECKPOINT_2_REGISTRY = docs/testing/eval-registry.json
CHECKPOINT_2_FORMAT = JSON
CHECKPOINT_2_VALIDATOR = npm run eval:registry:check

CHECKPOINT_3 = WORKFLOW_HYGIENE
CHECKPOINT_3_SCOPE = CU-05 + CU-06 + CU-09 + CU-10
CHECKPOINT_3_STATUS = IMPLEMENTATION_PENDING_OPERATOR_REVIEW
CHECKPOINT_3_OPERATOR_ACCEPTANCE = PENDING

CHECKPOINT_4 = INTERACTION_AND_FAST_GATE_INTEGRITY
CHECKPOINT_4_SCOPE = CU-07 + CU-08 + CU-12
CHECKPOINT_4_CU12_SCOPE = FAST_COVERAGE_GAP + VALIDATE_FAST_REEXECUTION_COST
CHECKPOINT_4_STATUS = NOT_STARTED

CHECKPOINT_5 = RETROSPECTIVE_VALIDATION_AND_FINALIZATION
CHECKPOINT_5_STATUS = NOT_STARTED
```

Do not mark later checkpoints completed in this run.

## Retrospective acceptance scenarios

These capture known Stage 3.15A lessons as workflow-quality invariants. They
are **not** product re-implementation. They test whether this stage's contract
would have selected the right eval classes.

| ID | Lesson | Required eval class | Status |
| --- | --- | --- | --- |
| S316A-RET-001 | Mounted `RUNNING` → `COMPLETED` without reload. | `MOUNTED_TRANSITION` | `APPROVED` |
| S316A-RET-002 | Historical NULL fingerprint first material mutation. | `HISTORICAL_FIRST_MUTATION` | `APPROVED` |
| S316A-RET-003 | NEW CODE + OLD DB migration compatibility. | `MIGRATION_COMPATIBILITY` | `APPROVED` |
| S316A-RET-004 | Save → Retranscribe uses the real confirmation interaction. | `INTERACTION` + `TRANSITION` | `APPROVED` |
| S316A-RET-005 | Lab native dialog vs application `ConfirmDialog` drift. | `INTERACTION` | `APPROVED` |
| S316A-RET-006 | Optional enhancement race correctness + bounded UX latency. | race/correctness control distinct from UX latency budget | `APPROVED` |

Judge these at Checkpoint 5 against the workflow contract and selected evals.
Do not implement the underlying product fixes in this stage.

## Future pilot

```
FUTURE_PILOT = AI Analysis Schema Reliability & Recovery
FUTURE_PILOT_STAGE = after 3.16A
FUTURE_PILOT_IN_THIS_STAGE = NO
```

Do not investigate or implement the pilot here.

## Requirements

Every row is independently verifiable. Checkpoint 1 and Checkpoint 2 rows
below are operator `PASS`. Checkpoint 3 rows may be implemented in this run
but are not operator-accepted until review.

### Workflow contract (CU-01)

| ID | Requirement | Acceptance evidence | Checkpoint | Authorization | Status |
| --- | --- | --- | --- | --- | --- |
| S316A-WF-001 | One authoritative engineering workflow contract exists at `docs/testing/engineering-workflow.md`. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-002 | Meaningful changes require a compact CIA covering CHANGE, INVARIANTS, IMPACT MAP, CHANGE UNITS, HIGH-RISK KERNEL, EVAL IMPLICATIONS, STRATEGY, and VALIDATION PLAN. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-003 | Risk is assigned after Change Unit decomposition. Do not default to one LOW/MEDIUM/HIGH label for an entire user story. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-004 | Change Graph is a lightweight keep-together / split rationale, not a required rendering tool. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-005 | High-Risk Kernel is the smallest maximum-caution set. A HIGH kernel does not force the entire stage onto the highest-cost model. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-006 | Strategies A (integrated/staged), B (high-first → fast lane), and C (split) are defined with a required WHY KEEP TOGETHER / WHY SPLIT rationale. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-007 | Eval selection distinguishes at least STATE, TRANSITION, MOUNTED_TRANSITION, HISTORICAL_READ, HISTORICAL_FIRST_MUTATION, MIGRATION_COMPATIBILITY, INTERACTION, PROVIDER/INTEGRATION, and MANUAL/PRODUCTION ACCEPTANCE. STATE fixture ≠ TRANSITION fixture. HISTORICAL_READ ≠ HISTORICAL_FIRST_MUTATION; READ is not a mutation example. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-008 | When historical data is relevant, first mutation under new code is a mandatory question. Use synthetic historical shapes, not production copies. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-009 | Async AI work is classified MANDATORY GATE / OPTIONAL ACCELERATOR / BACKGROUND ENRICHMENT. Race/correctness controls are separate from UX latency budget. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-010 | Model routing is per Change Unit or batch. Risk sets a minimum reasoning/review floor; complexity/coupling may raise effort. Current model identities live in `docs/testing/agent-model-routing.md`. Risk is not a rigid model-effort mapping. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-011 | Multi-agent policy prefers 1 orchestrator + 1 implementation context + deterministic evals + optional independent reviewer. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-012 | Human-acceptance rules cover UI-only visual acceptance before L4, real destructive interaction testing, and historical+new session checks for high-risk product stages only. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-013 | Deploy safety points at existing runbook/architecture docs and states only workflow-level rules. It does not duplicate the runbook. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-WF-014 | `AGENTS.md` contains a concise pointer to the contract. Existing scoped DB/privacy/deploy/domain rules remain authoritative. | `SKILL` + `DOC` | 1 | `AUTHORIZED` | `PASS` |

### Validation ladder (CU-04)

| ID | Requirement | Acceptance evidence | Checkpoint | Authorization | Status |
| --- | --- | --- | --- | --- | --- |
| S316A-VL-001 | Existing validation guidance defines L1 Focused, L2 Relevant/coupled, L3 Checkpoint, and L4 Final/deploy-level. L4 is a final code/config/test/runtime package or high-risk/deploy boundary, not every commit. | `DOC` + `SKILL` | 1 | `AUTHORIZED` | `PASS` |
| S316A-VL-002 | The ladder must not weaken existing mandatory high-risk or deploy gates. L1–L3 change timing of intermediate validation; they do not waive L4 when repository policy requires it. | `DOC` + `SKILL` | 1 | `AUTHORIZED` | `PASS` |
| S316A-VL-003 | Staged validation is allowed: docs-only needs no product suite; UI-only awaits visual acceptance before L4; small related CUs may use L1 per CU and L3/L4 at accumulated boundaries. | `DOC` + `SKILL` | 1 | `AUTHORIZED` | `PASS` |
| S316A-VL-004 | Change plans record required eval classes, current validation level, commands/evidence run, and unresolved findings. No new automation in this checkpoint. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-VL-005 | L3 maps to existing `validate:fast` **subject to its current known coverage** plus focused/relevant evals for the changed area. Do not claim `validate:fast` is universally exhaustive. Glob completeness is CU-12. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-VL-006 | `validate-wave` executes the approved Validation Plan after implementation. It may raise planned validation from the actual diff; it must not silently lower an approved plan, and must not claim that low current risk skips required final validation. | `SKILL` | 1 | `AUTHORIZED` | `PASS` |

### Manifest / change plan (CU-02)

| ID | Requirement | Acceptance evidence | Checkpoint | Authorization | Status |
| --- | --- | --- | --- | --- | --- |
| S316A-MP-001 | This file is the Stage 3.16A requirement/change-plan manifest in repository-native stage-manifest style. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
| S316A-MP-002 | The manifest remains compatible with `verify-requirements` / `docs/testing/requirement-completeness.md`. Do not redesign that workflow in Checkpoint 1. | `DOC` | 1 | `AUTHORIZED` | `PASS` |

### Checkpoint 2 and later

| ID | Requirement | Acceptance evidence | Checkpoint | Authorization | Status |
| --- | --- | --- | --- | --- | --- |
| S316A-ER-001 | Eval Registry exists at `docs/testing/eval-registry.json` and can name evals by class from S316A-WF-007. | `DOC` | 2 | `AUTHORIZED` | `PASS` |
| S316A-ER-002 | Eval Registry has a structural validator (`npm run eval:registry:check`) with negative cases for duplicate ID, missing field, and invalid enum/type. | `CODE` + `TEST` | 2 | `AUTHORIZED` | `PASS` |
| S316A-HY-001 | Stale agent / model-routing text is cleaned up without weakening safety policy. | `DOC` + `SKILL` | 3 | `AUTHORIZED` | `APPROVED` |
| S316A-HY-002 | Checkpoint template is standardized. | `DOC` | 3 | `AUTHORIZED` | `APPROVED` |
| S316A-HY-003 | Architecture README / code-map navigation includes the engineering workflow. | `DOC` | 3 | `AUTHORIZED` | `APPROVED` |
| S316A-HY-004 | Minimal metrics fields exist for later process measurement. | `DOC` | 3 | `AUTHORIZED` | `APPROVED` |
| S316A-IT-001 | Native-browser-dialog guard exists for interaction evals. | `CODE` + `TEST` | 4 | `NOT_AUTHORIZED` | `APPROVED` |
| S316A-IT-002 | Lab I03 is aligned with application `ConfirmDialog` rather than native dialog drift. | `CODE` + `TEST` | 4 | `NOT_AUTHORIZED` | `APPROVED` |
| S316A-IT-003 | Fast/final validation integrity and cost: `FAST_COVERAGE_GAP` (`validate:fast` unit glob currently misses deterministic tests outside `lib/**`, including known `app/**` / `components/**` candidates) and `VALIDATE_FAST_REEXECUTION_COST` (`validate:deploy` re-invokes `validate:fast` while the L4 sequence also calls `validate:fast` immediately beforehand). Close the gap by coverage or explicit policy, and examine redundant cost together in Checkpoint 4. Do not change package scripts or gate order in Checkpoint 3. | `CODE` + `TEST` | 4 | `NOT_AUTHORIZED` | `APPROVED` |

The six retrospective rows above are Checkpoint 5 acceptance scenarios, not
Checkpoint 1 implementation work.

## Checkpoint 1 evidence log

Operator accepted Checkpoint 1 architecture on 2026-08-20 (`MANUAL`). Required
small kernel corrections were applied in the combined Checkpoint 1+2 run
before Checkpoint 2 implementation.

```
CURRENT_CHECKPOINT = 1
CHECKPOINT_1_STATUS = PASS
OPERATOR_ACCEPTANCE = MANUAL 2026-08-20
REQUIRED_EVAL_CLASSES = DOC, SKILL
REQUIRED_VALIDATION_LEVEL = L1
L4_REQUIRED_NOW = NO
PRODUCT_SUITE_REQUIRED_NOW = NO
PHASE_A_CORRECTIONS = validation plan before implementation; CIA STRATEGY +
                      VALIDATION_PLAN; planned vs actual cannot silently
                      lower; HISTORICAL_READ ≠ FIRST_MUTATION; model-routing
                      authority deduplicated; L4 docs-only ambiguity removed;
                      checklist intro; git diff --check listed
COMMANDS_RUN = git status; referenced-path existence check; git diff --check
COMMANDS_RESULT = PASS
UNRESOLVED_FINDINGS = CU-05 stale routing/agent text; CU-07/CU-08 Lab I03
                      native-dialog residual; CU-09 architecture README/code-map
                      navigation plus stale mapped test path; CU-12 validate:fast
                      glob misses app/** and components/** tests;
                      validate:fast is re-executed inside validate:deploy
```

## Checkpoint 2 evidence log

Operator accepted Checkpoint 2 on 2026-08-21 (`MANUAL`). CU-03, CU-11,
S316A-ER-001, and S316A-ER-002 are `PASS`.

```
CURRENT_CHECKPOINT = 2
CHECKPOINT_2_STATUS = PASS
OPERATOR_ACCEPTANCE = MANUAL 2026-08-21
REGISTRY_PATH = docs/testing/eval-registry.json
REGISTRY_FORMAT = JSON
PARSER = node JSON.parse
NEW_DEPENDENCY_ADDED = NO
VALIDATOR = npm run eval:registry:check
REQUIRED_EVAL_CLASSES = DOC, CODE, TEST
REQUIRED_VALIDATION_LEVEL = L1
L4_REQUIRED_NOW = NO
SEED_EVAL_IDS = EVAL-PP-S10-AI-CURRENT, EVAL-PP-CANONICAL-PROJECTION,
                EVAL-PP-ENH-MOUNTED-RUNNING-COMPLETED, EVAL-AI-HIST-NULL-READ,
                EVAL-AI-HIST-NULL-FIRST-MATERIAL-EDIT, EVAL-MIG-FINGERPRINT-COMPAT,
                EVAL-PP-RETRANSCRIBE-CONFIRM, EVAL-LAB-I03-NATIVE-VS-APP-DIALOG,
                EVAL-PP-ENH-RACE-AND-LATENCY, EVAL-AI-MATERIAL-CHANGE-REVOKE,
                EVAL-AI-RECIPIENT-STALE-FAIL-CLOSED, EVAL-PP-MAPPING-INCOMPLETE-BLOCKS-AI,
                EVAL-PP-PIPELINE-AUTO-MAPPING, EVAL-ROOM-FINISH-CANONICAL,
                EVAL-PROV-MOCK-SMOKE, EVAL-PROV-LIVE-OPT-IN,
                EVAL-MANUAL-PREDEPLOY-HIST-AND-NEW, EVAL-PP-HIST-MATERIALS-OPEN,
                EVAL-ACCESS-SMOKE-GUARDS, EVAL-PP-ENH-RUNNING-BLOCKS-MATERIAL-EDIT
RETROSPECTIVE_MAP = S316A-RET-001→EVAL-PP-ENH-MOUNTED-RUNNING-COMPLETED PARTIAL;
                    S316A-RET-002→EVAL-AI-HIST-NULL-FIRST-MATERIAL-EDIT COVERED
                    (READ remains EVAL-AI-HIST-NULL-READ);
                    S316A-RET-003→EVAL-MIG-FINGERPRINT-COMPAT PARTIAL;
                    S316A-RET-004→EVAL-PP-RETRANSCRIBE-CONFIRM PARTIAL;
                    S316A-RET-005→EVAL-LAB-I03-NATIVE-VS-APP-DIALOG PARTIAL;
                    S316A-RET-006→EVAL-PP-ENH-RACE-AND-LATENCY PARTIAL
```

## Checkpoint 3 evidence log

Implementation complete in this run. Operator acceptance is **pending**.
Do not treat CU-05/CU-06/CU-09/CU-10 as operator `PASS`.

```
CURRENT_CHECKPOINT = 3
CHECKPOINT_3_STATUS = IMPLEMENTATION_PENDING_OPERATOR_REVIEW
OPERATOR_ACCEPTANCE = PENDING
CHANGE_UNITS = CU-05, CU-06, CU-09, CU-10
PLANNED_EVALS = DOC, SKILL
RECONCILED_EVALS = DOC, SKILL
PLANNED_VALIDATION_LEVEL = L1
ACTUAL_VALIDATION_LEVEL = L1
CHECKPOINT_TEMPLATE = docs/testing/engineering-workflow.md#checkpoint-evidence-template
METRICS_LOCATION = same template
NAVIGATION = docs/architecture/README.md, docs/architecture/code-map.md
STALE_CODE_MAP_REMOVED = app/api/sessions/[sessionId]/control/route.test.ts
REQUIRED_VALIDATION = git diff --check; referenced-path existence; npm run eval:registry:check
L4_REQUIRED_NOW = NO
PRODUCT_SUITE_REQUIRED_NOW = NO
CU12_FUTURE_SCOPE = FAST_COVERAGE_GAP + VALIDATE_FAST_REEXECUTION_COST
PACKAGE_SCRIPT_CHANGE = NO
UNRESOLVED_FINDINGS = CU-07 native-dialog guard; CU-08 Lab I03 ConfirmDialog;
                      CU-12 FAST_COVERAGE_GAP and VALIDATE_FAST_REEXECUTION_COST
```
