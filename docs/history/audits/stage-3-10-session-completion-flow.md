# Stage 3.10 — Session Completion Flow Audit (Finalized Product Decisions)

This document is the release audit for the implemented Stage 3.10 runtime,
migration, scenario, tests, and operational behavior.

This update finalizes target product decisions for:

- Session completion lifecycle and debrief policy;
- durable room closure and last-disconnect semantics;
- server-authoritative finish and recording-stop orchestration;
- administrative session completion from non-room surfaces;
- AI report publication status aggregation in Sessions overview;
- completed-Event lobby access and guard behavior.

This revision also adds four final technical clarifications:

- mandatory server-side abrupt-disconnect expiry execution;
- Event completion recording-stop orchestration semantics;
- safe additive and compatibility-first Prisma migration phases;
- one authoritative active-connection predicate for occupancy decisions.

Late observer admission is now explicitly split from re-entry:

- `OPEN` permits first-time observer participant creation for authorized event members.
- `DEBRIEF_OPEN` permits only re-entry for users who already have a `SessionParticipant`.
- `FINISHED`/`CLOSED` never permit first-time observer participant creation.
- room admission and materials access are separate decisions with separate URLs.
- direct `/room/[sessionId]` access is guarded server-side from creating late observers.

The audit now explicitly separates:

1. negotiation lifecycle;
2. room/debrief lifecycle;
3. recording/transcript/AI-processing lifecycle;
4. individual Session completion;
5. complete TrainingEvent closure.

Detailed artifacts are in:

- `docs/audits/stage-3-10-session-completion-flow/README.md`
- `docs/audits/stage-3-10-session-completion-flow/domain-state-model.md`
- `docs/audits/stage-3-10-session-completion-flow/facilitator-finish-flow.md`
- `docs/audits/stage-3-10-session-completion-flow/individual-leave-flow.md`
- `docs/audits/stage-3-10-session-completion-flow/presence-rejoin-and-last-disconnect.md`
- `docs/audits/stage-3-10-session-completion-flow/recording-finalization-order.md`
- `docs/audits/stage-3-10-session-completion-flow/race-condition-analysis.md`
- `docs/audits/stage-3-10-session-completion-flow/root-cause-analysis.md`
- `docs/audits/stage-3-10-session-completion-flow/recommended-target-state-machine.md`
- `docs/audits/stage-3-10-session-completion-flow/target-behavior-gap-analysis.md`
- `docs/audits/stage-3-10-session-completion-flow/implementation-backlog.md`
- `docs/audits/stage-3-10-session-completion-flow/implementation-prompt.md`

Sanitization constraints were applied to avoid committing PII, secrets, or raw provider payloads.

## Stage 3.10 Server-stop Production Delta

This audit baseline now maps to production server-side Vox stop rollout:

- Durable stop operation model is unchanged (`PENDING`, `DELIVERING`, `DELIVERED`, `FAILED` only).
- Intermediate provider evidence is now persisted in additive timestamp/evidence columns instead of introducing new operation states.
- Server callback replay protection uses hashed nonces (`VoximplantCallbackNonce`) with bounded expiry cleanup.
- Session-private control URL is moved to server-only `SessionVoximplantControlChannel` and is never emitted by public DTO routes.
- `DELIVERED` on the normal server path requires terminal provider callback evidence, not just control transport acceptance.
- `OPEN -> DEBRIEF_OPEN` transition ownership remains with canonical completion and does not wait on async provider callbacks.

## Stage 3.10 Consolidated follow-up (observer/presence/polling)

This follow-up keeps canonical completion semantics unchanged and documents the
consolidated fixes implemented on top of Stage 3.10:

- Late observer first-time creation now relies on canonical
  `decideSessionRoomAccess()` (`ALLOW_ACTIVE_ROOM`) and no longer adds a raw
  `roomLifecycle === OPEN` guard that incorrectly denies legacy nullable
  lifecycle rows resolved as active.
- Existing `SessionParticipant` re-entry to `DEBRIEF_OPEN` remains allowed
  (`ALLOW_DEBRIEF`) and does not create duplicate participant rows.
- Participant-facing lobby session lists are split semantically:
  1) My Sessions in This Event, 2) Active Sessions, 3) Sessions Without My
  Participation.
