# Stage 3.13E — Live Session Experience & UI Polish

## 1. Document status

- Stage: 3.13E
- Status: APPROVED DESIGN — READY FOR IMPLEMENTATION
- Base SHA: `4d80e3ecbe244c0cf112c09a0bec6589964e41c4`
- Branch: `feat/stage-3-13e-live-session-ux`
- Scope: Live Session Experience & UI Polish
- Production baseline: Stage 3.13D Wave 2 deployed and accepted

This document has been reviewed and approved by the project owner and is the
authoritative implementation contract for Stage 3.13E.

Classification vocabulary used in this document:

- **APPROVED REQUIREMENT** — product behavior supplied for Stage 3.13E.
- **VERIFIED CURRENT IMPLEMENTATION** — behavior confirmed in the repository at the base SHA.
- **DESIGN DECISION** — the recommended implementation contract.
- **DERIVED PRESENTATION STATE** — client presentation computed from authoritative data, not a database enum.
- **REQUIRED CODE CHANGE** — implementation work required after approval.
- **REQUIRED SCHEMA CHANGE** — Prisma/database work required after approval.
- **OPEN / BLOCKING QUESTION** — unresolved only when the repository cannot answer it.

## 2. Goals

**APPROVED REQUIREMENT**

- Give facilitators and participants a clear, shared live-session state experience.
- Keep preparation and negotiation timing server-authoritative.
- Require explicit preparation start and support authoritative preparation pause/resume.
- Add restrained visual and semantic audio transition cues.
- Show the same unmistakable 2,500 ms finish-line treatment after natural
  timer expiry and manual facilitator Finish, with semantically correct copy.
- Retain the existing timer/status card footprint.
- Persist a per-user session-sound preference, defaulted and backfilled to ON.
- Remediate live-room and lobby overlap/clipping at browser zoom and low effective resolution.
- Deliver the agreed lobby, materials-navigation, admin-diagnostic, transcript-status, and artifact-freshness fixes.

## 3. Non-goals

**APPROVED REQUIREMENT**

- npm vulnerability remediation.
- Prisma framework upgrade.
- `fluent-ffmpeg` replacement.
- Operating-system/package upgrades.
- Unrelated AI performance work.
- Email architecture changes.
- Unrelated production infrastructure.

## 4. Existing architecture

### Session domain and authoritative timers

**VERIFIED CURRENT IMPLEMENTATION**

- `prisma/schema.prisma` defines persisted `NegotiationState` values:
  `PREPARATION`, `PREPARATION_RUNNING`, `PREPARATION_PAUSED`,
  `READY_TO_START`, `RUNNING`, `PAUSED`, and `FINISHED`.
- New `Session` rows default to `PREPARATION`. Neither
  `app/actions/sessions.ts` nor `lib/create-event-session.ts` starts the
  preparation clock during creation.
- `Session` already persists a complete preparation timer:
  `preparationDurationSeconds`, `preparationStartedAt`,
  `preparationEndedAt`, `preparationTimerStartedAt`,
  `preparationPausedAt`, and `preparationTotalPausedSeconds`.
- It separately persists negotiation timing:
  `durationSeconds`, `negotiationStartedAt`, `negotiationEndedAt`,
  `timerStartedAt`, `pausedAt`, and `totalPausedSeconds`.
- `lib/negotiation-control.ts` is the shared timer/control abstraction.
  `computePreparationRemainingSeconds()` and `computeRemainingSeconds()`
  derive time from persisted timestamps and accumulated pause duration.
  The client does not decrement an authoritative local counter.
- `getControlUpdateData()` already implements explicit
  `START_PREPARATION`, `PAUSE_PREPARATION`, and `RESUME_PREPARATION`.
  It also implements `STOP_PREPARATION`, `SKIP_PREPARATION`, direct `START`,
  negotiation `PAUSE`, `RESUME`, and `FINISH`.
- `shouldAutoFinishPreparation()` moves expired preparation from
  `PREPARATION_RUNNING` to `READY_TO_START`.
- `shouldAutoFinish()` causes canonical completion when negotiation time
  reaches zero.
- Auto-transition reconciliation is request-driven, not scheduler-driven:
  `GET /api/sessions/[sessionId]/control-state` and control writes evaluate
  timer expiry against server time.

### Control and synchronization

**VERIFIED CURRENT IMPLEMENTATION**

- `app/api/sessions/[sessionId]/control/route.ts` validates control actions,
  resolves the authenticated room participant, applies room-access policy,
  optionally validates the current connection lease, and restricts controls
  to `ParticipantType.FACILITATOR`.
- `app/api/sessions/[sessionId]/control-state/route.ts` returns the shared
  `ControlState`, reconciles preparation/negotiation expiry, and invokes
  `completeSessionCanonical()` at negotiation zero.
- `lib/session-completion.ts` is canonical completion authority. It
  transactionally persists `FINISHED`, chooses `DEBRIEF_OPEN` or `CLOSED`,
  closes open negotiation pause intervals, and owns recording-stop intent.
- `lib/session-close-state.ts` maps any `FINISHED` negotiation immediately to
  a closed/debrief UI state.
- `components/video-room-page.tsx` and
  `components/voximplant-negotiation-room-page.tsx` fetch initial state and
  poll control state every 1,000 ms with `cache: "no-store"`.
- Polling also validates the single-active `SessionRoomConnection` lease.
  Refresh/rejoin claims a fresh connection; stale tabs stop normal room
  interaction while global close redirects retain precedence.
- There is no SSE control stream. Synchronization is one-second polling plus
  immediate facilitator action responses.
- Browser sleep/backgrounding can delay rendering and request-driven expiry,
  but the next response recomputes remaining time from persisted server
  timestamps; it does not continue from a stale local decrement.

### Pause/resume and recording

**VERIFIED CURRENT IMPLEMENTATION**

- Preparation pause/resume uses the same `Session` control abstraction as
  negotiation and freezes remaining time authoritatively.
- Negotiation `PAUSE`/`RESUME` additionally opens/closes
  `SessionPauseInterval` rows for downstream transcription/analysis
  exclusion. Preparation pauses correctly do not create those recording
  intervals.
- Repeated negotiation PAUSE while already paused and RESUME while already
  running are treated as no-ops, and pause-interval helpers are idempotent.
- Preparation duplicates do not have equivalent no-op handling.
- Session updates in the control route are ordinary `update()` calls after a
  prior read; they are not compare-and-swap writes. Two accepted requests can
  both compute from the same state. The per-client `isSubmitting` flag and
  active connection lease reduce, but do not eliminate, concurrency risk.
- The control request permits omitted `connectionId`; when omitted, lease
  validation is skipped. Production room clients provide it, while existing
  API tests often do not.
- `validateSessionRoomConnectionLease()` currently treats the absence of any
  active lease row as allowed with version zero. Interactive Stage 3.13E
  control writes require stricter semantics: an actual active lease row for
  the caller and supplied `connectionId` must exist and be current.

### `Session.updatedAt` control-CAS audit

**VERIFIED CURRENT IMPLEMENTATION — VERDICT: UNSAFE / TOO BROAD**

`Session.updatedAt` is a Prisma `@updatedAt` field and changes for every Prisma
write to the `Session` row, including writes unrelated to negotiation-control
ordering:

- `lib/livekit.ts::ensureSessionLiveKitRoomName()` writes
  `livekitRoomName` during initial LiveKit token creation/room entry.
- `app/actions/sessions.ts::syncSessionPrepStatus()` writes legacy
  `Session.status` after participant-list changes.
- `lib/session-facilitator.ts::reassignSessionFacilitator()` writes
  `facilitatorId`.
- `lib/create-event-session.ts` writes initial `Session.status` after creating
  an event session and its participants; this is initialization-time rather
  than a live control transition.
- `app/actions/sessions.ts::updateSessionDuration()` and
  `app/api/sessions/[sessionId]/duration/route.ts` write durations.
