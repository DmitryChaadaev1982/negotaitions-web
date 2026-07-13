# Stage 3.10 Coverage Gaps (P0/P1)

This file tracks non-automated `P0`/`P1` scenarios from `docs/testing/stage-3-10-session-lifecycle-traceability.csv` for Stage 3.10 foundation/A7.

- Total manual/deferred `P0`/`P1` scenarios: `11`

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

- `ST310-SESSION-006` (`P1`): Participant denied FINISH.
  - Reason/evidence gap: needs explicit negative API spec
  - Traceability reference: `tests/e2e/session-finish-canonical.spec.ts` :: `participant denial`
- `ST310-SESSION-007` (`P1`): Observer denied FINISH.
  - Reason/evidence gap: needs explicit negative API spec
  - Traceability reference: `tests/e2e/session-finish-canonical.spec.ts` :: `observer denial`
- `ST310-SESSION-008` (`P1`): Administrative finish UI route.
  - Reason/evidence gap: Checkpoint C UI not implemented
  - Traceability reference: `N/A` :: `N/A`
- `ST310-UI-001` (`P1`): Administrative finish visibility.
  - Reason/evidence gap: Checkpoint C
  - Traceability reference: `N/A` :: `N/A`
- `ST310-UI-002` (`P1`): Complete versus Delete UX distinction.
  - Reason/evidence gap: Checkpoint C
  - Traceability reference: `N/A` :: `N/A`
- `ST310-UI-003` (`P1`): Completed event hides open lobby action.
  - Reason/evidence gap: Checkpoint C
  - Traceability reference: `N/A` :: `N/A`

## Residual accepted risk references

- No-browser server-owned Vox stop transport remains deferred backlog.
- Browser relay absence can leave stop operation in terminal relay-required diagnostic until provider/webhook reconciliation.
