# Stage 3.10 Session Lifecycle Scenario Catalog

This catalog is generated from `docs/testing/stage-3-10-session-lifecycle-traceability.csv` and reflects Stage 3.10 foundation plus Checkpoint B guard-path evidence on branch `feature/stage-3-10-session-completion-flow`.

## Coverage Totals

- Total distinct scenarios: `75`
- `AUTOMATED`: `70`
- `MANUAL_PROVIDER_CANARY`: `3`
- `MANUAL_MULTI_BROWSER`: `2`
- `DEFERRED_WITH_REASON`: `0`
- `NOT_APPLICABLE`: `0`

## PRESENCE

- `ST310-PRESENCE-001` (`AUTOMATED`, `P1`) Participant explicit leave only disconnects caller. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `explicit participant leave disconnects only participant`.
- `ST310-PRESENCE-002` (`AUTOMATED`, `P1`) Observer explicit leave only disconnects caller. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `explicit observer leave disconnects only observer`.
- `ST310-PRESENCE-003` (`AUTOMATED`, `P0`) Facilitator leave without finish does not finish session. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `explicit facilitator leave does not finish`.
- `ST310-PRESENCE-004` (`AUTOMATED`, `P1`) Leave finalizes only current connection. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `explicit leave only one connection`.
- `ST310-PRESENCE-005` (`AUTOMATED`, `P1`) Duplicate leave is idempotent. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `duplicate leave idempotent`.
- `ST310-PRESENCE-006` (`AUTOMATED`, `P1`) Network loss handled by expiry path. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `expired OPEN connections do not auto-complete session`.
- `ST310-PRESENCE-007` (`AUTOMATED`, `P1`) Reconnect within grace keeps session active and cancels pending empty-room completion. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `reconnect before grace prevents empty-room completion after old deadline`.
- `ST310-PRESENCE-008` (`AUTOMATED`, `P0`) Newest tab supersedes old tab. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `newest same-login replaces previous`.
- `ST310-PRESENCE-009` (`AUTOMATED`, `P0`) Old tab cannot execute controls. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `stale facilitator cannot execute`.
- `ST310-PRESENCE-010` (`AUTOMATED`, `P0`) Old tab cannot disconnect replacement. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `stale cannot override replacement`.
- `ST310-PRESENCE-011` (`MANUAL_MULTI_BROWSER`, `P1`) Multi-device media disconnect behavior. Coverage: `Manual` via `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `multi-device disconnect`. Notes: requires multiple real devices.

## ROOM

- `ST310-ROOM-001` (`AUTOMATED`, `P0`) Final leave from debrief closes room. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `explicit leave starts debrief grace and closes after grace elapses`.
- `ST310-ROOM-002` (`AUTOMATED`, `P1`) Final leave from open does not close immediately or start the short debrief grace. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `explicit leave does not close OPEN and stale tab cannot disconnect replacement`.
- `ST310-ROOM-003` (`AUTOMATED`, `P1`) Expiry closes abandoned debrief after the established grace. Coverage: `Unit` via `lib/session-room-occupancy.test.ts` :: `debrief closes once grace elapses with zero active connections`.
- `ST310-ROOM-004` (`AUTOMATED`, `P1`) Empty OPEN sessions remain OPEN and create no recording-stop operation. Coverage: `Unit + Browser E2E` via `lib/session-room-occupancy.test.ts` :: `OPEN lifecycle is never auto-closed by the debrief guard`; `tests/e2e/voximplant-room-presence.spec.ts` :: `expired OPEN connections do not auto-complete session`.

## NAV

- `ST310-NAV-001` (`AUTOMATED`, `P1`) Refresh is not explicit leave. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `refresh semantics keeps row active`.
- `ST310-NAV-002` (`AUTOMATED`, `P1`) Unmount cleanup does not call explicit leave. Coverage: `API/components` via `components/voximplant-negotiation-room-page.tsx` :: `cleanup path no leave`. Notes: validated by code path and E2E behavior.
- `ST310-NAV-003` (`AUTOMATED`, `P1`) FINISHED+DEBRIEF_OPEN authorized rejoin allowed. Coverage: `API/UI` via `app/api/sessions/[sessionId]/control-state/route.ts` :: `rejoin policy`.
- `ST310-NAV-004` (`AUTOMATED`, `P1`) FINISHED+CLOSED redirects to materials. Coverage: `Browser E2E` via `tests/e2e/session-finish-canonical.spec.ts` :: `closed terminal navigation`.
- `ST310-NAV-005` (`AUTOMATED`, `P0`) Completed event denies lobby/debrief. Coverage: `Browser E2E` via `tests/e2e/event-completion.spec.ts` :: `rejoin after event completed denies lobby and redirects to login [ST310-NAV-005]`.
- `ST310-NAV-006` (`AUTOMATED`, `P1`) OPEN direct entry remains allowed under canonical server guard. Coverage: `Unit` via `lib/session-room-access.test.ts` :: `allows OPEN lifecycle room access`.
- `ST310-NAV-007` (`AUTOMATED`, `P1`) FINISHED+DEBRIEF_OPEN direct entry remains allowed. Coverage: `Unit` via `lib/session-room-access.test.ts` :: `allows FINISHED + DEBRIEF_OPEN access`.
- `ST310-NAV-008` (`AUTOMATED`, `P1`) FINISHED+CLOSED direct entry resolves deterministic materials redirect. Coverage: `Unit` via `lib/session-room-access.test.ts` :: `redirects CLOSED room to materials`.

## SESSION

- `ST310-SESSION-001` (`AUTOMATED`, `P0`) Finish with active connections opens debrief. Coverage: `API` via `tests/e2e/session-finish-canonical.spec.ts` :: `finish keeps debrief open`.
- `ST310-SESSION-002` (`AUTOMATED`, `P0`) Finish without active connections closes room. Coverage: `API` via `tests/e2e/session-finish-canonical.spec.ts` :: `finish without active closes room`.
- `ST310-SESSION-003` (`AUTOMATED`, `P0`) Repeated FINISH idempotent. Coverage: `API` via `tests/e2e/session-finish-canonical.spec.ts` :: `repeated finish idempotent`.
- `ST310-SESSION-004` (`AUTOMATED`, `P0`) CLOSED terminal session does not reopen. Coverage: `Unit/API` via `lib/session-room-lifecycle.test.ts` :: `terminal closed mapping`.
- `ST310-SESSION-005` (`AUTOMATED`, `P0`) Facilitator is authorized to FINISH. Coverage: `API` via `tests/e2e/session-finish-canonical.spec.ts` :: `facilitator finish accepted`.
- `ST310-SESSION-006` (`AUTOMATED`, `P1`) Participant denied administrative completion. Coverage: `API` via `tests/e2e/session-finish-canonical.spec.ts` :: `administrative complete endpoint denies participant`.
- `ST310-SESSION-007` (`AUTOMATED`, `P1`) Observer denied administrative completion. Coverage: `API` via `tests/e2e/session-finish-canonical.spec.ts` :: `administrative complete endpoint denies observer [ST310-SESSION-007]`.
- `ST310-SESSION-008` (`AUTOMATED`, `P1`) Administrative finish UI route. Coverage: `Browser E2E` via `tests/e2e/session-completion-management-ui.spec.ts` :: `management UI shows canonical complete flow and preserves sibling/event state`.

## RECORDING

- `ST310-RECORDING-001` (`AUTOMATED`, `P1`) Recording continues after non-terminal leave. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `participant leave keeps session running`.
- `ST310-RECORDING-003` (`AUTOMATED`, `P1`) Starting-not-ready retry bounded policy. Coverage: `Unit` via `lib/recording-stop-delivery-policy.test.ts` :: `starting not ready policy`.
- `ST310-RECORDING-004` (`AUTOMATED`, `P0`) Exactly one stop operation per recording. Coverage: `API/DB` via `tests/e2e/session-finish-canonical.spec.ts` :: `finish creates one logical stop op`.
- `ST310-RECORDING-006` (`AUTOMATED`, `P1`) Processing is relay terminal. Coverage: `Unit` via `lib/session-recording-stop-relay.test.ts` :: `terminal statuses`.
- `ST310-RECORDING-008` (`AUTOMATED`, `P1`) Completed is terminal. Coverage: `Unit` via `lib/session-recording-stop-relay.test.ts` :: `completed terminal`.
- `ST310-RECORDING-010` (`AUTOMATED`, `P0`) Duplicate finish does not create duplicate stop. Coverage: `API/DB` via `tests/e2e/session-finish-canonical.spec.ts` :: `duplicate finish one op`.

## VOX

- `ST310-VOX-001` (`AUTOMATED`, `P0`) Facilitator relay transport allowed for authorized op. Coverage: `API` via `app/api/sessions/[sessionId]/recording-control/route.ts` :: `relay stop claim`.
- `ST310-VOX-002` (`AUTOMATED`, `P0`) Participant relay transport allowed for authorized op. Coverage: `API` via `app/api/sessions/[sessionId]/recording-control/route.ts` :: `participant relay`.
- `ST310-VOX-003` (`AUTOMATED`, `P0`) Observer relay transport allowed for authorized op. Coverage: `API` via `app/api/sessions/[sessionId]/recording-control/route.ts` :: `observer relay`.
- `ST310-VOX-004` (`AUTOMATED`, `P0`) Non-authorized client cannot create stop intent. Coverage: `API` via `app/api/sessions/[sessionId]/recording-control/route.ts` :: `deny unauthorized relay create`.
- `ST310-VOX-006` (`AUTOMATED`, `P0`) Concurrent relay claim is atomic. Coverage: `DB/API` via `lib/session-recording-stop-relay.ts` :: `atomic claim behavior`.
- `ST310-VOX-009` (`AUTOMATED`, `P0`) Relay timeout reaches terminal diagnostic. Coverage: `Unit` via `lib/recording-stop-delivery-policy.test.ts` :: `relay timeout terminal`.
- `ST310-VOX-011` (`AUTOMATED`, `P0`) Scenario stops recorder on ConferenceEvents.Stopped. Coverage: `Scenario contract` via `lib/voximplant/main-room-scenario.test.ts` :: `conference stopped shutdown`.
- `ST310-VOX-012` (`AUTOMATED`, `P0`) Scenario stops recorder on AppEvents.Terminating. Coverage: `Scenario contract` via `lib/voximplant/main-room-scenario.test.ts` :: `app terminating shutdown`.
- `ST310-VOX-013` (`AUTOMATED`, `P1`) participants===0 alone does not stop recorder. Coverage: `Scenario contract` via `lib/voximplant/main-room-scenario.test.ts` :: `disconnected block no stop`.
- `ST310-VOX-016` (`AUTOMATED`, `P1`) currentRecordingContext preserved through stopped webhook attempt. Coverage: `Scenario contract` via `lib/voximplant/main-room-scenario.test.ts` :: `context behavior`.
- `ST310-VOX-023` (`MANUAL_PROVIDER_CANARY`, `P0`) Provider auto-finalization reconciliation timing. Coverage: `Manual` via `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `manual provider auto-termination`. Notes: requires provider access.
- `ST310-VOX-024` (`MANUAL_PROVIDER_CANARY`, `P0`) Remote deployed scenario drift verification. Coverage: `Manual` via `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `manual drift verification`. Notes: predeploy gate.
- `ST310-VOX-025` (`MANUAL_PROVIDER_CANARY`, `P0`) Recorder.Stopped webhook after provider shutdown. Coverage: `Manual` via `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `manual stopped webhook`. Notes: requires provider access.
- `ST310-VOX-026` (`MANUAL_MULTI_BROWSER`, `P1`) Real multi-client relay transport from distinct clients. Coverage: `Manual` via `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md` :: `multi-client relay`. Notes: requires multiple real clients.

