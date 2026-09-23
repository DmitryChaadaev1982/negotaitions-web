# Product Requirements

This is the canonical **active product contract** for NegotAItions.

Git commit `308c1c74eb355724fd3377354c07d9821a0cb3f1` is the
documentation-baseline evidence anchor: the production candidate from which
this contract was reconciled. It is a reference point. It does not freeze
this contract to that commit. This document remains the authoritative
product requirement contract after later commits. Update it when the product
contract changes.

It describes what the product must do. Current implementation is specified
in `docs/architecture/`. When the two diverge, preserve the requirement
here and record the conflict in `docs/FINDINGS.md`. Do not silently rewrite
this file to match accidental implementation.

Stage-labelled manifests under `docs/history/design-packets/requirements/`
are historical provenance, not current authority.

## How to read this document

| Kind | Meaning |
| --- | --- |
| Active requirement | Still binding |
| Implemented behavior | Current code matches; architecture owns the how |
| Deferred | Explicitly not in this baseline |
| Superseded | Must not be re-implemented |
| Ambiguous | Intent not resolvable from repository evidence |

## Product purpose

NegotAItions is a negotiation-training platform for case-based standalone
sessions and event-based training lobbies, with post-session transcript and
AI debrief workflows. The same Next.js application serves a public website
at `/`.

Public product name: Russian `ПереговорИИ (NegotAItions)`; English
`NegotAItions`. Do not display both brand names simultaneously in runtime
UI.

## Capabilities

The product must provide:

- Case authoring and reuse (`NegotiationCase`, `CaseRole`).
- Standalone sessions with role assignment and facilitator controls.
- Multi-session training events with lobby assignment.
- Live room runtime with explicit provider selection (`livekit` or
  `voximplant`). There is no application default provider.
- For Vox session rooms, recoverable network/media degradation is Layer-3
  connectivity, not logical Leave. SDK reconnect owns first-line transport
  recovery. A provider 408 log alone must not rejoin. Terminal conference
  Failed/Disconnected recovery must keep the same logical `connectionId`
  and heartbeat. A terminal disconnect during SDK reconnect is deferred, not
  lost. If SDK reconnect begins after terminal recovery has already started
  but before the new Conference joins, the same bounded attempt pauses and
  later resumes; it must not fail merely because recovery is already in
  flight. Old-generation Conference callbacks and released state watchers
  must not mutate current runtime or Layer-3 projection. `RemoteMediaRemoved`
  disposes that stream's liveness binding so a late ended callback cannot
  affect replacement media. SDK reconnect completion is edge-triggered and
  must not treat ordinary healthy SDK state callbacks as recovery or mark the
  room degraded solely because no remote endpoints exist. Usable live remote
  media must render immediately; recovery logic must not add blocking work on
  that path. When multiple Vox endpoints map to one logical participant
  (normalized Vox username), remote browsers must select current usable
  live media without Refresh. A stale stream object must not beat a live
  track. Video tiles and remote audio playback share one selected endpoint
  per logical participant; equal-quality overlap keeps the previously
  selected endpoint for both. Actual remote HTMLAudioElement playback is
  further limited to that endpoint's current projected audio stream
  (`remote.audioStream`); an obsolete same-endpoint stream is not playback
  eligible. Layer-1 presence remains independent of endpoint media health.
- Recording → raw transcription → optional enhancement → speaker mapping →
  AI analysis.
- Session materials with role-specific privacy projections.
- Account authentication, legal consent, and account-security email.

## Roles and authority

Account identity:

- `User.globalRole` is `USER` or `ADMIN`. Admin may also be granted by
  `ADMIN_EMAILS`.
- Legacy `User.role` (`FACILITATOR` / `PARTICIPANT` / `OBSERVER`) is not
  access-control authority.
- Session/event facilitator is domain-scoped: `Session.facilitatorId`,
  `TrainingEvent.hostUserId` / `facilitatorUserId`, and
  `SessionParticipant.type`.

