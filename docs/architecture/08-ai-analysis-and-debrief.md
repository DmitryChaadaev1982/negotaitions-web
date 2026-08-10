# 08 AI Analysis And Debrief

## Purpose

Produce structured post-session coaching output from transcript/materials and expose it with role-aware visibility rules.

## Flow

1. Facilitator starts analysis when transcript is ready and mapping prerequisites are met.
2. Analysis context is built from transcript segments with pause processing mode awareness:
   - `source_audio_cut` (production default): use transcript as-is (already generated from active-only audio).
   - `transcript_interval_filter` (legacy/deprecated fallback): apply shared interval filter to transcript segments.
3. A fenced `QUEUED` operation is created and the route returns `202` without
   making the browser connection execution authority.
4. Self-hosted Next.js `after()` starts the owned operation, transitions it to
   `ANALYZING`, and runs the explicitly selected provider (`openai` or
   `yandex`).
5. Yandex creates one durable background response and retrieves that same
   response by ID until it reaches a terminal provider state.
6. The complete provider output is parsed and validated against the canonical
   schema. Only then is `analysisJson` persisted and status changed to
   `COMPLETED`.
7. A completed analysis can be shared to session participants/observers through
   the existing sanitized publication flow.

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
- Participant fallback includes own role private instructions.
- Observer fallback excludes participant private instructions.
- Materials action is independent from "leave room" and remains available in debrief (new-tab open in sidebar mode).
- Processing/partial/failed AI states are surfaced without hiding fallback context.

## Source Notes

- `lib/ai/negotiation-analysis.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `tests/e2e/debrief-ai-sharing.spec.ts`
- `docs/audits/archive/old-root-reports/PRIVACY_SERIALIZERS.md`
