# 06 Recording And Transcription Pipeline

## Pipeline Overview

1. Recording state transitions to complete with persisted storage key.
2. Transcription run downloads source audio from object storage.
3. Audio is evaluated for compatibility and optionally transcoded/compressed.
4. Selected transcription provider runs diarization/transcription.
5. Transcript and segments are stored with processing metadata.

## Pause/Resume Recording Continuity (Stages 3.4.1-3.4.4)

- Current pipeline remains single-recording-per-session (`Recording.sessionId` unique, `Transcript.sessionId` unique).
- Recording lifecycle remains single-file:
  - start recording on negotiation `START`;
  - do not physically stop recording on `PAUSE`;
  - close recording on `FINISH`.
- `SessionPauseInterval` is the exclusion source for pause windows:
  - `PAUSE` opens interval when none is open;
  - `RESUME` closes latest open interval;
  - `FINISH` closes all still-open intervals.
- Transcription filtering uses segment classification against all pause intervals:
  - drop segments fully inside a paused interval;
  - keep tiny boundary jitter overlap (`overlapDurationSeconds <= 0.35`);
  - drop segments with dominant paused overlap (`overlapRatio >= 0.6`);
  - drop segments with significant absolute paused overlap (`overlapDurationSeconds >= 1.25`), even if overlap ratio is below 0.6;
  - keep boundary-overlap segments otherwise.
- Known limitation: filtering is segment-level (no word-level split), so mixed boundary segments are kept/dropped by dominance.

## Experimental Source-Audio Pause Cut (Stage 3.4.4)

- Feature-flagged by `PAUSE_PROCESSING_MODE`.
  - `transcript_interval_filter` (default): existing segment-level pause filtering.
  - `source_audio_cut`: builds an active-only audio file before SpeechKit.
- In `source_audio_cut` mode:
  - continuous source recording is still downloaded as one file;
  - `SessionPauseInterval` rows are converted to recording-relative offsets;
  - active timeline intervals are built (real timeline -> active timeline map);
  - ffmpeg cuts pause windows and concatenates active parts into `active-audio.wav`;
  - SpeechKit receives active-only audio.
- Transcript metadata stores `pauseProcessing` diagnostics:
  - mode, source/active durations, pause/active interval counts,
  - removed pause duration,
  - active timeline map,
  - ffmpeg diagnostics and local artifact path when available.
- If ffmpeg is unavailable in `source_audio_cut` mode, transcription fails with an explicit recoverable error (no silent fallback to segment-level filtering in that run).

## Key Implementations

- Transcription orchestrator: `lib/services/transcription-runner.ts`.
- Active timeline builder: `lib/transcription/active-audio-timeline.ts`.
- Active audio builder: `lib/transcription/active-audio-builder.ts`.
- Provider abstraction: `lib/services/transcription-provider.ts`.
- Yandex SpeechKit provider: `lib/services/yandex-speechkit-transcription.ts`.
- Recording key normalization: `lib/storage/recording-file-key.ts`.
- Storage adapter: `lib/storage/s3.ts`.

## Readiness Rules

- Transcription starts only when recording is in ready terminal state and storage object is usable.
- Status progression is surfaced through `materials/status`.
- Manual stop/cancel state is represented with explicit transcript failure sentinel.
- Session pause windows (`SessionPauseInterval`) are converted to recording-relative offsets and classified against transcript segments before persistence.

## Observability

- Processing metadata stores preprocessing decisions, provider timings, and quality indicators.
- External failures are classified and written to `ExternalServiceEvent`.
- Transcript processing metadata includes pause-filtering diagnostics:
  - `totalPausedIntervals`
  - `appliedIntervals`
  - `filteredSegmentCount`
  - `fullyPausedDroppedCount`
  - `boundaryOverlapKeptCount`
  - `boundaryOverlapDroppedCount`
  - `significantOverlapDroppedCount`
  - `maxKeptPauseOverlapSeconds`
  - `maxDroppedPauseOverlapSeconds`
- Source-audio mode metadata includes:
  - `pauseProcessing.mode`
  - `pauseProcessing.sourceRecordingDurationMs`
  - `pauseProcessing.activeAudioDurationMs`
  - `pauseProcessing.activeTimelineMap`
  - `pauseProcessing.sourceAudioArtifactPath`
  - `pauseProcessing.ffmpegDiagnostics`

## Local Pause-Filter Calibration Harness (Stage 3.4.4)

- Local-only calibration mode is gated by `PAUSE_FILTER_CALIBRATION_ENABLED=1`.
- Before pause filtering drops any segment, transcription runner writes:
  - `.debug/pause-filter-calibration/<sessionId>/raw-calibration-input.json`
- The raw artifact captures:
  - provider normalized segments,
  - mapped segments before filtering,
  - transcript text/diarized text before filtering,
  - absolute pause intervals and recording-relative pause offsets,
  - production classifier decision per segment.
- Optional marker-driven auto-run (`PAUSE_FILTER_CALIBRATION_AUTO_RUN=1`) evaluates
  a grid of candidate pause-filter rules and writes local artifacts under
  `.debug/pause-filter-calibration/<sessionId>/`.
- Calibration output is for review only; production defaults are unchanged.

## Source Notes

- `lib/services/transcription-runner.ts`
- `lib/services/transcription-provider.ts`
- `lib/services/yandex-speechkit-transcription.ts`
- `lib/transcription/pause-filter-calibration.ts`
- `lib/transcription/active-audio-timeline.ts`
- `lib/transcription/active-audio-builder.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `tests/e2e/session-materials-processing.spec.ts`
