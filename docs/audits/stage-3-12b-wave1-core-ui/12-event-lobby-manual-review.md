# Stage 3.12B-W1 Event Lobby Manual Review Corrections

## Component And Control Map

- Event lobby route/page: `app/events/[id]/lobby/page.tsx` -> `components/event-lobby-view.tsx`.
- Route shell and scroll contract: `EventLobbyView` owns the fixed viewport shell; desktop scrolling is contained in the right `aside`.
- Persona cards: `components/compact-person-status.tsx`.
- Shared media badge/button primitive: `components/media-status-icon.tsx`.
- Bottom lobby media controls:
  - Voximplant: `components/event-lobby-voximplant-room.tsx` and `components/voximplant-media-controls.tsx`.
  - LiveKit: `components/event-lobby-video-room.tsx` and LiveKit local participant APIs.
- Event-state polling: `GET /api/events/[id]/state`, `lib/event-state.ts`.
- Media status source of truth: `lib/voximplant/media-status-store.ts`, persisted in `AppSetting`.
- Owner media command path: `POST /api/events/[id]/media-control`, `lib/voximplant/event-media-control-store.ts`, delivered through existing Event-state polling.
- Session board/history cards: `components/event-host-controls-panel.tsx`.
- Complete Session action/API: `components/complete-session-button.tsx`, `POST /api/sessions/[sessionId]/complete`, `lib/session-completion.ts`.
- Dictionaries: `lib/i18n/dictionaries/ru.ts`, `lib/i18n/dictionaries/en.ts`.

## Viewport And Scroll Contract

Root cause: the lobby shell was height-bounded but still participated in normal document flow under the app page. Tall right-panel content could therefore define document height and expose empty page-level space below the lobby.

The corrected lobby shell is fixed to the viewport (`fixed inset-0`) and hides document overflow at the route boundary. Desktop uses `min-h-0` flex containment and keeps the right panel as the independent `overflow-y-auto` container. Narrow layouts scroll inside the route container instead of creating body/document scroll. No global body overflow rule was added.

## Media Control Permission Matrix

| Actor | Own media | Other user disable | Other user enable |
|---|---:|---:|---:|
| Event owner | Yes | Yes | Request/confirmation |
| Participant | Yes | No | No |
| Observer | Yes | No | No |
| Facilitator who is not owner | Yes | No, unless an existing server rule makes them Event owner | No |

Authorization source: `resolveEventAccess(...).isEventOwner` for remote controls, not a client role label. The server also verifies that the target participant belongs to the current Event and is currently online in the Event-state model.

## Offline Media State

Offline presence is authoritative over the last known media values. Offline camera/microphone icons render as neutral gray unavailable indicators, are not buttons, and expose:

- RU camera: `Камера недоступна: пользователь не в сети`
- RU microphone: `Микрофон недоступен: пользователь не в сети`
- EN camera: `Camera unavailable: user is offline`
- EN microphone: `Microphone unavailable: user is offline`

## Self And Remote Controls

Self roster controls reuse the same local media actions as the bottom controls. The provider component registers a shared local controller with `EventLobbyView`; roster icons and bottom controls therefore share the same local state and busy guards.

Owner remote disable is implemented as a server-authorized command persisted in `AppSetting` and delivered to the target through existing Event-state polling. The target client validates that the command is addressed to its current Event participant, disables local media idempotently, and acknowledges the command. UI does not optimistically flip another participant's displayed state before the normal media-status publish/poll path confirms it.

Remote enable is not silent activation. It is an owner request delivered through the same command path. The target receives a prompt naming the requester and device, then chooses `Включить` / `Отклонить` (`Enable` / `Decline`). Only acceptance invokes the target's local media action.

Known limitation: command delivery cadence is bounded by the existing Event-state polling interval; no new realtime transport was introduced.

## Completed Sessions

Completed Sessions are grouped into a shared disclosure section:

- RU: `Завершённые сессии (N)`
- EN: `Completed Sessions (N)`

Active and `DEBRIEF_OPEN` Sessions remain above the disclosure. The deterministic default is expanded for one completed Session and collapsed for several. Collapse state is stored in `sessionStorage`, keyed by Event and current user/owner identity.

## Device-Busy Copy

The always-visible lobby hint now uses neutral device-availability language:

- RU: `Камера или микрофон могут быть недоступны, если устройство уже используется другой вкладкой, браузером или программой.`
- EN: `Your camera or microphone may be unavailable if it is already being used by another tab, browser, or application.`

No testing-specific wording or "only one browser tab" claim remains.

## DEBRIEF_OPEN Completion

The Event owner sees `Завершить сессию` / `Complete Session` on a `DEBRIEF_OPEN` Session card. The button reuses `POST /api/sessions/[sessionId]/complete` and passes `closeDebriefForAll: true`, which calls the canonical completion path with `hardClose`. Normal active Session completion keeps the existing non-hard-close behavior.

The confirmation for the debrief action says:

- RU: `Завершить сессию и закрыть разбор для всех участников?`
- EN: `Complete this Session and close the debrief for all participants?`

## Test Matrix

- Focused E2E: `npm run test:e2e:focused:managed -- tests/e2e/stage-3-12b-wave1-corrections.spec.ts --project=chromium`
  - page scroll containment and right-panel scroll;
  - offline media labels and disabled icons;
  - neutral device copy;
  - owner media-control API authorization and pending command delivery;
  - completed Session disclosure;
  - `DEBRIEF_OPEN` complete action and hard-close result;
  - existing observer/debrief/speaker mapping corrections.
- Lint: `npm run lint`.

Manual verification and screenshot capture remain to be recorded during the final browser pass.

## Non-Scope

- No Prisma migration.
- No Voximplant scenario modification.
- No provider-secret or durable-lease change.
- No direct remote camera/microphone activation without target consent.
- No observer rail or Session room geometry change.
