# 06 Recording And Transcription Pipeline

## Pipeline Overview

1. Recording state transitions to complete with persisted storage key.
2. Transcription run downloads source audio from object storage.
3. Audio is evaluated for compatibility and optionally transcoded/compressed.
4. Active-audio (pause-cut) is built and sent to Yandex SpeechKit (`source_audio_cut`).
5. Raw transcript and raw transcript segments are durably persisted.
6. Optional automatic transcript enhancement is admitted as a durable D1 job
   after raw persist. The transcription HTTP path does not wait for enhancement
   to finish (T1 is decoupled from T2).
7. Transcript and segments are finalized for speaker mapping and AI analysis.
   Enhancement may later publish an atomic all-success lexical generation.

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
- Retranscription source proof: `lib/services/source-recording-preload.ts`,
  `lib/services/retranscribe-session.ts`.
- Active timeline builder: `lib/transcription/active-audio-timeline.ts`.
- Active audio builder: `lib/transcription/active-audio-builder.ts`.
- Provider abstraction: `lib/services/transcription-provider.ts`.
- Yandex SpeechKit provider: `lib/services/yandex-speechkit-transcription.ts`.
- Recording key normalization: `lib/storage/recording-file-key.ts`.
- Storage adapter: `lib/storage/s3.ts`.

## Transcription Entry Points

- Canonical current orchestration is `POST /api/sessions/[sessionId]/materials/transcribe`
  (initial) and `POST /api/sessions/[sessionId]/materials/retranscribe` (explicit
  rerun). Retranscribe downloads the original source object before
  `admitTranscriptionRun`. Initial transcription still admits first, then
  loads source bytes; a missing object fails the transcript without rewriting
  `Recording.status`. After a successful claim both routes execute
  `executeClaimedTranscription`.
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
  Recipient report rendering uses `publishedReportCurrent`, not facilitator
  `analysisCurrent`.
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

## Retranscription Source Proof

- `Recording.status = COMPLETED` is historical recording-lifecycle truth. The
  absence of a retained object-storage binary does not rewrite that status to
  `FAILED`, change `fileKey`, or invent a recording `errorMessage`.
- Retranscription acquires the original source bytes (`Recording.fileKey`,
  after existing safe normalization) **before** `admitTranscriptionRun`.
  Admission, counter increment, history append, transcript `QUEUED`, and
  publication revoke happen only after those bytes are in memory.
- The claimed run consumes the preloaded buffer and does not GET the original
  object again. Later object deletion cannot break a run that already holds
  bytes.
- If GET returns `NoSuchKey` / `NotFound` / HTTP 404, the API returns
  `409` with `code: SOURCE_RECORDING_NOT_AVAILABLE` and performs zero material
  mutations. Timeout, network, credential, and 5xx failures are not classified
  as source absence. Unavailability is reported neutrally; the API and UI
  must not claim that retention expiration is the cause.
- Absence of the physical object does not invalidate a saved transcript or
  AI analysis by itself. Physical retention (operator-managed 90-day
  expiration of all objects in `negotiations-recordings-dev-bucket`) is
  independent from historical application material. See
  `10-data-storage-and-retention.md`.
- `materials/status` may still overlay a read-only HEAD result for display.
  That overlay does not mutate `Recording` and does not hide retranscribe when
  a completed transcript exists.

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
  - `chunked` (default): bounded chunk enhancement with deterministic merge and
    per-chunk fallback.
  - `single`: accepted compatibility/diagnostic configuration. It is **not** a
    second provider, retry, publication, or limiter stack. Live execution uses
    the same D1/chunk executor as `chunked`. Fitting input becomes one logical
    chunk; oversized input keeps the safe chunked split.
- Local default is `chunked` unless explicitly overridden for diagnostics.
- `single` cannot turn an oversized utterance into an unbounded request.
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
    If any piece fails, that utterance is not an enhanced success; the
    chunk stays unpublished. User-visible lexical text is not a hybrid of
    enhanced pieces plus original fallbacks.
  - empty/whitespace-only source utterances are deterministic pass-through
    entries and cannot poison a neighboring provider chunk.
- The configured character limit bounds editable target text. With the default
  one read-only neighbor on each side, total source text in one provider prompt
  is bounded by three times that target limit. Prompt/schema overhead is also
  bounded by the configured target-count limit.
