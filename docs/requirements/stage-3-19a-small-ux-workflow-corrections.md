# Stage 3.19A — Small UX & Workflow Corrections

## Authority

This is the authoritative requirement/change-plan manifest for Stage 3.19A.
Architecture, privacy, access, database, and operations documents remain the
domain/safety authorities. Checkpoint 0 is supporting evidence only.

Status values: `APPROVED`, `IMPLEMENTED`, `PENDING`, `NOT_STARTED`, `PASS`.

```
STAGE_ID = 3.19A
STAGE_NAME = Small UX & Workflow Corrections
STAGE_KIND = product / UI / workflow
PRODUCT_BEHAVIOR_CHANGE = YES
CHECKPOINT_0 = PASS
IMPLEMENTATION_WAVE = CU-A + CU-B + CU-C
CU-A = PASS
CU-B = PASS
CU-C = PASS
OA-A = PASS
OA-B = PASS
OA-C = PASS
UI_OPERATOR_CHECKPOINT = PASS
VALIDATION = PASS
EVAL_REGISTRY = RECONCILED
FINALIZATION = PASS
RELEASE_CANDIDATE = PASS
```

## Change Impact Analysis

```
CHANGE: Standalone START_PREPARATION role readiness; transcript Insert after;
        replace 5 native browser dialogs with existing ConfirmDialog surfaces
INVARIANTS: Event-created START_PREPARATION unchanged; negotiation SM unchanged;
            transcript API / orderIndex rewrite unchanged; no schema/migration;
            ConfirmDialog call sites without new props render unchanged
IMPACT: server/domain, API (control guard only), client, tests/evals
UNITS: CU-A, CU-B, CU-C
KERNEL: CU-A server guard (narrow standalone precondition; no lifecycle redesign)
EVAL: EVAL-S319A-PREP-ROLE-GUARD, EVAL-S319A-PREP-ROLE-UI,
      EVAL-S319A-TRANSCRIPT-INSERT-AFTER, EVAL-WF-NATIVE-DIALOG-GUARD
STRATEGY: A — keep together in one implementation wave
VALIDATION_PLAN: L1 focused CU tests; managed E2E A–C; L3 validate:fast;
                 L4 validate:deploy + smoke + browser-smoke
```

## CU-A — Standalone Preparation role guard

**Business contract.** A Standalone Session (`eventId == null`) must not start
Preparation until:

1. every required assignable SessionRole slot is occupied; AND
2. every negotiation `PARTICIPANT` has a valid assignable `sessionRoleId`.

`FACILITATOR` and `OBSERVER` are excluded. Roles filtered out by
`isAssignableCaseRole` are not required slots. Zero assignable roles satisfies
the requirement. Event-created Sessions keep their existing readiness contract.

Shared predicate: `areStandalonePreparationRolesReady` for server guard and UI
button state. Incomplete standalone start is rejected `409` with
`standaloneRolesNotReady` / `STANDALONE_ROLES_NOT_READY`. No new persisted
status. No lifecycle state-machine change. Existing facilitator authorization
and lease/CAS checks remain ahead of this guard.

UI: Start Preparation stays visible; disabled with existing disabled style when
incomplete; concise RU/EN explanation nearby
(`room.assignRolesBeforePreparation`, `data-testid="start-preparation-roles-hint"`).
Enable via existing sidebar refresh/poll. No extra polling. No modal on
disabled click.

**Result:** `PASS`

## CU-B — Transcript Insert after

**Business contract.** Each editable turn exposes “Insert after” / “Вставить после”.
New turns reuse the existing empty manual-turn factory (`startSeconds` /
`endSeconds` null). Insert after the last turn is the append path. Save still
submits the visual `turns[]` order; server still rewrites `orderIndex` 0..n-1.
No API/schema change, no timestamp interpolation, no reorder UX. Material
input invalidation / AI currentness stays on the existing save path.

**Operator UI adjustment.** After OA-B PASS, the operator removed the global
“Add turn” / “Добавить реплику” control from
`components/recording-transcription-section.tsx` because it duplicated Insert
after on the last replica. The unused `appendManualSpeakerTurn` helper was
removed from `lib/transcription/manual-speaker-turn-edits.ts`. Dictionary keys
`recording.addManualSpeakerTurn` remain unused.

**Result:** `PASS`

## CU-C — Native browser dialog cleanup

**Business contract.** Remove the five production `window.confirm` /
`window.prompt` call sites. Reuse `ConfirmDialog` (optional content area,
backward compatible). Events-list complete uses ConfirmDialog. Clipboard
failure uses a small `CopyLinkFallbackDialog` on the same modal primitive.
Native-dialog allowlist has no production exceptions. Admin optional comment
and server-action semantics are unchanged. Authorization is unchanged.

**Result:** `PASS`

## Operator acceptance

| ID | Status |
| --- | --- |
| OA-A | `PASS` |
| OA-B | `PASS` |
| OA-C | `PASS` |

A minor UI correction was then made directly in Cursor: removal of the global
Add turn control. That worktree diff is authoritative.

## Checkpoints

| Gate | Status |
| --- | --- |
| UI operator acceptance | `PASS` |
| Eval registry | `RECONCILED` |
| Focused CU tests | recorded in the finalization report |
| Managed E2E A–C | recorded in the finalization report |
| Native-dialog guard | `PASS` (0 production exceptions) |
| L3 `validate:fast` | recorded in the finalization report |
| L4 `validate:deploy` + smoke | recorded in the finalization report |
| DB migration / schema / actual env / live provider | `NO` |
| Commit / push | authorized after gates; deploy not authorized |
