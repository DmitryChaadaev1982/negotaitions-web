# 06 Recording And Transcription Pipeline

## Pipeline Overview

1. Recording state transitions to complete with persisted storage key.
2. Transcription run downloads source audio from object storage.
3. Audio is evaluated for compatibility and optionally transcoded/compressed.
4. Active-audio (pause-cut) is built and sent to Yandex SpeechKit (`source_audio_cut`).
5. Raw transcript and raw transcript segments are durably persisted.
6. Optional automatic transcript enhancement runs (DeepSeek JSON Schema mode).
7. Transcript and segments are finalized for speaker mapping and AI analysis.

## Recording Attempt Identity and CAS Discipline (Stage 3.13E)

- `Recording.recordingAttemptId` is the stable identity of one provider recording
  attempt and fences all delayed mutations.
- START admission persists `recordingAttemptId` and `STARTING` state before
  provider dispatch; provider dispatch never opens the attempt identity.
- Callback application uses two-step attempt validation:
  1. pre-HEAD attempt correlation check;
  2. post-HEAD recheck inside DB transaction before mutation.
- S3 HEAD verification is intentionally outside DB transactions; row/session locks
  are taken only for final mutation to avoid long lock hold during network I/O.
- Timeout reconciliation (`STARTING` -> `FAILED`) and callback terminal updates are
  CAS-fenced by `id + recordingAttemptId + expected status`.
- Legacy `recordingAttemptId = NULL` rows remain valid historical data but do not
  participate in fenced timeout-recovery paths.
- Existing control-state/materials polling may run one throttled RC4
  exact-attempt provider query for stale STARTING, durable stopping, or the
  recoverable callback-loss failure. Provider `stopped` still requires object
  key normalization, S3 verification outside a transaction, and the second
  attempt/status CAS before normal completion and downstream processing.
  An exact active result can re-drive only a due STOP operation carrying that
  same `recordingAttemptId`.

## Recording Indicator Semantics

- UI recording indicator is bound to authoritative backend `Recording.status`
  returned by control-state/materials APIs, not optimistic client relay results.
- Session `control-state` and negotiation-control responses return the canonical
  `recordingAttemptId` with that status. Obsolete scenario/controller-call
  status messages never replace this server-owned room state; attempt-fenced
  callbacks must first update the canonical `Recording` row.
- `STARTING` is rendered as an explicit non-success state
  (`recording.recordingStarting`), while success-red "recording in progress"
  appears only after backend status reaches `RECORDING`.
- Callback-loss uncertainty is bounded to
  `FAILED + RECORDING_STARTING_TIMEOUT_RECONCILED` and renders the distinct
  orange `recording.recordingDidNotStart` warning. Other FAILED reasons retain
  normal failure semantics.
- The scenario's `STARTING` webhook carries no `startedAt`. The authoritative
  start timestamp is emitted only from that recorder instance's `Started` event
  together with canonical `RECORDING`. If cleanup was already requested after a
  start timeout, a late `Started` event is cleanup-only: it cannot emit
  `RECORDING`, so it cannot reactivate the recording indicator. A later
  attempt-scoped `Stopped` remains eligible for server-fenced recovery.
- Negotiation `RUNNING` does not imply recording `RECORDING`; these lifecycles are
  intentionally decoupled.
- The same status mapping applies to standalone and Event-created sessions.

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
- Active-audio remains the production ASR input; full-length/original audio is not used
  by default in this pipeline.
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

## Materials Freshness Contract

- Materials UI and room/debrief consumers read authoritative backend
  `Recording`, `Transcript`, enhancement, speaker-mapping, and AI operation
  state through the materials/control APIs; client relay or provider messages
  are not freshness authority.
- A status is publishable only after its corresponding durable persistence and
  attempt/run fencing succeeds. Delayed callbacks, stale workers, and abandoned
  browser sessions cannot make older material state look newer.
- Recording, transcription, enhancement, mapping, and analysis are independent
  progress dimensions. A ready material in one dimension must not imply that
  another dimension is complete or accessible.