- Concurrency and retry are bounded:
  - hard Product caps: global ≤ 10, per job ≤ 8. Configuration may lower
    either value and can never raise it. Accessors and DB slot admission both
    hard-clamp incoming caps.
  - `TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY` (default `8`, per job, clamp 1–8);
  - `TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY` (default `10`, clamp 1–10) with
    `reserved_slot` fairness so one job cannot consume every global slot
    (`effectivePerJob = min(configuredPerJob, 8, reserved-slot-safe global)`);
  - `TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS` (default `120000`) is the
    per-chunk provider timeout, not job publication authority.
- Global provider admission is cross-process and database-backed:
  - it requires the additive
    `20260916090000_add_transcript_enhancement_provider_slots` migration on
    every database the application reads, including local development and the
    isolated E2E database. Without the seeded slot inventory, provider
    admission fails closed and enhancement never calls the provider.
  - `TranscriptEnhancementProviderSlot` holds a fixed inventory of 10 leased
    slot rows and is the only global concurrency authority
    (`lib/services/transcript-enhancement-provider-slots.ts`). Acquisition is
    one short transaction: take the canonical GLOBAL transaction advisory lock
    (`transcript-enhancement-provider-slot-global-admission`), then the
    per-job advisory lock (never the reverse), reread live global and same-job
    lease counts, enforce the effective configured caps, take a free/expired
    row with `FOR UPDATE SKIP LOCKED`, write ownership and expiry, commit.
    The GLOBAL lock serializes the count-and-claim decision across jobs and
    processes so a lowered configured global cap is a hard bound. Advisory
    locks are transaction-scoped and are never held across provider HTTP,
    Retry-After, polling, or slot release.
  - configuration may lower global ≤ 10 and per-job ≤ 8 and can never raise
    them. Concurrent different-job acquisitions cannot all observe a stale
    live count and then claim distinct SKIP LOCKED rows past the configured
    global cap.
  - physical global active leases ≤ 10 and per-job live leases ≤ 8, so a
    single job can never occupy the whole cap and reserved slots stay
    available to other jobs.
  - the slot lease TTL is the provider request timeout plus 15 s slack and is
    independent of the D1 job lease. A crashed holder's lease simply expires,
    so capacity recovers without a permanent leak. Release only clears a row
    whose `leaseToken` still matches, so a stale owner cannot clear a slot that
    a new owner already re-acquired.
  - the slot is acquired immediately around the HTTP request and released in
    `finally`. It is never held across backoff/`Retry-After` waiting, and the
    Transcript row lock is never held while a slot is in use.
  - a provider POST starts only after an explicit ACCEPTED start decision
    (`authorizeEnhancementChunkStart`). Terminal, cancelled, stale-owner,
    stale-generation, already-complete, and exhausted-budget starts are typed
    rejections: no HTTP, no attempt increment, slot released immediately.
    Workers then stop consuming later queued chunks. Already-in-flight calls
    may finish and are fenced at the finish checkpoint.
  - every real Product path shares this authority: application enhancement,
    automatic enhancement, Repeat Improve, recovery, and the Stage 3.10
    maintenance oneshot all execute through `runAdmittedEnhancementJob`.
    `single` mode uses the same D1 executor and slot admission. No runtime
    provider path bypasses it.
  - the in-process `FairGlobalLimiter` is only a process-local waiter and
    per-job fairness helper in front of the database authority. It is not
    global authority.
  - if slot acquisition cannot succeed within its bounded wait, the run fails
    closed with `provider_slot_unavailable` through the canonical
    terminalization path. Enhancement never calls the provider without a slot.
- `TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS` (default `7000`) is deprecated
  historical compatibility only. It is not T1, T2, T3, Continue timeout,
  edit-lock duration, publication deadline, or recovery lease. Healthy
  enhancement is not made `SKIPPED` because 7000 ms elapsed.
- Timing split:
  - T1: raw SpeechKit persist/viewable;
  - T2: normal enhancement duration (operating-point p95, not a UX skip);
  - T3: safety/recovery bound `clamp(waves × p95 × 4, 120s, 1800s)`.
    T3 recovers abandoned leases; it does not discard completed checkpoints.