- `app/actions/sessions.ts::deleteSession()` writes `deletedAt`.
- `lib/session-room-occupancy.ts::maybeCloseDebriefRoomForOccupancy()` writes
  `roomLifecycle` and explicitly writes `updatedAt`.
- `lib/stage-3-10-maintenance.ts::runRoomLifecycleBackfill()` writes
  `roomLifecycle` for legacy rows.
- Session control, auto-preparation completion, and canonical completion also
  update the row, as expected.

Heartbeat/presence, media status, recording, participant notes, transcript
processing, and AI analysis write their own related models rather than
`Session`; they do not by themselves change `Session.updatedAt`. Nevertheless,
the LiveKit room-name and legacy status writers are enough to create false
control conflicts during room entry, so `Session.updatedAt` must not be the
Stage 3.13E control version.

**DESIGN DECISION — NARROW CONTROL SNAPSHOT CAS**

- Do not add a dedicated revision column. Build an opaque control-version
  token from a canonical snapshot of existing control-relevant fields.
- The snapshot includes `negotiationState`, both duration fields, all
  preparation and negotiation start/end/timer/pause timestamps, both
  accumulated pause-second fields, and access/lifecycle invariants
  (`facilitatorId`, `deletedAt`, `closedByEventAt`, `closedByEventId`,
  `closeReason`, and `roomLifecycle`).
- The server never trusts the token alone. It recomputes the token from the
  row it reads, compares it with the client's expected token, and performs a
  conditional `updateMany` (or equivalent atomic update) whose predicate
  includes the exact expected control snapshot and transition source state.
- A zero-row update means another relevant transition won. Refetch and return
  the current authoritative state; do not apply side effects.
- The conditional predicate must include the transition-specific timestamps,
  not merely the enum state, so a delayed PAUSE from an earlier RUNNING epoch
  cannot apply after a PAUSE/RESUME cycle returns to RUNNING.
- Interactive facilitator mutations must, in the same transaction/atomic
  decision, prove that the supplied `connectionId` identifies the active,
  unexpired, unsuperseded, unrevoked current facilitator lease. A preliminary
  lease check outside the mutation is insufficient on its own. The same
  decision must revalidate canonical room access/current facilitator identity,
  including any linked event closure state.
- Request-driven auto-transitions use the same narrow snapshot CAS without a
  facilitator lease; concurrent pollers allow one transition to win and the
  others refetch.

This mechanism requires no additional Prisma field or migration. A dedicated
`controlRevision` column was considered but rejected because the existing
control tuple provides a narrower atomic predicate without persisting
presentation or concurrency-only state. Implementing and testing this narrow
CAS is a Wave 1 prerequisite, not a product blocker.

### Room, lobby, and timer components

**VERIFIED CURRENT IMPLEMENTATION**

- `components/shared-room-shell.tsx` owns common provider-independent room
  orchestration, header, facilitator footer, media slot, sidebar, and debrief.
- `components/structured-video-layout.tsx` and
  `components/voximplant-video-layout.tsx` place the shared
  `components/room-timer-panel.tsx` in the media stage.
- The timer card is `w-full`, with `px-3 py-2` and `sm:px-4 sm:py-3`,
  `text-xl/sm:text-2xl` digits, and
  `text-xs/sm:text-sm` state text. It has no explicit fixed height; its
  footprint is constrained by the center column and content.
- Digits already use `font-mono` and `tabular-nums`.
- The timer shows only one phase timer at a time, despite its responsive
  one/two-column internal grid.
- The current `<=60` warning is color-only amber. There is no 10-second
  semantic state, animation contract, sound, `aria-live`, or reduced-motion
  behavior.
- In `READY_TO_START`, the RU string is “Можно начинать переговоры” and EN is
  “Ready to start negotiation”.
- `components/facilitator-room-controls.tsx` already shows explicit
  preparation start/pause/resume controls, but also exposes skip/stop and a
  direct “Start negotiation” button from `PREPARATION`.
- `components/shared-room-shell.tsx` changes to debrief as soon as a polled
  response reports `FINISHED`; no finish-line presentation exists.
- The room shell is `h-dvh overflow-hidden`. The right sidebar appears at
  `lg` with fixed `w-[28rem]` and `xl:w-[32rem]`. The Voximplant three-column
  stage also begins at `lg`. The facilitator footer is `shrink-0` and has no
  bounded internal vertical overflow.
- `components/event-lobby-view.tsx` already renders camera warnings only when
  provider device state reports an error. `deviceWarningLabel()` maps both
  camera error codes to the concise “Camera is busy or unavailable” /
  “Камера занята или недоступна”; the older long dictionary value is not used
  on this path.
- `components/event-lobby-voximplant-room.tsx` passes its normal provider
  status to `components/voximplant-media-controls.tsx`, which displays
  “Connected” / “Подключено” at the lower right even after stable connection.

### User preferences and authentication

**VERIFIED CURRENT IMPLEMENTATION**

- `User` has a direct persisted `preferredLocale`; there is no generic user
  preferences JSON/table and no session-sound field.
- `app/(app)/account/settings/page.tsx`,
  `components/account-settings-view.tsx`, and server actions in
  `app/actions/account.ts` / `app/actions/auth.ts` demonstrate the current
  direct-column preference convention.
- Runtime room access is authenticated. `lib/room-participant-resolver.ts`
  explicitly closes guest access; join tokens are authenticated invite-claim
  secrets, not guest identities. Room pages redirect unauthenticated users to
  login.
- Existing provider code already uses Web Audio for Voximplant silent-stream
  and microphone analysis and has an explicit user-gesture retry for blocked
  remote audio. There is no shared semantic UI-cue utility.

### Materials, lineage, publication, and diagnostics

**VERIFIED CURRENT IMPLEMENTATION**

- `Transcript.retranscribeCount` is the current transcript generation.
  `retranscribeHistory` archives previous text, mapping, completion time, and
  `processingMetadata`, including transcript-enhancement metadata.
- Transcript enhancement stores a deterministic `inputIdentity`, `runId`,
  raw-segment hash, model/output/schema/prompt identity, and terminal status
  under `Transcript.processingMetadata.transcriptEnhancement`.
- `AiAnalysis.transcriptId` and `transcriptRetranscribeCount` identify the
  transcript generation used by analysis.
- `isAiAnalysisOutdated()` currently compares only retranscription counts.
- Participant publication is a snapshot:
  `sharedAnalysisJson`, `sharedExecutiveSummary`, `sharedAt`, `sharedBy`, and
  `visibility`. Sharing never automatically follows a later analysis.
- `app/api/sessions/[sessionId]/materials/status/route.ts` exposes
  `analysisFromOlderTranscript`, but does not expose equivalent enhancement
  or publication freshness.
- Stage 3.13D Wave 2 made raw transcript persistence usable before optional
  enhancement and fenced enhancement writes. Current UI may correctly show
  usable transcript/mapping controls while an independent enhancement is
  genuinely running. This is not itself a pipeline mismatch. The wording
  should explicitly say “Transcript ready; AI enhancement in progress” so
  readiness and enhancement are not presented as mutually exclusive.
- `lib/account-session-materials.ts` and
  `components/account-session-materials-view.tsx` already show an “Open room”
  action for non-finished active sessions. Their `canReturnToRoom` helper
  excludes all `FINISHED` sessions and does not use `RoomLifecycle`, so it
  cannot distinguish `DEBRIEF_OPEN` from `CLOSED`.
- `components/admin-diagnostics-view.tsx` loads
  `GET /api/admin/health`, renders environment groups, and invokes separate
  admin-only POST check routes. Existing checks cover LiveKit, storage,
  OpenAI, ffmpeg, and Voximplant.
- The diagnostics quick-link labelled Mail/Email currently links to
  `/admin/email`, duplicating the Email Journal navigation. Environment groups
  have no stable per-group anchors.
