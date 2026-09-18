# Stage 3.24A — Managed Voximplant Test Identities

## Authority

This is the authoritative requirement/change-plan manifest for Stage 3.24A
CP1 (stable managed test slots + non-Vox provider isolation).
Architecture, privacy, access, database, operations, and existing validation
ladder documents remain the domain/safety authorities.

Status values: `APPROVED`, `IMPLEMENTED`, `DEFERRED`, `OUT_OF_SCOPE`, `PASS`,
`READY`.

```
STAGE_ID = 3.24A
STAGE_NAME = Managed Voximplant Test Identities
STAGE_KIND = test infrastructure
PRODUCT_BEHAVIOR_CHANGE = RETRANSCRIBE_SOURCE_UNAVAILABLE
CHECKPOINT = CP5 Focused Combined Validation
CP1 = READY
CP2 = READY
CP3 = PASS
CP4_SLICE_A = PASS
CP4B = PASS
CP5 = FOCUSED_PASS_READY_FOR_FINAL_VALIDATION
```

## Change Impact Analysis (CP4B / CP5)

```
CHANGE: Reconcile Stage 3.24A docs/eval copy with the approved dedicated
        recording-bucket retention: all objects in
        negotiations-recordings-dev-bucket expire at 90 days, no prefix,
        replacing the old 14-day prefix rule. No recordings/raw/, no
        recordNamePrefix change, no object or Prisma migration. UI copy
        stays neutral (unavailable, not "expired by retention").
INVARIANTS: Physical retention independent of saved materials; COMPLETED
            + fileKey remain historical; SOURCE_RECORDING_NOT_AVAILABLE
            is non-destructive; lifecycle is operator/cloud only;
            managed Vox slots and orphan-cleanup fences unchanged;
            one-time orphan apply is complete and is not re-executed.
IMPACT: architecture docs, requirements, eval registry expected UI,
        testing docs; no schema, storage, Vox, or runtime mutation
UNITS: CU-DOCS retention architecture; CU-COPY/eval UI semantics;
       CU-REVIEW combined surface; CU-L1 focused CP5
KERNEL: docs/runtime consistency — stale recordings/raw or retention-as-cause
        would mislead operators
EVAL: EVAL-S324A-RETRANSCRIBE-SOURCE-UNAVAILABLE (UI text), plus
      EVAL-S324A-MANAGED-VOX-TEST-IDENTITIES and
      EVAL-S324A-VOX-ORPHAN-CLEANUP (no live apply)
STRATEGY: A — documentation reconciliation + focused combined proof
VALIDATION_PLAN: L1 focused node:test + eslint + eval:registry:check.
                 No validate:fast/build/deploy. No broad Playwright.
                 Slice A UI operator checkpoint already PASS.
```

## Change Impact Analysis (CP4 Slice A)

```
CHANGE: Retranscribe downloads source bytes before admitTranscriptionRun.
        Missing object → SOURCE_RECORDING_NOT_AVAILABLE, zero material
        mutations. Recording COMPLETED is never rewritten to FAILED for
        source absence (initial + retranscribe).
INVARIANTS: Recording COMPLETED is historical truth; retention deletion
            does not invalidate saved transcript/analysis; successful
            retranscribe still invalidates AI/publication; no schema,
            storage PUT/COPY/DELETE, lifecycle, or Vox namespace change;
            no HEAD→admit→GET race.
IMPACT: server/domain, API, client, i18n, publication/currentness (must
        NOT change on miss), tests/evals, architecture docs
UNITS: CU-A error+classifier; CU-B preload before admit; CU-C reuse
       buffer; CU-D Recording FAILED fix; CU-E API 409; CU-F UI; CU-G tests
KERNEL: CU-B + CU-C + CU-D
EVAL: EVAL-S324A-RETRANSCRIBE-SOURCE-UNAVAILABLE
STRATEGY: A — preload, admit, buffer reuse, and FAILED invariant are one
          contract
VALIDATION_PLAN: L1 focused node:test only. No validate:fast/build/deploy.
                 Operator UI checkpoint after automated PASS.
```

## Change Impact Analysis (CP2-R2)

