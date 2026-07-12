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

## Source-Audio Pause Processing (Production Default)

- Feature-flagged by `PAUSE_PROCESSING_MODE`.
  - `source_audio_cut` (**default when env is unset**): builds an active-only audio file before SpeechKit.
  - `transcript_interval_filter` (**legacy/deprecated fallback**): approximate segment-level pause filtering.
- In `source_audio_cut` mode:
  - continuous source recording is still downloaded as one file;
  - `SessionPauseInterval` rows are converted to recording-relative offsets;
  - active timeline intervals are built (real timeline -> active timeline map);
  - ffmpeg cuts pause windows and concatenates active parts into `active-audio.wav`;
  - SpeechKit receives active-only audio.
- In `source_audio_cut`, transcript interval filtering is bypassed by design (no double filtering).
- Transcript metadata stores `pauseProcessing` diagnostics:
  - mode, source/active durations, pause/active interval counts,
  - removed pause duration,
  - active timeline map,
  - ffmpeg diagnostics and local artifact path when available.
- If ffmpeg is unavailable or fails in `source_audio_cut` mode, transcription fails explicitly (no silent fallback to full recording or segment-level filtering in that run).
- Source-audio debug artifacts are written under `PAUSE_SOURCE_AUDIO_DEBUG_DIR` when configured; default path is `.debug/pause-source-audio`.

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
  - `pauseProcessing.removedPauseDurationMs`
  - `pauseProcessing.pauseIntervalCount`
  - `pauseProcessing.activeIntervalCount`
  - `pauseProcessing.activeTimelineMap`
  - `pauseProcessing.sourceAudioArtifactPath`
  - `pauseProcessing.ffmpegDiagnostics`

## Transcript Enhancement Modes (Stage 3.9E Phase 1)

- Enhancement runtime mode is controlled by `TRANSCRIPT_ENHANCEMENT_MODE`:
  - `single` (default, rollback-safe): existing one-request enhancement flow.
  - `chunked`: bounded chunk enhancement with deterministic merge and per-chunk fallback.
- Chunked mode uses ordered `TranscriptSegment` input and keeps canonical fields unchanged:
  - segment identity (`orderIndex` / ID),
  - start/end timestamps,
  - speaker labels and participant mapping,
  - original segment ordering.
- Chunk planning is deterministic and contiguous:
  - balanced split by segment count and character budget,
  - bounded by `TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS` and `TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS`,
  - context neighbors are read-only and cannot overwrite target segments.
- Concurrency and retry are bounded:
  - `TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY` (default `4`),
  - `TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS` (default `120000`),
  - `TRANSCRIPT_ENHANCEMENT_MAX_RETRIES` (default `1`, transient timeout/network/provider errors only).
- Empty-output reliability policy per chunk (bounded to max 3 attempts):
  - attempt 1: primary model with normal prompt;
  - attempt 2: primary model strict-JSON retry with increased bounded `max_output_tokens`;
  - attempt 3: optional `TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL` strict-JSON retry when configured.
- Empty-output diagnostics are persisted as sanitized attempt telemetry (no raw provider payload):
  - `responseIdPresent`, `initialStatus`, `finalStatus`,
  - `pollingAttemptCount`, `pollingElapsedMs`,
  - `outputFieldDetected`, `rawOutputCharCount`,
  - `parsedSegmentCount`, `emptyOutputStage`,
  - `modelUsed`, `maxOutputTokens`,
  - `fallbackTriggered`, `fallbackReason`.
- Deterministic merge and no-loss rules:
  - merge strictly by original segment order,
  - unknown or duplicate model indexes reject that chunk,
  - empty non-empty segment rewrites are rejected,
  - catastrophic shrinkage is rejected per segment,
  - missing/failed chunk outputs fall back to original text.
- Enhancement statuses in `processingMetadata.transcriptEnhancement.status`:
  - `COMPLETED`: all chunks succeeded;
  - `PARTIAL`: at least one chunk succeeded and at least one chunk used fallback;
  - `FAILED`: all chunks used fallback or orchestration failed;
  - `SKIPPED`: enhancement skipped due empty input.
- Persistence safety and recovery path:
  - enhanced text is persisted into `Transcript.text`, `Transcript.diarizedText`, and `TranscriptSegment.text` when status is `COMPLETED` or `PARTIAL`;
  - initial transcription ingestion now stores provider text in both `TranscriptSegment.text` and `TranscriptSegment.qualityText` for newly created rows;
  - pre-enhancement per-segment provider text is preserved once in existing `TranscriptSegment.qualityText` (`qualityText ?? text` at first enhancement write) and remains immutable backup;
  - every manual re-enhancement input segment starts from `originalText = qualityText ?? text`, so enhancement never recursively re-enhances previous AI output when backup exists;
  - original transcript can be reconstructed from ordered segments using preserved `qualityText` + existing speaker/timestamp fields;
  - `TRANSCRIPT_ENHANCEMENT_MODE=single|chunked` only changes execution mode for future runs and does not revert already persisted enhanced text.
- UI rendering path is unchanged and single-source:
  - transcript/materials UI reads persisted canonical text (`Transcript.text`, `Transcript.diarizedText`, `TranscriptSegment.text`);
  - UI does not currently expose side-by-side original vs enhanced transcript versions.

## Transcript Enhancement Structured Output (Stage 3.9E JSON Schema)

- Output mode is now independently controlled by `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE`:
  - `legacy` (default): prompt-generated JSON path.
  - `json_schema`: Responses API provider-enforced schema via `text.format`.
- In `json_schema` mode, each chunk sends a dynamic strict schema:
  - root object with required `segments`;
  - `segments` is an object keyed by exact chunk target indexes (`"12"`, `"13"`, ...);
  - root and `segments` both use `additionalProperties=false`;
  - each key value is `string` with `minLength=1`.
- Response handling in `json_schema` mode is strict and deterministic:
  - parse extracted output as JSON without repair;
  - reject missing/extra keys, non-string values, empty/whitespace-only values;
  - retain catastrophic-shrink guard before applying any text update;
  - preserve no-loss fallback to original text on invalid chunk output.
- Retry and safety semantics are unchanged:
  - bounded retries only;
  - no long polling in schema mode;
  - statuses remain `COMPLETED`/`PARTIAL`/`FAILED`/`SKIPPED`;
  - `FAILED` means no transcript text mutation.

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