- All existing check routes call `apiRequireAdminUser()` before provider work.
  `lib/services/admin-env-display.ts` serializes no secret values.

## 5. Existing state-transition model

```text
Session creation
  -> PREPARATION (timer not started)
       -> START_PREPARATION -> PREPARATION_RUNNING
            <-> PREPARATION_PAUSED
            -> expiry / STOP_PREPARATION -> READY_TO_START
       -> STOP_PREPARATION / SKIP_PREPARATION -> READY_TO_START
       -> START -> RUNNING (direct preparation bypass)
       -> FINISH -> FINISHED

READY_TO_START
  -> START -> RUNNING
  -> FINISH -> FINISHED

RUNNING
  <-> PAUSED
  -> FINISH or server-observed timer zero
  -> FINISHED + DEBRIEF_OPEN/CLOSED
  -> immediate debrief presentation

The current API-level FINISH transition also accepts
PREPARATION_RUNNING/PREPARATION_PAUSED, although the normal facilitator UI
uses STOP_PREPARATION for preparation completion.
```

## 6. Stage 3.13E target experience

**APPROVED REQUIREMENT**

```text
ROOM_READY
  -> facilitator explicitly starts preparation

PREPARATION_RUNNING
  <-> PREPARATION_PAUSED
  -> facilitator finishes preparation early
     or preparation expires

WAITING_FOR_NEGOTIATION_START
  -> facilitator explicitly starts negotiations

NEGOTIATION_RUNNING
  <-> NEGOTIATION_PAUSED
  -> FINAL_MINUTE presentation at <= 60 seconds
  -> FINAL_10_SECONDS presentation at <= 10 seconds
  -> zero

FINISH_LINE / TIMER_EXPIRED for exactly 2,500 ms after authoritative completion
  or
FINISH_LINE / MANUAL_FINISH for exactly 2,500 ms after authoritative completion
  -> FINISHED / DEBRIEF with the timer/status card retained
```

`ROOM_READY`, `WAITING_FOR_NEGOTIATION_START`, `FINAL_MINUTE`,
`FINAL_10_SECONDS`, and both `FINISH_LINE` variants are UX names. They do not
require new persisted enum values. The existing persisted states are
sufficient.

## 7. Final state mapping

| UX state | Authoritative source | Persisted or derived | Participant presentation | Facilitator presentation | Available facilitator actions | Timer behavior | Audio event | Notes |
|---|---|---|---|---|---|---|---|---|
| ROOM_READY | `negotiationState=PREPARATION` | Persisted source, UX alias | Title: Waiting for preparation; subtitle: Facilitator will start shortly | Same title; subtitle: Check participants and connection | Start preparation; edit durations | Full preparation duration, not running | None | No Start negotiation; no Skip preparation |
| PREPARATION_RUNNING | `PREPARATION_RUNNING` + preparation timestamps | Persisted | Preparation in progress | Preparation in progress | Pause preparation; Finish preparation | Server-derived countdown | None | Early Finish moves authoritatively to READY_TO_START |
| PREPARATION_PAUSED | `PREPARATION_PAUSED` + `preparationPausedAt` | Persisted | Preparation paused; wait for facilitator | Preparation paused | Resume preparation; Finish preparation | Frozen server-derived value | None | No preparation audio |
| WAITING_FOR_NEGOTIATION_START | `READY_TO_START` | Persisted source, UX alias | Preparation complete; waiting for facilitator | Preparation complete | Start negotiation | Full negotiation duration, not running | None | Reached by expiry or Finish preparation |
| NEGOTIATION_RUNNING | `RUNNING`, remaining > 60 | Persisted source + derived remaining | Negotiations in progress | Negotiations in progress | Pause; Finish | Server-derived countdown | START on observed READY_TO_START -> RUNNING | Initial hydration silent |
| NEGOTIATION_PAUSED | `PAUSED` | Persisted | Negotiations paused | Negotiations paused | Resume; Finish | Frozen server-derived value | PAUSE / RESUME on observed transition | Recording continuity unchanged |
| FINAL_MINUTE | `RUNNING`, 10 < remaining <= 60 | **DERIVED PRESENTATION STATE** | 1 minute remaining | Same | Pause; Finish | Continues; card does not grow | One 60-second cue | State text, not color only |
| FINAL_10_SECONDS | `RUNNING`, 0 < remaining <= 10 | **DERIVED PRESENTATION STATE** | Final 10 seconds | Same | Pause; Finish | Continues; restrained digit emphasis | One urgent two-tone cue | Reduced motion respected |
| FINISH_LINE / TIMER_EXPIRED | authoritative `FINISHED`, `remainingSeconds=0`, fresh `negotiationEndedAt` deadline | **DERIVED PRESENTATION STATE** | Time is up; negotiations complete | Same; no controls | None | May show `00:00`; no active countdown | END once | Same strong treatment; exactly 2,500 ms from authoritative end |
| FINISH_LINE / MANUAL_FINISH | authoritative `FINISHED`, `remainingSeconds>0`, fresh `negotiationEndedAt` deadline | **DERIVED PRESENTATION STATE** | Negotiations complete | Same; no controls | None | Do not show `00:00` or imply expiry | END once | Same strong treatment; exactly 2,500 ms from authoritative end |
| FINISHED / DEBRIEF | `FINISHED` + room lifecycle after finish-line deadline | Persisted source + elapsed presentation deadline | Debrief/materials with persistent status card | Same | No negotiation controls | Frozen final time (`00:00` for expiry or authoritative remaining time for manual Finish) | None on hydration | Uses neutral `status-debrief.png`; `DEBRIEF_OPEN` remains re-enterable; `CLOSED` redirects |

## 8. ROOM_READY and preparation lifecycle

**DESIGN DECISION**

- Map persisted `PREPARATION` directly to `ROOM_READY`.
- Do not add a `ROOM_READY` enum or timestamps.
- Preparation must start only through authoritative `START_PREPARATION`.
- Keep duration editing only in `ROOM_READY`; tighten the duration route so a
  stale/malicious request cannot alter an active or completed preparation.
- Remove the direct negotiation START button from ROOM_READY and reject START
  from persisted `PREPARATION`.
- Remove `SKIP_PREPARATION` from the normal room UX and accepted product
  control contract.
- Retain `STOP_PREPARATION` from both `PREPARATION_RUNNING` and
  `PREPARATION_PAUSED`, presented as “Finish preparation” /
  “Завершить подготовку”. It closes an active pause if necessary, records
  `preparationEndedAt`, and authoritatively moves to `READY_TO_START`.
- An intentional effective skip is therefore two visible transitions:
  START_PREPARATION followed by STOP_PREPARATION. Do not bypass preparation.
- Restrict interactive negotiation `FINISH` to `RUNNING` or `PAUSED`.
  Preparation completion uses STOP_PREPARATION; WAITING_FOR_NEGOTIATION_START
  has only START. Internal canonical event closure remains a separate
  organizer lifecycle operation.
- Continue to use existing preparation start/pause/resume fields and
  `computePreparationRemainingSeconds()`.
- Do not create `SessionPauseInterval` rows for preparation pauses.

**REQUIRED CODE CHANGE**

- Add the narrow control-snapshot token specified in section 4 and require
  clients to send the expected token and state with writes.
- Apply state changes with the exact snapshot conditional update/CAS. Exactly
  one concurrent request wins; a loser receives/refetches the current
  authoritative state.
- Treat same-state duplicate start/pause/resume responses as idempotent no-ops
  only when they match the accepted control snapshot. Do not let a delayed
  old PAUSE reapply after a later RESUME.
- Require the current room `connectionId` for interactive control writes and
  atomically prove the strict active lease during mutation. Existing legacy
  and API test callers that omit `connectionId` must be migrated to claim and
  send a lease; their omission does not weaken the production contract.
