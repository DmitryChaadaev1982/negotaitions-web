# Implementation Recommendation (Design Only)

## What should change

- Add automatic trigger for transcript enhancement immediately after successful automatic SpeechKit transcription.
- Keep raw text persistence invariant:
  - `qualityText` = canonical raw SpeechKit text.
  - `text` = enhanced text only after successful enhancement persistence.
- Add idempotency/lease guard to prevent duplicate concurrent enhancement runs.
- Keep manual controls unchanged:
  - manual transcribe / re-transcribe
  - manual enhance / re-enhance
  - diagnostics

## What should not change

- SpeechKit model/parameter baseline in this stage.
- DeepSeek JSON Schema enhancement strategy in this stage.
- DB schema in this stage (unless implementation phase later proves absolutely necessary).

## Audio-source recommendation from interval adjudication

- For transcription input, switch from pause-removed active-audio to full-length source:
  - preferred: original recording A
  - acceptable control-equivalent fallback: processed-no-cut B
- Keep active-audio generation and pause map for diagnostics/other features, but do not use cut audio as the primary ASR input until pause-interval detection is corrected and re-validated.

## Suggested integration points

- `lib/services/transcription-runner.ts`: enqueue or trigger enhancement after successful automatic transcription.
- `lib/services/yandex-transcript-enhancement.ts`: unchanged core logic, but called from new orchestration branch.
- `lib/services/transcript-enhancement-persistence.ts`: keep canonical-field guarantees.
- `app/api/sessions/[sessionId]/materials/status/route.ts`: expose explicit automatic-enhancement state.

## Rollout strategy

1. Introduce env flag `TRANSCRIPT_ENHANCEMENT_AUTO_RUN` default `false`.
2. Update transcription runner input selection to full-length audio for SpeechKit (A/B path).
3. Ship guarded code path; no behavior change while enhancement auto-run flag is off.
4. Enable canary and monitor:
   - transcript completeness across known pause windows
   - enhancement latency/failure rates
   - duplicate-run telemetry
5. Expand rollout gradually.

## Rollback strategy

- Set `TRANSCRIPT_ENHANCEMENT_AUTO_RUN=false`.
- Keep manual enhancement button operational.
- No transcription rollback required.

