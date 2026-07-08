# 06 Recording And Transcription Pipeline

## Pipeline Overview

1. Recording state transitions to complete with persisted storage key.
2. Transcription run downloads source audio from object storage.
3. Audio is evaluated for compatibility and optionally transcoded/compressed.
4. Selected transcription provider runs diarization/transcription.
5. Transcript and segments are stored with processing metadata.

## Pause/Resume Recording Continuity (Stage 3.4.1)

- Current pipeline remains single-recording-per-session (`Recording.sessionId` unique, `Transcript.sessionId` unique).
- Recording lifecycle remains single-file:
  - start recording on negotiation `START`;
  - do not physically stop recording on `PAUSE`;
  - close recording on `FINISH`.
- `SessionPauseInterval` is the exclusion source for pause windows:
  - `PAUSE` opens interval when none is open;
  - `RESUME` closes latest open interval;
  - `FINISH` closes all still-open intervals.
- Transcription filtering excludes segments overlapping any pause interval while retaining post-resume speech.

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
- Session pause windows (`SessionPauseInterval`) are converted to recording-relative offsets and overlapping transcript segments are filtered before transcript persistence.

## Observability

- Processing metadata stores preprocessing decisions, provider timings, and quality indicators.
- External failures are classified and written to `ExternalServiceEvent`.
- Transcript processing metadata includes pause-filtering diagnostics (`totalIntervals`, `appliedIntervals`, `filteredSegmentCount`).

## Source Notes

- `lib/services/transcription-runner.ts`
- `lib/services/transcription-provider.ts`
- `lib/services/yandex-speechkit-transcription.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `tests/e2e/session-materials-processing.spec.ts`
