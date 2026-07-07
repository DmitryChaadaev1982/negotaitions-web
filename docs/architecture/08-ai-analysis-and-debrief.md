# 08 AI Analysis And Debrief

## Purpose

Produce structured post-session coaching output from transcript/materials and expose it with role-aware visibility rules.

## Flow

1. Facilitator starts analysis when transcript is ready and mapping prerequisites are met.
2. Provider-specific analysis execution runs (`openai` or `yandex`).
3. Structured output is validated against schema.
4. Analysis is persisted and optionally shared to session participants/observers.

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
