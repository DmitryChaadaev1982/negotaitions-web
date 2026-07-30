# Filter Findings

## UI-F003 List filters are consistent but too footprint-heavy
Cases, Events, and Sessions all render full chip groups in `ListFilterBar` with search plus several visible filters.

Recommendation: Collapse advanced filters behind a compact toolbar with active-filter chips.


Cross-page consistency:
- Cases: search, visibility, language, difficulty, reset.
- Events: search, status, visibility, activity, reset.
- Sessions: search, status, AI analysis, event chip when active, reset.

The shared component set is a strength. The issue is footprint and disclosure, not divergent implementation.