Session management versus participation:

- Session owner/facilitator display is `Session.facilitatorId`.
- **Binding management authority:** ADMIN, Event host
  (`TrainingEvent.hostUserId`), Event facilitator
  (`TrainingEvent.facilitatorUserId`), and Session facilitator owner
  (`Session.facilitatorId`). Case owner membership is not management.
- Management is separated from participant projection. ADMIN does not need
  a facilitator `SessionParticipant` row to manage materials.
- **Ambiguous / not a proven product requirement:** whether a
  `SessionParticipant.type === "FACILITATOR"` account or join-token path
  may receive management when that identity is not `Session.facilitatorId`.
  Current code (`canManageSession`, `decideSessionManagementAuthorization`)
  grants that extra path. That is implementation reality, not a binding
  requirement. Do not treat the extra grant as product intent. See FIND-01.
- Negotiation **control** mutations remain stricter than management:
  facilitator participant whose `userId` matches `Session.facilitatorId`,
  plus lease/`controlToken`. Do not weaken control to match the extra
  management grant.
- Admin/manager materials **projection** may enrich the payload from a
  FACILITATOR `SessionParticipant` row. Which row to use when several exist
  is not a proven product requirement. Current code selects the earliest
  FACILITATOR row by `createdAt` for manager view, while reassignment uses
  `Session.facilitatorId`. See FIND-02.
- Presence stream `GET /api/sessions/{sessionId}/presence/stream` uses the
  implemented `canManageSession` helper (including the extra
  FACILITATOR-participant grant). Unauthenticated `401`; authenticated
  unrelated callers `404`. The stream ACL must not be read as proof that
  the extra grant is an intended product requirement.

AI publication versus transcript access:

- Published AI delivery requires a non-revoked grant bound to historical
  Session **room-shell** entry (`SessionRoomConnection` claim), not Event
  lobby presence and not confirmed live media.
- Transcript authorization is **not** aligned to that room-entry grant
  model. Observer transcript remains grant/projection based as implemented
  for materials; participant transcript remains membership-based. Do not
  “fix” transcript auth by copying AI publication eligibility.

Superseded: active-presence-at-Publish recipient rules. Do not restore them.

Canonical architecture: `09-security-and-access-control.md`,
`04-session-event-flow.md`, `08-ai-analysis-and-debrief.md`.

## Cases, sessions, events

- A `TrainingEvent` is the parent of Event-created Sessions
  (`Session.eventId`). Standalone Sessions have no `eventId`.
- Event completion is Event authority. Completing a child Session does not
  complete the Event. There is **no Event auto-close**. Past Events remain
  joinable under existing Event access rules.
- Dashboard Active/Archive grouping is **presentation only**, not
  authorization.
- Every newly created Event receives non-null `scheduledAt`. `NULL` is
  legacy compatibility only. Invalid datetime/timezone input is rejected,
  never rewritten to now.
- Standalone `START_PREPARATION` requires every assignable SessionRole slot
  occupied and every negotiation PARTICIPANT to have a valid
  `sessionRoleId`. FACILITATOR and OBSERVER are excluded. Failure is
  `409 STANDALONE_ROLES_NOT_READY`.

Canonical architecture: `02-domain-model.md`, `04-session-event-flow.md`.

## Room and lifecycle

Room lifecycle: `OPEN` → `DEBRIEF_OPEN` → `CLOSED`.

Negotiation states include Preparation, Ready to start, Running, Finished,
and paused variants. Product copy may say “room ready before Preparation”;
persisted enum for that pre-start room-ready state is `PREPARATION`.

Automatic Session close:

- Empty Debrief: `SESSION_DEBRIEF_EMPTY_CLOSE_MS` (default 60s).
- Debrief hard maximum: `SESSION_DEBRIEF_MAX_DURATION_MS` (default 2h).
- Abandoned: `SESSION_ABANDONED_CLOSE_MS` (default 3h).
- Event-created abandoned reference floors at `TrainingEvent.scheduledAt`.
- Single writer: `finalizeSessionCanonicalClose` /
  `completeSessionCanonical`.
- Abrupt tab close is not an explicit Leave. Occupancy uses durable leases.
  `pagehide` / `sendBeacon` must not open a new room lifecycle.

Occupancy SQL against Prisma `DateTime` (`timestamp without time zone`)
must compare using UTC wall-clock (`sqlUtcWallClockNow`). Production
PostgreSQL `TimeZone=Europe/Moscow` is expected.

Canonical architecture: `04-session-event-flow.md`,
`10-data-storage-and-retention.md`.

## Recording, transcription, enhancement

- One Recording and one Transcript per Session.
- Recording attempt identity (`recordingAttemptId`) fences delayed provider
  mutations. START persists the attempt before provider dispatch.
- `Recording.status = COMPLETED` is historical lifecycle truth. Missing
  object storage bytes do not rewrite that status to FAILED.
- Retranscribe must preload source bytes before admission. Missing object:
  `409 SOURCE_RECORDING_NOT_AVAILABLE`, zero material mutations.
- Canonical transcribe routes are materials `/transcribe` and
  `/retranscribe`. `/transcribe-recording` is a canonical adapter, not a
  silent failover.
- Raw transcript is persisted and viewable **before** enhancement (T1 then
  T2). Enhancement is a durable D1 job. Generation CAS fences completion
  writes.
- Enhancement publishes atomically only on all-success
  `terminalQuality=COMPLETED`. Partial must not mix enhanced and raw
  lexical text.
- Provider slots (`TranscriptEnhancementProviderSlot`, 10-row inventory)
  are the global concurrency authority (caps ≤10 global, ≤8 per job).
  Fail closed without a slot. Max 2 HTTP POSTs per chunk per run.
- Utterances larger than the piece budget are split deterministically and
  reconstructed to source `orderIndex`. Incomplete coverage fails closed.
- `PAUSE_PROCESSING_MODE=source_audio_cut` is the production default.
  Missing ffmpeg fails the run; no silent full-source fallback.
- `processingMetadata` namespace merge must not erase other subsystems.
- Facilitator transcript editing uses per-turn **Insert after**. There is
  no global Add-turn control.
- Large-realistic enhancement UAT: Skip is not Resume. UAT shares the
  same 10-slot inventory as application and Stage 3.10 maintenance.

Canonical architecture: `06-recording-transcription-pipeline.md`.

## Speaker mapping

- Auto-mapping after transcription is generation-fenced.
- Structurally complete `AUTO_SUGGESTED` mapping is informational, not an
  AI blocker. Start AI may persist CONFIRMED for a complete suggestion.
- Mapping writers merge only the mapping namespace in
  `processingMetadata`.

Canonical architecture: `07-speaker-mapping-and-telemetry.md`.

## AI analysis and debrief

- Start AI when the canonical projection says the transcript is usable,
  enhancement can no longer publish, and mapping is structurally complete.
- Owned operation: `QUEUED` → `202` → Next `after()` → `ANALYZING`.
  Route `maxDuration` is 610 seconds.
- Selected provider is exact; no cross-provider fallback.
- Yandex schema recovery: at most one extra same-prompt generation on
  `MODEL_SCHEMA_VALIDATION_ERROR`; row stays ANALYZING.
- Recovery WARNING `ExternalServiceEvent` rows are operator/forensic only,
  not a user-facing banner.
- Publication grants use historical room-shell entry. Unshare must drop
  the mounted recipient report without requiring navigation.
- Facilitator/observer notes are not in the AI input fingerprint.
  Participant preparation notes remain locked visible per the debrief
  notes matrix in `08-ai-analysis-and-debrief.md`.

