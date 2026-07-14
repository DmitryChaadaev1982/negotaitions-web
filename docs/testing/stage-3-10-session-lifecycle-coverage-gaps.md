# Stage 3.10 Coverage Gaps (P0/P1)

This file tracks non-automated `P0`/`P1` scenarios from `docs/testing/stage-3-10-session-lifecycle-traceability.csv` for Stage 3.10 foundation/A7 plus Checkpoint B guard-path updates.

- Total manual/deferred `P0`/`P1` scenarios: `5`

## Manual Provider Canary

- `ST310-VOX-023` (`P0`): Provider auto-finalization reconciliation timing.
  - Reason/evidence gap: requires provider access
  - Traceability reference: `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `manual provider auto-termination`
- `ST310-VOX-024` (`P0`): Remote deployed scenario drift verification.
  - Reason/evidence gap: predeploy gate
  - Traceability reference: `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `manual drift verification`
- `ST310-VOX-025` (`P0`): Recorder.Stopped webhook after provider shutdown.
  - Reason/evidence gap: requires provider access
  - Traceability reference: `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `manual stopped webhook`

## Manual Multi-Browser / Multi-Device

- `ST310-PRESENCE-011` (`P1`): Multi-device media disconnect behavior.
  - Reason/evidence gap: requires multiple real devices
  - Traceability reference: `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `multi-device disconnect`
- `ST310-VOX-026` (`P1`): Real multi-client relay transport from distinct clients.
  - Reason/evidence gap: requires multiple real clients
  - Traceability reference: `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `multi-client relay`

## Deferred With Reason

- None for `P0`/`P1` after Checkpoint C final hardening. Remaining non-automated items are environment-bound manual canaries only.

## Residual accepted risk references

- No-browser server-owned Vox stop transport remains deferred backlog.
- Browser relay absence can leave stop operation in terminal relay-required diagnostic until provider/webhook reconciliation.

## Checkpoint B note

Checkpoint C closed previously deferred administrative-completion and management-UI scenarios (`ST310-SESSION-007/008`, `ST310-UI-001/002/003`) with API/browser coverage in `tests/e2e/session-finish-canonical.spec.ts` and `tests/e2e/session-completion-management-ui.spec.ts`.
