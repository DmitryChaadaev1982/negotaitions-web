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

## Transcription Entry Points

- Canonical current orchestration is `POST /api/sessions/[sessionId]/materials/transcribe`
  (initial) and `POST /api/sessions/[sessionId]/materials/retranscribe` (explicit
  rerun). Both admit through `admitTranscriptionRun` /
  `lockSessionTranscriptionClaim`, then `executeClaimedTranscription`.
- Normal facilitator UI (Materials page and room Debrief `roomQuick` panel)
  calls only the canonical routes. The child transcript section no longer
  posts to `/transcribe-recording`.
- `POST /api/sessions/[sessionId]/transcribe-recording` is a
  **canonical adapter** (`OLD_ROUTE_MODE=CANONICAL_ADAPTER`), not a failover.
  It is not deleted in this stage and is not invoked after a canonical failure.
- The old route admits through the same `admitTranscriptionRun` primitive,
  executes `executeClaimedTranscription`, then adapts the response to
  `{ transcript, warnings, recording }`.
- A competing request receives 409 (`TRANSCRIPTION_IN_PROGRESS` or
  `TRANSCRIPTION_ALREADY_COMPLETED`) and must not call the provider, overwrite
  text/segments, change generation identity, or start enhancement/mapping.
- Completion and failure writes are generation-owned. A late compatibility
  writer cannot replace a newer generation or attach enhancement/mapping to
  the wrong run. Generation-fenced completion replaces that run's transcript
  fields only when `id + startedAt + retranscribeCount + active status` still
  match; a stale writer cannot restore an older `processingMetadata` snapshot.
- Deprecation or removal of `/transcribe-recording` is deferred.

## Readiness Rules

- Transcription starts only when recording is in ready terminal state and storage object is usable.
- `materials/status` is the canonical post-processing projection for both
  Materials and room Debrief. A completed historical recording with a storage
  key is transcription-ready; clients must not invent “waiting for recording”
  when this API is unavailable.
- The Prisma client for `materials/status` reads nullable
  `AiAnalysis.inputFingerprint`. That additive column must exist in the
  database the client is using. A missing column is schema drift and 500s
  every session’s materials payload; it is not evidence that the recording is
  unready. Historical fingerprint values may be NULL.
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
  Sessions, and by the `/transcribe-recording` canonical adapter. It preserves
  the existing post-transcription enhancement trigger while preventing duplicate
  provider cost and competing raw/enhancement persistence for one transcript
  generation.
- AI analysis persists the canonical transcript ID and `retranscribeCount` it
  consumed. Materials status and AI publication use that same identity to mark
  older completed analysis stale; a report from an earlier transcript
  generation is not publishable.
- Confirmed retranscription is one downstream invalidation boundary. The
  admission transaction increments `retranscribeCount`, archives the previous
  transcript, and revokes any active AI publication through
  `revokeActiveAiAnalysisPublicationInTransaction`. Currentness then treats the
  old `AiAnalysis` row as non-current for the new generation (fingerprint
  generation mismatch, or NULL-fingerprint `legacy_stale`). The historical
  analysis artifact is kept. Speaker mapping, manual attribution, transcript
  correction, and enhancement that prepare the new generation do not repeat
  that invalidation warning.

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
- The authoritative post-transcription wait window is
  `TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS` (default `7000`). This is not the
  per-chunk provider timeout. After this window the current run is made
  non-authoritative (`SKIPPED` / `timeout`) and workflow unlocks.
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
  - terminal persistence rereads `processingMetadata` under a row lock and
    merges the enhancement namespace into the latest snapshot. A competing
    speaker-mapping write must not erase `transcriptEnhancement`, and an
    enhancement write must not erase `mappingSuggestion` or unknown keys;
  - a lost `updatedAt` CAS from a sibling namespace write does not leave the
    current run stuck in `RUNNING`; ownership is the run ID + identity +
    generation. A newer enhancement run ID still cannot be overwritten;
  - same-identity already-`COMPLETED` enhancement does not rewrite status to
    `SKIPPED`;
  - `diarizedText` is rebuilt through `buildCanonicalDiarizedText` from current
    lexical `segment.text` plus the current speaker mapping. Enhancement must
    not strip mapped names; mapping must not rewrite lexical text;
  - while enhancement is `RUNNING` and still inside the configured
    `TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS` window (default `7000`), transcript/material
    saves, speaker-mapping writes, and AI start are rejected. Facilitator/observer
    notes are not locked by this rule.
  - The timeout is enforced at the orchestration/domain write boundary using the
    existing runId + generation + `RUNNING` CAS. A provider result arriving after
    the timeout cannot modify `text`, `diarizedText`, mapped speaker identity, or
    later AI input. Timeout recovery reuses Phase B stale-run handling and persists
    terminal `SKIPPED` with `skipReason=timeout` instead of leaving `RUNNING`
    forever or starting a second automatic run.
  - After `COMPLETED` / `PARTIAL` / `FAILED` / `SKIPPED` (including timeout),
    enhancement no longer blocks editing, mapping, or AI. AI may still be blocked
    by structurally incomplete mapping or other existing readiness/consent rules.