- Retry has exactly one durable owner. D1 orchestration owns `attemptCount`,
  retry classification, backoff, `Retry-After`, the retry budget and recovery
  continuation (`lib/services/transcript-enhancement-retry.ts`). The provider
  module performs exactly one HTTP POST per invocation, with its own response
  polling, parsing and normalized classification, and never sleeps or retries
  internally.
  - hard bound: at most 2 HTTP POST attempts per chunk per `runId`
    (attempt 1 plus one retry). `TRANSCRIPT_ENHANCEMENT_MAX_RETRIES` counts
    retries, so the POST budget is retries + 1 clamped to 2; the knob can lower
    the budget but never widen it.
  - `chunks[i].attemptCount` is the single durable ledger and is incremented
    exactly once per POST, inside the provider-slot window, so a failed slot
    acquisition never consumes budget.
  - recovery reads the ledger: a chunk with `attemptCount = 1` may take its one
    remaining POST; `attemptCount ≥ 2` takes none and terminalizes. A process
    restart never manufactures a hidden extra attempt, and COMPLETED chunks are
    skipped.
  - retryable: HTTP 429, 5xx, network failure, timeout, empty output and
    malformed/missing-key schema output. Terminal: catastrophic shrink,
    unknown/duplicate segment index, malformed envelope. Non-429
    `RESOURCE_EXHAUSTED` remains non-retryable.
  - when the budget is spent the chunk becomes permanently `FAILED` and the job
    terminalizes through the canonical failure path; the retry layer does not
    own a second failure state machine.
- `Retry-After` handling for HTTP 429 is same-chunk/same-`runId` automatic
  retry, not the user-facing Repeat Improve action:
  - delta-seconds (`Retry-After: 5` → 5000 ms) and HTTP-date are both parsed;
  - malformed, missing or already-elapsed values fall back to normal backoff;
  - the wait is `max(backoffWithJitter, parsedRetryAfter)`, with the
    provider-requested delay capped at 30 s;
  - waiting happens with no Transcript lock and no provider slot held, and the
    job heartbeat keeps renewing the D1 lease.
- Attempt-2 flavor per chunk:
  - attempt 1: primary model with normal prompt;
  - attempt 2 after empty/malformed/schema-shape output: primary model
    strict-JSON retry with increased bounded `max_output_tokens`;
  - attempt 2 after 429/5xx/network/timeout: the same semantic request after
    the chosen delay.
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
  - missing/failed chunk outputs remain unpublished durable checkpoints.
    Published lexical text stays the previous authoritative version
    (normally raw SpeechKit). Terminal PARTIAL does not mix enhanced
    chunks with original fallback text.
- Enhancement statuses in `processingMetadata.transcriptEnhancement` use a
  three-layer model. `PARTIAL` is not an execution state.
  - `executionStatus`: `NOT_STARTED` | `QUEUED` | `RUNNING` | `COMPLETED` |
    `FAILED` | `CANCELLED_FOR_PUBLICATION`;
  - durable progress counters: total/completed/running/pending/
    retryableFailed/permanentFailed;
  - `terminalQuality`: null while processing, then `COMPLETED` | `PARTIAL` |
    `FAILED`;
  - `publicationEligible`: independent boolean; true only while a current
    QUEUED/RUNNING job can still atomically publish all-success lexical text.
  Legacy one-layer `status` (`RUNNING`/`COMPLETED`/`PARTIAL`/`FAILED`/
  `SKIPPED`/`timeout`) remains readable. First mutation under new code must not
  erase sibling namespaces. Historical 7-second `SKIPPED` rows stay readable;
  a later Improve starts a new-format D1 job.
- Materials/debrief status UI maps `COMPLETED` terminal quality to explicit
  success/green semantics. Running remains active. Terminal `PARTIAL`/`FAILED`
  remain warning/error. Continue is available while `publicationEligible`.