```
CHANGE: Add an operator-gated dry-run Vox ng_u_* orphan classifier. Keep-list
        = production Users + localhost:5432 manual Users + four managed E2E
        IDs + explicit /voximplant-test POC usernames. Default is dry-run.
INVARIANTS: No DelUser in this CP; bare CLI never deletes; production
            username algorithm reused; E2E port 5433 is not a keep source;
            fail closed if production or local-manual keep cannot load;
            collisions are AMBIGUOUS_BLOCKED; no user_id=all / wildcards.
IMPACT: provider integration (read-only GetUsers + unused apply fences),
        tests / evals, ops script, architecture/ops docs
UNITS: CU-R2-A classify/keep-index; CU-R2-B apply fences; CU-R2-C live
       dry-run inventory; CU-R2-D docs/eval
KERNEL: CU-R2-A + CU-R2-B — a wrong keep-list would authorize false deletes
        in a later apply CP
EVAL: EVAL-S324A-VOX-ORPHAN-CLEANUP
STRATEGY: A — classification and refuse-closed fences must ship together
VALIDATION_PLAN: L1 focused VC-01..VC-16 + username/CLI tests + one real
                 dry-run. No apply. validate:fast / validate:build /
                 validate:deploy NOT_RUN.
```

## Change Impact Analysis (CP2-R1)

```
CHANGE: Isolate managed Vox room-parity access onto a dedicated Session /
        participant / auth cookie; stop DB fixture tests from planting
        ACTIVE ng_u_fixture_* VideoProviderIdentity rows on canonical slots;
        delete the exact local E2E poison row if still present.
INVARIANTS: Production identity/Management API unchanged; ordinary Playwright
            still pins LiveKit; PARTICIPANT_02 legitimate identity untouched;
            managed Users survive cleanup; no DelUser / historical cleanup.
IMPACT: tests / evals / testing docs
UNITS: CU-R1-A serial fixture isolation; CU-R1-B non-contaminating identity
       tests; CU-R1-C exact poison-row cleanup
KERNEL: false fixture identity would hide production provisioning; shared
        serial userId mutation diverges cookie vs membership
EVAL: EVAL-S324A-MANAGED-VOX-TEST-IDENTITIES
STRATEGY: A — fixture isolation + source/observation identity proofs
VALIDATION_PLAN: L1 focused R1 tests, then explicit PLAYWRIGHT_VIDEO_PROVIDER
                 =voximplant RUN A/B. validate:fast / validate:build /
                 validate:deploy NOT_RERUN.
```

## Change Impact Analysis (CP1)

```
CHANGE: Add four fixed-User.id managed Vox E2E slots; preserve them across
        ordinary cleanup; pin ordinary managed Playwright to LiveKit;
        route only real Vox-access tests onto managed slots.
INVARIANTS: Production username/provisioning unchanged; same slot → same
            User.id → same ng_u_*; historical remote Vox users untouched;
            ordinary validation never inherits VIDEO_PROVIDER=voximplant;
            explicit PLAYWRIGHT_VIDEO_PROVIDER=voximplant still allowed;
            MAX 1 live login per slot; workers remain 1.
IMPACT: tests / evals / Playwright local config / testing docs
UNITS: CU-1 helper; CU-2 cleanup; CU-3 provider isolation; CU-4 route
       real-Vox tests; CU-DOCS/eval
KERNEL: CU-2 cleanup preservation vs ephemeral deletion (false negatives
        would leak users or destroy managed rows)
EVAL: EVAL-S324A-MANAGED-VOX-TEST-IDENTITIES
STRATEGY: A — helper + cleanup + isolation share one identity contract
VALIDATION_PLAN: L1 focused only. validate:fast / validate:build /
                 validate:deploy / live Vox / L4 NOT_RUN in CP1.
```

## Slot contract

| Slot | Fixed User.id | Reserved email |
| --- | --- | --- |
| FACILITATOR_01 | `e2e_managed_vox_facilitator_01` | `managed-vox-facilitator-01@e2e-reserved.test` |
| PARTICIPANT_01 | `e2e_managed_vox_participant_01` | `managed-vox-participant-01@e2e-reserved.test` |
| PARTICIPANT_02 | `e2e_managed_vox_participant_02` | `managed-vox-participant-02@e2e-reserved.test` |
| OBSERVER_01 | `e2e_managed_vox_observer_01` | `managed-vox-observer-01@e2e-reserved.test` |

Prisma `User.id` is `String @id @default(cuid())`. Explicit IDs are supported.
No schema change. Recreating a missing row uses the same fixed id so
`buildVoximplantUsernameForUser` recovers the same remote username.

Concurrency: Playwright `workers = 1`, `fullyParallel = false`.
`MAX_1_LIVE_LOGIN_PER_SLOT` because `SetUserInfo` rotates the password before
one-time-key login. Worker-scoped pools are out of scope.

## Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| S324A-I01 | Four managed slots with fixed User.id and reserved email | IMPLEMENTED |
| S324A-I02 | `ensureManagedVoxE2EUser` reuses/creates exact fixed User.id | IMPLEMENTED |
| S324A-I03 | Recreated slot after local deletion keeps the same User.id | IMPLEMENTED |
| S324A-I04 | Username comes only from production `buildVoximplantUsernameForUser` | IMPLEMENTED |
| S324A-C01 | Ordinary cleanup preserves managed User + VideoProviderIdentity | IMPLEMENTED |
| S324A-C02 | Ordinary cleanup still deletes ephemeral test Users | IMPLEMENTED |
| S324A-C03 | Per-test Session/Event memberships for managed users are removed | IMPLEMENTED |
| S324A-P01 | Ordinary managed Playwright pins `VIDEO_PROVIDER=livekit` | IMPLEMENTED |
| S324A-P02 | `PLAYWRIGHT_VIDEO_PROVIDER=voximplant` remains the explicit Vox path | IMPLEMENTED |
| S324A-P03 | Observer scaling stays ephemeral and non-Vox | IMPLEMENTED |
| S324A-R01 | Production identity / Management API source unchanged | IMPLEMENTED |
| S324A-R02 | No live AddUser / SetUserInfo / DelUser in CP1 validation | IMPLEMENTED |
| S324A-F01 | Managed room-parity Vox access uses a dedicated Session/participant/auth and does not rewrite the shared serial `SessionParticipant.userId` | IMPLEMENTED |
| S324A-F02 | Later serial room-parity tests keep the original fixture userId and cookie | IMPLEMENTED |
| S324A-F03 | DB fixture tests do not leave `ng_u_fixture_*` ACTIVE identities on canonical managed slots | IMPLEMENTED |
| S324A-F04 | Managed User survives ordinary cleanup with or without a `VideoProviderIdentity` | IMPLEMENTED |
| S324A-F05 | Ordinary cleanup does not delete a legitimate existing `VideoProviderIdentity` | IMPLEMENTED |
| S324A-H01 | Operator cleanup tool defaults to dry-run; a bare invocation never deletes | IMPLEMENTED |
| S324A-H02 | DELETE_CANDIDATE requires exact `^ng_u_[0-9a-f]{16}$` and absence from production, local-manual, managed E2E, and explicit keep lists | IMPLEMENTED |
| S324A-H03 | Local manual Users on localhost:5432 are authoritative KEEP | IMPLEMENTED |
| S324A-H04 | E2E port 5433 contributes only the four managed IDs to KEEP; other rows are correlation hints | IMPLEMENTED |
| S324A-H05 | Production or local-manual keep-list load failure fails closed | IMPLEMENTED |
| S324A-H06 | Hash collisions across keep sources are AMBIGUOUS_BLOCKED | IMPLEMENTED |
| S324A-H07 | Future apply requires `--apply` + `--expected-count` and refuses count/set drift; live CLI also requires `VOX_ORPHAN_CLEANUP_ALLOW_APPLY=1` | IMPLEMENTED |
| S324A-H08 | No `user_id=all` / wildcard / prefix deletion mode | IMPLEMENTED |
| S324A-H09 | CP2-R2 Phase 1 performs GetUsers + read-only SQL only; zero DelUser | IMPLEMENTED |
| S324A-RT-01 | Missing source before retranscribe returns SOURCE_RECORDING_NOT_AVAILABLE; count/history/transcript unchanged | IMPLEMENTED |
| S324A-RT-02 | Missing source leaves Recording COMPLETED, fileKey, and errorMessage unchanged | IMPLEMENTED |
| S324A-RT-03 | Missing source does not change AI currentness, publication, grants, visibility, shared payload, or notes | IMPLEMENTED |
| S324A-RT-04 | GET NotFound before admission performs zero historical mutation | IMPLEMENTED |
| S324A-RT-05 | Storage timeout during preload is not classified as SOURCE_RECORDING_NOT_AVAILABLE and does not admit | IMPLEMENTED |
| S324A-RT-06 | Successful preload admits once, reuses bytes, and retains downstream invalidation | IMPLEMENTED |
| S324A-RT-07 | Initial transcription source absence keeps Recording COMPLETED | IMPLEMENTED |
| S324A-RT-08 | UI shows neutral unavailable copy (not retention-as-cause) and does not clear saved transcript/analysis | IMPLEMENTED |
| S324A-RET-01 | Dedicated recording bucket negotiations-recordings-dev-bucket; no recordings/raw/; no Vox recordNamePrefix or historical object/fileKey rewrite | IMPLEMENTED |
| S324A-RET-02 | Operator/cloud lifecycle is bucket-wide 90-day expiration for all objects, replacing the prefix-specific 14-day rule; not application runtime | IMPLEMENTED |