Canonical architecture: `08-ai-analysis-and-debrief.md`.

## Public site, legal, analytics

- Public `/` is a marketing homepage, not a dashboard redirect.
- Current legal release `2026-08-v2` gates authenticated product entry
  when required consents are missing.
- No self-service account deletion UI; support mail is the channel.
- Cookie consent gates Yandex Metrica. Webvisor is not enabled.
- Next Image AVIF output stays disabled (`GHSA-2xp9-vwfh-vxw4`). Do not
  re-enable AVIF to restore a visual requirement.

Canonical architecture: `13-public-site-and-content.md`.

## Account security and email

- Cookie session `auth_session` / `UserSession`.
- Forgot-password is anti-enumerating. Only ACTIVE users receive a token.
- New passwords are 10 to 128 Unicode code points, with no composition rules.
  The server rejects a whole-password match against the local common-password
  denylist. Self-service change and email reset also reject the current
  password and the previous five passwords. Login does not apply that policy
  to an existing credential. Registration, account settings, and email reset
  show the same checklist for length, confirmation match, common passwords,
  and previous passwords. Length and match update while typing. The common
  and previous-password items stay unchecked until the server accepts that
  password or rejects the matching rule. The checklist does not expose or
  pre-approve the denylist or password history.
- There is no mass forced reset. `passwordChangeRequiredAt` is stored and not
  enforced. Administrator password reset is not available.
- Business code enqueues `EmailMessage`; workers send. Sending is disabled
  by default until explicitly enabled.
- Production Server Action origins are exactly `negotaitions.ru`.
  Local origins are development/test only.

Canonical architecture: `09-security-and-access-control.md`,
`account-security-email-flows.md`, `email-delivery-foundation.md`.

## Runtime and deployment constraints

- Typed runtime registry: required provider and origin settings have no
  silent application defaults.
- Production paths: `/var/www/negotaitions/app-git`, systemd
  `negotaitions-poc`, canary `GET /api/health`.
- Stage 3.10 maintenance is a separate process sharing enhancement slots.
- Session lifecycle timeouts must be set in **both**
  `/var/www/negotaitions/app/.env.production` and
  `/etc/negotaitions/env.production`.
- Production UI must not use native `window.confirm` / `prompt` /
  `alert`. Use in-app dialogs (`check:native-dialogs`).

Canonical architecture: `11-deployment-architecture.md`,
`03-application-architecture.md`.

## Testing constraints that are product requirements

- Automated PostgreSQL and Playwright use `E2E_DATABASE_URL`
  (`localhost:5433/negotiations_e2e`). No `DATABASE_URL` fallback.
- `validate:fast` must not run `*.pg.test.ts` or `tests/pg-race/**`.
- Managed Playwright defaults `VIDEO_PROVIDER=livekit` unless an explicit
  Vox matrix is selected.
- `POST_TRANSCRIPTION_LAB=1` skips realtime signaling and is ignored in
  production.
- Four managed Vox E2E identity slots; max one live login per slot.

Canonical quality doc: `QUALITY-AND-ACCEPTANCE.md`.

## Deferred

- Hierarchical AI summary/synthesis.
- Calendar purge of transcripts/AI in application code (operator erasure
  runbook only).
- Application-managed object-storage lifecycle APIs (operator 90-day
  bucket rule).
- Platform-wide “all data stays in Russia” claim. Voximplant Fastcom
  confirmation is Vox-scoped only.
- Pause-filter calibration harness changing production defaults.
- One-time `vox:orphan-cleanup` apply already executed; do not rerun
  without a new Change Unit.
- Enforcement of stored `passwordChangeRequiredAt`.
- Administrator-initiated password reset.
- Deletion of active `UserSession` rows when an administrator sets
  BLOCKED or REJECTED. Reset-token revocation on those transitions is
  current behavior.

## Implementation anchors

See `docs/architecture/code-map.md` for module, Prisma, and test owners.
