# Current Observer Data Flow

Preflight source inspection was performed against the implementation worktree, using the Stage 3.12A audit as read-only evidence.

1. An observer in the rendered room is a `SessionRosterEntry` from `sidebar.roster` whose visual zone resolves to `observer`, combined client-side with any matching Voximplant endpoint stream and normalized media/presence state.
2. `resolveRosterVisualRoles` classifies `ParticipantType.OBSERVER` as observer. It also classifies `ParticipantType.PARTICIPANT` without `sessionRoleId` as observer.
3. Base roster order comes from `Session.participants` ordered by `createdAt ASC` in `lib/room-sidebar.ts`. Stage 3.12B-O correction uses this stable roster order as the primary visual order.
4. Per observer, the room has display name, participant type, case role name, `joinedAt`, `lastSeenAt`, Voximplant provider username, optional media status (`micEnabled`, `cameraEnabled`, `mediaStatusUpdatedAt`), and optional logical presence (`isLogicallyPresent`, `logicalConnectionId`, `logicalDisconnectReason`). There is no avatar field in `SessionRosterEntry`.
5. Before this stage, only active observer tiles were rendered, and each rendered tile contained a `<video>` element. This stage renders all observer-zone roster entries in the observer rail; each observer tile still uses the existing `VoximplantParticipantTile` media binding.
6. Horizontal scrolling does not mount or unmount tiles. React keys use `rosterEntry.id`; the visual list no longer reorders observers for camera or connection changes.
7. The current room uses stable observer keys: `tile.rosterEntry.id`.
8. Duplicate Voximplant endpoints can briefly occur after reconnect/refresh. The layout already collapses duplicate remote endpoints by normalized Voximplant provider username before matching them to roster entries.
9. Existing media state safely supports per-tile camera, microphone, connection, and speaking indicators. Automatic observer reordering is deferred because stable positioning is more important for usability and predictable scrolling.
10. The observer area renders inside `SharedRoomShell` media area for normal open/preparation/active room states and `DEBRIEF_OPEN`. Event-closed or deleted room states can show a blocking overlay according to existing access/lifecycle logic.

No Prisma schema or SQL behavior was changed.
