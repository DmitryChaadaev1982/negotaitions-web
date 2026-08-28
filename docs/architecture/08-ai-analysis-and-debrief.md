# 08 AI Analysis And Debrief

## Purpose

Produce structured post-session coaching output from transcript/materials and expose it with role-aware visibility rules.

## Flow

1. Facilitator starts analysis when the canonical projection says the
   transcript is usable, enhancement is not `RUNNING` inside the configured
   `TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS` window, speaker mapping is
   structurally complete, and existing AI consent/permissions are present.
   After enhancement becomes terminal (`COMPLETED` / `PARTIAL` / `FAILED` /
   `SKIPPED` including timeout), enhancement no longer blocks AI.
2. A fenced `QUEUED` operation is created and the route returns `202` without
   making the browser connection execution authority.
3. Self-hosted Next.js `after()` starts the owned operation and transitions it
   to `ANALYZING`.
4. Analysis context is read with transcript and ordered segments in one Prisma
   relation query, then applies pause processing mode awareness:
   - `source_audio_cut` (production default): use transcript as-is (already generated from active-only audio).
   - `transcript_interval_filter` (legacy/deprecated fallback): apply shared interval filter to transcript segments.
5. Prompt packing keeps the existing direct representation for normal sessions.
   Large direct prompts switch to a lossless timeline representation that
   removes only the duplicate narrative copy while retaining every ordered
   segment, speaker attribution, and timestamp.
6. Yandex creates one durable background response and retrieves that same
   response by ID until it reaches a terminal provider state.
7. The complete provider output is parsed and validated against the canonical
   schema. Existing bounded helpers may strip a full markdown JSON fence,
   extract a first balanced JSON object from surrounding prose, and remove
   trailing commas. That wrapper noise is then schema-validated and is not
   classified as `MODEL_INVALID_OUTPUT` solely because of the wrapper.
   Truncated JSON, output with no parseable balanced object, or otherwise
   unparseable text after those helpers is `MODEL_INVALID_OUTPUT` and is
   never persisted as valid analysis. Personal feedback identifies its
   recipient by supplied `SessionParticipant` ID, which is validated against
   the current negotiating roster before `analysisJson` is persisted and
   status changed to `COMPLETED`.
8. If the selected provider is Yandex and generation 1 terminates with
   `MODEL_SCHEMA_VALIDATION_ERROR`, the same owned analysis operation may
   start exactly one NEW same-prompt Yandex generation. The row stays
   `ANALYZING`. There is no intermediate `FAILED`, no second HTTP
   `POST /analyze`, and no extra `analysisVersion`. The original prompt,
   `runToken`, fingerprint, and operation deadline are reused; attempt 2
   receives only remaining budget. Ownership/currentness is rechecked before
   the second provider POST. The currentness linearization point is a
   successful `assertReadyForSecondGeneration` check: stale F1 before that
   point yields zero generation-2 POSTs. After that point, a later material
   mutation may make the already-authorized provider work stale, exactly as
   during ordinary generation-1 provider work. Completion does not rewrite
   `inputFingerprint` to the later envelope; stored F1 vs current F2 is
   non-current, unshareable, and presented as rerun-required / `NOT_STARTED`.
   Any other first-attempt class, including OpenAI schema validation, stays
   single-generation. Generation 2 is terminal: success completes once; any
   failure fails once; there is no third generation.

## Large-session input contract

- Normal sessions use the byte-for-byte existing direct whole-session prompt:
  narrative/diarized transcript plus the attributed timeline. They still make
  one canonical provider generation with unchanged model, temperature,
  reasoning, background, and output-token semantics.
- Yandex DeepSeek input diagnostics use the existing `chars / 4` application
  heuristic as an approximate guard. Yandex DeepSeek application budgets are:
  - complete provider input: 100,000 estimated tokens;
  - reserved provider instructions/schema: 10,000 estimated tokens;
  - session prompt: 90,000 estimated tokens.