- Persistence safety and recovery path:
  - `Transcript` is the single D1 authority boundary. Writers take
    `SELECT "id" FROM "Transcript" WHERE "id" = $transcriptId FOR UPDATE`
    through `lib/transcription/transcript-row-lock.ts`, reread current
    metadata/status/generation, then mutate inside the same caller
    transaction. Business decisions stay at the call site.
  - Canonical lock order is Session (transcription/retranscription admission
    only) → Transcript (D1, mapping, Skip, publication, enhancement admission,
    AI-vs-enhancement admission, generation currentness) → AiAnalysis
    (only after Transcript is held). Provider-slot rows are never held
    with those locks.
  - The Transcript lock is never held across Yandex HTTP, SpeechKit,
    provider I/O, long waits, or other external network calls.
  - `processingMetadata` namespaces are owned: `transcriptEnhancement` by
    enhancement/D1 latest attempt (admit, checkpoint, heartbeat, Skip,
    Repeat Improve, terminalization, recovery, retranscription/lexical
    fences); `transcriptEnhancementPublication` by successful atomic
    publication, generation-fence clear, and approved broad lexical
    rewrite only; `mappingSuggestion` by mapping suggestion/auto-trigger;
    `transcriptionClaim` by transcription admission. Unknown sibling keys
    are always preserved. Latest attempt status is not published-lexical
    provenance: Repeat Improve RUNNING/Skip/FAILED must not erase a prior
    successful publication sibling. Mapping writers must not persist a
    whole stale `processingMetadata` snapshot; enhancement writers must not
    delete `mappingSuggestion`, `transcriptEnhancementPublication`, or
    unrelated diagnostics.
  - Enhancement admission happens entirely under the Transcript lock from
    current `qualityText ?? text` after `Transcript.status === COMPLETED`.
    `runId`, `retranscribeCount`, and `inputIdentity` are bound in that
    transaction. Provider work is scheduled only after commit. A job may
    claim generation N only if its fingerprint was derived from generation N
    in the same authority decision.
  - Skip (`CANCELLED_FOR_PUBLICATION`) is never rewritten to `COMPLETED`
    merely because all chunk results exist. First Transcript lock holder
    wins Skip vs publication: either cancelled raw text or published
    `COMPLETED`. Later Skip after publication returns already-not-eligible
    and cannot unpublish.
  - Terminal quality is derived from all buckets after unfinished
    (`pending + running + retryableFailed`) chunks are converted to `FAILED`.
    `COMPLETED` is illegal while unfinished work remains. Durable
    `RUNNING + publicationEligible=false` is illegal; recovery reconciles it
    to Skip or `FAILED`/`PARTIAL` without re-enabling publication.
  - Repeat Improve after Skip/FAILED/PARTIAL/published COMPLETED admits a
    new `runId` and fences old callbacks. Starting Repeat creates a new
    latest-attempt job and must not erase `transcriptEnhancementPublication`.
    Skip or FAILED of Repeat B leaves Run A publication as the lexical
    provenance. Only a later successful atomic publication replaces that
    sibling, in the same transaction that publishes segment text,
    `Transcript.text`, and rebuilt `diarizedText`.
  - Per-segment current provenance is derived, not a persisted lifecycle.
    Green (`applied`) is `runId + retranscribeCount + orderIndex digest`
    from `transcriptEnhancementPublication` when that publication is
    applicable to the current transcript generation, current lexical text
    still matches that digest, and current text is not the SpeechKit
    backup. Gray (`raw`) is current text that still equals a non-null
    immutable SpeechKit backup (`qualityText`). `qualityText = null` is
    never gray: it means there is no raw/original transcription evidence.
    Manual (`edited`) is current text that is not SpeechKit raw when
    published-enhanced evidence is absent, inapplicable, or does not
    match the applicable digest.
    Generation mismatch means published-enhanced evidence is not
    applicable; it does not classify the current text as raw.
    `TranscriptSegment.qualityText != null` means actual SpeechKit
    raw/original lexical evidence for that segment. Manual lexical
    saves may change `text` but must not write edited text into
    `qualityText`. New manually inserted segments store `qualityText = null`
    (no SpeechKit raw baseline) and successful enhancement must not
    fabricate one. Provider input may use transient `qualityText ?? text`;
    that fallback is never persisted as raw authority. After a successful
    publication, a no-raw segment may be `applied` when current text
    matches the recorded digest, including AI copy-through of the manual
    input.
    Latest attempt `COMPLETED` is not the green prerequisite. Same-structure
    lexical or speaker-only saves must not rewrite `publication.runId` or
    drop unrelated digests. Structural correspondence is proven only by a
    1:1 map of stable `TranscriptSegment.id` values. Count or `orderIndex`
    equality is not sufficient. The editor/save round-trips every existing
    stable ID and does not treat omitted empty/whitespace-only existing
    segments as a delete. Insert, delete, or reorder remaps
    `segmentDigestByOrderIndex` by stable ID onto the surviving segments'
    new `orderIndex` values. A deleted ID drops its digest so a later
    occupant cannot inherit it. A newly inserted segment has no digest and
    is classified `edited` unless it matches a non-null SpeechKit raw
    baseline. Unrelated surviving AI-enhanced text that still matches its
    remapped digest stays `applied`. That remap is the fail-closed
    structural fence, not a wipe of historical
    `transcriptEnhancement` execution identity, `publication.runId`,
    `executionStatus`, or `providerHistory`. Retranscription
    increments generation and clears the publication sibling in the same
    generation transition so old digests cannot paint the new ASR segments
    green.
  - durable job/chunk state lives in `Transcript.processingMetadata` (D1).
    There is no `TranscriptEnhancementJob` / `TranscriptEnhancementChunk` table.
    Writers reread under `FOR UPDATE` and merge via `mergeProcessingMetadata`;
  - unpublished lexical checkpoints are stored by deterministic `orderIndex`
    and are not user-visible until atomic publication;
  - enhanced text is persisted into `Transcript.text`, `Transcript.diarizedText`,
    and `TranscriptSegment.text` only on all-success `terminalQuality=COMPLETED`.
    Terminal `PARTIAL` does not publish mixed enhanced+raw text;
  - initial transcription ingestion and later genuine retranscription
    store SpeechKit provider text in both `TranscriptSegment.text` and
    `TranscriptSegment.qualityText`. That is how a real raw baseline is
    created. Enhancement publication must not invent `qualityText` for a
    segment that still has `qualityText = null`;
  - existing SpeechKit `qualityText` remains the immutable backup across
    enhancement, lexical edits, and reorder (matched by stable segment
    id). Newly inserted manual segments keep `qualityText = null` through
    AI enhancement and Repeat Improve. Manual attribution must not
    replace a SpeechKit backup with edited text;
  - every enhancement *provider input* starts from
    `originalText = qualityText ?? text`. That fallback is transient
    input construction only. Publication writeback persists
    `qualityText` unchanged, including leaving it null;
  - each job has `runId`/`jobId`, `inputIdentity`, `retranscribeCount`,
    `leaseToken`, and `leaseExpiresAt`. Only the current lease owner may
    checkpoint or publish;
  - automatic enhancement is admitted after raw persist and scheduled with
    Next.js `after()` / detached execution. Durability is the D1 row, not
    the in-process Promise;
  - Stage 3.10 oneshot `task=all` / `task=enhancement-recovery` periodically
    claims expired leases and resumes unfinished chunks. Recovery does not
    depend on Materials/status traffic;
  - `CONTINUE_WITH_CURRENT_TRANSCRIPT` CAS-sets
    `executionStatus=CANCELLED_FOR_PUBLICATION` and `publicationEligible=false`
    without changing published text, `qualityText`, or mapping.
    After that fence, chunk checkpoints are refused. Isolated Large UAT
    may install a non-authoritative provider-call observer
    (`tests/e2e/helpers/large-realistic-uat-provider-observe.ts`) onto the
    generic enhancement observation seam when
    `LARGE_REALISTIC_UAT_PROVIDER_OBSERVE=1` and `NODE_ENV` is not
    production. Next Node instrumentation loads that helper via a native
    `file://` import (`lib/instrumentation/node-runtime.ts`) and therefore
    the helper's runtime graph must use Node-resolvable specifiers, not
    tsconfig `@/` aliases. Instrumentation and the enhance-transcript
    request graph are separate Next compilations, so the observation
    registry lives on `globalThis` and the helper recorder is bound there.
    Production supplies no observer and never writes
    `.debug/large-realistic-uat/`. Observation cannot change checkpoint
    or publication authority;
  - a human lexical save fences `publicationEligible` in the same material
    currentness transaction, then persists the human text. Mapping writes
    are allowed during QUEUED/RUNNING and do not revoke eligibility;
  - atomic publication rereads the latest speaker mapping inside the
    persistence transaction and rebuilds `diarizedText` from enhanced
    lexical text plus that mapping;
  - AI consumes only the published transcript generation and is blocked
    while `publicationEligible=true`. Start AI does not implicit-Continue;
  - retranscription increments generation, fences the old job, and prevents
    old checkpoints from publishing onto the new generation.
  - terminal persistence rereads `processingMetadata` under a row lock and
    merges the enhancement namespace into the latest snapshot. A competing
    speaker-mapping write must not erase `transcriptEnhancement`, and an
    enhancement write must not erase `mappingSuggestion` or unknown keys;
  - a lost `updatedAt` CAS from a sibling namespace write does not leave the
    current run stuck in `RUNNING`; ownership is the run ID + identity +
    generation + lease. A newer enhancement run ID still cannot be overwritten;
  - same-identity already-`COMPLETED` enhancement does not rewrite status to
    `SKIPPED`;
  - `diarizedText` is rebuilt through `buildCanonicalDiarizedText` from current
    lexical `segment.text` plus the current speaker mapping. Enhancement must
    not strip mapped names; mapping must not rewrite lexical text;
  - provider usage telemetry stores actual envelope usage or an explicit
    unknown classification. `tokensUsed` must not equal configured `maxTokens`
    merely because that was the request cap.
