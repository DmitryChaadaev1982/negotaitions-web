# Stage 3.5 Speaker Mapping UI Audit

## Scope
- Audit only (no code changes in runtime components/routes).
- Target area: speaker mapping + transcript/materials UI before assisted mapping redesign.
- Repository audited: `negotiations-web`.

## Screens and Exact Routes/Entry Points
- Facilitator room / video room:
  - Route: `/room/[sessionId]` via `app/room/[sessionId]/page.tsx`.
  - Room shell: `components/shared-room-shell.tsx`.
  - Debrief sidebar appears in same route after finish: `components/debrief-panel.tsx` -> `components/session-post-processing-panel.tsx` (`variant="sidebar"`).
- Session management screen:
  - Route: `/sessions/[id]` via `app/(app)/sessions/[id]/page.tsx`.
  - View: `components/session-detail-view.tsx`.
  - Post-processing area embedded here: `components/session-post-processing-panel.tsx` (`variant="page"`).
- Transcript/materials screen:
  - Route: `/sessions/[id]/materials` via `app/(app)/sessions/[id]/materials/page.tsx`.
  - View: `components/account-session-materials-view.tsx`.
  - Uses same post-processing block: `components/session-post-processing-panel.tsx` (`variant="page"`).
- Debrief/material generation screen:
  - No separate route; debrief is sidebar mode inside `/room/[sessionId]` after session finish.
  - Component chain: `shared-room-shell` -> `debrief-panel` -> `session-post-processing-panel`.
- Any event/session post-processing UI:
  - Shared single implementation: `components/session-post-processing-panel.tsx`.
  - It delegates transcript/speaker mapping UI to `components/recording-transcription-section.tsx`.

## Search Results (Requested Terms)
- `"Улучшить качество транскрипта"`:
  - i18n key in `lib/i18n/dictionaries/ru.ts`.
  - rendered in `recording-transcription-section.tsx` and `session-post-processing-panel.tsx`.
- `"Почему автосопоставление"`:
  - i18n key in `lib/i18n/dictionaries/ru.ts`.
  - rendered as mapping failure banner in `recording-transcription-section.tsx`.
- `"автосопостав"` / `"Сопоставление говорящих"`:
  - i18n and mapping status/failure logic in `ru.ts`, `mapping-failure-reasons.ts`, `speaker-mapping-state.ts`, `auto-trigger-mapping.ts`.
- `"mappingSuggestion"`:
  - persisted/used in `auto-trigger-mapping.ts`, `recording/route.ts`, `materials/status/route.ts`, `mapping-failure-reasons.ts`.
- `"low_margin_review_required"`:
  - decision source in `lib/transcription/mapping-decision.ts`.
- `"speakerMappingStatus"`:
  - API + UI wiring across `recording/route.ts`, `materials/status/route.ts`, `speaker-mapping/route.ts`, `recording-transcription-section.tsx`.

## Audit Answers (1-10)
1. Which component renders the huge improve transcript block?
   - `components/recording-transcription-section.tsx` (`showEnhancementAction || showEnhancementStatus` violet card).

2. Is this action duplicated elsewhere?
   - Yes.
   - Also rendered in `components/session-post-processing-panel.tsx` Step 1 action row (`post-processing-run-transcript-enhancement-button`), calling same endpoint `/api/sessions/[sessionId]/materials/enhance-transcript`.
   - Additional legacy duplicate exists in `components/session-materials-dashboard.tsx` (currently not wired into active account materials route).

3. Which component renders auto mapping warning?
   - `components/recording-transcription-section.tsx`:
     - telemetry warning hint (`showTelemetryMappingReviewHint`)
     - failure banner with title key `recording.mappingFailureTitle` ("Почему автосопоставление не выполнено").

4. Which component renders manual speaker dropdowns?
   - `components/recording-transcription-section.tsx`:
     - speaker-level mapping dropdowns inside `shouldShowSpeakerMappingPanel`.
     - turn-level manual attribution dropdowns in manual mode (`manualSpeakerModeEnabled`).

5. Which API provides mapping suggestion/status?
   - Status and failure reason for facilitator UI:
     - `GET /api/sessions/[sessionId]/recording` (`app/api/sessions/[sessionId]/recording/route.ts`)
     - `GET /api/sessions/[sessionId]/materials/status` (`app/api/sessions/[sessionId]/materials/status/route.ts`)
   - Mapping CRUD + on-demand suggestion:
     - `GET /api/sessions/[sessionId]/speaker-mapping` returns `speakerMappingStatus`, speakers, participants.
     - `POST /api/sessions/[sessionId]/speaker-mapping`:
       - `suggestAutomatically: true` returns suggestion/confidence/telemetry quality.
       - mapping save/confirm/apply flows.
   - Auto suggestion persistence source:
     - `lib/transcription/auto-trigger-mapping.ts` writes diagnostics into `processingMetadata.mappingSuggestion`.