- Preserve immediate action-response updates, then let one-second polling
  reconcile every client.
- Reconnect, refresh, browser wake, and rejoin load remaining preparation time
  from server timestamps. No client-only preparation countdown is permitted.

## 9. Negotiation lifecycle

**DESIGN DECISION**

- Preparation expiry remains an authoritative transition to
  `READY_TO_START`, presented as WAITING_FOR_NEGOTIATION_START.
- Facilitator STOP_PREPARATION is an equally authoritative early-completion
  transition to `READY_TO_START`; it is not a direct negotiation start.
- Negotiation starts only through facilitator `START` from `READY_TO_START`
  after existing recording-consent confirmation.
- Keep negotiation PAUSE/RESUME/FINISH, `SessionPauseInterval`, and recording
  continuity semantics.
- Move any externally visible provider-start side effect behind a successful
  state CAS/idempotent claim so concurrent START requests cannot initiate
  duplicate work.
- At zero, `control-state` continues to call
  `completeSessionCanonical(reason="AUTO_TIMER_FINISH")` immediately. Do not
  delay backend FINISHED, recording stop, or control disablement for UI.

## 10. TIME_EXPIRED / FINISH_LINE completion transition

**DESIGN DECISION**

Use one ephemeral `FINISH_LINE` presentation after every authoritative
negotiation completion. It has two semantic variants:

- `TIMER_EXPIRED` when authoritative final `remainingSeconds` is zero.
- `MANUAL_FINISH` when facilitator Finish completes the negotiation with
  authoritative final `remainingSeconds` greater than zero.

Do not add a persisted FINISH_LINE, TIMER_EXPIRED, or MANUAL_FINISH state.

- Extend the shared control response DTO returned by control GET/POST paths
  with `negotiationEndedAt` and `serverNow` (ISO timestamps) plus the existing
  final `remainingSeconds`.
- Derive FINISH_LINE only when:
  - authoritative state is `FINISHED`;
  - `negotiationEndedAt` exists; and
  - `serverNow - negotiationEndedAt < 2,500 ms`.
- The deadline is authoritative end time plus exactly **2,500 ms**, not 2,500
  ms after each client first notices it.
- On receipt, calculate `remainingPresentationMs` as
  `clamp(2500 - (serverNow - negotiationEndedAt), 0, 2500)` and anchor the
  local timeout to receipt time plus that remainder. Subsequent responses may
  shorten/correct that deadline but must never restart it.
- TIMER_EXPIRED may render `00:00`, “Time is up” / “Время истекло”, and
  “Negotiations complete” / “Переговоры завершены”.
- MANUAL_FINISH renders “Negotiations complete” / “Переговоры завершены” and
  may use a concise transition-to-debrief subtitle. It must not show `00:00`
  or otherwise imply that time expired. Suppress the inactive countdown and
  use a fixed-size completion mark/title in the same card slot.
- Both variants use exactly the same strong border/background/icon treatment,
  visual prominence, card dimensions, and 2,500 ms duration. Semantic copy is
  the only meaningful presentation difference.
- Hide/disable facilitator negotiation controls as soon as authoritative
  FINISHED is received. `sessionCloseState` remains authoritative.
- A canonical CLOSED redirect or organizer/event hard close takes precedence
  over FINISH_LINE; the completion presentation applies to timer expiry and
  room facilitator Finish while canonical room/debrief access remains
  available.
- Delay only the local debrief panel presentation until the remaining
  deadline; do not delay completion or recording stop.
- Keep the timer/status card mounted after that deadline. Replace the strong
  finish-line copy/badge with neutral Debrief copy, `status-debrief.png`, and
  the frozen authoritative final time.
- Play END once only on a live observed active/paused -> FINISHED transition,
  when the finish-line deadline is still current and sound is
  enabled/unlocked. This applies equally to timer expiry and manual Finish.
- A client initially hydrating into FINISHED is silent. If it joins/reloads
  inside the authoritative 2,500 ms window, it may show the remaining
  finish-line visual time but must not replay END. After the window it goes
  directly to debrief/materials while retaining the neutral status card.
- On reconnect, use the server timestamp, not remount time.
- Multiple clients calculate the same deadline and independently render it.
- On `visibilitychange`, compare the deadline immediately. A backgrounded tab
  resuming after the deadline skips to debrief and does not replay END.

This preserves backend safety and solves late-join/reload/background behavior
without a new domain state.

## 11. Timer/status card design contract

**APPROVED REQUIREMENT**

The existing `RoomTimerPanel` footprint is fixed for Stage 3.13E. No
implementation may casually increase it.

**VERIFIED CURRENT IMPLEMENTATION**

- Component: `components/room-timer-panel.tsx`.
- Container: full available width, rounded card, `px-3 py-2`,
  `sm:px-4 sm:py-3`.
- Digits: `font-mono text-xl sm:text-2xl font-semibold tabular-nums`.
- State: `text-xs sm:text-sm`; optional subtitle
  `text-[10px] sm:text-xs`.
- No fixed pixel width/height is declared; stage geometry supplies the width.
- Existing dimensions can be retained.

**DESIGN DECISION**

- Retain all container padding, digit size, responsive size, and enclosing
  stage geometry unless a measured defect proves a change is unavoidable.
- Keep one concise title and at most one concise subtitle.
- Use border, icon/text, and tone together; never use color alone.
- FINAL_MINUTE: amber border/tone plus “1 minute remaining”.
- FINAL_10_SECONDS: stronger rose/amber border/tone plus “Final 10 seconds”.
- Both FINISH_LINE variants: the same high-contrast completion
  border/background/icon and explicit text. TIMER_EXPIRED may show `00:00`;
  MANUAL_FINISH must not imply expiry.
- A small transform on digits is allowed because transforms do not reflow or
  grow the card. Use one restrained transition/entry emphasis, not a
  per-second flash.
- Under `prefers-reduced-motion: reduce`, remove digit scaling/animation and
  retain static emphasis.

Concise card strings:

| State | EN title | EN subtitle | RU title | RU subtitle |
|---|---|---|---|---|
| ROOM_READY participant | Waiting for preparation | Facilitator will start shortly | Ожидание подготовки | Фасилитатор скоро начнёт |
| ROOM_READY facilitator | Waiting for preparation | Check participants and connection | Ожидание подготовки | Проверьте участников и связь |
| PREPARATION_RUNNING | Preparation in progress | — | Идёт подготовка | — |
| PREPARATION_PAUSED | Preparation paused | Waiting for facilitator | Подготовка на паузе | Ждём фасилитатора |
| WAITING_FOR_NEGOTIATION_START | Preparation complete | Waiting for facilitator | Подготовка завершена | Ждём старта фасилитатора |
| NEGOTIATION_RUNNING | Negotiations in progress | — | Переговоры идут | — |
| NEGOTIATION_PAUSED | Negotiations paused | — | Переговоры на паузе | — |
| FINAL_MINUTE | 1 minute remaining | — | Осталась 1 минута | — |
| FINAL_10_SECONDS | Final 10 seconds | — | Последние 10 секунд | — |
| FINISH_LINE / TIMER_EXPIRED | Time is up | Negotiations complete | Время истекло | Переговоры завершены |
| FINISH_LINE / MANUAL_FINISH | Negotiations complete | Debrief is next | Переговоры завершены | Далее — дебрифинг |
| FINISHED | Debrief | You can discuss the meeting results | Дебриф | Можно обсудить результаты встречи |

## 12. Audio UX contract

**APPROVED REQUIREMENT**

Semantic cues:

- negotiation START;
- negotiation PAUSE;
- negotiation RESUME;
- 60 seconds remaining;
- 10 seconds remaining;
- END.

**DESIGN DECISION**

- Preparation is completely silent in Stage 3.13E: no start, pause, resume, or
  completion cue. Preparation remains visible and accessibly announced.
