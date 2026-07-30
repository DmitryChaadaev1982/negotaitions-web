# Dashboard Findings

### UI-F001 — Dashboard completed work competes with next action
- Surface: Dashboard
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Active and completed sessions share similar card weight; completed sessions are included in dashboard source mapping.
- Scenario IDs: UIAUD-DASH-020
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Segment scheduled/current/archive and de-emphasize historical items.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F002 — Dashboard has no safe reserved lanes for future stats/messages
- Surface: Dashboard
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Dashboard source has active events, active sessions, completed sessions, hosted events, and one continue item; no reserved density model for progress or messages.
- Scenario IDs: UIAUD-DASH-020
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Future IA requirement
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Define dashboard lanes before adding statistics or messages.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.




See consolidated detail below for all fields.