- Effective enhancement running/terminal state is owned by
    `projectTranscriptEnhancementStatus` /
    `resolveTranscriptEnhancementStatus` after opportunistic recovery.
    Persisted `RUNNING`/`QUEUED` map to API/UI `IN_PROGRESS`. The same
    effective state — the five-stage rail semantic — drives Recording &
    Transcription banner, Materials, and room Debrief. Mapping is available
    during RUNNING. AI and lexical-save fences follow `publicationEligible`.
  - Room Debrief and Materials poll canonical `materials/status`. That
    projection is the live enhancement status source passed into the
    already-mounted `RecordingTranscriptionSection`. The section identity is
    `recordingId:transcriptId:retranscribeCount` for the current generation; volatile
    `processingStage`, enhancement status, diarization, and mapping-required
    flags must not remount the tree.
  - Authoritative transcript-generation activity is
    `isActiveTranscriptGenerationStage` in `lib/post-processing/projection.ts`
    (`queued` / `downloading` / `compressing` / `transcribing`, including the
    Prisma `DOWNLOADING_RECORDING` / `COMPRESSING_AUDIO` aliases). Repeat
    Improve (`enhancing`) is not a transcript-generation stage. The initiating
    tab may use local `rerunBusy` / start-transcription busy plus
    `awaitingAuthoritativePostRetranscriptionStatus` as an optimistic
    lock until a status fetch that started after the retranscription POST
    has been applied; refreshed and second views use only
    the materials/status stage. `observeThenRetranscribe` starts
    materials/status observation before the long-running retranscribe POST
    and does not emit a second POST. After that POST resolves, the initiating
    tab immediately applies an exclusive authoritative `materials/status`
    refresh. Local busy/fence may clear only after that post-response apply
    succeeds. A failed final refresh stays fail-closed: cached pre-run
    downstream chrome is not shown as current, ordinary polling continues,
    and a later successful apply of a newer status request releases the
    fence. Each materials/status GET uses an `AbortController` and a bounded
    client observation timeout. Exclusive acquire waits only a bounded time
    and may abort a stalled in-flight GET so the slot cannot be held
    forever; a timed-out or aborted response is not applied as current and
    cannot overwrite a newer request. Unmount aborts the outstanding request.
    Concurrent GET status is a read and
    does not change admission/lifecycle.
  - While that signal is active, `projectTranscriptGenerationUiCurrentness`
    presents transcription as running and enhancement, speaker mapping, and
    AI as non-current/pending. Historical successful rows stay in storage and
    may remain readable; they must not render as current for the incoming
    generation. After the active stage ends, currentness still follows
    generation fences (`retranscribeCount` / `isEnhancementCurrentForTranscriptGeneration`
    and `evaluateAiAnalysisCurrentness`). Leaving the active stage must not
    briefly restore old green/current chrome. The detailed diarized view may
    keep prior transcript text readable during active retranscription, but
    generation-dependent decoration is not current: prior CONFIRMED /
    AUTO_SUGGESTED mapped participant names render as source speaker labels
    / mapping-pending, mapping controls stay locked, and prior per-segment
    provenance icons are suppressed. After the active stage ends, decoration
    remains fenced until the mounted `/recording` payload is current: its
    `retranscribeCount` matches the materials/status generation AND its
    lifecycle is no longer an active queued/downloading/compressing/transcribing
    snapshot for that same generation. Generation equality alone is not
    enough. A payload loaded while generation N+1 was still active must
    refresh once from `/recording` when materials/status later reports that
    same generation complete, even when transcript ID and text are unchanged.
    That completion trigger is one-shot per authoritative active→terminal
    transition; a hydrated completed payload does not refetch. After the
    completed matching generation is hydrated, mapped names and provenance
    follow that generation’s currentness;
    old mapping/provenance does not reappear merely because `transcriptionActive`
    became false. Historical mapping/provenance rows are not destructively
    cleared for this UI fence.
  - Polling updates execution status, durable `k/n` progress, publication
    eligibility, terminal quality, and AI readiness in place. It must not
    set page-level loading, blank the transcript, or call a full
    `loadData()` on every enhancement tick.
  - Successful atomic publication (`terminalQuality=COMPLETED` and published
    kind `enhanced`) must hydrate the mounted transcript projection from
    `/recording` before the client settles out of enhancement polling.
    A published-transcript refresh obligation stays true until that fetch
    applies current `TranscriptSegment.text` and per-segment provenance.
    Text inequality alone is not sufficient: a swallowed one-shot refresh
    must not leave RAW cards mounted after `shouldPoll` becomes false.
    Skip / PARTIAL / FAILED do not create this obligation. Mapping drafts,
    facilitator/observer notes, and scroll are preserved. Unsaved lexical
    edits are not legal while `publicationEligible=true`.
  - Enhancement provenance of the *current published* transcript is a compact
    header icon next to the speaker/role label (`applied` vs `raw` vs
    `edited`). The icon is per-segment, not transcript-wide: `applied` only
    when current `TranscriptSegment.text` still matches the applicable
    publication digest and is not SpeechKit raw; `raw` when a non-null
    `qualityText` exists and current text still equals it; `edited` when
    current text is not SpeechKit raw and either has no applicable published
    evidence (including generation mismatch) or does not match the
    applicable digest. Successful unchanged AI-processed segments stay
    `applied`. Successful unchanged SpeechKit copy-through segments stay
    `raw` and are not failures. A no-raw manual segment is never `raw`
    merely because `qualityText` is null; if a successful publication
    digest exists, copy-through of the manual input may stay `applied`.
    RUNNING/PARTIAL/Continue keep unpublished chunk results off the icon.
    The transcript-level COMPLETED banner can remain
    enhanced while some visible turns have no green icon.
  - Progress copy is `{completed} из {total} фрагментов обработано` on the
    Step 2 card. RUNNING `k/n` is not terminal `PARTIAL`. Historical
    `SKIPPED`/timeout rows render without invented chunk counters and may start
    a new B02 Improve/Retry job.
  - Continue is the real `POST /materials/continue-transcript` operation,
    labeled «Пропустить ИИ-улучшение» once on the Debrief/Materials Step 2
    card while `publicationEligible`. The expanded transcript section does not
    repeat that primary Skip. After Skip/Continue,
    `publicationEligible` is false, lexical editing follows
    `lexicalEditAvailable`, mapping stays usable, and enhancement leftovers
    must not imply they can still replace the published transcript.
    Copy hierarchy: the five-card rail is step name + short status; Step 2 is
    progress + next action; the expanded transcript section adds only local
    context (`ИИ-улучшение выполняется · k из n фрагментов` and that the
    original transcript is in use). Debrief/Materials Step 2 and the
    enhancement rail use the same `resolveEnhancementUxState` presentation
    as the transcript section: eligible `QUEUED`/`RUNNING` is live
    execution with Skip on Step 2; `CANCELLED_FOR_PUBLICATION` is
    «ИИ-улучшение пропущено» / «Используется текущий транскрипт», not
    “enhancement not started”. If a prior successful enhanced publication
    remains authoritative, Skip copy says the new attempt was skipped and
    the previously improved text is still in use. That is wording only.
    Historical `SKIPPED`/timeout stays a distinct timeout copy.
    The Step 2 Improve control label is start vs retry from enhancement
    history/state (`resolveEnhancementStartActionKind`), not from
    `improveAvailable`. Fresh `NOT_STARTED` with no prior run is
    «Запустить ИИ-улучшение». A later Improve after a previous attempt is
    «Повторить ИИ-улучшение». Availability of the control stays with Product
    admission/`improveAvailable`.
    Debrief/Materials Step 3 status copy follows the same `publicationEligible`
    fence (`resolveAiWorkflowStepCopyKind`): while enhancement can still
    replace the transcript, Step 3 does not say AI can be started. It says
    analysis is available after enhancement finishes or is skipped.
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
  - statuses remain `COMPLETED`/`PARTIAL`/`FAILED`/`SKIPPED` as mirrored
    compatibility; execution uses the three-layer D1 fields;
  - `FAILED` and terminal `PARTIAL` mean no transcript text mutation.

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
  3. transcript status is already usable (`COMPLETED`) — T1;
  4. a durable enhancement job is admitted and detached (`after()`);
  5. speaker mapping auto-suggestion continues independently and may run
     while enhancement is QUEUED/RUNNING.