- Yandex's authenticated `/models` catalog confirms
  `deepseek-v4-flash` but exposes no context-window capability. These are
  therefore explicit conservative application safety limits, not claims about
  an undocumented Yandex provider maximum and not runtime-tunable settings.
- If the normal representation exceeds the prompt budget and ordered segments
  exist, the packer first verifies normalized `Transcript.text` equivalence
  with the ordered segment text. Only after that no-loss check does it emit all
  segments exactly once as a deterministic JSON timeline. It preserves order
  index, participant/speaker, start/end time, and complete text. Only the
  verified redundant `Transcript.text`/`diarizedText` copy is omitted. A
  mismatch keeps the full direct prompt and therefore fails explicitly if it
  remains over budget.
- This lossless compact path remains a single whole-negotiation provider call.
  It is not a set of unrelated chunk summaries and does not add synthesis calls,
  so cross-session reasoning and Wave 1 response recovery remain unchanged.
- If the lossless representation still exceeds the supported prompt budget,
  execution fails before creating a provider generation with
  `INPUT_TOO_LARGE` and `contentDropped=false`. No substring, array cap, or
  provider-side truncation is used.
- Provider-side capacity failures remain explicit failures.
- A known `providerResponseId` remains recovery-first even if the current
  application budget would reject a new POST. This preserves an already
  accepted generation and does not create a duplicate.
- The 8,000-token canonical output budget is independent from input packing.
  An `incomplete/max_output_tokens` provider result is still an explicit
  exhausted-generation failure and can be retried as a new generation.
- No hierarchical summary/synthesis stage is introduced. Durable intermediate
  generations would require additional recoverable stage state, add cost, and
  risk evidence loss. The quality stop condition therefore prefers an explicit
  supported boundary over a lossy report presented as complete.
- A completed analysis can be explicitly published as a role-scoped snapshot
  to historically eligible Participant/Observer room entrants.

## Provider Selection And Fail-Closed Contract

- `AI_ANALYSIS_PROVIDER` is an explicit required enum: `yandex` or `openai`.
- Dispatch is exact. A selected Yandex adapter failure is returned as a Yandex
  failure; no catch, configuration, timeout, transport, lifecycle, parsing, or
  schema branch invokes OpenAI.
- Missing Yandex credentials fail closed even if OpenAI credentials are
  present.
- OpenAI remains supported only when `AI_ANALYSIS_PROVIDER=openai` is selected
  explicitly, plus existing explicit mock/test paths.
- The production configuration used by the Yandex POC selects `yandex`.

## Durable Background And Whole-Report Semantics

- `runToken` and `leaseExpiresAt` own `QUEUED` and `ANALYZING` work. Background
  start, lease renewal, provider-response persistence, success, and failure are
  fenced to the current token.
- `providerResponseId` remains the durable recovery pointer. Once accepted, GET
  retries and later recovery retrieve the same Yandex generation and never
  create a second generation for that known ID.
- `analysisJson` retains one meaning: the complete canonical report after full
  schema validation. Nonterminal provider output is never parsed or published
  as application content.
- The verified repository provider contract establishes Yandex background
  creation plus independent response retrieval. It does not establish a safe
  resumable `background=true` + `stream=true` contract, so provider streaming
  is not enabled.
- A live August 10, 2026 Yandex run was observed for approximately 85 seconds.
  Every nonterminal retrieval contained no usable section output; the complete
  validated report appeared only with `COMPLETED`. The product stop condition
  therefore keeps the whole-report model instead of adding progress storage,
  split prompts, extra model calls, artificial delays, or speculative parsing.
- A browser refresh, navigation, disconnect, or closed page only interrupts UI
  polling. It does not abort accepted server work. If the app process stops,
  lease expiry and `providerResponseId` recovery preserve Wave 1 takeover
  behavior.

## Pause Filtering Guarantees