- Implement a small provider-independent Web Audio utility; do not add media
  assets or npm dependencies.
- Lazily create one provider-independent shared `AudioContext`. Prime it on a
  trusted pointer/keyboard gesture used to navigate into `/room/...`, and
  reuse it from the mounted room sound controller.
- Also attempt resume on room mount and on the first trusted pointer/keyboard
  gesture inside the room. A short inaudible oscillator primes the graph in
  the same gesture for browser autoplay compatibility.
- The visible button follows the persisted preference: ON is green and OFF is
  red. Runtime readiness is exposed separately as
  `data-audio-runtime=running|awaiting-user-gesture`; a blocked browser context
  must not make the persisted default-ON preference appear OFF.
- If the preference is ON but runtime is not ready, the first button click
  unlocks audio and leaves the preference ON. Once runtime is ready, the same
  button toggles the preference OFF.
- A cue that occurred while blocked is discarded. Enabling sound seeds the
  current transition refs and must not replay any historical cue.
- Generate cues with oscillator(s) and a gain envelope: short attack, short
  decay, an audible restrained master gain, and total duration roughly
  120–450 ms.
- START/RESUME use an upward tonal direction; PAUSE uses downward direction;
  60 seconds uses one mild tone; 10 seconds uses a clear short two-tone cue;
  END uses a distinct short completion cadence.
- Exact frequencies may be tuned during manual acceptance.
- No per-second beep, siren, voice, long melody, or preparation-complete cue.
- Do not reuse provider microphone-analysis contexts. The shared semantic
  context survives client-side room navigation so entry-gesture unlock is not
  lost before the room hook mounts.

## 13. Audio event deduplication

**DESIGN DECISION**

Use one provider-independent room hook/controller with previous authoritative
snapshot refs:

- First successful state hydration seeds refs and is always silent.
- START: previous `READY_TO_START`, current `RUNNING`.
- PAUSE: previous `RUNNING`, current `PAUSED`.
- RESUME: previous `PAUSED`, current `RUNNING`.
- 60 seconds: same running epoch, previous remaining > 60 and current <= 60.
- 10 seconds: same running epoch, previous remaining > 10 and current <= 10.
- END: previous active state (`RUNNING` or `PAUSED`), current `FINISHED`, for
  both TIMER_EXPIRED and MANUAL_FINISH.

Additional guards:

- Compare state plus `timerStartedAt`/control-snapshot token so a new run
  cannot inherit threshold refs from an old render.
- Identical poll responses and render loops do nothing.
- If one delayed response crosses both thresholds, play only the most urgent
  still-current cue; never stack 60- and 10-second cues.
- Threshold cues are allowed only within normal polling jitter (current value
  at threshold or at most approximately two seconds below it) and while the
  document is visible. A browser waking much later does not replay history.
- Refresh, reconnect, and React remount reseed silently.
- Preference changes and AudioContext unlock do not replay the current state.
- END is additionally gated by the authoritative 2,500 ms completion window.

## 14. Persisted sound preference

**VERIFIED CURRENT IMPLEMENTATION**

`User.preferredLocale` is the only comparable persisted UI preference. There
is no settings JSON/table. Runtime guests do not exist.

**REQUIRED SCHEMA CHANGE**

Add a direct boolean to `User`:

```prisma
sessionSoundEnabled Boolean @default(true)
```

Migration contract:

- Add a non-null boolean column with database default `true`.
- The migration must leave every existing user row as `true`.
- New users inherit `true`.
- Verify zero false/null rows immediately after migration in staging.
- Keep the default on rollback planning; dropping the column loses only a
  preference, not session correctness.

**REQUIRED CODE CHANGE**

- Add an authenticated self-only preference GET/PATCH route or equivalent
  typed server action. Validate a boolean body and update only the current
  user.
- Load the preference once when entering the room; do not add a user query to
  every one-second control poll.
- Add a compact, accessible notifications control immediately after camera in
  the room media controls. It renders persisted preference ON as green and OFF
  as red; technical AudioContext readiness remains separately inspectable.
- Preference changes persist before confirming success and may optimistically
  update with rollback on failure. A click while preference is already ON but
  runtime is blocked creates/resumes the `AudioContext` without turning the
  preference OFF.
- No room or control functionality depends on sound.
- Because production room access requires an authenticated account, no guest
  persistence fallback is needed. If guest room access is reintroduced in a
  later stage, default ON for that visit and use non-authoritative local
  fallback only for the guest; do not redesign authentication here.

## 15. Accessibility contract

**DESIGN DECISION**

- Put transition text in a dedicated `role="status" aria-live="polite"
  aria-atomic="true"` region.
- Do not put changing timer digits inside an assertive live region.
- Timer digits remain inspectable with a non-live accessible label, but each
  second is not automatically announced.
- Announce only: preparation started/paused/resumed, negotiations
  started/paused/resumed, one minute, ten seconds, time expired, and manual
  negotiation completion.
- Initial hydration is not announced as a transition.
- Use explicit text/icon/border in addition to color.
- No flashing and no focus movement.
- The sound control exposes its persisted and browser-unlock state with an
  accessible name/state. Enable sound is keyboard-operable, non-modal, and
  does not move focus after activation.
- Respect `prefers-reduced-motion`; both FINISH_LINE variants remain equally
  obvious without animation.

## 16. Responsive and browser-zoom contract

**VERIFIED CURRENT IMPLEMENTATION / ROOT CAUSE**

- The `h-dvh overflow-hidden` room shell gives all headers, observer rail,
  video stage, facilitator controls, media controls, and diagnostics one fixed
  vertical budget.
- At `lg`, the fixed 28 rem sidebar and Voximplant three-column stage activate
  even at approximately 1,024 CSS pixels. This is especially tight at
  1280x720/125%.
- The fixed-height observer rail consumes 10–11.75 rem before the main stage.
- The facilitator footer is non-shrinking and can wrap but has no bounded
  internal scroll. At low effective height it can squeeze the media stage to
  clipping.
- The room header action cluster does not wrap or provide an overflow
  strategy.
- Below `lg`, the right sidebar disappears entirely; this avoids collision but
  is not tested as a deliberate zoom behavior.
- Existing observer layout coverage tests rail/stage/sidebar geometry at raw
  viewports, but not facilitator-control reachability, timer visibility, or
  browser-zoom effective viewports.

**REQUIRED CODE CHANGE**

- Move the fixed right sidebar and Vox three-column desktop stage from `lg`
  to `xl`; prefer the existing vertically scrollable compact structures below
  `xl`.
- At short effective heights, compact the observer rail and bound the
  facilitator footer with internal vertical scrolling so controls remain
  reachable without page-level overlap.
- Make the header action cluster wrap/compact without horizontal page overflow.
- Do not change timer-card internal dimensions.
- Keep media/sidebar overflow contained; no page-level horizontal scroll.
- A desktop sidebar may disappear visually only when every functionally
  meaningful item it contains remains reachable through a responsive
  alternative. Reuse a suitable existing alternate/compact layout where
  available; otherwise use the smallest appropriate drawer, collapsible
  panel, or compact section.
- Validate that no mandatory control and no meaningful sidebar function
  becomes inaccessible at any breakpoint or zoom level.

Required matrix:

| Physical viewport | Browser zoom |
|---|---|
| 1920x1080 | 100%, 125% |
| 1366x768 | 100%, 125%, 150% |
| 1280x720 | 100%, 125%, 150% |

Acceptance at every point:

- no overlap or clipping;
- facilitator actions reachable;
- timer visible;
- video stage and side panels do not collide;
- mandatory media/session controls usable;
- all meaningful desktop-sidebar functions reachable through the displayed
  layout or its responsive alternative.

Automated tests should also use corresponding effective CSS viewports
(approximately 1536x864, 1093x614, 911x512, 1024x576, and 853x480) while the
manual matrix uses real browser zoom.