- Safety invariants:
  - `qualityText` remains canonical raw SpeechKit text when present, and
    stays `null` for manual segments that never had a SpeechKit source;
  - `text` changes only after validated all-success enhancement publication;
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
  Rail tile chrome maps `ready` to green, semantic `running` to a shared
  active cyan accent, and `pending` to muted waiting
  (`lib/post-processing/rail-tile-tone.ts`). Speaker-mapping rail chrome maps
  both canonical `ready` (CONFIRMED) and structurally complete `informational`
  (AUTO_SUGGESTED, `readyForAnalysis`) to that same completed/green success
  tile with concise Ready/Готово copy. Incomplete / REQUIRED mapping stays
  `action_required` (non-completed). Enhancement `informational` (skipped)
  does not use that mapping chrome. While the current transcript generation
  is still running (Repeat transcription QUEUED/downloading/transcribing),
  leftover enhancement, mapping, and AI rows are projected `pending` and
  are not presented as current for the incoming generation. A leftover
  enhancement job whose stored `retranscribeCount` does not match the
  current transcript generation is also projected `pending` after the new
  generation completes, until a new-generation enhancement exists.
  Historical rows are not deleted to produce that presentation. Backend
  mapping status and AI publication authority are unchanged.
- Enhancement `QUEUED`/`RUNNING` is non-terminal while `publicationEligible`.
  `COMPLETED`, `PARTIAL`, `FAILED`, `SKIPPED`, and
  `CANCELLED_FOR_PUBLICATION` are terminal for publication. Continue is
  available while `publicationEligible`. A late enhancement result after
  Continue, lexical save, retranscription, or generation mismatch cannot
  overwrite the current transcript. Terminal `PARTIAL` does not publish
  mixed text.