- Analysis context applies all persisted pause intervals for a session (including multiple pause/resume cycles).
- Segment filtering uses the same shared pause classifier as transcription and speaker-mapping consumers.
- Exception: when transcript `processingMetadata.pauseProcessing.mode=source_audio_cut`, analysis context does not re-apply interval filtering.
- Segments fully inside pause windows are excluded.
- Boundary-overlap segments are kept when mostly unpaused, including tolerance for timestamp jitter near pause/resume edges.
- Segments with dominant paused overlap are excluded (`overlapRatio >= 0.6`).
- Segments with significant absolute paused overlap are excluded (`overlapDurationSeconds >= 1.25`), even when ratio is below dominance threshold.
- If a pause interval remains open at `FINISH`, server-side close-on-finish behavior guarantees safe filtering boundaries.

## Key Components

- Analysis model/schema and provider execution: `lib/ai/negotiation-analysis.ts`.
- Bounded failure diagnostics: `lib/ai/analysis-failure-diagnostics.ts`.
- Bounded Yandex schema recovery: `lib/ai/analysis-schema-recovery.ts`.
- Durable ownership and recovery: `lib/ai/analysis-operation.ts`.
- Analysis context builder: `lib/ai/session-analysis-context.ts`.
- Visibility filtering: `lib/analysis-visibility.ts`.
- Shared facilitator pending-section UI:
  `components/session-post-processing-panel.tsx` and
  `components/session-materials-dashboard.tsx`.
- APIs:
  - `app/api/sessions/[sessionId]/analyze/route.ts`
  - `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`
  - `app/api/sessions/[sessionId]/ai-analysis/unshare/route.ts`

## Failure Diagnostics Contract

`ExternalServiceEvent` is the durable failure-evidence source for AI analysis.
A failed `AiAnalysis` row stores only a generic user-facing `errorMessage`.
The journal sanitizer is fail-closed: only the positive allowlist in
`APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEYS` may persist, and only as bounded
primitives or primitive arrays. Unknown keys, nested objects, unbounded
values, free-form `issues` strings, `candidate`, `responseBody`, and any
raw model or provider prose are dropped. The journal `rawError` may retain:

- application `errorClass`;
- `issueCount`, bounded `issuePaths`, `issueCodes`, expected/received
  type kinds (not values), and `providerGenerationAttempt` when recovery
  records which provider generation failed;
- `outputCondition`, `responseLength`, provider lifecycle status, and
  incomplete reason when present;
- durations and token estimates already collected on the run as a
  separately hand-constructed metrics object.

It must not persist transcript, participant notes, hiddenInfo, personal
feedback, raw model output, or extracted model prose. Schema validation
failures map to `MODEL_SCHEMA_VALIDATION_ERROR`. The adapter-level
`AI_ANALYSIS_MAX_ATTEMPTS` remains 1 and `retryable=false` remains correct
for an exhausted first generation. A separate owned-operation primitive may
start one NEW Yandex generation after the first `MODEL_SCHEMA_VALIDATION_ERROR`.
That first-attempt diagnostic is journaled as a non-terminal WARNING
(`AI analysis schema recovery: MODEL_SCHEMA_VALIDATION_ERROR`). Consumers:
`logExternalServiceEvent` persists the row and writes a server log;
`GET /api/admin/health` may show it in the admin/operator journal
(unfiltered last-50 events); `hasRecentCriticalServiceErrors` and
`GET /api/admin/service-warnings` count only `ERROR`/`CRITICAL`, so the
dashboard `ServiceWarningBanner` does not fire. Session materials/status
and post-processing read `AiAnalysis.status` / `errorMessage`, not
`ExternalServiceEvent`. The facilitator UI therefore does not present a
recovered first-attempt WARNING as a transient or final session failure.
A terminal owned-operation failure still journals `ERROR` and writes
`AiAnalysis.errorMessage`. The row stays `ANALYZING` until the owned
operation completes or fails once.

