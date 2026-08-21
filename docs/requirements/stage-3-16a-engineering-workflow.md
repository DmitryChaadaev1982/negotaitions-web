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
| CU-05 | Stale agent / model-routing cleanup | LOW | 3 | `AUTHORIZED` | `PASS` |
| CU-06 | Checkpoint template standardization | LOW | 3 | `AUTHORIZED` | `PASS` |
| CU-07 | Native-dialog guard | MEDIUM | 4 | `AUTHORIZED` | `PASS` |
| CU-08 | Lab I03 ConfirmDialog alignment | MEDIUM | 4 | `AUTHORIZED` | `PASS` |
| CU-09 | Documentation navigation / code-map | LOW | 3 | `AUTHORIZED` | `PASS` |
| CU-10 | Minimal metrics fields | LOW | 3 | `AUTHORIZED` | `PASS` |
| CU-11 | Eval Registry structural validator | LOW | 2 | `AUTHORIZED` | `PASS` |
| CU-12 | Fast/final validation integrity and cost | MEDIUM | 4 | `AUTHORIZED` | `PASS` |

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
CHECKPOINT_1_STATUS = PASS
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
CHECKPOINT_3_STATUS = PASS
CHECKPOINT_3_OPERATOR_ACCEPTANCE = MANUAL 2026-08-21

CHECKPOINT_4 = INTERACTION_AND_FAST_GATE_INTEGRITY
CHECKPOINT_4_SCOPE = CU-07 + CU-08 + CU-12
CHECKPOINT_4_CU12_SCOPE = FAST_COVERAGE_GAP + VALIDATE_FAST_REEXECUTION_COST
CHECKPOINT_4_STATUS = PASS
CHECKPOINT_4_OPERATOR_ACCEPTANCE = PASS
CHECKPOINT_4_OPERATOR_REVIEW = MANUAL 2026-08-21 including headed Lab I03 ConfirmDialog

