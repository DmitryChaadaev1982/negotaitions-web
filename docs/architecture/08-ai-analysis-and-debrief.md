# 08 AI Analysis And Debrief

## Purpose

Produce structured post-session coaching output from transcript/materials and expose it with role-aware visibility rules.

## Flow

1. Facilitator starts analysis when transcript is ready and mapping prerequisites are met.
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
   schema. Personal feedback identifies its recipient by supplied
   `SessionParticipant` ID, which is validated against the current negotiating
   roster before `analysisJson` is persisted and status changed to `COMPLETED`.

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
7. A completed analysis can be explicitly published as a role-scoped snapshot
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
  `participantPersonalFeedback`. Facilitator/full analysis still uses the
  canonical schema. Published Participant/Observer views share
  `parsePublishedViewerAnalysis` in `lib/materials-ai-analysis-view.ts`.
  The report UI does not re-add private personal feedback or facilitator-only
  debrief questions to satisfy parsing.
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
- `lib/analysis-visibility.ts`
- `lib/privacy/serializers.ts`
- `lib/ai-publication.ts`
- `lib/ai-publication-entry-grant.ts`
- `lib/session-room-connection-lease.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`
- `app/api/sessions/[sessionId]/ai-analysis/unshare/route.ts`
- `tests/e2e/debrief-ai-sharing.spec.ts`