## Owned-Operation Performance Model

`getAiAnalysisPerformanceModel()` reports:

- `maxGenerationPosts = 1` — ordinary single provider invocation (adapter
  retries clamped to 1; compact/depth extras stay 0).
- `maxOwnedOperationGenerationPosts = 2` — generation 1 plus at most one
  same-prompt Yandex schema-recovery POST.
- `maxPollingRequestsPerGeneration` — `ceil(pollTimeout / pollInterval)`.
- `maxPollingRequests` — owned-operation polling total
  (`maxOwnedOperationGenerationPosts * maxPollingRequestsPerGeneration`).

The polling total is a conservative structural bound. Both generations still
share the original operation deadline; remaining budget can cut generation 2
short. Do not treat `maxPollingRequests` as a single-generation figure.

## Visibility Model

- Facilitator: full analysis.
- Participant/observer: shared/sanitized analysis only when published.
- No role receives partial provider output through the status API.
- Sharing state controls materials access for observer-facing debrief behavior.

## Publication Recipient and Snapshot Contract

Distinguish three concepts:

- **CURRENT PRESENCE** — who is canonically in the room *now* / at a specific
  instant. Predicate: `activeHumanSessionConnectionWhere` and
  `summarizeLogicalPresenceByUser`. Used for occupancy, live UI, attendance,
  and future presence-gated features. Not publication authorization.
- **HISTORICAL ROOM ENTRY ELIGIBILITY** — whether a valid Participant or
  Observer has successfully entered the authorized Session room surface at
  least once. Durable evidence is any `SessionRoomConnection` row for that
  `(session, user)`, including disconnected, superseded, revoked, or expired
  rows. That row is created by canonical room-shell claim
  (`claimSessionRoomConnectionLease`) after authorized `/room` bootstrap.
  Confirmed Vox/media connection is not additionally required. Event Lobby
  presence, membership, invitation, join-token, unauthorized room URL access,
  and Event-lobby provider credentials are not sufficient.
- **PUBLICATION GRANT AUTHORIZATION** — a non-revoked
  `AiAnalysisPublicationGrant` bound to current Participant/Observer
  membership, account identity, and a stored maximum projection. Delivery
  never uses session-wide `SHARED_WITH_SESSION` alone. That older flag is why
  Observers previously received an unsafe shared payload; Observer access
  remains grant-plus-`OBSERVER` projection.

- `AiAnalysis` remains a mutable, one-per-session execution row. Each reclaimed
  analysis run increments `analysisVersion`; a prior recipient grant never
  authorizes the regenerated report automatically.
- An explicit Publish locks the analysis row and takes one logical
  `publishedAt` timestamp. It derives recipients from historical room-entry
  eligibility: any `SessionRoomConnection` for an ACTIVE account plus current
  `SessionParticipant` membership of type `PARTICIPANT` or `OBSERVER`.
  Active presence at Publish is not required. A viewer who entered and later
  left remains eligible. A lobby-only membership is not eligible.
- Publish persists one immutable `AiAnalysisPublication` snapshot per
  `(analysisVersion, publicationEpoch)`, plus normalized
  `AiAnalysisPublicationGrant` rows. A grant binds the recipient's
  `SessionParticipant`, account user, and maximum allowed projection
  (`PARTICIPANT` or `OBSERVER`). Facilitator privileges stay separate;
  facilitators are not converted into ordinary viewer-grant recipients.
- First canonical room entry (`claimSessionRoomConnectionLease`) while an
  unrevoked publication exists materializes a grant for the current epoch with
  the same selector, upsert, `AiAnalysis` row lock, and serializable retry as
  Publish. This covers an Observer or Participant who first enters during
  `DEBRIEF_OPEN` after Publish. Ordinary materials/status reconciliation then
  sees the grant. Client-only authorization is not used.
