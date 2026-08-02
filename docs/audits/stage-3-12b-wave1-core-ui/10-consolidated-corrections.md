# Stage 3.12B-W1C Consolidated Corrections

## Correction Summary

This stage applies six targeted corrections to the Wave 1 event lobby and room flow:

- Lobby roster media state now uses compact camera and microphone icons shared with room video tiles.
- Remote Voximplant lobby video tiles no longer show the redundant "Participants in lobby" subtitle.
- Observer-accessible active Sessions are promoted near the top of the lobby side panel and use `PRIMARY_PROGRESS` actions.
- `DEBRIEF_OPEN` shows server-filtered read-only meeting notes by role.
- Manual speaker-mapping candidates are filtered by durable historical room participation during the recording/session interval.
- Room exit to the Event lobby now follows a one-way explicit-leave transition and does not let stale/takeover banners win during intentional navigation.

## Affected Component And Data Map

- Event lobby shell: `components/event-lobby-view.tsx`.
- Lobby Voximplant tiles: `components/event-lobby-voximplant-room.tsx`.
- Compact persona row: `components/compact-person-status.tsx`.
- Shared media icon primitive: `components/media-status-icon.tsx`.
- Room video tile media icons: `components/voximplant-participant-tile.tsx`.
- Event-state payload and observer action source: `lib/event-state.ts`.
- Room sidebar payload: `lib/room-sidebar.ts`, `lib/room-sidebar-types.ts`.
- Debrief panel: `components/debrief-panel.tsx`, `components/session-post-processing-panel.tsx`.
- Meeting-note persistence: `SessionParticipant.notes`, saved by `ParticipantNotesPanel` through `saveParticipantNotes` and `saveAccountParticipantNotes`; no autosave.
- Debrief note authorization: `lib/debrief-visible-notes.ts`.
- Speaker mapping API: `app/api/sessions/[sessionId]/speaker-mapping/route.ts`.
- Speaker candidate resolver: `lib/transcription/speaker-mapping-candidates.ts`.
- Explicit leave client: `lib/client/explicit-room-leave.ts`, `lib/client/explicit-room-leave-sequence.ts`.
- Voximplant room exit caller: `components/voximplant-negotiation-room-page.tsx`.
- Duplicate-tab/takeover handling remains in `lib/voximplant/use-voximplant-room.ts` and room stale handlers.
- Durable participation evidence remains `SessionRoomConnection.createdAt`, `disconnectedAt`, `supersededAt`, `revokedAt`, and `expiresAt`.
- Recording association remains `Recording.sessionId` and `Transcript.recordingId`; transcript segments and saved speaker mappings are not rewritten by candidate filtering.

## Lobby Media Icon Contract

`MediaStatusIconBadge` is now shared by room tiles and lobby persona rows. It preserves the room color and slash language, keeps SVG paths decorative with `aria-hidden`, exposes the complete localized state with `aria-label` and `title`, and is not focusable because it is informational.

The roster no longer renders verbose visual media strings. The combined `CompactPersonStatus` accessible label still includes display name, role, assignment, presence, location, camera state, and microphone state.

## Observer Available-Session Hierarchy

The lobby side panel now places "Available to observe" / "Доступно для наблюдения" immediately after the current user's desired-role and My Session cards, before participants and historical sections. The section lists only Sessions whose Event-state payload includes `observerJoinUrl`, so no client-side authorization is derived from incomplete lifecycle fields.

Each available Session shows room title, case title, current negotiation state, and a `PRIMARY_PROGRESS` "Join as observer" action. The previous lower active-session action block was removed to avoid duplicate focusable primary actions to the same target. Completed Sessions and observer materials remain visually secondary in the existing materials section.

## Debrief-Note Visibility Matrix

Meeting notes are the text stored in `SessionParticipant.notes`; private role briefings, facilitator briefings, case instructions, transcript annotations, and invitation notes are not used as note content.

- Participant A or B sees only their own non-empty note.
- Observer sees Participant A, Participant B, and their own non-empty note.
- Facilitator sees Participant A, Participant B, and their own non-empty note.
- Other observers' notes are excluded.
- Empty notes are omitted.
- If one user occupies multiple relevant roles, owner deduplication by `userId` prevents duplicate note blocks.
- The resolver returns notes only during `DEBRIEF_OPEN`; `OPEN` returns an empty array.

## Speaker Candidate Historical-Participation Rule

Manual speaker candidates are no longer all Session participants. A candidate must have a `SessionRoomConnection` for the same Session whose durable interval overlaps the recording evidence interval:

`connection.createdAt < interval.end && effectiveConnectionEnd > interval.start`

`effectiveConnectionEnd` is the first durable terminal field among `disconnectedAt`, `supersededAt`, `revokedAt`, then `expiresAt`. The preferred evidence interval is `Recording.startedAt` to `Recording.endedAt`; if recording timestamps are incomplete, the resolver falls back to negotiation/session/transcript timestamps in that order. Current online state and current lease validity are not used.

Reconnect rows are deduplicated by `userId`. A connected observer or facilitator can be a candidate; an invited but never-connected user is excluded. Saved transcript segments and existing saved mappings are not automatically changed.

