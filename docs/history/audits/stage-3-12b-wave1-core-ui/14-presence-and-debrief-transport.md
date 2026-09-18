# 14 — Immediate away presence and long-debrief transport recovery

Stage 3.12B-W1. Branch `ui/stage-3-12b-wave1-core-ui`, starting SHA `6ccd252`.

Two defects reported from manual testing on event `cms7ru4bi0000t8uaoxjonu23`
and session `cmsd58m9i00001gua9z1n22z2`:

- **A.** Leaving a Session through a navigation that bypasses the Event lobby
  left other participants looking at `В сессии` for about two minutes, then
  `Временно вышел` for about two more, before `Оффлайн`.
- **B.** A Session left open in `DEBRIEF_OPEN` eventually raised the Next.js
  development error overlay carrying
  `class=TERMINAL_PROVIDER_FAILURE reason=unclassified_provider_failure phase=connected scope=GW Transport`.

---

## A. Presence

### A1. The exact broken navigation paths

The Session room header offered five ways out. Only one of them told the server
anything:

| Control | Destination | Behaviour at `6ccd252` |
| --- | --- | --- |
| `back-to-event-lobby-button` | Event lobby | `onReturnToEventLobby` → explicit leave |
| Voximplant leave button | session materials | `handleLeave` → explicit leave |
| `back-to-sessions-button` | `/sessions` | plain `SecondaryButtonLink` |
| `session-materials-link` | `/sessions/{id}/materials` | plain `GradientButtonLink` |
| Brand logo (both variants) | `/dashboard` | plain `Link` |
| `RejoinNavLink` | `/rejoin` | plain `Link` |

The closed-session overlay had the same split: its lobby button ran the explicit
leave only when the room passed a handler, and its materials button never did.

The reported path is any of the four plain links. They navigate with the Next.js
router, so the room unmounts and the client stops heartbeating, but no
`SessionRoomConnection` field changes.

### A2. Why presence then waited for the lease

`SessionRoomConnection` is a lease: `expiresAt` is set to
`PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS` (120 s) ahead of now on claim and
on every heartbeat, and the heartbeat runs every
`PRESENCE_HEARTBEAT_INTERVAL_MS` (15 s). A row with no terminal marker stays
active until `expiresAt` passes, so the observed timeline follows directly:

- up to 120 s of `IN_SESSION` while the abandoned lease runs out;
- then 120 s of `TEMPORARILY_AWAY`, the recent-disconnect window;
- `OFFLINE` roughly four minutes after the user actually left.

A second, narrower defect made the same delay possible even for a *correct*
explicit leave. `latestTerminalTimestamp` took the maximum of `disconnectedAt`,
`revokedAt`, `supersededAt` and `expiresAt` once expired. An explicitly
terminated row keeps whatever expiry the last heartbeat wrote, up to a full
lease into the future; when that abandoned expiry lapsed it became the newest
candidate and restarted the away window, delaying `OFFLINE` by up to another
120 s after the grace period had already elapsed.

### A3. Correction

**One canonical exit.** `SharedRoomShell` now takes a single `onExitSession`
handler and routes every product exit through it via `RoomExitControl`
(`components/room-exit-control.tsx`). `BrandLogo` and `RejoinNavLink` accept an
optional `onNavigate` and render a button instead of a link when the room
supplies one. `VoximplantNegotiationRoomPage.handleExitSession` forwards the
destination to the existing `performLeaveAndNavigate`, so lobby and non-lobby
exits share one implementation and differ only in where they land. Outside the
room those components keep rendering ordinary links.

`lib/client/session-exit-navigation.ts` states which triggers are intentional
and which are not. `route-unmount` is deliberately on the disappearance list:
attaching an explicit leave to unmount would turn a refresh into a departure.

**Terminal timestamp semantics.** `latestTerminalTimestamp` now prefers explicit
terminal markers and only falls back to a lapsed `expiresAt` when there is none:

```
EXPLICIT_LEAVE: recent-away starts at disconnectedAt / revokedAt / supersededAt
NETWORK_LOSS:   recent-away starts when expiresAt has passed
```

No timestamp is backdated or synthesised. A stale future expiry on an explicitly
terminated connection can no longer override its own earlier terminal time.

**Unchanged.** Lease TTL, heartbeat cadence, validate-versus-renew separation,
explicit-leave idempotency, duplicate-tab protection, the five presence states
and their precedence, and the `Session` lifecycle. No Prisma migration: the
correction uses `disconnectedAt`, which the schema already had.

### A4. Grace period and polling

| Value | Source |
| --- | --- |
| Grace window (120 s) | `PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS`, `lib/presence.ts` |
| Lobby poll (3 s visible, 10 s hidden) | `EVENT_LOBBY_POLL_INTERVAL_MS`, `lib/event-state-polling.ts` |
| Heartbeat (15 s) | `PRESENCE_HEARTBEAT_INTERVAL_MS`, `lib/presence.ts` |

