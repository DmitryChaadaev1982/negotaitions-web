# 08 AI Analysis And Debrief

## Purpose

Produce structured post-session coaching output from transcript/materials and expose it with role-aware visibility rules.

## Flow

1. Facilitator starts analysis when transcript is ready and mapping prerequisites are met.
2. Analysis context is built from transcript segments with pause processing mode awareness:
   - `transcript_interval_filter`: apply shared interval filter to transcript segments;
   - `source_audio_cut`: use transcript as-is (already generated from active-only audio).
3. Provider-specific analysis execution runs (`openai` or `yandex`).
4. Structured output is validated against schema.
5. Analysis is persisted and optionally shared to session participants/observers.

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
- Analysis context builder: `lib/ai/session-analysis-context.ts`.
- Visibility filtering: `lib/analysis-visibility.ts`.
- APIs:
  - `app/api/sessions/[sessionId]/analyze/route.ts`
  - `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`
  - `app/api/sessions/[sessionId]/ai-analysis/unshare/route.ts`

## Visibility Model

- Facilitator: full analysis.
- Participant/observer: shared/sanitized analysis only when published.
- Sharing state controls materials access for observer-facing debrief behavior.

## Source Notes

- `lib/ai/negotiation-analysis.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `tests/e2e/debrief-ai-sharing.spec.ts`
- `docs/audits/archive/old-root-reports/PRIVACY_SERIALIZERS.md`