- Non-facilitator materials projections retain safe canonical enhancement and
  analysis completion status even when the viewer has no publication grant.
  Processing freshness never grants transcript or AI-report access; publication
  authorization is defined separately by `08-ai-analysis-and-debrief.md`.
- No-grant debrief polling receives canonical AI status distinctly from absent
  analysis state: pending/running continues polling, a current completed report
  remains publishable despite later upstream failure, and terminal AI failure
  without such a report stops polling. This readiness outcome never changes
  authorization.

## Single-Run Admission

- Initial transcription and manual retranscription serialize admission by
  locking the owning non-deleted `Session` row.
- The current `Transcript` status check, generation/archive preparation, and
  `QUEUED` upsert execute in the same transaction. A competing request waits,
  observes the committed active claim, and returns `409` without starting a
  second provider run.
- Provider download/transcription starts only after the claim transaction
  commits, so the row lock is not held across external work.
- This Session-scoped admission fence is shared by standalone and Event-created
  Sessions. It preserves the existing post-transcription enhancement trigger
  while preventing duplicate provider cost and competing raw/enhancement
  persistence for one transcript generation.
- AI analysis persists the canonical transcript ID and `retranscribeCount` it
  consumed. Materials status and AI publication use that same identity to mark
  older completed analysis stale; a report from an earlier transcript
  generation is not publishable.

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
  - `single`: one-request enhancement flow.
  - `chunked`: bounded chunk enhancement with deterministic merge and per-chunk fallback.
- Local default is `chunked` unless explicitly overridden for rollback diagnostics.
- `single` is honored only when the complete input fits the configured segment
  and character bounds. Larger input automatically uses the bounded chunked
  path; rollback mode cannot turn an oversized utterance into an unbounded
  request.
- Chunked mode uses ordered `TranscriptSegment` input and keeps canonical fields unchanged:
  - segment identity (`orderIndex` / ID),
  - start/end timestamps,
  - speaker labels and participant mapping,
  - original segment ordering.
- Chunk planning is deterministic and contiguous:
  - balanced split by segment count and character budget,
  - bounded by `TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS` and `TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS`,
  - context neighbors are read-only and cannot overwrite target segments.
- Stage 3.13D Wave 2 makes the character bound effective for every individual
  utterance:
  - complete utterances remain the preferred target unit;
  - an utterance over the target budget is split deterministically at sentence
    punctuation, then whitespace, and only then a Unicode-safe hard boundary;
  - every piece retains source segment index/ID, speaker, participant mapping,
    timestamps, piece order, and exact local separators;
  - provider keys for pieces are internal and unique; persistence still targets
    the original `orderIndex`;
  - all pieces must succeed before the reconstructed utterance is accepted.
    If any piece fails, the complete original utterance is used instead;
  - empty/whitespace-only source utterances are deterministic pass-through
    entries and cannot poison a neighboring provider chunk.
- The configured character limit bounds editable target text. With the default
  one read-only neighbor on each side, total source text in one provider prompt
  is bounded by three times that target limit. Prompt/schema overhead is also
  bounded by the configured target-count limit.
- Concurrency and retry are bounded:
  - `TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY` (default `4`),
  - `TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS` (default `120000`).
- Empty-output reliability policy per chunk is bounded to two attempts:
  - attempt 1: primary model with normal prompt;
  - attempt 2: primary model strict-JSON retry with increased bounded `max_output_tokens`;
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
  - `COMPLETED`: all chunks succeeded and no source segment used fallback;
  - `PARTIAL`: at least one chunk succeeded and at least one chunk or source segment used fallback;
  - `FAILED`: all chunks used fallback or orchestration failed;
  - `SKIPPED`: enhancement skipped due empty input.
- Materials/debrief status UI maps only `COMPLETED` to explicit
  success/green semantics. Running remains active, `PARTIAL`/`FAILED` remain
  warning/error, and `SKIPPED` remains neutral.
