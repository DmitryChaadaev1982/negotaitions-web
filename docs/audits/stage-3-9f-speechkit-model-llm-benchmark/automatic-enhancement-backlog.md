# Automatic Enhancement Backlog Design (No Implementation)

## Goals

1. Auto-start enhancement after every successful automatic transcription.
2. Keep transcription success independent from enhancement success.
3. Preserve all current manual controls and re-run paths.
4. Prevent duplicate enhancement jobs for the same transcript/version.

## Proposed flow

1. Automatic transcription completes and raw transcript persists.
2. Runner checks `TRANSCRIPT_ENHANCEMENT_AUTO_RUN`.
3. If enabled and transcript eligible, acquire enhancement lease/idempotency key.
4. Launch enhancement asynchronously (non-blocking preferred).
5. Persist enhancement result:
   - success: update `text`, keep `qualityText` raw
   - failure: keep raw transcript visible; mark enhancement failed
6. Release lease and expose final status in status API/UI.

## Status model behavior

- Preserve/extend statuses:
  - `pending`, `running`, `completed`, `partial`, `failed`, `skipped`
- UI must distinguish:
  - transcription completed
  - enhancement running
  - enhancement completed
  - enhancement failed but raw available

## Idempotency and concurrency

- Lock key suggestion: transcript ID + raw-text hash + enhancement mode version.
- Reject or coalesce duplicate in-flight jobs.
- Allow manual re-enhancement to create new job only when lease is free (or explicitly override with safe guardrails).

## Manual controls (must remain)

- Manual transcribe/re-transcribe unchanged.
- Manual enhance/re-enhance unchanged.
- Diagnostics endpoints/controls unchanged.

## Env naming sanity (current codebase)

- Existing enhancement model key is `YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL` (not `TRANSCRIPT_ENHANCEMENT_MODEL`).
- Existing output mode key is `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE`.
- Existing SpeechKit config keys include:
  - `YANDEX_SPEECHKIT_MODEL`
  - `YANDEX_SPEECHKIT_LANGUAGE`
  - `YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING`
  - `YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED`
  - `YANDEX_SPEECHKIT_LITERATURE_TEXT`

## Telemetry cleanups to include later

1. On successful enhancement attempts, avoid storing `failureStage=integrity_validation`; use `null` or rename field to `lastValidationStage`.
2. Separate timing fields for:
   - transcription-run timing
   - automatic enhancement timing
   - manual enhancement timing

