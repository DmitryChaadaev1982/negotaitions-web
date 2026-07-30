# Scale and Overflow Findings

Negotiator scale: current source supports two primary negotiation participant slots. Counts 3-8 cannot be treated as a simple CSS resize problem; they require a role/slot layout model.

Observer scale: observer counts 0, 1, 4, 8, 12, 30, 50, and 100 were modeled in the scenario matrix. Runtime evidence was bounded; high counts were deterministic fixtures/source analysis, not 100 live browsers.

Viewport risk: primary desktop target is `1440x900`; mobile `390x844` increases risk that room-entry actions sit below management content.

Zoom/reflow risk: at 150-200% the full filter bars and dense lobby stacks are the most likely to require excessive scrolling or hide critical controls.


# Consolidated Finding Detail

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

### UI-F003 — List filters are consistent but too footprint-heavy
- Surface: Cases/Events/Sessions
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Cases, Events, and Sessions all render full chip groups in `ListFilterBar` with search plus several visible filters.
- Scenario IDs: UIAUD-FILTER-001 UIAUD-FILTER-002 UIAUD-FILTER-003
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Collapse advanced filters behind a compact toolbar with active-filter chips.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F004 — Lobby management and room entry share one long vertical stack
- Surface: Event lobby
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S2
- Frequency: Common on affected surface
- Evidence: Host controls, case library, assignment, participant status, sessions, and room actions are all in the same scroll flow.
- Scenario IDs: UIAUD-LOBBY-050
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Observed defect
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Separate management controls from persistent room-access controls.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: M-L
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F005 — Critical room-entry controls can fall below unrelated lobby content
- Surface: Event lobby
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S2
- Frequency: Common on affected surface
- Evidence: Long participant lists and assignment controls precede or surround session room CTAs.
- Scenario IDs: UIAUD-LOBBY-050 UIAUD-LOBBY-MOB-001
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Observed defect
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Use a sticky/current-room action zone or a compact session board.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: M-L
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F006 — Different session destinations share identical primary visual treatment
- Surface: Lobby/Lists/Room
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S2
- Frequency: Common on affected surface
- Evidence: `EventSessionRoomButton` renders open room, return to debrief, open materials, and open results as `GradientButtonLink`.
- Scenario IDs: UIAUD-LOBBY-050 UIAUD-FILTER-002
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Observed defect
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Introduce a semantic action taxonomy separating progression, navigation, materials, and completion.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: M-L
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F007 — Participant status text repeats role, name, status, and assignment
- Surface: Event lobby
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Lobby participant strings combine system role, slot, display name, case role, and location.
- Scenario IDs: UIAUD-LOBBY-050
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Create a reusable persona/role row with concise text plus accessible state badges.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F008 — Event assignment UI does not scale gracefully to 50-100 people
- Surface: Event lobby
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S2
- Frequency: Scale-dependent
- Evidence: Assignment controls are select/list based and remain inline with room setup.
- Scenario IDs: UIAUD-LOBBY-050
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Scalability risk
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Move assignment into a roster/room-management workspace or drawer.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: M-L
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F009 — Mobile/narrow lobby relies on long document scroll for management
- Surface: Event lobby
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Mobile evidence keeps management, participants, room controls, and status in one page flow.
- Scenario IDs: UIAUD-LOBBY-MOB-001
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Observed defect
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Preserve critical actions at top and collapse advanced management sections.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F010 — Archive/history has excessive visual weight
- Surface: Dashboard
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Completed sessions are mapped into dashboard alongside active work and use the same card language.
- Scenario IDs: UIAUD-DASH-020
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Use compact archive rows or collapsible history.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F011 — Current room layout is two-slot, not an eight-negotiator gallery
- Surface: Negotiation room
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S2
- Frequency: Common on affected surface
- Evidence: `resolveRosterVisualRoles` resolves only `participant_a` and `participant_b`; overflow assigned negotiators become `unknown`.
- Scenario IDs: UIAUD-SCALE-008
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Scalability defect
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Design a stable 2-8 negotiator grid before implementation.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: M-L
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F012 — Observer row can grow and compete with the negotiation stage
- Surface: Negotiation room
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S2
- Frequency: Scale-dependent
- Evidence: `VoximplantVideoLayout` renders observer tiles in a wrapping row above the main participant stage.
- Scenario IDs: UIAUD-SCALE-008
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Scalability risk
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Use a dedicated scrollable observer roster that does not shrink the negotiator stage.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: M-L
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F013 — Observer prioritization lacks a complete stable product state
- Surface: Negotiation room
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Media status stores camera/mic by participant in `AppSetting`; audio activity exists, but observer active-speaker prioritization is not exposed as a stable roster field.
- Scenario IDs: UIAUD-SCALE-008
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Missing product decision
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Define priority inputs and anti-jump rules before sorting observers.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: Medium
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F014 — Same case content is rendered by several components with different hierarchy
- Surface: Preparation/Debrief/Materials
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: `RoleBriefingCard`, `RoomSidebar`, materials views, observer materials, and join pages each render case context/role details differently.
- Scenario IDs: UIAUD-DEBRIEF-001 UIAUD-MATERIALS-001
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Create a shared case-content presentation contract after audit.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F015 — Debrief, materials, and recording states are visually close to navigation states
- Surface: Debrief/Materials
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Return to lobby, open materials, debrief, recording finalizing, and leave controls appear near each other with limited semantic separation.
- Scenario IDs: UIAUD-DEBRIEF-001 UIAUD-MATERIALS-001
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Observed defect
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Distinguish review/materials destinations from active room entry and leave actions.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F016 — Right sidebar has independent scroll but competes with video width
- Surface: Negotiation room
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: `SharedRoomShell` fixes right panel width at `28rem`/`32rem` and hides it below large breakpoint.
- Scenario IDs: UIAUD-SCALE-008
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Keep one panel with tabs or collapsible sections; preserve stable video area.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F017 — Role/name/case-role labels create high textual noise
- Surface: Roles and labels
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: The same person can be represented by system role, slot, display name, case role, location, camera, mic, and assignment text.
- Scenario IDs: UIAUD-LOBBY-050 UIAUD-SCALE-008
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Adopt one role/persona format with accessible badges and optional details.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F018 — Desired-role selector is too prominent after selection
- Surface: Event lobby
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S4
- Frequency: Common on affected surface
- Evidence: Desired role is rendered as a full control even after the interaction becomes infrequent.
- Scenario IDs: UIAUD-LOBBY-050
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Use a compact persona/status control with discoverable change action.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F019 — Visual language depends on local glass/card styles rather than documented tokens
- Surface: Brand/visual system
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: Reusable tokens exist (`btn-gradient`, `btn-secondary`, GlassCard), but component-level spacing, cards, badges, and gradients vary by surface.
- Scenario IDs: UIAUD-DASH-020 UIAUD-LOBBY-050
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Design weakness
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Document restrained tokens for action hierarchy, surfaces, spacing, and status.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.

### UI-F020 — Accessibility coverage is structural, not automated WCAG-scanned
- Surface: Accessibility
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: S3
- Frequency: Common on affected surface
- Evidence: `@axe-core/playwright` is not installed; current audit uses structural checks for names, target size, focus sample, headings, landmarks, overflow, and clipping.
- Scenario IDs: UIAUD-A11Y-001
- Screenshot references: `artifacts/ui-audit/screenshots/` where captured by scenario ID.
- Source components: see `01-current-ui-architecture.md`.
- Root cause: Missing test coverage
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: Add an a11y dependency in a separate decision and keep structural checks.
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in `14-recommendation-options.md`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: S-M
- Confidence: High
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.


