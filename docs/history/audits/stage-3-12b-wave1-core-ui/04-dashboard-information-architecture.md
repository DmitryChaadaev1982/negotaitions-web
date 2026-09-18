# Dashboard Information Architecture

Wave 1 reorganizes existing Dashboard data in the render layer only. No backend archive model or recommendation service is introduced.

## Sections

- Continue / Current: one loader-supplied next action when available, otherwise a restrained empty state.
- Upcoming and active: active Events and active Sessions.
- Managed Events: Events managed by the user that are not already rendered as active full cards.
- Archive / Completed: completed Sessions in a native disclosure, collapsed by default.

## Current Action Priority

The existing loader priority is preserved and documented:

1. First active Session from `getSessionsForUser`.
2. First active Event from `getEventsForUser`.
3. First completed Session materials link only when no active Session or Event exists.

This is deterministic from the existing query order and does not add heuristics.

## Deduplication

If an Event is both personally relevant and managed by the user, the active/upcoming section owns the full card. The managed section renders only managed Events not already present in active cards.

## Archive Behavior

Completed Sessions move to the Archive / Completed section. The disclosure is collapsed by default, keyboard-operable by native browser semantics, and keeps materials and Event lobby links reachable. Live room actions are not rendered for archived cards.

## Future Extensibility

The layout reserves a quiet low-priority note after the main sections. Future progress, statistics, calendar, and messages can be added below current/upcoming lanes without competing with the primary action.