`GET /api/events/[id]/state` was already `dynamic = "force-dynamic"`,
`revalidate = 0` and `Cache-Control: no-store`, and the lobby fetches it with
`cache: "no-store"`. Caching was not a contributor and nothing about polling
changed; the endpoint simply had nothing new to report until the lease lapsed.

### A5. Resulting timeline

| Event | Observer sees |
| --- | --- |
| Intentional exit through any product action | `Временно вышел` on the next poll (≤ 3 s), media icons grey and not actionable |
| 120 s after that departure | `Оффлайн` |
| Refresh | no leave persisted, row stays active, participant stays `В сессии` |
| Tab close / network loss | no terminal marker, presence follows `expiresAt` exactly as before |

---

## B. Gateway WebSocket closure in `DEBRIEF_OPEN`

### B1. What the SDK actually gives us

The captured line, kept verbatim in
`lib/voximplant/provider-fault-simulation.ts` as
`GATEWAY_WEBSOCKET_CLOSE_SDK_LOG`:

```
[WEBSDK] [GW Transport] WS transport 1f4c9a20-… closed with error {"isTrusted":true}
```

There is no `CloseEvent` object, no `code`, no `reason` and no `wasClean`. The
SDK logs through `onLogCallback`, which receives strings, and the trailing
payload is a serialized DOM event: `code`, `reason` and `wasClean` are prototype
accessors on `CloseEvent`, so `JSON.stringify` keeps only the own enumerable
`isTrusted`. The reliable structured evidence is therefore:

| Field | Available | Value here |
| --- | --- | --- |
| logger scope | yes | `GW Transport` |
| log level | yes | `ERROR` |
| socket-close wording | yes | `WS transport <id> closed …` |
| `isTrusted` | yes | `true` |
| close code / reason / `wasClean` | only when the SDK prints them | absent |
| lifecycle phase | from the surface, not the SDK | `connected` |

### B2. Root cause of `unclassified_provider_failure`

`parseVoxProviderSignal` looks for a constructor name (`…Error`/`…Exception`), a
three-digit transport code and an `actionName`. This line has none: "closed with
error" is prose, not a type. Every branch of `classifyVoxProviderFailure` missed,
so it fell through to the terminal unknown branch, `logLevelForClassification`
returned `error` for `unknown`, and Next.js turns any `console.error` in
development into the overlay.

### B3. New classification

`VoxProviderSignal` gained `transportClosure`, parsed only from the SDK's own
socket-close wording (`/\b(?:ws|websocket)\s+transport\b[^\n]*?\bclosed\b/i`) and
only honoured when the scope is a transport scope. The classifier then decides,
in this order:

| Evidence | Class | Reason |
| --- | --- | --- |
| `AuthError`-family type or transport code 401/403 | `TERMINAL_PROVIDER_FAILURE` | `provider_authorization_rejected` |
| close code 1008 / 4401 / 4403 | `TERMINAL_PROVIDER_FAILURE` | `provider_authorization_rejected` |
| closure during intentional teardown or handoff | `EXPECTED_DURING_INTENTIONAL_TEARDOWN` | `gateway_websocket_closed_during_teardown` |
| closure while connected, retry budget left | `RECOVERABLE_TRANSIENT` | `gateway_websocket_closed` |
| closure with the budget spent | `TERMINAL_PROVIDER_FAILURE` | `transport_retry_budget_exhausted` |
| anything else | unchanged | `unclassified_provider_failure` / `application_invariant_failure` |

Deliberately *not* reclassified: a `GW Transport` message that is not a socket
close, socket-close wording logged from a non-transport scope, and any
`isTrusted:true` event without transport evidence. All three stay unknown and
loud. The taxonomy is asserted against the verbatim captured string so it cannot
drift from what the SDK emits.

### B4. Console policy

| Classification | Level |
| --- | --- |
| `EXPECTED_DURING_INTENTIONAL_TEARDOWN` | `console.debug` |
| `RECOVERABLE_TRANSIENT`, known terminal | `console.warn` |
| unknown provider failure, application invariant | `console.error` |

`logLevelForClassification` was already shaped this way; the fix is that the
gateway close is no longer `unknown`. No global console patch was added and the
previously removed runtime-error suppressor was not reintroduced.

### B5. Recovery behaviour

`lib/voximplant/session-transport-recovery.ts` supplies the application-side
verdict. It **observes**; it never connects, logs in, joins or touches media, so
it cannot create a second provider membership or re-prompt for the camera. After
a closure it waits a 4 s quiet period and then checks that no further closure
arrived and that the conference still reports itself connected. Scheduling, the
attempt budget and cancellation are delegated to the existing
`createProviderConnectRunner` (4 attempts, 0.8 s → 4 s backoff), so there is one
retry engine rather than two.

