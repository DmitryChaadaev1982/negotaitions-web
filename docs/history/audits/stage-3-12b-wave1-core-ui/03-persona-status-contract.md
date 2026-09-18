# Persona And Status Contract

Wave 1 introduces `CompactPersonStatus` for dense Event lobby surfaces.

## Priority

1. Person display name.
2. Case role where available.
3. Participant type or system role.
4. Assignment, presence/location, camera, and microphone status.

## Rules

- The display name is the main visible line.
- Case role is displayed before generic system role.
- Host status is a compact explicit badge.
- Assignment is a compact badge when available.
- Presence status remains explicit text through `EventPresenceIndicator`.
- Camera and microphone states are text labels, not color-only indicators.
- Long names truncate visually and keep the full accessible/title text.
- Screen readers receive name, role, assignment, host status, location, and media state in the accessible label.
- The component consumes current props only; it does not cache Event state or media truth.

## Wave 1 Usage

- Event lobby participant roster rows.
- Event lobby current user's desired-role card.
- Event lobby My Session card.
- Event host Session board participant summaries.

Not forced into full management forms or room observer rail.
