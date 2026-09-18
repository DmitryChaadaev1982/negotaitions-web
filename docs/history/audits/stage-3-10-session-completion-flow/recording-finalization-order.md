# Recording Finalization Order (Current vs Final Target)

## Sequence

1. Facilitator finish action updates negotiation state to `FINISHED`.
2. Recording stop path:
   - LiveKit: server attempts stop in `/control`.
   - Voximplant: client posts `/recording-control stop`, receives scenario message, relays to conference.
3. Recording row upsert on stop (`STOPPED` or idempotent existing terminal state).
4. Provider callback/webhook (`/voximplant/recording-status`) updates canonical row.
5. If `stopped` with normalized `fileKey`, webhook upgrades to `COMPLETED`.
6. Materials/status interprets recording stage and enables downstream transcription readiness checks.

## Answers

- **Can users navigate to materials before finalization?** Yes.
- **Can recording finalize after room closure/navigation?** Yes.
- **Can room disconnect prevent stop?** For Voximplant, yes in edge cases (client relay dependency); partial mitigations exist.
- **Can delayed webhook leave session stuck?** Recording can remain `STOPPED/finalizing` until webhook/fallback resolution.
- **Can duplicate stop corrupt state?** Low corruption risk; status transition guards and idempotent stop upserts reduce damage.
- **What about unfinished recordings?** Materials/status shows finalizing/processing/failed states; facilitator can observe error paths.
- **Does materials polling handle delayed processing?** Yes (`shouldPoll` across active recording/transcript/AI stages).

## Current protection set

- Vox webhook signature validation and transition guard (`isValidStatusTransition`)
- Stop idempotency at row-level (`upsertVoximplantRecordingOnStop`)
- Client-side duplicate stop suppression (`stopInFlightRef`)

## Remaining gap

- No end-to-end transactional guarantee binding session FINISH, provider stop acknowledgment, webhook completion, and client redirect.

## Final target clarification — Event completion recording semantics

When an authorized organizer completes a `TrainingEvent`:

1. Event completion must claim/create idempotent Event operation.
2. Linked unfinished Sessions must be completed through canonical Session completion service (batch-safe mode), not ad hoc Session row mutations.
3. For each linked Recording in active/paused state, request the same idempotent recording-stop orchestration as normal Session FINISH.
4. For `NOT_STARTED|PROCESSING|COMPLETED|FAILED|STOPPED` equivalent states, apply valid transition rules and avoid duplicate stop operation.
5. Exactly one logical stop operation may exist per Recording.
6. Linked rooms hard-close under Event semantics regardless of remaining presence.
7. Event lobby becomes unavailable for active participation.
8. Webhook finalization/transcription/enhancement/mapping/AI continue independently after room/lobby closure.
9. Per-session stop failures must remain visible and retryable without reopening Event or rolling Event state back to active.