The room hook wires it to the SDK log sink through the new `onClassified` hook
and only for `reason === "gateway_websocket_closed"`. Ownership is checked on
every note and every attempt, so a stale tab or a room whose client the Event
lobby has taken over cannot drive recovery; unmount cancels it and no state is
published afterwards.

The UI is non-blocking: `room-transport-reconnecting` while recovering,
`room-transport-degraded` with a retry control once the budget is spent. The
Session shell, notes, case content and header stay mounted throughout.

`SessionRoomConnection` heartbeats, the recording lifecycle and
`OPEN → DEBRIEF_OPEN → CLOSED` are untouched: a client socket blip is not
evidence that the participant left or that the Session should close.

### B6. Deterministic seam

`gateway-ws-close-connected` was added to the server-gated fault modes. It waits
for the room to reach the connected phase (bounded at 15 s) and then replays the
captured line through `dispatchVoxSdkLog`, so parsing, classification, the
console policy and the recovery sequence are all exercised end to end. It is
inert unless the server runs with `EXTERNAL_SERVICES_MODE=mock` and is not
reachable from a query parameter.

During the E2E run the real room reached the gateway, so the injected closure was
classified in the true reported state:

```
[vox-provider] surface=session-room class=RECOVERABLE_TRANSIENT
reason=gateway_websocket_closed phase=connected scope=GW Transport closeCode=unknown
```

---

## Test matrix

| Area | Location | Cases |
| --- | --- | --- |
| Presence resolution | `lib/event-participant-presence.test.ts` | grace starts at the terminal timestamp; a stale future expiry never extends it; network loss stays lease-based; an unexpired lease keeps `IN_SESSION`; reconnect during grace reports the new location; repeated leave does not move the window (6 new cases, 18 in the file) |
| Intentional exit | `lib/client/session-exit-navigation.test.ts` | all six exit actions persist exactly one leave and navigate; lobby and dashboard share one implementation; all six disappearance events stay lease-based; unmount is not an exit; duplicate leave is idempotent; navigation does not wait for provider teardown; a failed leave keeps the user in the room |
| Gateway classification and recovery | `lib/voximplant/gateway-transport-recovery.test.ts` | verbatim signal parsing; recoverable while connected; expected during teardown; terminal on auth evidence and on codes 1008/4401/4403; non-terminal code 1006 still recoverable; non-close `GW Transport` and non-transport scope stay unknown; invariant stays `console.error`; the sink emits one warn and no error; one sequence per incident; no duplicate sequence from concurrent callbacks; bounded to four attempts; unmount cancels; stale owner cannot recover; no false success; controller cannot touch connection or media |
| End to end | `tests/e2e/stage-3-12b-presence-and-debrief-transport.spec.ts` | exit to Sessions overview and to materials → one leave, terminal row, `TEMPORARILY_AWAY` within one poll, grey non-actionable media, `OFFLINE` after the grace window; logo exit to dashboard; lobby exit shares the same single call; refresh persists no leave and keeps one active lease; tab close leaves no terminal marker; `DEBRIEF_OPEN` gateway close recovers with no overlay, no console error, shell intact, lifecycle `DEBRIEF_OPEN`, no recording row, no second connection; terminal auth failure stays terminal with no retry loop |
| Regression | `tests/e2e/stage-3-12b-room-lobby-media-handoff.spec.ts` | 12/12 unchanged: first-click navigation, delayed teardown, transport 408, gateway unavailable, ICE restart timeout, bounded recovery, terminal auth, duplicate-tab protection |

Focused unit totals: 18 presence, 17 intentional exit, 20 gateway
classification and recovery.

Heavy gates after the runtime change: `validate:fast` (703 unit tests),
`validate:deploy` (production build), `test:e2e:smoke` (12),
`test:e2e:smoke:browser` (5), `test:stage310` (102 unit + 37 managed browser).
`test:e2e:observer:layout` was not run.

---

## Manual evidence

The gateway closure cannot be produced on demand against the live gateway, so
the deterministic seam is the primary proof, and the classification line quoted
in B6 is the captured evidence that it ran in the `connected` phase.

Presence was re-checked in the browser against event
`cms7ru4bi0000t8uaoxjonu23` after the automated suites passed; see the
completion report for the recorded result.

---

## Limitations

- Close code, reason and `wasClean` are only used when the SDK prints them. For
  the observed line they do not exist, so the verdict rests on scope, the SDK's
  close wording and the lifecycle phase.
- Recovery infers success from the conference's own connected state after a
  quiet period rather than from a gateway-level "reconnected" event, because the
  SDK exposes none.
- Presence for a refresh, tab close or network loss still follows the lease by
  design; no terminal timestamp exists for those and none is invented.
- The Session shell is still media-gated on the *initial* join. That backlog
  item is unchanged and out of scope here, which concerns an already established
  connection.
