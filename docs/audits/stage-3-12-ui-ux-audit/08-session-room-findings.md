# Session Room Findings

## UI-F011 Current room layout is two-slot, not an eight-negotiator gallery
Severity: S2

Evidence: `resolveRosterVisualRoles` resolves only `participant_a` and `participant_b`; overflow assigned negotiators become `unknown`.

Recommended direction: Design a stable 2-8 negotiator grid before implementation.

## UI-F012 Observer row can grow and compete with the negotiation stage
Severity: S2

Evidence: `VoximplantVideoLayout` renders observer tiles in a wrapping row above the main participant stage.

Recommended direction: Use a dedicated scrollable observer roster that does not shrink the negotiator stage.

## UI-F013 Observer prioritization lacks a complete stable product state
Severity: S3

Evidence: Media status stores camera/mic by participant in `AppSetting`; audio activity exists, but observer active-speaker prioritization is not exposed as a stable roster field.

Recommended direction: Define priority inputs and anti-jump rules before sorting observers.

## UI-F014 Same case content is rendered by several components with different hierarchy
Severity: S3

Evidence: `RoleBriefingCard`, `RoomSidebar`, materials views, observer materials, and join pages each render case context/role details differently.

Recommended direction: Create a shared case-content presentation contract after audit.

## UI-F015 Debrief, materials, and recording states are visually close to navigation states
Severity: S3

Evidence: Return to lobby, open materials, debrief, recording finalizing, and leave controls appear near each other with limited semantic separation.

Recommended direction: Distinguish review/materials destinations from active room entry and leave actions.

## UI-F016 Right sidebar has independent scroll but competes with video width
Severity: S3

Evidence: `SharedRoomShell` fixes right panel width at `28rem`/`32rem` and hides it below large breakpoint.

Recommended direction: Keep one panel with tabs or collapsible sections; preserve stable video area.



See consolidated detail in related files for full field structure.
