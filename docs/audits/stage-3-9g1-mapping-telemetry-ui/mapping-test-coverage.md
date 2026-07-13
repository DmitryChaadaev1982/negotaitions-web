# Mapping Test Coverage Audit

## Covered well

- Telemetry authorization semantics:
  - `lib/telemetry/audio-activity-authorization.test.ts`
  - `lib/telemetry/audio-activity-role-gates.test.ts`
- Activity interval processing/normalization:
  - `lib/telemetry/audio-activity-event-processor.test.ts`
  - `lib/telemetry/active-timeline-normalization.test.ts`
- Source selection and disagreement behavior:
  - `lib/transcription/speaker-mapping-telemetry-source-selection.test.ts`
- Mapping safety and telemetry quality warnings:
  - `lib/transcription/mapping-safety.test.ts`
- Decision gates and margin override:
  - `lib/transcription/mapping-decision.test.ts`
  - `lib/transcription/auto-trigger-mapping.test.ts`
- Status derivation/UI prefill precedence:
  - `lib/transcription/speaker-mapping-state.test.ts`
  - `lib/transcription/assisted-speaker-mapping.test.ts`
- E2E propagation and lock override:
  - `tests/e2e/diarization-speaker-mapping.spec.ts`
- AI readiness gating by mapping:
  - `lib/transcription/speaker-mapping-readiness.test.ts`
  - `tests/e2e/session-materials-processing.spec.ts`

## Partially covered / gaps

- No dedicated end-to-end assertions for all RU/EN mapping copy combinations.
- Limited explicit tests for cross-browser duplicate remote observation collisions.
- No direct test asserting that enhanced transcript run never mutates mapping fields (behavior visible in code, indirectly covered by flow tests).
- Limited explicit UI test for "auto-suggested but not confirmed" distinction language.

