# Stage 1 Design: Vox Room UX, Presence, and Audio Policy Parity

## 1. Current implementation summary

- **Current Vox room entry flow**
  - `app/room/[sessionId]/page.tsx` resolves account participant with `ensureAccountRoomParticipant`.
  - Vox room UI uses `components/voximplant-negotiation-room-page.tsx`.
  - Vox SDK handshake uses `app/api/sessions/[sessionId]/voximplant/access/route.ts` and `lib/voximplant/use-voximplant-room.ts`.
  - Business state is loaded by polling:
    - `/api/livekit/sidebar` for domain roster/roles/sidebar content.
    - `/api/sessions/[sessionId]/control-state` for timer and control state.

- **Current Vox participant identity construction**
  - Access route resolves account user and session participant.
  - Vox role (`participant_a`, `participant_b`, `facilitator`, `observer`) is derived server-side from `SessionParticipant.type` plus `SessionRole.name`.
  - Vox SDK usernames are generated from `VideoProviderIdentity.providerUsername` + `userDomain`.

- **Current role source**
  - Authoritative role source is DB-backed sidebar/control APIs (`SessionParticipant`, `SessionRole`).
  - Local visible role label already uses server-backed sidebar.
  - Remote Vox tiles currently show display name only and do not have server-backed role labels.

- **Current timer propagation**
  - Timer source of truth is server-side control state (`lib/negotiation-control.ts`).
  - Vox room polls `/control-state` every second.
  - Vox layout currently does not render parity timer panel.

- **Current mute handling**
  - Vox hook supports local mic/camera toggles and conference mute/unmute.
  - There is no deterministic policy enforcement tied to negotiation states for stale/rejoined tabs.
  - During `RUNNING`, current server policy marks mic allowed only for participants, but Vox room does not yet enforce it with an equivalent to LiveKit `MicEnforcement`.

- **Current recording relay behavior**
  - Recording start/stop is lifecycle-driven from facilitator controls:
    - `START` triggers `/recording-control` start.
    - `FINISH` triggers `/recording-control` stop.
  - Browser relays `scenarioMessage` via `conference.sendMessage`.
  - Webhook route and fileKey handoff are already working and must remain unchanged.

- **Current duplicate-tab behavior**
  - Same login can open multiple tabs for same session participant.
  - Presence is currently `lastSeenAt` heartbeat only.
  - No deterministic active-connection lease exists.

## 2. Role data source

- **Authoritative source**
  - `SessionParticipant.type` and `SessionParticipant.sessionRoleId/sessionRole.name` from DB.
  - Sidebar roster remains the room role authority for both local and remote labels.

- **Local participant mapping**
  - Local participant is already resolved from account `participantId` and sidebar payload.
  - Keep local role label from sidebar data, not transport identity.

- **Remote Vox participant mapping**
  - Add a server-backed mapping from Vox endpoint username to session participant:
    - `SessionParticipant.userId` -> `VideoProviderIdentity.providerUsername`.
  - Build a participant directory in room data and map remote endpoint usernames to:
    - display name
    - participant type
    - case role name
  - If mapping fails, show `Unknown participant` diagnostic label, never infer an incorrect role.

- **Refresh/rejoin role resolution**
  - On every poll, role labels are recalculated from server roster/directory.
  - No role authority is persisted in client-only transport state.

## 3. Timer rendering plan

- **Source**
  - Use existing server-backed `/control-state` fields and `ControlState`.

- **Renderer**
  - Introduce/reuse a shared timer panel component used by Vox layout.
  - Keep timer view provider-agnostic where possible.

- **Update model**
  - Continue 1-second polling in room page.
  - Render from current `controlState` only.

- **Refresh/rejoin behavior**
  - After reload/rejoin, timer immediately reflects server state from fresh poll.
  - No local stopwatch source of truth.

- **State-specific behavior**
  - `PREPARATION/PREPARATION_RUNNING/PREPARATION_PAUSED`: show preparation timer.
  - `READY_TO_START`: show negotiation duration preset.
  - `RUNNING`: show decreasing negotiation timer.
  - `PAUSED`: freeze remaining timer.
  - `FINISHED`: show terminal timer/value from server.

## 4. Layout plan

- **Facilitator zone**
  - Dedicated facilitator tile area near center/timer.
  - If facilitator video unavailable: placeholder tile with facilitator label.

- **Participant 1 / participant 2 zones**
  - Two negotiator zones (left/right columns) with participant tiles.
  - Roles shown from server labels (`participant type + session role`).

- **Observers zone**
  - Dedicated observer row/section separate from negotiator zones.

- **Fallback behavior**
  - Missing video stream: keep role tile placeholder.
  - 1 participant: show single participant zone, other side placeholder.
  - 3+ participants: overflow participants continue in participant columns with deterministic ordering by roster + fallback for unknowns.
  - 0 observers: observer zone hidden, table expands.