- Repeating Publish while the same snapshot remains active expands grants
  monotonically to newly historically eligible recipients. Existing valid
  grants remain valid when their holders later leave or reconnect.
  Reconnects upsert the same `(publicationId, sessionParticipantId)` and do
  not duplicate authorization.
- Unshare revokes the active publication and all of its grants. Room entry
  after Unshare does not create a grant and cannot resurrect a revoked
  epoch. The next Publish always opens a new epoch and recomputes recipients
  from historical room-entry truth at that moment, including viewers who
  first entered during Debrief or after the previous Unshare.
- Publish with zero eligible recipients still creates a publication snapshot
  but zero grants. Later lobby/membership alone has no access. Later
  authorized Session room-shell entry while that snapshot remains active does
  create a grant. Confirmed live media is not an extra eligibility gate.
- Participant projection is the sanitized shared report plus only that
  participant's personal feedback. Observer projection explicitly removes all
  `participantPersonalFeedback` as well as the shared sanitizer's blocked
  facilitator/private fields. These projections are selected server-side from
  the stored grant, never from client visibility.
- Client rendering must parse Observer-safe payloads without requiring
  `participantPersonalFeedback`. Facilitator/full analysis uses
  `parseCanonicalAnalysisOutput` (historical persisted-read contract).
  Published Participant/Observer views share
  `parsePublishedViewerAnalysis` in `lib/materials-ai-analysis-view.ts`.
  The report UI does not re-add private personal feedback or facilitator-only
  debrief questions to satisfy parsing.
- New AI analysis writes keep the strict current
  `NegotiationAnalysisOutputSchema`, including required
  `sessionParticipantId` on every personal-feedback item. Readers use a
  separate historical persisted-read contract
  (`HistoricalPersistedNegotiationAnalysisSchema` via
  `parseCanonicalAnalysisOutput` / `parsePublishedViewerAnalysis`) so
  previously completed reports remain renderable when they omit that ID or
  omit `participantPersonalFeedback` entirely. Compatibility is read-only: it
  does not synthesize IDs, rewrite stored JSON, or weaken write validation.
  Historical name-only delivery still requires a unique negotiating-participant
  display-name match; duplicate names omit the entry. Observer projections
  continue to strip all personal feedback.
- Delivery checks a non-revoked snapshot, a non-revoked grant, the bound
  account/session membership, and the grant's stored projection. A later role
  change cannot upgrade an old grant.
- Publish, Unshare, and late-entry grant materialization lock the same
  `AiAnalysis` row in serializable transactions and retry one bounded
  PostgreSQL serialization conflict. Their successful results therefore have
  one serial order: an Unshare after Publish or late-entry grant creation
  revokes the epoch; a Publish after Unshare creates the next epoch; entry
  after Unshare is a no-op.
- Publish additionally verifies that the completed analysis's persisted
  `transcriptId` and `transcriptRetranscribeCount` still match the canonical
  current transcript. A stale completed report cannot be shared, and status
  exposes `canShare=false` for it.
- New provider output carries `sessionParticipantId` for each personal-feedback
  entry. The prompt supplies this ID only as a model correlation value and the
  server locks every current `SessionParticipant` row by stable primary key
  (`id ASC`), re-queries, and validates current `PARTICIPANT` membership in the
  same short transaction that persists the run-token-fenced completion.
  Multi-row participant-role mutations use that same lock/write order. A
  membership/role mutation therefore serializes before validation or after
  completion persistence; provider execution never runs inside this lock.
  Legacy name-only feedback is delivered only when normalized display-name
  matching produces exactly one negotiating participant; zero or duplicate
  matches are omitted.

### Legacy publication compatibility

Pre-grant `AiAnalysis.sharedAnalysisJson` rows are retained for facilitator
review but receive no reconstructed recipient grants. They did not persist
historical room-entry eligibility or Observer-safe grant projections.
Therefore no participant or Observer gets legacy shared access automatically
after migration; the facilitator must explicitly republish to capture current
historically eligible recipients. This preserves stored artifacts without
guessing historical access or broadly granting Observers the old session-wide
payload.