6. Where should assisted mapping card live?
   - In `components/recording-transcription-section.tsx`, replacing the current split pattern:
     - warning banner (`showMappingFailureBanner`)
     - separate mapping panel (`shouldShowSpeakerMappingPanel`).
   - Keep it in same vertical location (before transcript text blocks), so all screens reusing `SessionPostProcessingPanel` inherit the redesign.

7. What should be removed/collapsed?
   - Collapse/remove large standalone transcript enhancement card in `recording-transcription-section.tsx` as primary CTA.
   - Keep enhancement as compact secondary action (single-line/link-style) in one place.
   - Merge/remove warning-only mapping banner and standalone mapping dropdown block into one unified "Подтвердите говорящих" card.
   - Optional cleanup: `components/speaker-mapping-panel.tsx` appears unused in `negotiations-web` and duplicates older mapping UX.

8. Does manual mapping require retranscription?
   - No.
   - `POST /api/sessions/[sessionId]/speaker-mapping` applies mapping to transcript/segments directly.
   - `POST /api/sessions/[sessionId]/manual-speaker-attribution` writes transcript and segments directly, marks mapping confirmed.

9. Can debrief/materials be regenerated after manual mapping?
   - Yes.
   - AI run gate is `isSpeakerMappingReadyForAnalysis` in `/api/sessions/[sessionId]/analyze`.
   - After mapping is ready/confirmed, AI analysis can run.
   - If analysis already exists, rerun is supported (`canRerunAiAnalysis` in materials status).

10. What is the minimal UI redesign?
   - Replace warning block title/content with a single assisted review card: "Подтвердите говорящих".
   - Inside one card:
     - reason + confidence context (from mapping diagnostics).
     - suggested mapping rows.
     - manual dropdowns inline per speaker.
   - Actions in same card:
     - "Применить предложение"
     - "Сохранить сопоставление"
     - "Пропустить пока"
   - Reframe low confidence as review-needed state (not error state).

## Current UX Gaps vs Target
- Current low-confidence path uses warning/failure framing and separate editing block, increasing cognitive load.
- Suggestion confidence exists in backend diagnostics but is not surfaced in the active facilitator mapping panel.
- Enhancement CTA is visually dominant and duplicated, competing with mapping review.

## Backend Readiness for Assisted/Manual-First
- Ready:
  - `speakerMappingStatus` lifecycle already supports `REQUIRED`, `NEEDS_REVIEW`, `AUTO_SUGGESTED`, `CONFIRMED`.
  - Low-confidence reasons already normalized (`low_margin_review_required` and related) via `mapping-decision.ts` + `mapping-failure-reasons.ts`.
  - AI gate enforces mapping readiness before debrief generation.
  - `source_audio_cut` default confirmed in `lib/env.ts` (`getPauseProcessingMode()` fallback).
- Partial gap (UI integration, not backend blocker):
  - For `NEEDS_REVIEW`/`REQUIRED`, `resolveSpeakerMappingForUi()` currently does not prefill candidate mapping from diagnostics; it only prefills from persisted mapping or `AUTO_SUGGESTED`.
  - Suggestion payload is available in `mappingSuggestionDiagnostics`, so assisted card can consume it without new backend endpoint.

## Duplicated / Obsolete Actions Identified
- Duplicate transcript enhancement action:
  - `recording-transcription-section.tsx`
  - `session-post-processing-panel.tsx`
- Legacy/unused dashboard flow still contains same enhancement CTA:
  - `session-materials-dashboard.tsx` via `join-page-view.tsx` (not referenced by active account route).
- Standalone `speaker-mapping-panel.tsx` appears unmounted in current main app flow.

## Recommendations (Strict Minimal Redesign)
- Implement redesign only in `recording-transcription-section.tsx` so all parent screens inherit change automatically.
- Keep `session-post-processing-panel.tsx` as orchestration layer; do not add new page-level buttons there unless replacing an obsolete one.
- Convert large enhancement block into compact secondary control and keep only one visible trigger across Step 1 + transcript body.
- Preserve existing API contracts (`/speaker-mapping`, `/recording`, `/materials/status`) and use existing diagnostics for confidence/reason rendering.

## Suggested Implementation Branch
- `feature/stage-3-5-assisted-speaker-mapping-ui`

