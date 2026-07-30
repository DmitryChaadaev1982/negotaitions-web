# Implementation Waves

## Wave 1 — Safe High-Value UI Corrections
Address: UI-F001, UI-F004, UI-F005, UI-F006, UI-F007, UI-F010, UI-F017, UI-F018.

Expected value: clearer next action, less repeated text, less accidental materials/room confusion, lower lobby stress.

Dependencies: none beyond current routes/components.

Regression risk: low to medium; test with focused Playwright audit scenarios plus Stage 3.10 lifecycle gates.

Recommended branch: `ui/stage-3-12b-wave-1-action-hierarchy`.

## Wave 2 — Structural Component Improvements
Address: UI-F003, UI-F008, UI-F011, UI-F012, UI-F014, UI-F016.

Expected value: scalable filters, event roster management, stable negotiation stage, shared case content.

Dependencies: role/slot layout decision for 2-8 negotiators.

Regression risk: medium to high; requires room/lobby E2E coverage.

Recommended branch: `ui/stage-3-12b-wave-2-lobby-room-structure`.

## Wave 3 — Future Product Experience
Address: UI-F002, UI-F013, high-volume virtualization and future dashboard product lanes.

Expected value: observer prioritization, messages/statistics/calendar, large event management.

Dependencies: backend/domain state for active observer priority and product decisions for future IA.

Regression risk: high; split into separate decision branches.

Recommended branch: `product/stage-3-12c-dashboard-roster-future`.
