# Event Lobby Current Session Contract

Wave 1 adds a top-of-sidebar `My Session` area in `EventLobbyView`.

## Data Sources

The component reuses only authorization-filtered Event state:

- `currentParticipant`
- `participants`
- `assignedSessionId`
- `roomUrl`
- `materialsUrl`
- `sessions`
- `roomAccessDecision`
- `roomAccessRedirectTo`

It does not derive room authorization independently.

## Action Selection

The primary action is selected by the existing `resolveEventSessionPrimaryAction` helper and rendered by `EventSessionRoomButton`.

- Active room remains `OPEN_ROOM` -> `PRIMARY_PROGRESS`.
- Debrief return remains `RETURN_TO_DEBRIEF` -> `RETURN_TO_ACTIVE`.
- Materials/results remain review actions.
- No assigned Session renders waiting copy rather than a disabled fake room action.

## Duplicate Policy

For ordinary assigned users, the lower `mySessionsInEvent` list excludes the current assigned Session. This removes the duplicate same-target room action while preserving historical sessions and materials links.

Owner/facilitator Session board actions remain available because they operate across multiple Sessions and have management purpose.

## Polling Safety

The component is derived from current props/state on every render. It introduces no polling loop and no local copy of server authorization state.

Existing stale-response, hidden-tab, focus recovery, no-cache fetch, lease, heartbeat, and provider behavior are unchanged.