## Source Notes

- `lib/services/transcription-runner.ts`
- `lib/services/retranscribe-session.ts`
- `lib/services/source-recording-not-available.ts`
- `lib/services/source-recording-preload.ts`
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
- `lib/post-processing/enhancement-ux-presentation.ts`
- `lib/services/transcript-enhancement-publication.ts`
- `lib/transcription/manual-speaker-turn-edits.ts`
- `app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts`
- `lib/post-processing/rail-tile-tone.ts`
- `lib/transcription/transcription-section-key.ts`
- `lib/services/transcript-enhancement-orchestration.ts`
- `lib/services/transcript-enhancement-provider-observation.ts`
- `instrumentation.ts`
- `lib/instrumentation/node-runtime.ts`
- `lib/services/transcript-enhancement-job.ts`
- `lib/services/transcript-enhancement-state.ts`
- `lib/services/transcript-enhancement-limiter.ts`
- `lib/services/transcript-enhancement-recovery.ts`
- `lib/services/transcript-enhancement-timeout.ts`
- `lib/transcription/transcript-row-lock.ts`
- `lib/transcription/processing-metadata.ts`
- `lib/stage-3-10-maintenance.ts`
- `scripts/ops/stage-3-10-maintenance.ts`
- `app/api/sessions/[sessionId]/materials/continue-transcript/route.ts`
- `lib/services/transcription-run-claim.ts`
- `lib/services/transcription-ownership.ts`
- `lib/services/transcription-generation-cas.ts`
- `lib/transcription/recording-transcription-presentation.ts`
- `components/recording-transcription-section.tsx`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `tests/e2e/session-materials-processing.spec.ts`