CHECKPOINT_5 = RETROSPECTIVE_VALIDATION_AND_FINALIZATION
CHECKPOINT_5_STATUS = PASS
STAGE_3_16A_STATUS = PASS
STAGE_CLOSURE = PENDING_OPERATOR_PACKAGING_AUTHORIZATION
DEPLOY = NOT_AUTHORIZED
```

Stage engineering status is `PASS`. Git `CLOSED` packaging still requires
operator-authorized commit. Stage closure is not a production deploy.

## Retrospective acceptance scenarios

These capture known Stage 3.15A lessons as workflow-quality invariants. They
are **not** product re-implementation. They test whether this stage's contract
would have selected the right eval classes.

| ID | Lesson | Required eval class | Status |
| --- | --- | --- | --- |
| S316A-RET-001 | Mounted `RUNNING` → `COMPLETED` without reload. | `MOUNTED_TRANSITION` | `PASS` |
| S316A-RET-002 | Historical NULL fingerprint first material mutation. | `HISTORICAL_FIRST_MUTATION` | `PASS` |
| S316A-RET-003 | NEW CODE + OLD DB migration compatibility. | `MIGRATION_COMPATIBILITY` | `PASS` |
| S316A-RET-004 | Save → Retranscribe uses the real confirmation interaction. | `INTERACTION` + `TRANSITION` | `PASS` |
| S316A-RET-005 | Lab native dialog vs application `ConfirmDialog` drift. | `INTERACTION` | `PASS` |
| S316A-RET-006 | Optional enhancement race correctness + bounded UX latency. | race/correctness control distinct from UX latency budget | `PASS` |

Checkpoint 5 retrospective `PASS` means the Stage 3.16A workflow would have
selected or detected the correct evidence class/problem before production. It
does **not** upgrade an underlying product Eval Registry entry from `PARTIAL`
to `COVERED`. Do not implement the underlying product fixes in this stage.

## Future pilot

```
FUTURE_PILOT = AI Analysis Schema Reliability & Recovery
FUTURE_PILOT_STAGE = after 3.16A
FUTURE_PILOT_IN_THIS_STAGE = NO
```

Do not investigate or implement the pilot here.

## Requirements

Every row is independently verifiable. Checkpoints 1–5 are `PASS`. Stage
engineering status is `PASS`. Git packaging/`CLOSED` still requires operator
commit authorization. Stage closure is not a production deploy.

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
| S316A-VL-005 | L3 maps to existing `validate:fast` **subject to its classified cheap-deterministic coverage** plus focused/relevant evals for the changed area. Do not claim `validate:fast` is universally exhaustive. Classified fast-gate coverage is the current S316A-IT-003 / CU-12 contract. | `DOC` | 1 | `AUTHORIZED` | `PASS` |
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
| S316A-HY-001 | Stale agent / model-routing text is cleaned up without weakening safety policy. | `DOC` + `SKILL` | 3 | `AUTHORIZED` | `PASS` |
| S316A-HY-002 | Checkpoint template is standardized. | `DOC` | 3 | `AUTHORIZED` | `PASS` |
| S316A-HY-003 | Architecture README / code-map navigation includes the engineering workflow. | `DOC` | 3 | `AUTHORIZED` | `PASS` |
| S316A-HY-004 | Minimal metrics fields exist for later process measurement. | `DOC` | 3 | `AUTHORIZED` | `PASS` |
| S316A-IT-001 | Native-browser-dialog guard exists for interaction evals. Production `window.alert` / `window.confirm` / `window.prompt` uses fail closed unless allowlisted with a matching `expectedCount`. Duplicate and stale allowlist entries fail. | `CODE` + `TEST` | 4 | `AUTHORIZED` | `PASS` |
| S316A-IT-002 | Lab I03 is aligned with application `ConfirmDialog` rather than native dialog drift. Headed operator inspection of that same dialog is the manual acceptance evidence. | `CODE` + `TEST` + `MANUAL` | 4 | `AUTHORIZED` | `PASS` |
| S316A-IT-003 | Fast/final validation integrity and cost remain the accepted current contract: `validate:fast` includes the native-dialog guard and all classified cheap deterministic tests selected for the routine fast gate (`lib/**`, `app/**`, `components/**`, `scripts/__tests__/**`); intentionally excluded suites (Playwright execution, live/provider, real-DB-beyond-skip) have explicit reasons; normal L4 is `validate:fast` → `validate:build` → `test:e2e:smoke` → `test:e2e:smoke:browser` and does not execute `validate:fast` twice; standalone `validate:deploy` remains a complete `validate:fast` + `validate:build` convenience/deploy-validation command. Do not weaken this evidence. Historical Checkpoint 3 notes (`FAST_COVERAGE_GAP`, `VALIDATE_FAST_REEXECUTION_COST`) describe the pre-fix problem and are not the current contract. | `CODE` + `TEST` | 4 | `AUTHORIZED` | `PASS` |

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

Operator accepted Checkpoint 3 on 2026-08-21 (`MANUAL`). CU-05, CU-06, CU-09,
CU-10, S316A-HY-001, S316A-HY-002, S316A-HY-003, and S316A-HY-004 are `PASS`.

```
CURRENT_CHECKPOINT = 3
CHECKPOINT_3_STATUS = PASS
OPERATOR_ACCEPTANCE = MANUAL 2026-08-21
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

## Checkpoint 4 evidence log

Operator accepted Checkpoint 4 on 2026-08-21 (`MANUAL`), including headed
Lab I03 application `ConfirmDialog` inspection. CU-07, CU-08, CU-12,
S316A-IT-001, S316A-IT-002, and S316A-IT-003 are `PASS`.

Pre-fix Checkpoint 3 notes (`FAST_COVERAGE_GAP`: `validate:fast` missed
classified cheap deterministic tests outside `lib/**`;
`VALIDATE_FAST_REEXECUTION_COST`: normal L4 plus standalone `validate:deploy`
could re-execute `validate:fast`) describe the problem that Checkpoint 4
closed. They are historical rationale, not the current contract.

```
CURRENT_CHECKPOINT = 4
CHECKPOINT_4_STATUS = PASS
CHECKPOINT_4 = PASS
CHECKPOINT_4_OPERATOR_ACCEPTANCE = PASS
OPERATOR_ACCEPTANCE = MANUAL 2026-08-21
CHANGE_UNITS = CU-07, CU-08, CU-12
CU-07 = PASS
CU-08 = PASS
CU-12 = PASS
S316A-IT-001 = PASS
S316A-IT-002 = PASS
S316A-IT-003 = PASS
PLANNED_EVALS = EVAL-WF-NATIVE-DIALOG-GUARD, EVAL-LAB-I03-NATIVE-VS-APP-DIALOG,
                EVAL-PP-RETRANSCRIBE-CONFIRM, FAST_COVERAGE_GAP,
                VALIDATE_FAST_REEXECUTION_COST
RECONCILED_EVALS = EVAL-WF-NATIVE-DIALOG-GUARD COVERED;
                   EVAL-LAB-I03-NATIVE-VS-APP-DIALOG COVERED
                   (invariant = Lab I03 uses application ConfirmDialog;
                   operator headed I03 PASS 2026-08-21);
                   EVAL-PP-RETRANSCRIBE-CONFIRM PARTIAL
                   (Save→Retranscribe real-surface evidence remains broader
                   than I03 Lab alignment)
PLANNED_VALIDATION_LEVEL = L3
ACTUAL_VALIDATION_LEVEL = L3
NATIVE_DIALOG_GUARD = npm run check:native-dialogs
NATIVE_DIALOG_ALLOWLIST = file + api + expectedCount + reason; current
                          expectedCount = 1 for every exception
NATIVE_DIALOG_FAIL_CLOSED = unexpected APIs, count mismatch, stale entries
FAST_UNIT_GLOBS = lib/**/*.test.ts, app/**/*.test.ts, components/**/*.test.ts,
                  scripts/__tests__/*.test.mjs
EXCLUDED_FROM_FAST = Playwright execution; live/provider; real-DB-beyond-skip
L4_SEQUENCE = validate:fast -> validate:build -> test:e2e:smoke ->
              test:e2e:smoke:browser
NORMAL_L4_REEXECUTES_VALIDATE_FAST = NO
STANDALONE_DEPLOY_VALIDATION = validate:deploy remains validate:fast + validate:build
BROAD_VALIDATION_RUNS = L3_VALIDATE_FAST, L4_VALIDATE_BUILD, L4_SMOKE,
                        L4_BROWSER_SMOKE, STANDALONE_VALIDATE_DEPLOY
L4_REQUIRED_NOW = NO
PRODUCT_SUITE_REQUIRED_NOW = NO
MANUAL_REQUIRED = headed Lab I03 ConfirmDialog inspection
MANUAL_I03_ACCEPTANCE = PASS 2026-08-21
COMMANDS_RUN = check:native-dialogs; native-dialog focused tests;
               lab-i03 source-contract; validate-gate-scripts focused;
               eval:registry:check; git diff --check;
               npm run validate:fast (actual composite)
COMMANDS_RESULT = PASS
ACTUAL_NPM_RUN_VALIDATE_FAST = PASS
UNIT = 1663 passed, 8 skipped, 0 failed
E2E_LIST = 831 tests in 67 files
I03_HEADED = operator PASS 2026-08-21; no additional manual evidence invented
UNRESOLVED_FINDINGS = none for CU-07/CU-08/CU-12; Checkpoint 5 finalization remains
```

## Checkpoint 5 evidence log

Finalization complete 2026-08-21. Compact CIA used as planned. Operator
packaging/commit authorization remains pending. No new final handoff file.

Retrospective workflow verdicts (underlying product evals unchanged except
EVAL-LAB-I03-NATIVE-VS-APP-DIALOG PARTIAL → COVERED after headed I03):

| RET | Lesson | Workflow mechanism | Eval ID | Underlying | Target layer | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| RET-001 | Mounted RUNNING→COMPLETED without reload | MOUNTED_TRANSITION ≠ STATE | EVAL-PP-ENH-MOUNTED-RUNNING-COMPLETED | PARTIAL | MOUNTED_UI | PASS |
| RET-002 | Historical NULL first mutation | HISTORICAL_READ ≠ FIRST_MUTATION | EVAL-AI-HIST-NULL-FIRST-MATERIAL-EDIT | COVERED | HISTORICAL_ACCEPTANCE | PASS |
| RET-003 | NEW CODE + OLD DB | 4-cell MIGRATION_COMPATIBILITY | EVAL-MIG-FINGERPRINT-COMPAT | PARTIAL | MANUAL_CHECKPOINT | PASS |
| RET-004 | Save→Retranscribe real confirmation | INTERACTION + TRANSITION | EVAL-PP-RETRANSCRIBE-CONFIRM | PARTIAL | LAB_TRANSITION | PASS |
| RET-005 | Lab native vs ConfirmDialog | INTERACTION + native-dialog guard | EVAL-LAB-I03-NATIVE-VS-APP-DIALOG | COVERED | UNIT + LAB_TRANSITION | PASS |
| RET-006 | Optional enhancement race vs UX latency | MANDATORY/OPTIONAL/BACKGROUND + budget | EVAL-PP-ENH-RACE-AND-LATENCY | PARTIAL | INTEGRATION | PASS |

```
CURRENT_CHECKPOINT = 5
CHECKPOINT_5_STATUS = PASS
OPERATOR_ACCEPTANCE = PENDING_PACKAGING
CHANGE_UNITS = FINAL-RETROSPECTIVE, FINAL-REQUIREMENTS, FINAL-L4,
               FINAL-METRICS, FINAL-PACKAGE
RET_001 = PASS
RET_002 = PASS
RET_003 = PASS
RET_004 = PASS
RET_005 = PASS
RET_006 = PASS
REQUIREMENTS_COMPLETE = YES
PLANNED_EVALS = S316A-RET-001..006, Eval Registry audit, L4 graph
RECONCILED_EVALS = same; I03 COVERED; mounted/migration/retranscribe/race remain PARTIAL
PLANNED_VALIDATION_LEVEL = L4
ACTUAL_VALIDATION_LEVEL = L4
NORMAL_L4_REEXECUTES_VALIDATE_FAST = NO
STANDALONE_VALIDATE_DEPLOY_REMAINS_SAFE = YES
STANDALONE_VALIDATE_DEPLOY_RUN = NO
OBSERVER_LAYOUT = NOT_APPLICABLE
FUTURE_PILOT = AI Analysis Schema Reliability & Recovery; READY to exercise
               Stage 3.16A workflow; IN_THIS_STAGE = NO

L4:
  validate:fast PASS; unit 1663 passed / 8 skipped / 0 failed; e2e list 831/67;
    duration ~84.3s
  validate:build PASS; compiled 13.4s; duration ~46.4s
  test:e2e:db:check PASS; negotiations_e2e @ localhost:5433; no writes; ~6.1s
  test:e2e:smoke PASS 27/27; duration ~26.8s (host Chromium)
  test:e2e:smoke:browser PASS 14/14; duration ~45.8s (host Chromium)

FLAKE_RECORD:
  1. First smoke FAIL: ephemeral sandbox PLAYWRIGHT_BROWSERS_PATH lacked Chromium
  2. Second smoke 26 pass / 1 fail: /opengraph-image unsupported image format
  3. Focused proof PASS 6.6s; subsequent full smoke 27/27
  Classification: environment + first-compile ImageResponse transient;
                  not a Stage 3.16A product regression

METRICS:
  CURSOR_IMPLEMENTATION_ITERATIONS = 1 (finalization/docs/registry only)
  BROAD_VALIDATION_RUNS:
    L3_VALIDATE_FAST = 1
    L4_VALIDATE_BUILD = 1
    L4_SMOKE = 3 (1 env fail, 1 flake fail, 1 PASS)
    L4_BROWSER_SMOKE = 1
    STANDALONE_VALIDATE_DEPLOY = 0
  DEFECTS_BY_DISCOVERY_LAYER:
    UNIT = 0
    PRODUCTION = 0
    environment Playwright cache = 1 (not product)
    public OG ImageResponse flake = 1 (unrelated; not Stage 3.16A)
  ESCAPED_DEFECTS_AFTER_ACCEPTANCE = 0
  MODEL_EFFORT_BY_CU_OR_BATCH = Grok 4.6 parent; Luna validation-runner L4
  HUMAN_INTERVENTIONS = operator CP1-4 + headed I03; packaging STOP

GIT_STATE:
  BRANCH = feat/engineering-workflow-optimization
  HEAD = 7e26d12024dc22edffa93a839b48de4578eb0046
  TREE = dirty (manifest + eval-registry only)
  DIFF_CHECK = PASS

AUTHORIZATION:
  COMMIT = NOT_AUTHORIZED
  PUSH = NOT_AUTHORIZED
  DEPLOY = NOT_AUTHORIZED

UNRESOLVED_FINDINGS = operator packaging/commit; honest PARTIAL product evals;
                      public OG first-compile flake (non-blocking for 3.16A)
```