## Material input fingerprint and currentness

- New `AiAnalysis` rows persist nullable `inputFingerprint` (SHA-256 of
  envelope `schemaVersion = 1`). For **new runs**, that hash is the prompted
  material snapshot (PT-19). Untouched historical rows stay `NULL` and are
  not bulk-backfilled (PT-22). A facilitator material write may bind a
  still-legacy-current NULL row to the pre-mutation envelope hash. That bind
  is a **legacy compatibility baseline**: PT-22 already treated the
  pre-mutation transcript generation as current, and the hash lets later
  same-generation edits become durably non-current. It is not reconstructed
  original-provider-prompt provenance. `retranscribeCount` remains ASR
  generation identity; `analysisVersion` remains AI-run/publication identity.
  The additive column must exist before `materials/status` can be read; a
  missing column fails every session’s post-processing projection rather than
  falling back to “waiting for recording.”
- Canonical builder: `buildSessionAnalysisContext` loads one in-memory
  snapshot. `buildMaterialInputEnvelope` / `fingerprintSessionAnalysisContext`
  hash that snapshot; `buildAnalysisPrompt` renders the same object. The
  analyze route computes the fingerprint before `claimAiAnalysisRun`, stores
  it on the claimed row, and reuses the closed-over context for the prompt.
  Consistency boundary: one in-memory `SessionAnalysisContext`, not two
  independent reads.
- Envelope includes prompted session/case/event title, role
  objectives/constraints/hiddenInfo/fallbackPosition, negotiation-participant
  roster identity and preparation notes, transcript lexical/diarized text,
  segment timing, speaker labels, and mapped participant identity. It excludes
  timestamps, publication grants, model/deploy/prompt implementation metadata,
  unused `privateInstructions`, and facilitator/observer notes.
- Notes predicate: `areNotesMaterialToNegotiationAnalysis` in
  `lib/ai/material-negotiation-notes.ts`. Only `PARTICIPANT` notes are
  material. Facilitator/observer notes stay editable and do not rewind AI.
  After `Session.negotiationState === FINISHED`, material participant
  preparation notes are locked by
  `areMaterialNegotiationNotesLockedAfterNegotiation` on both UI and
  `persistParticipantNotesAfterAccess`. Lock is not hide: stored participant
  preparation notes remain readable to authorized viewers. There is no notes
  publication entity and no AI-publication prerequisite.
  `resolveDebriefVisibleNotes` in `lib/debrief-visible-notes.ts` is the
  lifecycle-gated projection (`FINISHED` or `roomLifecycle === DEBRIEF_OPEN`).
  Materials RSC (`getAccountMaterialsData`) and
  `GET /api/sessions/:id/materials/status` (`postNegotiationNotes.participantPreparation`)
  apply the same role matrix server-side: a negotiation participant receives
  only their own notes; facilitator and authorized session observer receive all
  negotiation-participant preparation notes. Pre-lock visibility is unchanged
  (this projection is empty before the reveal state). Facilitator/observer
  own notes stay writable and are not this projection. Viewing, read-only
  transition, and reveal do not change `inputFingerprint`. N01/N02 may still
  use controlled DB mutation.
