# Stage 3.13E Wave 3 - Responsive / Browser-Zoom / Live-Room Geometry Hardening

## Scope

Wave 3 hardens responsive geometry for Session room and Event lobby under
desktop resolution + browser-zoom pressure while preserving approved Wave 1/2
semantics (state machine, timer authority, finish semantics, notifications, and
debrief behavior).

## Geometry Audit Summary

### Root causes identified

1. `components/shared-room-shell.tsx`
   - Desktop sidebar activated at `lg` with fixed widths (`w-[28rem]`, `xl:w-[32rem]`),
     creating compression at effective widths around 1093/1024/911/853.
   - Header/right actions did not explicitly wrap under pressure.
   - Facilitator controls were non-bounded vertically in short-height views.
   - Media row risked horizontal pressure when notifications + provider controls
     were adjacent in a single line.

2. `components/voximplant-video-layout.tsx`
   - Desktop stage switched at `lg`, increasing early pressure.
   - Observer rail used fixed height tiers and could consume too much vertical
     budget at short effective heights.

3. `components/event-lobby-view.tsx`
   - Lobby desktop split at `lg` with fixed right sidebar width (`380/420px`)
     undercut usable media/control space at zoom pressure.

4. `components/restricted-control-bar.tsx` and `components/voximplant-media-controls.tsx`
   - Control bars assumed mostly single-row flow; wrapping behavior under high
     pressure needed explicit hardening.

5. `components/structured-video-layout.tsx`
   - Observer row and central stage area had limited overflow adaptability under
     pressure.

## Implemented Responsive Strategy

### Breakpoints and desktop/compact modes

- Moved shared room desktop sidebar behavior to `xl+`.
- Added compact sidebar drawer mode below `xl` with header toggle and explicit
  close affordances.
- Moved Vox desktop 3-column stage from `lg` to `xl` to align with shared-shell
  responsive pressure boundaries.
- Moved lobby desktop split from `lg` to `xl`; reduced sidebar width at `xl`
  (`360px`, `420px` at `2xl`).

### Height strategy

- Added bounded internal scroll for facilitator controls:
  `max-h-[42dvh] overflow-y-auto overscroll-contain`.
- Added wrap behavior for media-control rows to prevent clipped controls in
  short-height + narrow-effective-width combinations.
- Compacted observer rail with `h-[clamp(7.5rem,22vh,11.5rem)]`.

### Sidebar strategy and accessibility

- Desktop sidebar remains visible at `xl+` via `room-desktop-sidebar`.
- Below `xl`, meaningful sidebar content remains reachable through
  `room-sidebar-toggle` + compact drawer (`room-compact-sidebar-panel`).
- Added `aria-expanded`, `aria-controls`, Escape close behavior, explicit close
  button, and non-focusable hidden-state behavior via drawer root `aria-hidden`.

### Timer / status contract preservation

- `RoomTimerPanel` semantics were left unchanged (copy, urgency, badge mapping,
  debrief behavior, frozen final time behavior).
- Responsive hardening is placement/container-level only.

### Media / notification controls

- Notifications remain in-room (not moved to global header).
- Mic/camera/notification controls are explicitly wrap-capable.
- Control reachability is asserted in automated matrix tests.

### LiveKit / Vox parity approach

- Shared-shell geometry hardening is provider-neutral.
- Vox-specific adjustments are limited to rail/stage breakpoint and rail height.
- LiveKit structured layout gains overflow resilience and explicit geometry test
  anchors without changing state semantics.

## Observer Rail Strategy

- 0 observers: empty-state rail remains visible and bounded.
- Small counts: centered/fitting behavior preserved.
- Large counts: horizontal scroll remains explicit/usable with mandatory
  controls outside the rail trap.
- 30/50/100 observer scenarios are covered by Wave 3 responsive spec and
  observer-layout suite.

## Lobby Strategy

- Lobby desktop split deferred to `xl`, reducing aggressive early two-column
  pressure.
- Sidebar remains available and scrollable at desktop widths.
- Primary actions (`go-to-session-room-button`, role controls, media area) stay
  reachable in matrix checks.

## Automated Matrix Coverage

Implemented in `tests/e2e/stage-3-13e-responsive-geometry.spec.ts`.

### Covered viewports

- `1920x1080`
- `1536x864`
- `1366x768`
- `1093x614`
- `1024x576`
- `911x512`
- `853x480`

### Covered room states

- `ROOM_READY`
- `PREPARATION_PAUSED`
- `WAITING_FOR_NEGOTIATION_START`
- `NEGOTIATION_RUNNING`
- `NEGOTIATION_PAUSED`
- `FINAL_10_SECONDS`
- `DEBRIEF`
- Observer-heavy running room (30/50/100 observers)

### Geometry assertions

- Mandatory controls visible and non-zero size.
- No page-level horizontal overflow (`scrollWidth <= viewportWidth + 2`).
- Critical non-overlap checks among video surface, controls, sidebar, observer
  rail, and header regions.
- Compact sidebar alternative-path accessibility checks.

## Manual Browser Zoom Acceptance Checklist

Run physically in Chrome/Edge (no CSS zoom workaround):

1. `1920x1080` at `100%` and `125%`
2. `1366x768` at `100%`, `125%`, `150%`
3. `1280x720` at `100%`, `125%`, `150%`

For each point:
- Timer/status visible and readable.
- Notifications/mic/camera reachable.
- Facilitator mandatory actions reachable.
- Sidebar content reachable (desktop or compact drawer path).
- Observer rail usable without blocking mandatory controls.
- No page-level horizontal scrolling for normal operation.

## Heavy Observer Validation Evidence

Wave 3 requires `@observer-layout` validation and heavy observer counts
(30/50/100). Exact command outcomes are recorded in the completion report.

## Deferred Visual Polish (Wave 4+)

- No Wave 4 behavior changes were introduced in this wave.
- Any non-functional visual polish beyond geometry-hardening remains deferred.