Applicable suites:

- `npm run test:e2e:observer:smoke`;
- `npm run test:e2e:observer:layout` once before deployment, because this
  Stage changes room breakpoints, shell geometry, observer rail sizing, and
  stage overflow;
- a focused Stage 3.13E room/lobby zoom spec that asserts timer/control boxes
  do not intersect and remain inside the viewport.

## 17. Lobby cleanup

**VERIFIED CURRENT IMPLEMENTATION**

- LiveKit reports actual acquisition failures through
  `EventLobbyMediaPublisher` and local toggles in
  `components/event-lobby-video-room.tsx`.
- Voximplant reports recoverable camera/device acquisition errors through
  `cameraUnavailable` and `onDeviceWarning` in
  `components/event-lobby-voximplant-room.tsx`.
- `EventLobbyView` already conditionally renders only a concise camera warning.

**DESIGN DECISION / REQUIRED CODE CHANGE**

- Retain provider-reported device state; do not invent permission heuristics.
- Remove the obsolete long `events.cameraUnavailable` copy if no other live
  consumer remains, and keep the concise conditional label.
- Clear the warning only after successful device enable/reacquisition.
- Stop passing the stable “Connected” status to lower-right media controls.
  Keep connecting, retrying, disconnected, and error states in their existing
  dedicated banners/empty states. Normal mic/camera controls already prove
  successful connection sufficiently.

## 18. Materials navigation

**VERIFIED CURRENT IMPLEMENTATION**

- Route: `/sessions/[id]/materials`.
- Return route: `/room/[sessionId]`.
- Active non-finished sessions already receive an Open room action.
- `decideSessionRoomAccess()` authoritatively distinguishes
  `ALLOW_ACTIVE_ROOM`, `ALLOW_DEBRIEF`, and closed redirects.
- Current materials data does not select/use `roomLifecycle`, so FINISHED
  `DEBRIEF_OPEN` is treated like fully closed FINISHED.

**DESIGN DECISION**

- Show “← Back to session” / “← Назад к сессии” when the same canonical access
  decision is anything other than CLOSED: specifically `ALLOW_ACTIVE_ROOM` or
  `ALLOW_DEBRIEF`.
- Include `roomLifecycle`, event status, and closure fields needed by the
  shared access decision; do not duplicate a looser client heuristic.
- Hide the action only when canonical access is CLOSED or canonical room
  access redirects because the room is no longer available, including
  deleted/event-closed cases. Retain lobby/session-list/materials navigation
  in those cases.

## 19. Admin diagnostics

### Mail navigation

**REQUIRED CODE CHANGE**

- Replace the diagnostics quick-link that currently points to `/admin/email`
  with an in-page Mail environment/configuration anchor.
- Give the Mail environment `<details>` group a stable ID and open/scroll it
  when targeted.
- Keep the top-level Email Journal navigation unchanged.

### SpeechKit check

**DESIGN DECISION**

- Add admin-only `POST /api/admin/check-yandex-speechkit`.
- Reuse the configured SpeechKit base URL, API-key/folder headers, and a hard
  abort timeout (target 5 seconds).
- Issue a bounded `getRecognition` lookup with a generated nonexistent
  operation ID. A sanitized “operation not found” from the authenticated
  service proves DNS/TLS/auth/service reachability without creating a
  transcription job or uploading audio.
- Treat auth/config/network/timeout as categorized, sanitized failure. Never
  return request headers, API keys, folder secrets, or provider raw bodies.

### Yandex AI / DeepSeek check

**DESIGN DECISION**

- Add admin-only `POST /api/admin/check-yandex-ai`.
- Use the same base URL and headers as the analysis client, with a hard abort
  timeout (target 5 seconds).
- Perform a bounded models/catalog GET and verify the configured model name is
  present. Do not create a response/generation.
- Return only a bounded status code/category and safe configured model name.

Both checks follow existing `apiRequireAdminUser()` authorization, existing
button/result UI shape, `503` unhealthy semantics, and no-secret diagnostics.

## 20. Derived-artifact freshness

**VERIFIED CURRENT IMPLEMENTATION**

- Current transcript version: `Transcript.retranscribeCount`.
- Historical enhancement lineage:
  `Transcript.retranscribeHistory[].version` plus archived
  `processingMetadata.transcriptEnhancement.inputIdentity/status`.
- Current enhancement lineage:
  current `processingMetadata.transcriptEnhancement.inputIdentity`, raw hash,
  run ID, and status.
- Analysis lineage: `AiAnalysis.transcriptId` and
  `transcriptRetranscribeCount`.
- Publication snapshot lineage: current analysis row plus
  `sharedAnalysisJson`, `sharedAt`, and `visibility`.

**DESIGN DECISION**

- Define current transcript version as `(Transcript.id, retranscribeCount)`.
- Enhancement CURRENT:
  the enhancement metadata belongs to the current completed transcript
  generation/input identity.
- Enhancement STALE:
  a new retranscription generation has started while the retained/archived
  enhancement belongs to the immediately older generation. Old output may
  remain visible but receives an explicit stale badge; once replaced by new
  raw/enhanced text, no obsolete duplicate need remain.
- AI analysis CURRENT:
  `analysis.transcriptId === transcript.id` and
  `analysis.transcriptRetranscribeCount === transcript.retranscribeCount`.
- AI analysis STALE:
  either identifier differs/is older. Continue showing old analysis with a
  stale badge and explicit rerun action.
- Publication CURRENT:
  publication exists, analysis itself is current, and `sharedAt` is not older
  than the current analysis completion/start.
- Publication STALE:
  the shared snapshot exists but analysis is stale, or a newer analysis run
  completed/started after `sharedAt`.
- Do not auto-unshare, overwrite, or republish. Participants continue to see
  the prior shared snapshot with an “older version” indication until the
  facilitator explicitly republishes.
- Centralize these calculations in a tested lineage helper and return bounded
  booleans/version labels from the materials API.
- No new persisted stale flags are required. Existing generation IDs,
  archived metadata, and publication timestamps are sufficient for the
  approved “new transcript version” case.

## 21. Data model and migrations

**REQUIRED SCHEMA CHANGE**

Exactly one Stage 3.13E schema change is required:

| Model | Field | Reason | Default/backfill | Rollback |
|---|---|---|---|---|
| `User` | `sessionSoundEnabled Boolean @default(true)` | Cross-device authenticated sound preference | DB default true; every existing row true | Column may be dropped; session behavior unaffected |

Migration tests:

- migrate a pre-change fixture with true count > 0;
- assert every existing user is ON;
- create a user without specifying the field and assert ON;
- toggle OFF/ON through the authorized API and reload.

Rejected schema changes:

- no enums for ROOM_READY or WAITING_FOR_NEGOTIATION_START;
- no enums/columns for FINAL_MINUTE or FINAL_10_SECONDS;
- no FINISH_LINE, TIMER_EXPIRED, or MANUAL_FINISH state/row;
- no persisted sound-event ledger;
- no stale booleans for enhancement, analysis, or publication;
- no generic settings table/JSON solely for this one boolean;
- no dedicated control revision field: `Session.updatedAt` is too broad, but
  the exact existing control-field snapshot provides a safe narrow CAS
  predicate without another migration.

## 22. API and authorization changes

**REQUIRED CODE CHANGE**

Affected operations:

1. `POST /api/sessions/[sessionId]/control`
   - Caller: authenticated current room facilitator only.
   - Validation: action, required `connectionId`, expected state, and narrow
     control-snapshot token.
   - Lease: require an actual active current facilitator lease and prove it in
     the atomic mutation decision; version-zero/no-row is not sufficient.
   - Idempotency: exact control-snapshot CAS; the same accepted response does
     not duplicate a transition or provider side effect.
   - Concurrency: one update wins; stale request refetches current state.
   - Reject START from PREPARATION and remove SKIP_PREPARATION from the
     accepted product contract.
   - Retain STOP_PREPARATION from PREPARATION_RUNNING and PREPARATION_PAUSED,
     presented as Finish preparation.
   - Restrict interactive FINISH to RUNNING/PAUSED. Internal canonical event
     completion may still hard-close other states through its separately
     authorized lifecycle path.
   - Return the same narrow control token, `serverNow`, authoritative
     completion timestamp, and final remaining value as the GET control-state
     DTO so manual Finish can enter FINISH_LINE immediately.
   - Existing HTTP tests and legacy test helpers that omit `connectionId` must
     claim and submit a real lease. Core unit tests may exercise pure
     transition functions without an HTTP lease, but production route
     semantics are not weakened for test compatibility.
2. `GET /api/sessions/[sessionId]/control-state`
   - Caller: authenticated authorized room member.
   - Add the narrow control-snapshot token, `serverNow`, authoritative
     completion timestamp, and required timer timestamps.
   - Continue no-store and canonical expiry reconciliation.
3. Sound preference GET/PATCH or server action
   - Caller: active authenticated user.
   - May read/update only the caller’s `User.sessionSoundEnabled`.
   - Boolean validation; no admin override in this Stage.
4. Materials data/status
   - Caller/visibility unchanged.
   - Add canonical return-to-room decision and bounded freshness fields.
   - Participant response must not expose facilitator-only raw lineage
     metadata or private analysis.
5. AI share route
   - Existing facilitator/event-owner/admin authorization remains.
   - Explicit republish overwrites the shared snapshot only after confirmation.
   - Do not automatically republish.
6. Admin provider checks
   - Active admin only via `apiRequireAdminUser()`.
   - Bounded timeout, sanitized result, no full provider job.

## 23. Localization

**REQUIRED CODE CHANGE**

All user-visible strings belong in `lib/i18n/dictionaries/en.ts` and `ru.ts`.
Do not hardcode them in components.

New/changed strings include:

- all card titles/subtitles listed in section 11;
- “Start preparation” / “Начать подготовку”, “Pause preparation”,
  “Resume preparation”, and “Finish preparation” /
  “Завершить подготовку” (existing keys may be reused where exact);
- Sound on/off and “Enable sound” / “Включить звук”;
- preparation and negotiation transition announcements;
- one-minute, ten-second, timer-expired, and manual-finish announcements;
- “← Back to session” / “← Назад к сессии”;
- “Transcript ready; AI enhancement in progress” and RU equivalent;
- enhancement/analysis/publication Current and Older version/Stale labels;
- SpeechKit and Yandex AI check labels/results;
- Mail environment anchor label if the existing label is ambiguous.

RU and EN timer strings must be tested at the existing narrow center-column
width and must not increase card height.

## 24. Test strategy

### Unit tests

- Preparation/negotiation remaining-time and pause calculations.
- Final state mapping and threshold precedence.
- Initial-hydration silence and transition/threshold deduplication.
- Both FINISH_LINE variants and their exact 2,500 ms deadline from
  server/end timestamps.
- Narrow control-snapshot token stability: unrelated `Session` fields do not
  change it, while every control-relevant field does.
- Reduced-motion class/state mapping.
- Artifact freshness helper for current/stale enhancement, analysis, and
  publication.
- Materials return decision for OPEN, DEBRIEF_OPEN, CLOSED, event completed,
  and deleted.

### API / integration tests

- Facilitator-only controls; participant/observer denied.
- Required strict active connection lease, including rejection of omitted,
  unknown, expired, superseded, revoked, and version-zero/no-row leases.
- Narrow-snapshot CAS concurrency for duplicate start/pause/resume/finish,
  preparation early completion, concurrent poll expiry, and stale action
  ordering.
- Prove unrelated `Session.updatedAt` changes such as initial
  `livekitRoomName` assignment do not cause false control conflicts.
- Preparation expiry waits in READY_TO_START and negotiation timer remains
  full until explicit START.
- START is rejected from PREPARATION; SKIP_PREPARATION is rejected; Finish
  preparation works from running and paused preparation.
- Interactive FINISH is rejected before negotiation starts; internal
  organizer/event completion remains separately authorized.
- Timer zero immediately persists FINISHED and removes control authority.
- Sound preference self-only GET/PATCH.
- Admin checks require admin, time out, sanitize errors, and create no jobs.
- Republish remains explicit.

### Component/UI tests

- Fixed timer-card classes/box across every presentation state.
- Role-specific ROOM_READY copy and controls.
- Identical ROOM_READY title for both roles, with approved role-specific
  subtitles.
- No preparation skip/direct-negotiation controls; Finish preparation remains.
- No active controls in either FINISH_LINE variant or FINISHED.
- Timer-expired and manual-finish variants have equal visual prominence and
  dimensions; manual Finish does not display `00:00` or expiry copy.
- Lobby warning conditionality and Connected removal.
- Materials Back to session visibility.
- Three stale-artifact indicators.

### Playwright smoke

- Full acceptance flow in section 26 for facilitator and participant pages.
- Cross-client polling parity and one-second authoritative reconciliation.
- Lobby camera failure/success and Connected removal.
- Materials navigation and admin checks.

### Room geometry / observer scaling

- Run observer smoke after room runtime changes.
- Run the full observer layout suite once after final room geometry stabilizes
  and before deployment, because breakpoints/rail/footer geometry change.
- Extend or add targeted assertions for timer visibility, control
  reachability, no element intersection, and no page overflow.

### Manual zoom matrix

- Run every physical viewport/zoom pair in section 16 in Chromium.
- Spot-check Firefox/Safari-equivalent behavior where supported, especially
  Web Audio/autoplay and `dvh`.

### Pause/resume/reconnect

- Multiple preparation pauses; frozen values; reload during pause; resume from
  another current connection.
- Negotiation pause intervals unchanged.
- Sleep/background then wake to authoritative remaining state.

### Audio behavior

- One cue per semantic transition.
- No cue on hydration/reload/rejoin.
- No stacked historical warnings after sleep.
- Disabled preference is silent.
- Preference ON with blocked/unavailable context shows Enable sound and never
  pretends sound is active.
- Enable sound creates/resumes from a trusted gesture without a modal and does
  not replay missed cues.
- Preparation start/pause/resume/completion is always silent.
- No per-second sound.

### Migration/backfill verification

- Existing users all ON; new users ON; OFF survives logout/browser/device.

### Accessibility / reduced motion

- Live-region transition announcements only.
- Countdown seconds not announced.
- Keyboard-operable sound toggle/Enable sound state.
- Both finish variants announced with correct semantics and equal visual
  strength.
- No focus stealing; no flashing; reduced-motion static emphasis.

### RU / EN

- Screenshot/box tests in both locales at narrow timer widths and zoom matrix.

Required final gates after implementation stabilizes:

- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`
- focused lifecycle/materials/admin specs
- `npm run test:stage310`
- `npm run test:e2e:observer:smoke`
- `npm run test:e2e:observer:layout` once before deployment

`npm run test:e2e:full` remains manual/nightly unless separately requested.

## 25. Implementation sequence

### Wave 1 — authoritative controls and preference migration

- Goal: close lifecycle bypasses/concurrency gaps, preserve approved early
  preparation completion, and add persisted sound preference.
- Areas: Prisma `User`, migration, negotiation control/select/DTO, control and
  duration routes, preference API.
- Dependencies: migration review first.
- Risks: START/recording ordering, exact control-snapshot predicates, and
  existing test callers without `connectionId`.
- Tests: timer/control unit tests, strict-lease and narrow-snapshot control API
  concurrency/auth tests, early preparation finish, migration verification.
- Exit: explicit preparation-only entry, no SKIP, retained Finish
  preparation, narrow CAS controls, preference persists.

### Wave 2 — timer card, finish line, audio, accessibility

- Goal: deliver fixed-footprint state presentation and semantic cues.
- Areas: `RoomTimerPanel`, shared room shell, provider room pages, i18n, new
  audio/state helpers.
- Dependencies: Wave 1 DTO timestamps/control-snapshot token.
- Risks: hydration replay, blocked AudioContext state, background timing, and
  equal manual/expiry completion presentation.
- Tests: component state matrix, audio dedupe, reduced motion, two-client
  Playwright flow.
- Exit: both variants use the same exact 2,500 ms authoritative finish line,
  no active controls, blocked sound is explicit, and no historical sounds.

### Wave 3 — responsive room/lobby geometry

- Goal: eliminate overlap/clipping without enlarging the timer card.
- Areas: shared shell, Vox/LiveKit layouts, observer rail, facilitator footer,
  header, lobby layout.
- Dependencies: stable Wave 2 markup.
- Risks: observer and video-stage regressions.
- Tests: effective viewport spec, manual zoom matrix, observer smoke and final
  full layout run.
- Exit: all matrix points satisfy section 16 and retain access to every
  meaningful sidebar function through a responsive layout.

### Wave 4 — minor navigation, diagnostics, and freshness

- Goal: complete lobby cleanup, materials return, admin checks/anchor, status
  wording, and unified stale indications.
- Areas: lobby components, materials data/view/status, lineage helper,
  diagnostics UI/routes/provider health helpers, i18n.
- Dependencies: none beyond shared localization/test fixtures.
- Risks: privacy serialization and provider-check error leakage.
- Tests: focused materials, debrief sharing, diagnostics authorization and
  sanitization, lobby specs.
- Exit: every section 17–20 acceptance criterion passes.

### Wave 5 — final integrated validation

- Goal: one stabilized integrated run and release evidence.
- Areas: tests/docs only after runtime SHA is fixed.
- Dependencies: Waves 1–4 complete.
- Risks: expensive suite repetition.
- Tests: all mandatory gates, Stage 3.10, observer smoke, one full observer
  layout run, manual canary/zoom matrix.
- Exit: green runtime SHA recorded; only test/docs follow-ups after heavy gates.

## 26. Acceptance criteria

**APPROVED REQUIREMENT**

The following succeeds for facilitator and participant clients sharing one
authoritative state:

1. room entry;
2. waiting for preparation, with timer not running;
3. facilitator starts preparation;
4. facilitator pauses preparation and both clients show a frozen value;
5. facilitator resumes preparation;
6. facilitator can finish preparation early from running or paused, while a
   separate case verifies natural preparation expiry;
7. both clients wait for facilitator and negotiation remains unstarted;
8. facilitator starts negotiations after recording consent;
9. facilitator pauses negotiation;
10. facilitator resumes negotiation;
11. one 60-second warning visual/audio event;
12. one 10-second warning visual/audio event;
13. natural expiry reaches `00:00`;
14. authoritative FINISHED immediately disables controls and recording stop is
    initiated;
15. strong TIMER_EXPIRED FINISH_LINE lasts until exactly 2,500 ms after the
    authoritative end timestamp;
16. debrief presentation;
17. a separate manual facilitator Finish with remaining time greater than zero
    produces immediate authoritative completion, the same-strength
    MANUAL_FINISH FINISH_LINE for exactly 2,500 ms, correct non-expiry copy,
    one END cue, and then debrief.

Additional acceptance:

- Refresh/reconnect/rejoin restores server-derived time and does not replay
  historical sounds.
- Background wake after the finish-line deadline goes directly to debrief.
- Remount/reconnect never restarts either 2,500 ms finish-line deadline.
- Sound OFF persists across sessions/browsers/devices and all semantics remain
  visible.
- Preference ON with blocked AudioContext visibly offers Enable sound; using
  it does not replay missed events.
- Every pre-existing user is ON after migration.
- No timer-card footprint growth in RU or EN.
- All zoom matrix points have no overlap/clipping and retain mandatory
  controls and meaningful sidebar functions through responsive alternatives.
- Lobby camera warning appears only for actual provider device failure and is
  concise; stable Connected text is absent.
- Materials show Back to session for active/debrief-open access only.
- Enhancement, analysis, and publication independently show current/stale;
  stale publication is not automatically replaced.
- Mail quick-link targets Mail configuration.
- SpeechKit and Yandex AI checks are admin-only, bounded, sanitized, and do
  not start provider jobs.
- Participant and facilitator underlying state is identical; only controls
  differ.

## 27. Risks and rollback

- Highest risk: changing control-write ordering around negotiation START and
  canonical FINISH. Isolate and test the narrow control-snapshot CAS plus
  recording side effects.
- `Session.updatedAt` is explicitly rejected as control version because
  unrelated room-entry/status writes can change it. An implementation that
  falls back to `updatedAt` must stop for design review.
- Strict lease enforcement will break legacy/API test callers that omit
  `connectionId`; migrate fixtures to claim leases rather than adding a
  production bypass.
- Request-driven expiry means completion occurs on the first authorized poll
  after zero; preserve one-second polling and server-time recomputation.
- Migration risk is low but production deployment must explicitly verify
  every existing user is ON.
- Audio varies by autoplay policy, mobile suspension, and browser background
  throttling. Blocked sound remains non-blocking but must be represented by
  Enable sound rather than silently appearing enabled; visual behavior remains
  sufficient.
- Geometry changes can regress observer rail and short-height room layouts;
  the full observer layout suite is a deployment boundary.
- Artifact freshness must not leak facilitator-only metadata to participants.
- Practical rollback boundaries:
  - audio/presentation UI can roll back independently while server state stays
    safe;
  - narrow control CAS, strict lease enforcement, and bypass removal should
    roll back as one unit while retaining STOP_PREPARATION behavior;
  - preference column can remain harmlessly if UI is rolled back;
  - diagnostic routes/buttons can roll back independently;
  - no FINISH_LINE or stale flag data cleanup is required because those states
    are derived.

## 28. Open questions

No blocking repository question remains.

Non-blocking manual-acceptance decisions:

- final oscillator frequencies and gain within the semantic contract;
- final static/one-shot digit emphasis strength;
- whether the sound preference is also duplicated on Account Settings after
  the required in-room toggle is accepted. The minimum approved persistence
  behavior does not require that duplication.

## 29. Implementation contract

1. Subsequent Stage 3.13E implementation work must read this document before modifying code.
2. Approved behavior in this document must not be silently changed.
3. If repository discoveries during implementation contradict this document, implementation must stop and report the conflict rather than improvising a different product behavior.
4. The server remains authoritative for timing/session state.
5. Presentation-only states should remain presentation-only unless persistence is technically necessary.
6. The existing timer/status card footprint must remain unchanged unless explicitly re-approved.
7. No unrelated dependency/security/AI/email/infrastructure remediation is part of this Stage.
8. Required migrations must be explicitly reviewed before production deployment.

## 30. Wave 3 implementation notes (responsive geometry)

- Desktop sidebar mode is now `xl+`; below `xl`, session/debrief sidebar content
  is exposed through a compact drawer toggle in the room header.
- Facilitator controls keep semantic actions/labels unchanged and now run inside
  a bounded internal scroll container to preserve reachability under short
  viewport heights.
- Media-control rows (including Notifications) are wrap-capable to avoid hidden
  controls at zoom-pressured widths.
- Vox desktop stage breakpoint moved from `lg` to `xl`; observer rail uses a
  compact clamped height contract to avoid pushing mandatory controls off-screen.
- Lobby desktop split breakpoint moved from `lg` to `xl`, with narrower desktop
  sidebar width at `xl`, preserving action reachability at 1093/1024/911/853
  effective widths.
- Automated Wave 3 matrix coverage is implemented in
  `tests/e2e/stage-3-13e-responsive-geometry.spec.ts` and is intended to run
  with observer-layout validation gates.