## Room-Exit State Machine

The corrected Voximplant Event-lobby exit path is:

`IDLE -> LEAVE_REQUEST_DISPATCHED -> NAVIGATING -> UNMOUNTED`

Once the explicit leave starts, duplicate clicks are ignored, the lobby/back buttons expose disabled and `aria-busy` state, stale/takeover callbacks are suppressed for that intentional transition, and room polling stops applying stale banners. The explicit leave request uses a dispatched-timeout mode with `keepalive`; confirmed authorization or validation failures still surface as controlled errors, while an uncertain transport timeout after dispatch no longer strands the user on the disconnected room page.

The leave sequence now marks local inactive and starts navigation before provider disconnect cleanup. Provider cleanup still runs, but cannot block the user-visible navigation result.

## Focused Test Matrix

- Unit: `lib/debrief-visible-notes.test.ts`.
- Unit: `lib/transcription/speaker-mapping-candidates.test.ts`.
- Unit: `lib/client/explicit-room-leave.test.ts`.
- Unit: `lib/client/explicit-room-leave-sequence.test.ts`.
- E2E correction coverage is intended for `tests/e2e/stage-3-12b-wave1-corrections.spec.ts`; final execution should use managed Playwright mode after focused functional checks.

## Validation Results

Recorded heavy/focused command log:

- `npm run test:unit -- "lib/debrief-visible-notes.test.ts" "lib/transcription/speaker-mapping-candidates.test.ts" "lib/client/explicit-room-leave.test.ts" "lib/client/explicit-room-leave-sequence.test.ts"`
  - Duration: 29.971s wall time, Node reported 23.125s.
  - Result: pass, 613 tests.
  - Reason: focused unit verification; package script expanded to the repository unit suite, so this broader pass should not be repeated unless runtime code changes.
  - Runtime SHA: uncommitted working tree after C1-C4 runtime edits.

- `npm run test:e2e:focused:managed -- tests/e2e/stage-3-12b-wave1-corrections.spec.ts --project=chromium`
  - Final duration after runtime type fix: 20.6s.
  - Result: pass, 4 tests.
  - Reason: focused correction coverage for lobby media, observer active Sessions, debrief notes, and never-connected speaker candidates.

- `npm run test:e2e:focused:managed -- tests/e2e/stage-3-12b-wave1-core-ui.spec.ts --project=chromium`
  - Duration: 16.3s.
  - Result: pass, 3 tests.
  - Reason: existing Wave 1 focused regression.

- Directly relevant existing E2E suites:
  - `tests/e2e/voximplant-event-lobby.spec.ts`: pass, 7 tests, 20.4s.
  - `tests/e2e/stage-3-12b-observer-scaling.spec.ts`: pass, 15 tests, 3.9m.
  - `tests/e2e/phase-6-11b-session-role-assignment.spec.ts`: pass, 6 enabled tests and 53 skipped, 13.9s.
  - `tests/e2e/session-navigation.spec.ts`: pass, 2 tests, 20.2s after test-only fixture updates for current account-mode auth and closed-session routing.
  - `tests/e2e/debrief-ai-sharing.spec.ts`: pass, 7 tests, 39.9s after test-only fixture updates for current account-mode auth and post-processing UI.
  - `tests/e2e/diarization-speaker-mapping.spec.ts`: pass, 11 tests, 34.3s after test-only fixture updates for current account-mode auth, historical room connections, recording rows, and current safe manual-review behavior.
  - `tests/e2e/voximplant-room-presence.spec.ts`: pass, 21 tests, 19.5s.
  - `tests/e2e/voximplant-room-parity.spec.ts`: pass, 7 tests, 18.1s.

- `npm run validate:fast`
  - Final duration after runtime type fix: 65.1s.
  - Result: pass.
  - Reason: one-time fast gate after corrected runtime; earlier pre-fix passes were superseded by the runtime type fix.

- `npm run validate:deploy`
  - Final duration after runtime type fix: 99.7s.
  - Result: pass.
  - Earlier attempts failed during Next.js type-check because `EventLobbyVoxVideoTile.subtitle` was still typed/passed as required while remote lobby tiles intentionally omit it. The runtime fix made `subtitle` optional and omitted it via conditional spread for remote tiles.

- `npm run test:e2e:smoke`
  - Duration: 18.6s.
  - Result: pass, 12 Playwright smoke tests plus E2E database safety checks.

- `npm run test:e2e:smoke:browser`
  - Duration: 38.2s.
  - Result: pass, 5 browser-smoke tests plus E2E database safety checks.

- `npm run test:stage310`
  - Duration: 37.1s.
  - Result: pass, 102 unit tests and 30 Playwright tests.

Remaining manual verification is pending. No screenshot artifacts were collected in this automated pass.

## Explicit Non-Scope Statements

- No schema migration.
- No lifecycle state change to `OPEN -> DEBRIEF_OPEN -> CLOSED`.
- No role-assignment model change.
- No observer rail layout change.
- No AI prompt change.
- No automatic speaker mapping.
- No weakening of duplicate-tab protection.
- No production deployment.