## EVENT

- `ST310-EVENT-001` (`AUTOMATED`, `P0`) Event complete closes linked session via canonical finish. Coverage: `Browser E2E` via `tests/e2e/event-completion.spec.ts` :: `complete event closes session`.
- `ST310-EVENT-004` (`AUTOMATED`, `P0`) Mixed recording states handled during event completion. Coverage: `Browser E2E` via `tests/e2e/event-completion.spec.ts` :: `complete event closes running session and stops active recording [ST310-EVENT-004]`.
- `ST310-EVENT-005` (`AUTOMATED`, `P1`) No recording session still closes on event complete. Coverage: `Browser E2E` via `tests/e2e/event-completion.spec.ts` :: `session without recording`.
- `ST310-EVENT-006` (`AUTOMATED`, `P0`) Duplicate event completion idempotent. Coverage: `Browser E2E` via `tests/e2e/event-completion.spec.ts` :: `complete from lobby idempotent`.
- `ST310-EVENT-009` (`AUTOMATED`, `P0`) Partial stop failure does not block event completion. Coverage: `Browser E2E` via `tests/e2e/event-completion.spec.ts` :: `stop failure still completes`.
- `ST310-EVENT-010` (`AUTOMATED`, `P1`) Completed event-linked room entry resolves `EVENT_CLOSED` and redirect target. Coverage: `Unit` via `lib/session-room-access.test.ts` :: `returns EVENT_CLOSED for completed event-linked session`.

