# Stage 3.9F Automatic Enhancement Implementation Status

## Scope implemented

- Automatic transcript enhancement after successful Yandex SpeechKit transcription.
- Shared enhancement orchestration for automatic trigger, manual enhancement,
  and manual re-enhancement.
- Idempotency and stale-running recovery based on persisted metadata and
  deterministic input identity.
- Non-fatal enhancement execution: raw transcription remains usable on failure.
- Status/UI plumbing for `RUNNING` / `COMPLETED` / `PARTIAL` / `FAILED` / `SKIPPED`.
- Manual enhancement API keeps `202 Accepted` asynchronous contract
  (lock acquisition + background enhancement execution).
- Re-transcription queue/failure paths preserve previous `processingMetadata`
  until new raw transcript persistence succeeds.

## Final pipeline

`active-audio` -> `Yandex SpeechKit (general:rc)` -> `raw transcript persistence` ->
`optional auto DeepSeek JSON Schema enhancement` -> `speaker mapping` -> `AI analysis`

## Invariants

- Active-audio remains ASR input (`source_audio_cut` flow unchanged).
- Pause-removal behavior and Pause/Resume semantics are unchanged.
- SpeechKit built-in LLM is not used.
- `qualityText` is canonical raw SpeechKit text.
- `text` is replaced only after validated enhancement persistence.
- Enhancement failure is non-fatal and never removes raw transcript availability.
- Manual controls remain available, including re-enhancement and re-transcription.

## Feature flags

- `YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED` gates enhancement provider usage.
- `TRANSCRIPT_ENHANCEMENT_AUTO_RUN` gates automatic trigger (default `false`).
- Automatic trigger requires both flags to be `true`.

## Telemetry model (sanitized)

`processingMetadata.transcriptEnhancement` stores:

- `triggerSource`
- `inputIdentity`
- `idempotencyDecision`
- `queuedAt`, `startedAt`, `finishedAt`, `durationMs`
- `status`
- `model`, `outputMode`, `schemaVersion`, `promptVersion`
- `chunkCount`, `successfulChunkCount`, `failedChunkCount`
- `retryCount`, `fallbackSegmentCount`, `schemaValidationPassed`
- `skipReason`, `errorCategory`, `failureStage` (`null` on success)
