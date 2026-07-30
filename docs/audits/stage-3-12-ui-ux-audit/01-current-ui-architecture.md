# Current UI Architecture

Dashboard route: `app/(app)/dashboard/page.tsx` maps event/session overview data into `AccountDashboardView`.

List routes use `CasesListView`, `EventsListView`, and `SessionsListView`. They share `ListFilterBar`, `ListFilterGroup`, `ListFilterChip`, `ListFilterInput`, and `ListFilterResetButton`.

Lobby route: `app/events/[id]/lobby/page.tsx` renders `EventLobbyView`, which owns polling, desired role preference, event state, room/session actions, lobby presence, and host controls. `EventHostControlsPanel` owns case selection, assignment draft, session creation, and session cards.

Room route: `app/room/[sessionId]/page.tsx` renders the Voximplant room through `VoximplantNegotiationRoomPage`, `SharedRoomShell`, `VoximplantVideoLayout`, `FacilitatorRoomControls`, `RoomSidebar`, `DebriefPanel`, and recording controls.

Important source evidence:
- `EventSessionRoomButton` renders all resolved session actions as `GradientButtonLink`.
- `resolveEventSessionPrimaryAction` distinguishes open room, return to debrief, open materials, and open results in data but not presentation.
- `resolveRosterVisualRoles` supports facilitator, observer, participant A, participant B, and unknown; it does not model 3-8 negotiator slots.
- `VoximplantVideoLayout` renders observers in `vox-observer-row` and participant A/B/facilitator in a fixed desktop grid.
- `SharedRoomShell` fixes the right sidebar at `28rem` or `32rem` and hides it under the large breakpoint.
- Camera/mic media state is stored in `AppSetting` documents by `lib/voximplant/media-status-store.ts`.
- Audio activity exists in `SessionParticipantAudioActivity`, but observer active-priority state is not exposed as a stable roster contract.
