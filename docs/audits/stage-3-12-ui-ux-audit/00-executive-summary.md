# Stage 3.12A UI/UX Audit Executive Summary

Base branch: `origin/deploy/yandex-poc`
Base SHA: `ae4bbf4ff13d94155652b335866c99ec116d9a34`
Audit branch: `audit/stage-3-12-ui-ux-audit`
Audit worktree: `C:\Projects\Negotiations AI\negotiations-web-ui-ux-audit`

## Five Most Important Problems
1. The negotiation room source model is still a two-slot participant layout, so it does not safely scale to 3-8 negotiators.
2. Event lobby management, assignment, participant status, and room-entry actions share one crowded vertical flow.
3. Room, debrief, materials, and results actions can look like the same primary action.
4. Observer scaling uses a wrapping visual row and lacks a stable independent roster model.
5. Dashboard and list pages are functional but too dense for future stats, messages, archive, and high-volume history.

## Hypothesis Results
Confirmed: dashboard archive overload, future dashboard separation, 2-8 negotiator scaling gap, observer scaling gap, room-entry visibility, action semantic conflict, overloaded participant status text, event management confusion, assignment at scale, case-content inconsistency, restrained branding need, role/name text overload.

Partially confirmed: filters are consistent but too large; right-side panel scroll exists but competes with video width; duplicate lobby CTAs depend on role/state; button typography risk is more about length/weight than font size alone; desired-role selector is important before selection but too prominent afterward; role icons are useful only with accessible text.

Not confirmed: no supplied hypothesis was fully rejected by current evidence.

Blocked by missing state: active observer prioritization needs a product/runtime state definition before implementation.

## Direct Answers
Does the UI scale to eight negotiators? No. Source evidence in `lib/voximplant/room-layout-model.ts` resolves only participant A and B; extra assigned negotiators become unknown.

Does it scale to many observers? Not safely. Observers may be seeded without 100 browser contexts, but current layout places observer tiles in a wrapping row above the stage.

Critical controls that become hard to find: lobby room-entry buttons, return-to-debrief/materials actions, create-session controls in long management panels, and mobile lobby room access.

Conflicting visual semantics: open room, return to debrief, open materials, and open results all pass through the same primary gradient path in `EventSessionRoomButton`.

Duplicated functionality: room access appears from dashboard, event lobby, session list, materials, and room header; case content appears in join/materials/sidebar/debrief components with different hierarchy.

Safe without architecture changes: action taxonomy, duplicate CTA reduction, compact persona rows, compact desired role control, archive de-emphasis, filter disclosure, and label cleanup.

Requires backend/domain decision: observer prioritization, 2-8 negotiator layout contract, active-speaker/camera priority policy, and high-volume roster virtualization thresholds.

Wave 1 should implement semantic actions, visible room access, compact persona/status rows, desired-role compaction, archive de-emphasis, and minor labels.

Must not change: `OPEN → DEBRIEF_OPEN → CLOSED`, durable room leases, presence/reconnect/leave/heartbeat, server-side Voximplant recording stop, transcription/AI processing, legacy occupancy/reconciliation, provider architecture.

Missing validation: complete visual review of every pairwise viewport/language combination, full 100-observer runtime screenshot, and automated axe/WCAG scan because `@axe-core/playwright` is not installed.

## Scorecard
Dashboard: 3/5. Next action exists, but archive/history competes with active work.
Lists and filters: 3/5. Consistent implementation, high footprint.
Event lobby: 2/5. Management, roster, and room entry are crowded together.
Negotiation room: 2/5. Current source model supports two named negotiator slots, not 2-8.
Debrief: 3/5. State is reachable, but review/material/navigation semantics are close together.
Role clarity: 3/5. Complete information exists, but repeated text slows scanning.
Action hierarchy: 2/5. Materially different destinations share primary treatment.
Scale: 2/5. Many observers/people expose scroll and stage competition risks.
Accessibility: 3/5. Focus and labels are present in many controls; structural automated coverage is incomplete.
Brand consistency: 3/5. Recognizable dark/glass language exists, but tokens are not documented enough.