## MATERIALS

- `ST310-MATERIALS-001` (`AUTOMATED`, `P1`) Delayed finalization does not block materials availability. Coverage: `API` via `app/api/sessions/[sessionId]/materials/status/route.ts` :: `materials while finalizing`.
- `ST310-MATERIALS-002` (`AUTOMATED`, `P1`) Completed-event owner hierarchy may resolve to event results destination. Coverage: `Unit` via `lib/session-room-access.test.ts` :: `prefers event lobby results for event owners when requested`.

## MIGRATION

- `ST310-MIGRATION-001` (`AUTOMATED`, `P0`) Nullable lifecycle compatibility derivation. Coverage: `Unit` via `lib/session-room-lifecycle.test.ts` :: `keeps explicit or derives null`.
- `ST310-MIGRATION-002` (`AUTOMATED`, `P0`) Legacy unfinished derives OPEN. Coverage: `Unit` via `lib/session-room-lifecycle.test.ts` :: `unfinished legacy to OPEN`.
- `ST310-MIGRATION-003` (`AUTOMATED`, `P0`) Legacy terminal derives CLOSED. Coverage: `Unit` via `lib/session-room-lifecycle.test.ts` :: `finished legacy to CLOSED`.
- `ST310-MIGRATION-005` (`AUTOMATED`, `P1`) Backfill dry-run is bounded and safe. Coverage: `Unit` via `lib/stage-3-10-maintenance.test.ts` :: `backfill dry-run behavior`.
- `ST310-MIGRATION-006` (`AUTOMATED`, `P1`) Backfill bounded batches rerunnable. Coverage: `Unit` via `lib/stage-3-10-maintenance.test.ts` :: `bounded batch semantics`.