- Currentness: `evaluateAiAnalysisCurrentness`. Schema-recovery currentness
  linearizes at a successful `assertReadyForSecondGeneration` check. There is
  no transactional fence that locks the currentness read together with the
  later provider POST. Facilitator transcript/mapping/attribution writes and
  manual enhancement retry stay blocked while AI is `QUEUED`/`ANALYZING` with
  a live lease; retranscription and other ordinary provider-work windows can
  still stale an already-authorized generation. Completion never rewrites
  `inputFingerprint` to a later envelope. A new transcript generation
  (`transcriptId` + `retranscribeCount`) is a downstream invalidation boundary
  even when a stored fingerprint would still match the queued/archived text.
  Same-generation fingerprinted rows compare stored hash to the current
  envelope. `NULL` fingerprints keep
  `transcriptId` + `retranscribeCount` for **untouched** historical rows.
  That fallback cannot see same-generation lexical or mapping edits.
  Facilitator material writes (`applyFacilitatorMaterialInputChange`) bind a
  still-legacy-current NULL row to the pre-mutation envelope hash, then persist
  the mutation. After commit, currentness uses the fingerprinted path and the
  old row becomes non-current unless materials later equal that bound baseline
  (the same states PT-22 already accepted). This is not a bulk historical
  backfill and not a reconstructed original-prompt identity. `retranscribeCount`
  and `analysisVersion` are not used as generic edit counters. Mismatch
  presents AI as `NOT_STARTED` / rerun-required via the Phase C projection;
  the historical row is kept. The active-workflow string
  `analysisFromOlderTranscript` is emitted only when a still-current analysis
  is from an older generation; after rewind it stays off so Materials and room
  Debrief show the next pipeline step instead of a hidden historical reminder.
- Confirmed retranscription (`admitTranscriptionRun` in retranscribe mode)
  revokes any active publication in the same claim transaction. That is the
  single publication-revoke for the restart. Mapping/attribution/transcript
  saves that follow on the new generation do not revoke again unless a new
  current analysis exists. `SOURCE_RECORDING_NOT_AVAILABLE` is a
  non-destructive retranscription outcome: source bytes are proven before
  admission, so a missing source object does not increment
  `retranscribeCount`, revoke publication or grants, or change AI currentness.
- Facilitator material writes (transcript, mapping, manual attribution) go
  through `applyFacilitatorMaterialInputChange`. The destructive guard fires
  only when a **current** completed analysis exists for the active generation
  (published or not). Historical `AiAnalysis` rows, including a leftover
  publication on an already non-current generation, do not warn. A current
  unpublished analysis requires confirmation that a new AI run is needed and
  does not claim that a publication will be revoked. A current published
  analysis requires confirmation, then revoke via
  `revokeActiveAiAnalysisPublicationInTransaction` (same mechanism as Unshare).
  The three facilitator material-save UIs (plain transcript, speaker mapping,
  and diarized manual attribution) share the site `ConfirmDialog` before
  retrying with `confirmRewindPublication`. Recipients
  fail closed on fingerprint mismatch even if an old grant row still exists.
  Facilitator retranscription confirmation on Materials and room Debrief uses
  the same site `ConfirmDialog`. The original rerun control stays on the
  stable steps/status card. One click opens the modal; Cancel sends no
  request; Confirm sends exactly one `POST /materials/retranscribe`. The
  steps/status area does not transform into an inline amber confirmation
  panel.
  Manual transcript enhancement retry is also blocked while AI is
  `QUEUED`/`ANALYZING` with a live lease.
- Diagnostic logs may include fingerprint, schema version, and
  current/non-current reason. They must not dump transcript, hiddenInfo, or
  notes.

## Canonical Readiness And Presentation

- AI admission uses `evaluateAiAnalysisReadiness` plus enhancement-running
  ownership. `AUTO_SUGGESTED` is not a substitute for structural completeness.
- Materials `canStart` and the analyze route share that contract. Enhancement
  `FAILED` / `PARTIAL` / `SKIPPED` remain terminal and expose retry plus
  continue-with-current-transcript; starting AI is the continue path.
- The five-card rail, detailed rows, `/sessions`, and dashboard read speaker
  mapping and AI semantic state from `lib/post-processing/projection.ts`. A
  complete `AUTO_SUGGESTED` session is not shown as mapping-required beside
  completed AI.
