# Stage 3.10 Implementation Status (Checkpoint A Progress)

## Implemented in current branch

- **A1 additive schema**
  - Added `Session.roomLifecycle` (`RoomLifecycle` enum) as nullable compatibility field.
  - Added durable `SessionRoomConnection` ledger table and additive indexes.
  - Added `SessionRecordingStopOperation` table for durable idempotent recording-stop orchestration.

- **A2 compatibility and durable ledger integration**
  - Replaced in-memory room-connection lease with PostgreSQL-backed lease operations.
  - Kept compatibility behavior for legacy sessions where `roomLifecycle` is still `null`.
  - Separated lease validation from explicit lease renewal (`heartbeat` renews; validate-only callers do not).
  - Added stale-connection hardening to prevent reactivation of superseded/disconnected/revoked/expired connection IDs.

- **A3 canonical server-authoritative Session finish**
  - Added canonical finish service at `lib/session-completion.ts`.
  - Session finish now resolves room lifecycle (`DEBRIEF_OPEN` vs `CLOSED`) using durable active-connection predicate.
  - Added non-reopen guard (`CLOSED` remains terminal).
  - Added idempotent recording-stop intent claiming and durable delivery state machine.
  - Refactored facilitator room finish and timer auto-finish paths to use canonical finish service.

- **A4 Event completion orchestration through canonical Session completion**
  - Refactored `lib/complete-event.ts` to complete each linked session through canonical finish service in `EVENT_COMPLETION` mode.
  - Event completion now hard-closes linked session rooms (`roomLifecycle=CLOSED`) regardless of presence.
  - Per-session recording-stop failures are captured as warnings; Event status remains `COMPLETED`.

- **A5 durable room occupancy operations**
  - Added canonical occupancy helper `lib/session-room-occupancy.ts` with DB-time active predicate and reusable active-count diagnostics.
  - Added durable idempotent explicit disconnect operation in `lib/session-room-connection-lease.ts`.
  - Occupancy closure decisions now use DB `NOW()` for final active-connection checks.

- **A6 explicit leave and atomic last-disconnect closure**
  - Added explicit leave API endpoint `app/api/sessions/[sessionId]/presence/leave/route.ts`.
  - Corrected semantics: explicit leave is now invoked only from explicit user leave actions; generic heartbeat cleanup/unmount no longer calls `/presence/leave`.
  - LiveKit and Vox room leave handlers now call canonical explicit leave endpoint first, then provider disconnect/navigation.
  - Implemented atomic `DEBRIEF_OPEN -> CLOSED` compare-and-set update (`NOT EXISTS` active-connection subquery) in `closeDebriefRoomIfEmpty()`.
  - Added structured non-PII occupancy logging for disconnect/expiry closure outcomes.

## Recording stop orchestration notes

- Exactly one logical stop operation per recording is enforced by unique `recordingId` in `SessionRecordingStopOperation`.
- LiveKit stop delivery is server-authoritative and retryable via persisted operation state.
- Voximplant stop intent is durable and retryable server-side, but delivery still depends on browser relay in current architecture.
- Retry policy is bounded; unsupported browser-dependent flow now transitions to terminal operator-attention class `VOXIMPLANT_BROWSER_RELAY_REQUIRED_TERMINAL`.
- Webhook/provider completion remains authoritative for terminal recording finalization.

## A7/A8/A9 status in this checkpoint

- **A7 accepted architecture (bounded risk)**
  - Canonical FINISH/Event completion persists one durable `SessionRecordingStopOperation`.
  - Any eligible connected room client (facilitator, participant, observer) may relay the server-authorized stop operation by server-issued `operationId/requestId`.
  - Duplicate client relays converge on one operation and webhook finalization.
  - Scenario adds shutdown hardening (`ConferenceEvents.Stopped`, `AppEvents.Terminating`) without changing conference startup architecture.
  - Provider auto-termination remains fallback when no client can relay.
  - **Status:** accepted for Stage 3.10 Checkpoint A (`A7`), with explicit residual risk.
- **A8 bounded backfill and verification**: implemented rerunnable batch backfill + verification counters in maintenance command.
- **A9 restart/concurrency/rollback validation**: code-level protections and focused tests added; full deployment rollback rehearsal remains pending environment-level checkpoint review.

## Residual risks (accepted in A7)