## RACE

- `ST310-RACE-001` (`AUTOMATED`, `P1`) Two expiry workers are idempotent. Coverage: `Integration` via `lib/stage-3-10-maintenance.test.ts` :: `idempotent maintenance retries`.
- `ST310-RACE-003` (`AUTOMATED`, `P0`) Heartbeat versus leave race is safe. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `leave race with heartbeat`.
- `ST310-RACE-004` (`AUTOMATED`, `P0`) Reconnect versus close race keeps newest active. Coverage: `Browser E2E` via `tests/e2e/voximplant-room-presence.spec.ts` :: `leave racing reconnect`.
- `ST310-RACE-006` (`AUTOMATED`, `P0`) Finish versus final leave convergence. Coverage: `API/DB` via `tests/e2e/session-finish-canonical.spec.ts` :: `finish/occupancy convergence`.
- `ST310-RACE-007` (`AUTOMATED`, `P0`) Finish versus event completion convergence. Coverage: `Browser E2E` via `tests/e2e/event-completion.spec.ts` :: `event complete with running session`.
- `ST310-RACE-009` (`AUTOMATED`, `P0`) Webhook versus relay report convergence. Coverage: `API/DB` via `lib/session-recording-stop-relay.ts` :: `reconciliation semantics`.

## UI

- `ST310-UI-001` (`AUTOMATED`, `P1`) Administrative finish visibility. Coverage: `Browser E2E` via `tests/e2e/session-completion-management-ui.spec.ts` :: `management UI shows canonical complete flow and preserves sibling/event state`.
- `ST310-UI-002` (`AUTOMATED`, `P1`) Complete versus Delete UX distinction. Coverage: `Browser E2E` via `tests/e2e/session-completion-management-ui.spec.ts` :: `management UI shows canonical complete flow and preserves sibling/event state`.
- `ST310-UI-003` (`AUTOMATED`, `P1`) Completed event hides open lobby action. Coverage: `Browser E2E` via `tests/e2e/session-completion-management-ui.spec.ts` :: `management UI shows canonical complete flow and preserves sibling/event state`.
- `ST310-UI-004` (`AUTOMATED`, `P2`) AI publication aggregation in completed events. Coverage: `Browser E2E` via `tests/e2e/session-completion-management-ui.spec.ts` :: `management UI shows canonical complete flow and preserves sibling/event state`.
- `ST310-UI-005` (`AUTOMATED`, `P2`) Speaker mapping status independence in completion UI. Coverage: `Browser E2E` via `tests/e2e/session-completion-management-ui.spec.ts` :: `management UI shows canonical complete flow and preserves sibling/event state`.

