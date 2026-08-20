# Stage 3.15A — Manual Checkpoint F

Date: 2026-08-19  
Purpose: operator review of Phase F transcription ownership / compatibility
convergence. Do not start Phase G from this document.

```
CHECKPOINT_F_ACCEPTED = NO
PHASE_G_STARTED = NO
NEXT_PHASE = G
MANUAL_CHECKPOINT_A = ACCEPTED
MANUAL_CHECKPOINT_B = ACCEPTED
MANUAL_CHECKPOINT_C = ACCEPTED
MANUAL_CHECKPOINT_D = ACCEPTED
MANUAL_CHECKPOINT_E = ACCEPTED
NO_COMMIT = YES
NO_PUSH = YES
NO_DEPLOY = YES
```

Authoritative requirements:
[`docs/requirements/stage-3-15a-post-processing-workflow.md`](../requirements/stage-3-15a-post-processing-workflow.md)

Normal room/Materials transcription UI did not change visually. Manual evidence
is the canonical-route network assertion (F06) plus unchanged speaker-mapping
anchors (F09). Headed UI walkthrough was not required.

## F1 trace

```
OLD_ROUTE_NORMAL_UI_CALLERS = none
OLD_ROUTE_AUTOMATIC_FALLBACK = NO
OLD_ROUTE_EXTERNAL_COMPATIBILITY_EVIDENCE =
  tests/e2e/session-lifecycle.spec.ts posts /transcribe-recording directly
OLD_ROUTE_RESPONSE_CONTRACT =
  200 + { transcript, warnings, recording: { compressedSizeBytes, compressionStatus } }
CANONICAL_ROUTE =
  POST /api/sessions/[sessionId]/materials/transcribe
  POST /api/sessions/[sessionId]/materials/retranscribe
```

## Expected flags

```
OLD_ROUTE_MODE = CANONICAL_ADAPTER
NORMAL_UI_USES_OLD_TRANSCRIBE_ROUTE = NO
OLD_TRANSCRIBE_ROUTE_SILENT_FALLBACK = NO
OLD_ROUTE_CAN_COMPETE_WITH_CANONICAL = NO
STALE_OLD_WRITER_CAN_OVERWRITE_NEW_GENERATION = NO
DOWNSTREAM_WORK_CAN_ATTACH_TO_WRONG_GENERATION = NO
ONE_PROVIDER_CALL_PER_ACCEPTED_GENERATION = YES
OLD_ROUTE_RESPONSE_CONTRACT_PRESERVED = YES
  envelope { transcript, warnings, recording } preserved
  mock fixture text aligned to canonical runner ("Mock speaker 1 line.")
CANONICAL_FAILURE_TRIGGERS_OLD_ROUTE = NO
SPEAKER_MAPPING_ANCHORS = PASS
S06_S07_REQUIREMENT_EVIDENCE_ACCOUNTED = YES
  PT-15 via deriveSpeakerMappingStatus in speaker-mapping-state.test.ts
  PT-16 via lib/transcription/phase-e-save-contract.test.ts
  Lab catalog IDs S06/S07 do not exist and were not invented
```

## Focused results

```
F01 = PASS
F02 = PASS
F03 = PASS
F04 = PASS
F05 = PASS
F06 = PASS
F07 = PASS
F08 = PASS
F09 = PASS
git diff --check = PASS
```

F09 Lab smoke: AM01 AM02 AM03 AM04 AM04B AM07A–E AM11 all PASS (11 passed, 2.8m).
Reconfirmed after Checkpoint E acceptance by Luna `validation-runner`
`6cc3ed21-6b5f-434e-a590-5e12b6f43387` with port 3100 free.

Deprecation/removal of `/transcribe-recording` remains deferred.
Do not document that route as failover.
