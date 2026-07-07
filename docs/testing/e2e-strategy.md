# E2E Strategy

## Goals

- Validate end-to-end business flow for cases, events, sessions, materials, and role access.
- Keep provider-integrated flows testable with deterministic defaults.
- Prevent regressions in room lifecycle, recording pipeline, and AI sharing logic.

## Test Layers

- Domain-heavy regression specs (events/sessions/access/materials).
- Provider-focused specs (Voximplant room/lobby/layout/recording diagnostics).
- Diagnostics and environment checks.

## Default Execution Model

- Mock external services by default for stable and cost-safe runs.
- Keep live-provider smoke tests explicit and opt-in only.

## Key E2E Coverage Areas

- Event multi-session lifecycle and assignment behavior.
- Session lifecycle control state and room navigation.
- Recording/transcription/materials flow with role-gated access.
- Speaker mapping and debrief-sharing behaviors.
- Security/access behavior for account-mode restrictions and protected APIs.

## Canonical References

- `tests/e2e/**`
- `docs/testing/validation-checklist.md`
- `docs/testing/yandex-poc-smoke-regression-plan.md`
- `docs/audits/archive/old-root-reports/TEST_PLAN.md`
- `docs/audits/archive/old-root-reports/TEST_RESULTS.md`
