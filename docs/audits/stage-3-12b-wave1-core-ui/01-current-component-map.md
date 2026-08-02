# Current Component Map

Source of truth inspected in `negotiations-web-ui-wave1` before implementation.

## Dashboard

- Loader: `app/(app)/dashboard/page.tsx`
- View/cards: `components/account-dashboard-view.tsx`
- Data sources: `getEventsForUser`, `getSessionsForUser`
- Current grouping before W1: `continueItem`, active Events, active Sessions, completed Sessions, hosted Events.
- Completed items are separated by render mapping in the loader, not by a backend archive model.
- Event and Session cards are separate local implementations in `AccountDashboardView`; they do not use a shared dashboard card model.

## Event Lobby

- Main view, polling, and state refresh: `components/event-lobby-view.tsx`
- Host setup/assignment/session board: `components/event-host-controls-panel.tsx`
- Room/materials primary resolution: `lib/event-session-primary-action.ts`
- Room action rendering: `components/event-session-room-button.tsx`
- Event state payload and action fields: `lib/event-state.ts`

Preserved polling/runtime paths:

- `fetchState` uses `cache: "no-store"`.
- Request sequence protection is handled by `shouldApplyEventStateResponse`.
- Hidden-tab/focus polling is handled by `getEventLobbyPollDelayMs`, `visibilitychange`, and `focus`.
- Lobby presence heartbeat remains in `EventLobbyPresence`.

## Duplicate Room-Entry Actions

Existing duplicate candidate:

- `assigned-session-card` renders `EventSessionRoomButton` for the current participant assignment.
- `my-sessions-in-event-section` also renders `EventSessionRoomButton` for each historical/current session belonging to the same participant.
- For an ordinary assigned participant, these can target the same current room URL and same `roomAccessDecision`.

Different-purpose actions that must remain distinct:

- Owner Session board room actions in `EventHostControlsPanel` are management-level actions across multiple Sessions.
- Observer join action uses `observerJoinUrl`, not the assigned participant room URL.
- Materials links use `materialsUrl` or observer materials URLs and are review actions, not live room entry.
- Event lobby navigation uses `/events/[id]/lobby`.

## Labels And Local Resolvers

- `EventSessionRoomButton` derives labels from `resolveEventSessionPrimaryAction`.
- Dashboard cards derive labels locally from `DashboardAction.labelKey`.
- Sessions and Events lists use local list-action variants and labels.
- Desired role labels are rendered directly in `EventLobbyView`.
- Create Session label currently comes from `events.createSession`; no live usage of old "Create another Session" text was found in source.

## Persona, Role, And Status Patterns

Repeated patterns before W1:

- Participant list combines display name, host marker, active assignment, presence, online location, and preference in one row.
- Assigned session card combines assigned type and case role as a text chain.
- Host Session board participant summary renders `displayName · participantType · roleName`.
- Presence is already explicit through `EventPresenceIndicator`.
- Camera/mic truth is available on `EventStateParticipant` as `cameraEnabled` and `micEnabled`.

## Desired Role Persistence

- Preference is stored in `EventStateResponse.currentParticipant.preference` and mirrored in `participants`.
- `updatePreference` PATCHes `/api/events/[id]/participant` with the current lobby `connectionId`.
- The current UI keeps no independent persisted preference model; it optimistically updates state and then applies the server payload.

## Shared Buttons And Badges

- Global buttons: `components/ui/buttons.tsx`
- List actions: `components/list-action-button.tsx`
- Badges: `components/badge.tsx`
- Event session room, materials, and management actions currently share visually similar cyan/secondary treatments in the targeted surfaces.

## Stable Test IDs To Preserve

- `event-lobby-page`
- `event-lobby-video-area`
- `back-to-events-button`
- `lobby-panel-participants`
- `participant-card`
- `lobby-panel-selected-case`
- `host-controls-panel`
- `event-settings-section`
- `session-board-section`
- `event-session-card`
- `event-session-status-badge`
- `create-another-session-button`
- `create-session-button`
- `cancel-session-setup-button`
- `assigned-session-card`
- `go-to-session-room-button`
- `open-session-room-button`
- `open-session-materials-button`
- `join-session-as-observer`
- `my-sessions-in-event-section`
- `sessions-without-my-participation-section`