- Effective enhancement running/terminal state is owned by
    `isEnhancementStatusRunning` / `isTranscriptEnhancementTerminal` in
    `lib/post-processing/projection.ts`, applied to
    `processingMetadata.transcriptEnhancement.status` through
    `resolveTranscriptEnhancementStatus` after timeout reconciliation.
    Persisted `RUNNING`/`QUEUED` map to API/UI `IN_PROGRESS`. The same
    effective state — the five-stage rail semantic — drives Recording &
    Transcription banner and edit/mapping locks, Materials, room Debrief,
    and transcript/mapping/manual-attribution/AI write guards. A child
    `/recording` snapshot cannot keep a running banner after the rail is
    terminal.
  - Room Debrief and Materials poll canonical `materials/status`. The nested
    `RecordingTranscriptionSection` must apply that polled enhancement status
    even when its own `/recording` snapshot still has a stale `RUNNING` alias.
    A component-local running boolean must not outlive canonical terminal
    state (`COMPLETED` / `PARTIAL` / `FAILED` / `SKIPPED`).
  - Child enhancement refresh watches every running alias, not only
    `IN_PROGRESS`. After a live RUNNING→terminal transition, transcript
    content is reloaded without a page reload.
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
- Shared `RecordingTranscriptionSection` has two explicit presentations, decided
  by the parent surface rather than route-name checks:
  - `materialsDetail` (dedicated Materials / session page): keeps recording
    status detail and the transcript language selector.
  - `roomQuick` (in-room Debrief facilitator panel): omits those two detailed
    controls. Diarized transcript, copy, Edit transcript, speaker mapping, and
    parent rerun remain. Parent rerun confirms through the site
    `ConfirmDialog` rather than an inline status-card panel.
    Domain/readiness semantics are unchanged.

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

## Canonical Post-processing Projection

- One server projection (`lib/post-processing/projection.ts`) supplies semantic
  stage state for RECORDING, TRANSCRIPTION, TRANSCRIPT_ENHANCEMENT,
  SPEAKER_MAPPING, and AI_ANALYSIS. Publication remains a separate downstream
  action.
- Semantic states are `pending`, `running`, `ready`, `action_required`,
  `informational`, `failed`, and `not_applicable`. Raw diagnostic fields remain
  on materials status for existing UI.
- The five-card rail, detailed post-processing rows, materials status,
  `/sessions` list, and account dashboard consume this projection. Clients do
  not independently reinterpret `AUTO_SUGGESTED` / `CONFIRMED` / readiness.
- Enhancement `RUNNING` is non-terminal only while it remains inside the
  configured `TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS` window (default `7000`).
  `COMPLETED`, `PARTIAL`, `FAILED`, and `SKIPPED` (including timeout) are
  terminal. `FAILED`/`PARTIAL`/`SKIPPED` allow continue-with-current-transcript
  without a new acknowledgement column. A late enhancement result after timeout
  is discarded by runId/CAS ownership and cannot overwrite the current transcript.

## Source Notes

- `lib/services/transcription-runner.ts`
- `lib/services/transcription-run-claim.ts`
- `lib/services/transcription-ownership.ts`
- `lib/services/transcription-generation-cas.ts`
- `lib/services/transcribe-recording-compatibility.ts`
- `lib/transcription/transcription-routes.ts`
- `app/api/sessions/[sessionId]/transcribe-recording/route.ts`
- `lib/services/transcription-provider.ts`
- `lib/services/yandex-speechkit-transcription.ts`
- `lib/transcription/pause-filter-calibration.ts`
- `lib/transcription/active-audio-timeline.ts`
- `lib/transcription/active-audio-builder.ts`
- `lib/post-processing/projection.ts`
- `lib/post-processing/enhancement-effective-state.ts`
- `lib/services/transcript-enhancement-orchestration.ts`
- `lib/services/transcript-enhancement-timeout.ts`
- `lib/services/transcription-run-claim.ts`
- `lib/services/transcription-ownership.ts`
- `lib/services/transcription-generation-cas.ts`
- `lib/transcription/recording-transcription-presentation.ts`
- `components/recording-transcription-section.tsx`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `tests/e2e/session-materials-processing.spec.ts`