- Transcript-enhancement running vs terminal is the same effective state for
  the rail, Recording & Transcription locks, Materials, room Debrief, and
  write guards (`lib/post-processing/enhancement-effective-state.ts`). A
  polled `COMPLETED` status must unlock the nested transcript section even if
  that child still holds a stale `/recording` `RUNNING` snapshot.

## Facilitator UI State Model

- `QUEUED`: accepted and waiting for detached execution; duplicate start is
  hidden and API duplicate protection remains active.
- `ANALYZING`: the section outline remains visibly pending and explicitly says
  that the complete report must pass validation. It does not claim sections are
  arriving or expose nonterminal provider output. Refresh reconstructs this
  state from the durable operation status.
- `COMPLETED`: canonical `analysisJson` replaces the pending outline and
  existing share/unshare controls remain available.
- `FAILED`: the pending outline is removed and the existing safe retry path is
  shown.
- Transcript-enhancement `COMPLETED` uses explicit success/green semantics;
  running, partial/failed, and skipped states remain visually distinct.

## Debrief Right-Panel State Machine

- In `DEBRIEF_OPEN`, participant/observer panel never renders empty:
  - if published personalized/shared analysis exists and validates, show AI report;
  - otherwise show permitted fallback context from room sidebar payload.
- The canonical live recipient surface is the room sidebar `DebriefPanel` →
  `SessionPostProcessingPanel` (`variant="sidebar"`). Account materials at
  `/sessions/[id]/materials` mounts the same panel (`variant="page"`) and also
  renders the published report. `/join/[joinToken]` redirects there.
- The shared recording/transcription child uses an explicit presentation
  contract (`lib/transcription/recording-transcription-presentation.ts`):
  room sidebar is `roomQuick` (no recording-status detail, no language
  selector); Materials/session page is `materialsDetail` (both remain).
  Transcript review/edit, speaker mapping, and rerun stay on both surfaces.
  This is a presentation split only; readiness and mapping semantics do not
  change.
- `resolveAiAnalysisRenderState` must not hide an authorized, schema-valid
  published payload behind upstream recording/transcript waiting stages
  (including `recordingStage=not_available`). Facilitator `QUEUED`/`ANALYZING`
  still shows the pending outline instead of a previous payload.
- Participant fallback includes own role private instructions.
- Observer fallback excludes participant private instructions.
- Materials action is independent from "leave room" and remains available in debrief (new-tab open in sidebar mode).
- Processing/partial/failed AI states are surfaced without hiding fallback context.
- AI/transcript-enhancement completion is canonical artifact freshness and is
  reported independently from whether the viewer owns a publication grant.
- Participant/Observer polling completion is viewer-specific: an active
  publication with no grant does not stop polling for a viewer who could gain a
  grant on a later explicit Publish or on first canonical room entry while the
  publication remains active.
- After a viewer already has a valid grant, polling still continues while the
  materials/debrief surface is mounted, the session is finished, and processing
  is not in a terminal failure without a current publishable analysis. This lets
  an already-open recipient observe remote Unshare without navigation. Polling
  uses `processing.shouldPoll` / `nextPollMs` from canonical `materials/status`
  (default 3500 ms) and stops on unmount or that terminal-failure condition.
- A current completed usable analysis remains publishable for no-grant polling
  even if obsolete recording/transcript processing later reports failure. When
  no such artifact exists, terminal processing failure stops polling.

## Source Notes

- `lib/ai/negotiation-analysis.ts`
- `lib/ai/analysis-failure-diagnostics.ts`
- `lib/ai/analysis-schema-recovery.ts`
- `lib/analysis-visibility.ts`
- `lib/privacy/serializers.ts`
- `lib/ai-publication.ts`
- `lib/ai-publication-entry-grant.ts`
- `lib/session-room-connection-lease.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`
- `app/api/sessions/[sessionId]/ai-analysis/unshare/route.ts`
- `tests/e2e/debrief-ai-sharing.spec.ts`