- Persistence safety and recovery path:
  - enhanced text is persisted into `Transcript.text`, `Transcript.diarizedText`, and `TranscriptSegment.text` when status is `COMPLETED` or `PARTIAL`;
  - initial transcription ingestion now stores provider text in both `TranscriptSegment.text` and `TranscriptSegment.qualityText` for newly created rows;
  - pre-enhancement per-segment provider text is preserved once in existing `TranscriptSegment.qualityText` (`qualityText ?? text` at first enhancement write) and remains immutable backup;
  - every manual re-enhancement input segment starts from `originalText = qualityText ?? text`, so enhancement never recursively re-enhances previous AI output when backup exists;
  - original transcript can be reconstructed from ordered segments using preserved `qualityText` + existing speaker/timestamp fields;
  - `TRANSCRIPT_ENHANCEMENT_MODE=single|chunked` only changes execution mode for future runs and does not revert already persisted enhanced text.
  - each enhancement run has a metadata `runId`; completion/failure requires
    the same current run ID, input identity, `RUNNING` state, and transcript
    retranscription generation;
  - terminal persistence uses a compare-and-swap on `Transcript.updatedAt`, so
    a stale long-running chunk worker cannot overwrite a newer enhancement or
    retranscription.
- UI rendering path is unchanged and single-source:
  - transcript/materials UI reads persisted canonical text (`Transcript.text`, `Transcript.diarizedText`, `TranscriptSegment.text`);
  - UI does not currently expose side-by-side original vs enhanced transcript versions.

## Transcript Enhancement Structured Output (Stage 3.9E JSON Schema)

- Output mode is now independently controlled by `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE`:
  - `legacy`: prompt-generated JSON path.
  - `json_schema`: Responses API provider-enforced schema via `text.format`.
- Local default is `json_schema` for deterministic schema enforcement.
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

## Automatic Transcript Enhancement (Stage 3.9F)

- Auto-run is controlled by `TRANSCRIPT_ENHANCEMENT_AUTO_RUN` (default `false`).
- Automatic trigger is enabled only when both flags are true:
  - `YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED=true`
  - `TRANSCRIPT_ENHANCEMENT_AUTO_RUN=true`
- Trigger points:
  - successful initial Yandex transcription;
  - successful Yandex manual re-transcription.
- Execution order inside transcription runner:
  1. SpeechKit transcription completes;
  2. raw `Transcript` + `TranscriptSegment` persistence completes;
  3. transcript status is already usable (`COMPLETED`);
  4. enhancement runs as a non-fatal post-step;
  5. speaker mapping auto-suggestion continues independently.
- Safety invariants:
  - `qualityText` remains canonical raw SpeechKit text;
  - `text` changes only after validated enhancement persistence (`COMPLETED`/`PARTIAL`);
  - enhancement never mutates timestamps, speaker labels, segment ordering, or mapping fields;
  - enhancement failure never downgrades successful transcription usability.
- Idempotency identity includes transcript id + canonical raw hash + model + output mode +
  schema version + prompt version.
- `processingMetadata.transcriptEnhancement` stores trigger source, idempotency decision,
  timing, chunk telemetry, and skip/failure metadata without transcript text payloads.

## Transcript Readability Presentation (Stage 3.9G)

- Transcript segment timestamps originate from SpeechKit alternative-level timing and are
  persisted unchanged.
- Facilitator transcript UI now uses a presentation-only formatter:
  - under one hour: `MM:SS.t`;
  - one hour and above: `HH:MM:SS.t`;
  - rounding is to nearest tenth before splitting into hour/minute/second fields.
- UI displays compact range + duration metadata in one line (`start-end · duration`).
- Duration is computed client-side from numeric `endSeconds - startSeconds` and is never
  derived from formatted strings.
- Grouped transcript view keeps existing contiguous-turn grouping and shows grouped-turn
  duration (first segment start to last segment end of the rendered turn).
- Canonical transcript order remains `orderIndex`; no timestamp-based row re-sorting is applied.
- No overlap indicators are shown in facilitator transcript UI.
- No per-segment ambiguity markers/counts are shown in facilitator transcript UI.
- API contracts and transcript persistence fields are unchanged by this presentation layer.

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
