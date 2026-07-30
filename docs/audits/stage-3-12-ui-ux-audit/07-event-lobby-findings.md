# Event Lobby Findings

## UI-F004 Lobby management and room entry share one long vertical stack
Severity: S2

Evidence: Host controls, case library, assignment, participant status, sessions, and room actions are all in the same scroll flow.

Recommended direction: Separate management controls from persistent room-access controls.

## UI-F005 Critical room-entry controls can fall below unrelated lobby content
Severity: S2

Evidence: Long participant lists and assignment controls precede or surround session room CTAs.

Recommended direction: Use a sticky/current-room action zone or a compact session board.

## UI-F006 Different session destinations share identical primary visual treatment
Severity: S2

Evidence: `EventSessionRoomButton` renders open room, return to debrief, open materials, and open results as `GradientButtonLink`.

Recommended direction: Introduce a semantic action taxonomy separating progression, navigation, materials, and completion.

## UI-F007 Participant status text repeats role, name, status, and assignment
Severity: S3

Evidence: Lobby participant strings combine system role, slot, display name, case role, and location.

Recommended direction: Create a reusable persona/role row with concise text plus accessible state badges.

## UI-F008 Event assignment UI does not scale gracefully to 50-100 people
Severity: S2

Evidence: Assignment controls are select/list based and remain inline with room setup.

Recommended direction: Move assignment into a roster/room-management workspace or drawer.

## UI-F009 Mobile/narrow lobby relies on long document scroll for management
Severity: S3

Evidence: Mobile evidence keeps management, participants, room controls, and status in one page flow.

Recommended direction: Preserve critical actions at top and collapse advanced management sections.

## UI-F018 Desired-role selector is too prominent after selection
Severity: S4

Evidence: Desired role is rendered as a full control even after the interaction becomes infrequent.

Recommended direction: Use a compact persona/status control with discoverable change action.



See consolidated detail in related files for full field structure.