- **Mobile/narrow behavior**
  - Keep responsive fallback using stacked sections and overflow scrolling.
  - Role labels remain visible on tile footer.

## 5. Duplicate same-login policy

- **Selected policy**
  - Newest connection replaces previous active connection for same `(sessionId, userId)`.

- **Connection identity**
  - Client generates `connectionId` (UUID) per tab load.
  - Server maintains active in-memory lease per `(sessionId, userId)` with `connectionId` and monotonic `version`.

- **Old tab invalidation**
  - If request carries stale connectionId, server returns stale response (`409` + code).
  - Old tab switches to stale/read-only/disconnected UI banner and blocks controls.

- **Stale UI state**
  - Read-only mode with explicit "another tab became active" message.
  - Facilitator stale tab cannot execute control or recording actions.

- **Heartbeat/reconnect**
  - Heartbeat and state/sidebar polling include connectionId and validate lease.
  - Refresh creates a new connectionId and becomes authoritative by design.

- **Testing**
  - Add e2e coverage for two tabs same login:
    - newest becomes authoritative,
    - previous becomes stale,
    - stale facilitator control call is rejected.

## 6. Mute/audio/recording policy

- **Preparation**
  - Keep current product behavior: speaking allowed.

- **Active negotiation**
  - Only `PARTICIPANT` type can have mic active.
  - `FACILITATOR` and `OBSERVER` are policy-muted via Vox conference mute/local track disable.

- **Pause**
  - All participants policy-muted in room.

- **Resume**
  - Negotiating participants auto-restored to active mic (if muted by policy).
  - Facilitator and observers remain muted.

- **Layer distinction**
  - UI mute state: control bar button/status.
  - Local capture state: microphone track enabled/disabled.
  - Conference send state: `conference.muteMicrophone` / `unmuteMicrophone`.
  - Official recorder inclusion state: depends on conference audio that reaches Vox recording path.

- **Scenario requirement**
  - Stage 1 implementation does not require a mandatory scenario file rename/rebind.
  - No breaking message contract changes.

- **Limitation and fallback**
  - Without explicit server-side/scenario-side per-role audio gating, a malicious/modified client could bypass client-only policy.
  - Stage 1 fallback: enforce policy in official client at mic capture + conference send layer and expose visible policy state.
  - Document manual real Vox validation for recorder behavior during pause/resume.

## 7. Recording pipeline safety

- **Untouched components**
  - `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`
  - Yandex SpeechKit transcription and Yandex AI/DeepSeek analysis internals
  - Existing webhook/fileKey pipeline sequencing

- **Additive changes only**
  - Optional additive control-state/presence payload fields for stale-connection and room policy diagnostics.
  - No contract-breaking `recording_control` message changes.

- **Risk mitigation**
  - Keep start/stop relay call sites but prevent stale tabs from invoking them.
  - Preserve debug panel for smoke diagnosis.

## 8. Tests

- **Add/update automated tests**
  - `tests/e2e/voximplant-room-parity.spec.ts`
    - role labels, timer visibility, zone layout, facilitator controls.
  - `tests/e2e/voximplant-room-presence.spec.ts`
    - refresh/rejoin continuity + duplicate tab policy.
  - Update `tests/e2e/voximplant-recording-debug.spec.ts` only if required by new stale/connection checks.

- **Mocked/stubbed media assertions**
  - CI verifies control-state and policy transition behavior instead of real RTP audio.
  - Use fake media flags from Playwright config.

- **Manual real Vox smoke**
  - Required for true recorder pause/mute behavior confirmation.

- **Legacy event-flow note**
  - Do not rely on legacy guest UI selectors in `event-flow.spec.ts` for Stage 1 acceptance.

## 9. Manual user steps

- **Environment checks**
  - Confirm `.env.local`: `VIDEO_PROVIDER=voximplant`.
  - Confirm `DATABASE_URL` in PowerShell before Playwright.

- **Vox Console checks**
  - Confirm active scenario and rule names match env:
    - `VOXIMPLANT_SCENARIO_NAME=neg-conf-main-room`
    - `VOXIMPLANT_RULE_NAME=negotaitions-negotiation-room-rule`
  - If runtime logs show other names, stop and resolve mismatch.

- **Local dev**
  - Ensure local Postgres is running.
  - Run `npm run dev`.

- **Tunnel/webhook override (if real recording smoke)**
  - Start tunnel: `cloudflared tunnel --url http://localhost:3000`.
  - Open `http://localhost:3000/admin/voximplant-recording`.
  - Set current tunnel URL.
  - Verify unsigned webhook request returns `401`.

- **Manual room smoke**
  - Open room as facilitator + 2 participants + 2 observers.
  - Verify timer, role labels, layout zones, control visibility, stale-tab behavior.
  - Verify state transitions: preparation/start/pause/resume/finish.
  - Verify recording debug panel still works and pipeline remains green.