- Event-wide roster presence is derived from active room-connection leases
  (session location takes precedence over lobby heartbeat during transitions).
- Event overview participant statistics are defined as:
  lobby online unique users, in-session unique users, and total
  `EventParticipant` rows (no assignment-based in-session counting).
- Overview polling cadence was standardized to approximately 3000 ms for
  `/events`, `/sessions`, and `/cases`, with single non-overlapping pollers and
  immediate refresh on visibility/focus return.
- Room debrief notice is now explicit and persistent for externally finished
  sessions in `DEBRIEF_OPEN` mode (`data-testid="debrief-mode-notice"`), while
  the completed-event overlay behavior remains unchanged.

Out of scope (explicitly not fixed here): local reverse-tunnel / VPN transport
timeouts (`408`, temporary gateway transport unavailable, ICE restart rejected)
that recovered automatically in local tunnel environments.

## Stage 3.10.1 Presence + WebSDK Log Clarifications

Event overview presence definitions:

- `Lobby`: unique event users currently online in lobby heartbeat and not currently in an active session lease.
- `In Sessions`: unique users with canonical active `SessionRoomConnection` for this event.
- `Total Participants`: total `EventParticipant` rows in the event roster.

Canonical active session presence predicate:

- `disconnectedAt IS NULL`;
- `revokedAt IS NULL`;
- `supersededAt IS NULL`;
- `expiresAt > now`;
- connection belongs to a session of the same event.

Presence timing semantics:

- Explicit leave marks `disconnectedAt` immediately and should be visible in list stats in about 3-5 seconds (poll interval + request latency).
- Passive close/network loss is not an explicit leave: row remains counted until lease expiry.
- Lease validity window remains 120 seconds (`PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS`) before an abrupt disconnect is considered invalid.
- After definitive invalidation (`disconnectedAt` for explicit leave, `expiresAt` for expiry), empty-room reconciliation uses `DEBRIEF_AUTO_CLOSE_GRACE_MS` (default 30000 ms) before canonical closure/completion.

Session/lobby overlap semantics:

- If a user is both lobby-heartbeat online and has active session lease, classify as `In Sessions`.
- Multi-tab/multi-connection same user is deduplicated to one canonical in-session user (newest valid connection).

Events list polling/cache semantics:

- `/api/events/list` executes active-presence derivation per request and is force-dynamic.
- client poller replaces previous event list snapshot with latest API response; no stale merge retention.
- expected visibility: explicit leave in ~3-5 seconds, passive drop after lease expiry + one poll interval.

Voximplant WebSDK logger filtering:

- Filtering is scoped to WebSDK logger callback only (no global `console.error` override).
- Benign downgraded signatures:
  - `Cannot read properties of undefined (reading 'mids')` with `handleReInvite`/`ConferenceManager` context.
  - `Transport is not ready...` specifically for mute payload (`name = mute`).
  - `Can't find endpoint ... to change vad value` / `EndpointManagerImpl.setEndpointVad`.
- Downgraded entries are deduplicated per room runtime and reset on new runtime.

Errors intentionally never suppressed by this filter:

- `TransportTimeoutError` / code `408`.
- `Failed to connect to gateway`.
- `No transport established`.
- authentication/authorization failures.
- permissions/media-device failures.
- conference join failures.
- `IceRestartAction` / reinvite rejected failures.
- unknown non-matching `TypeError` and application errors outside WebSDK logger callback.

## Final Manual Canary Evidence

Manual M1-M7 validation completed successfully before final release
preparation:

- M1: facilitator canonical finish.
- M2: administrative finish without facilitator browser.
- M3: complete one Session from Event lobby.
- M4: complete Event with active recording.
- M5: explicit leave, logical presence, rejoin without duplication, active
  recording preservation, and live recorder ReInvite sanitization.
- M6: `CLOSED` Session stale tabs, direct-room access, and redirects.
- M7: recording, transcription, enhancement, speaker mapping, AI analysis,
  publication, and participant materials.

The remaining known provider issue is upstream emission of an unbacked recorder
ReInvite cause. The installed sanitizer is the mitigation and remains required
until the WebSDK/provider behavior is fixed and the recorder-rejoin canary
passes without it.
