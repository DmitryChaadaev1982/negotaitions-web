# 06 Recording And Transcription Pipeline

## Pipeline Overview

1. Recording state transitions to complete with persisted storage key.
2. Transcription run downloads source audio from object storage.
3. Audio is evaluated for compatibility and optionally transcoded/compressed.
4. Selected transcription provider runs diarization/transcription.
5. Transcript and segments are stored with processing metadata.

## Key Implementations

- Transcription orchestrator: `lib/services/transcription-runner.ts`.
- Provider abstraction: `lib/services/transcription-provider.ts`.
- Yandex SpeechKit provider: `lib/services/yandex-speechkit-transcription.ts`.
- Recording key normalization: `lib/storage/recording-file-key.ts`.
- Storage adapter: `lib/storage/s3.ts`.

## Readiness Rules

- Transcription starts only when recording is in ready terminal state and storage object is usable.
- Status progression is surfaced through `materials/status`.
- Manual stop/cancel state is represented with explicit transcript failure sentinel.

## Observability

- Processing metadata stores preprocessing decisions, provider timings, and quality indicators.
- External failures are classified and written to `ExternalServiceEvent`.

## Source Notes

- `lib/services/transcription-runner.ts`
- `lib/services/transcription-provider.ts`
- `lib/services/yandex-speechkit-transcription.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `tests/e2e/session-materials-processing.spec.ts`