1. All clients can disappear before seeing FINISHED/event close and before relay claim.
2. Clients can remain connected but fail relay transport (`sendMessage` unavailable, timing out, transient network/client failures).
3. Provider session termination can lag behind expected timing, extending recording window.
4. Debrief speech may still be captured until relay succeeds or provider session terminates.
5. Webhook delivery/finalization can be delayed.
6. Shutdown-handler webhook delivery is best effort under forced provider termination.

## Escalation conditions for deferred server-owned Vox control

- recurring debrief over-recording outside accepted window;
- repeated materially delayed stop finalization;
- privacy-boundary incidents tied to delayed stop;
- frequent event/session completion without relay-capable clients;
- observable provider cost growth from delayed termination;
- missing webhook past operational timeout threshold.

## Deferred backlog item (explicit)

- Implement true server-owned, no-browser VoxEngine stop transport for active conferences (without WebSDK client relay), including durable command ingress and runtime verification.

## Leave trigger inventory (correctness evidence)

- **Explicit leave API invoked**
  - `components/video-room-page.tsx`: explicit room leave button, control-bar leave, session-closed overlay leave.
  - `components/voximplant-negotiation-room-page.tsx`: explicit room leave button and session-closed overlay leave.
- **No explicit leave API invocation**
  - `components/session-room-presence-heartbeat.tsx` effect cleanup (refresh/unmount/navigation/page termination path).
  - stale-tab auto cleanup path in Vox room (`staleConnection` hook effect) only disconnects provider media; does not call `/presence/leave`.
- **Heartbeat touch path**
  - `POST /api/sessions/[sessionId]/heartbeat` remains only TTL-renewal caller.
- **Claim/validate paths**
  - room bootstrap and polling calls continue to use claim/validate via sidebar/control-state/access routes.

## Vox no-browser transport evidence table

| candidate_transport | supported_by_current_start_flow | required_identifier | identifier_currently_persisted | scenario_change_required | server_secret_required | retryable | works_without_browser | evidence |
|---|---|---|---|---|---|---|---|---|
| Browser `conference.sendMessage` relay | yes | active browser conference object | n/a server-side | no | no | yes (via stop operation retries waiting for browser path) | no | `lib/voximplant/use-voximplant-room.ts`, `lib/voximplant/recording-dispatch.ts`, `docs/architecture/05-voximplant-integration.md` |
| `media_session_access_url` HTTP control | not in current flow | `media_session_access_url` from StartScenarios/StartConference response | no | likely yes (add AppEvents.HttpRequest command handler hardening) | yes | potentially | unknown in current app | app currently starts conference through WebSDK join, not StartScenarios/StartConference control response persistence; no stored access URL in schema/routes |
| Management API direct “send to running conference” | no repository evidence | active session control handle | no | yes | yes | n/a | no evidence | `lib/voximplant/management-api.ts` implements identity/user management calls, no active-session message bridge |
| Server-owned scenario polling channel | no | durable server command pull endpoint/queue | no | yes | yes | potentially | potentially | no existing polling/control endpoint in scenario artifact; would be new architecture work |

## Remaining later checkpoints

- **Checkpoint B** guards/rejoin/redirects finalization.
- **Checkpoint C** administrative completion entry points and Sessions/Event UI updates.
- **Checkpoint D** full test matrix closure, docs completion, and gate evidence.

## Test catalog and traceability artifacts (Checkpoint A foundation)

- Scenario catalog: `docs/testing/stage-3-10-session-lifecycle-scenario-catalog.md`
- Traceability matrix: `docs/testing/stage-3-10-session-lifecycle-traceability.csv`
- Coverage gaps and manual canaries: `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md`
- Focused deterministic regression command: `npm run test:stage310`
- Focused browser subset command: `npm run test:stage310:browser`

Current traceability totals (recalculated from CSV):

- Total distinct scenarios: `70`
- `AUTOMATED`: `57`
- `MANUAL_PROVIDER_CANARY`: `3`
- `MANUAL_MULTI_BROWSER`: `2`
- `DEFERRED_WITH_REASON`: `8`
- `NOT_APPLICABLE`: `0`

Checkpoint status note:

- Stage 3.10 foundation/A7 is implemented and validated with deterministic non-provider automation.
- Full Stage 3.10 completion is not claimed; Checkpoint B/C UI and manual provider/multi-device canaries remain open.
