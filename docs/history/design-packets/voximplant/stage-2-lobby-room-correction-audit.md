# Stage 2 Correction Audit: Lobby/Room Vox Camera, Layout, Transition, i18n

## Scope and guardrails

- Work directory: `C:\Projects\Negotiations AI\negotiations-web-yandex-ai`.
- This audit and correction are Stage 2 fixes only (no Stage 3 start).
- No Prisma schema or migrations changes.
- No Yandex SpeechKit / Yandex AI / DeepSeek pipeline changes.
- No Vox recording webhook route, recording dispatch contract, scenario, or rule changes.

## 1) Where Event Lobby currently initializes Vox SDK/media

- Lobby entry flow:
  - `app/events/[id]/lobby/page.tsx` renders `EventLobbyView`.
  - `components/event-lobby-view.tsx` bootstraps event state and calls `/api/events/[id]/voximplant-access` in Vox mode.
  - `components/event-lobby-voximplant-room.tsx` initializes Vox SDK directly:
    - imports `@voximplant/websdk` and modules;
    - calls `Core.init({})`, `core.client.connect`, one-time-key handshake;
    - creates local audio/video streams;
    - creates conference, adds streams, joins conference.
- Lobby media/camera/mic controls are implemented directly inside `event-lobby-voximplant-room.tsx`.

## 2) How lobby camera permission/device errors are currently handled

- Lobby has local helper `isRecoverableMediaError`.
- On local media init:
  - audio error -> `onDeviceWarning?.("microphoneUnavailable")`;
  - video error -> `onDeviceWarning?.("cameraUnavailable")`.
- `EventLobbyView` renders a warning banner using only two warning keys.
- Lobby camera toggle is currently track-enable/disable only; it does not attempt re-acquire if stream is missing.
- Error handling path is not shared with room hook and is less complete than room logic (no camera-busy console suppression, no richer classification, no shared state model).

## 3) Whether session room camera error handling is reusable

- Yes. `lib/voximplant/use-voximplant-room.ts` already has stronger and mostly reusable behavior:
  - robust non-fatal media classification;
  - camera toggle idempotency (`buildCameraEnablePlan`, duplicate add-stream recovery);
  - non-fatal warnings without hard crash;
  - fallback behavior when devices are unavailable.
- Current issue: lobby re-implements similar logic independently in `event-lobby-voximplant-room.tsx`, causing divergence.

## 4) Why "Device in use" becomes console error instead of system UI message in lobby

- In room hook, there is targeted dev-only console suppression for known StreamManager camera busy logs.
- In lobby component, this suppression is absent, so WebSDK StreamManager logs surface as raw console errors.
- Lobby still sets warning banner in some paths, but console errors remain noisy and can appear as primary failure in dev UX.
- Result: user sees SDK-style noise even when error should be treated as recoverable "camera unavailable" system state.

## 5) Current lobby layout structure and stretching cause

- Main lobby layout in `event-lobby-view.tsx`:
  - root: `min-h-screen` page flow;
  - content area: flex column/row with no strict `min-h-0`/overflow isolation between panes;
  - aside: `overflow-y-auto`, but parent sizing allows whole page scrolling.
- Vox video area in `event-lobby-voximplant-room.tsx`:
  - media container uses `overflow-auto`;
  - tile grid uses `h-full` + `auto-rows-fr`.
- Root causes:
  1. `auto-rows-fr` with `h-full` stretches rows to available vertical space, making tiles too large.
  2. Missing strict overflow isolation (`min-h-0`, `overflow-hidden`) across parent containers lets page height be influenced by side panel content.
  3. Page-level scroll appears and video panel can visually stretch/scroll together with overall layout.

## 6) Current media controls components/styles in lobby and room

- Lobby controls are inline in `event-lobby-voximplant-room.tsx`:
  - English hard-coded labels (`Mic on/off`, `Camera on/off`).
  - red/green state only.
- Room controls are inline in `voximplant-negotiation-room-page.tsx` (`VoximplantControlBar`):
  - Russian hard-coded labels.
  - includes locked gray mic state.
- Duplication:
  - label logic duplicated and language-inconsistent;
  - style conventions partially aligned but not shared;
  - accessibility labels/tooltips differ by component.
- Shareable area:
  - a common Vox media controls component with state-based colors and i18n labels/tooltips/aria.

## 7) Current Lobby -> Room transition lifecycle and participant DISCONNECTING risk

- Transition path currently uses direct navigation links from lobby card to `/room/[sessionId]`.
- Lobby Vox component cleanup triggers `conference.hangup()` + `core.client.disconnect()` during unmount.
- Room page initializes a new Vox SDK client quickly on mount and starts connect/auth.
- There is no cross-page coordination to wait for previous lobby client disconnect completion before starting room client connect.
- This can produce SDK lifecycle conflict (`DISCONNECTING` / not connected) when room starts while lobby client is still disconnecting.
- Why facilitator may succeed while participant fails:
  - transition timing and tab timing differ; one user may hit clean teardown window while another starts room init during active disconnect.

## 8) Current i18n mechanism and hard-coded labels

- Locale mechanism:
  - `lib/i18n/useI18n.tsx` reads locale from storage/cookie and dispatches locale-change events.
  - dictionaries in `lib/i18n/dictionaries/en.ts` and `ru.ts`.
- Hard-coded labels found in Stage 2 lobby/room UI:
  - `components/event-lobby-voximplant-room.tsx`: English mic/camera labels and status text.
  - `components/voximplant-negotiation-room-page.tsx`: Russian hard-coded control labels and autoplay text.
  - `components/voximplant-video-layout.tsx`: hard-coded English section labels and placeholders plus Russian state labels.
  - `components/event-lobby-view.tsx` and `components/shared-room-shell.tsx`: stale-tab banner hard-coded in English.
- Dictionaries already contain many needed keys, but not all media-control and layout labels used in these Vox components.

## 9) Minimal fix plan

1. **Shared media error handling**
   - Introduce shared Vox media error helpers and use them in both lobby and room.
   - Normalize camera/mic unavailability classification and UI warning behavior.
   - Keep lobby join successful without video/mic when recoverable.

2. **Shared media controls**
   - Create shared Vox media controls component used by lobby and room.
   - State model: on (green), off (red), locked/unavailable (gray).
   - Localize all labels/tooltips/aria in RU/EN dictionaries.

3. **Lobby layout stabilization**
   - Refactor lobby shell to strict `min-h-0` + `overflow-hidden` container model.
   - Make right panel independently scrollable.
   - Replace stretching tile grid (`auto-rows-fr`) with bounded aspect-ratio tile sizing and max dimensions.

4. **Lobby -> Room lifecycle sequencing**
   - Add browser-level Vox client lifecycle sequencing utility.
   - Ensure room init waits for any in-flight lobby disconnect.
   - Keep dev logs, but show user-friendly localized fallback UI with retry and return-to-lobby/session options.

5. **i18n completion**
   - Replace hard-coded lobby/room labels with `t(...)`.
   - Add missing translation keys in `en.ts`/`ru.ts`.
   - Keep case titles/user names/session role names from domain data untouched.

6. **Test updates**
   - Extend `voximplant-layout-camera-model.spec.ts` for new i18n/media-control/layout checks.
   - Extend `voximplant-event-lobby.spec.ts` for camera-unavailable warning and transition sequencing guard expectations.
   - Extend event/phase regressions for locale consistency and participant transition stability checks where feasible.
