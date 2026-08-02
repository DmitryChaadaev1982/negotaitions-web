# 11 — Session room to Event lobby media handoff

Stage 3.12B-W1. Branch `ui/stage-3-12b-wave1-core-ui`, starting SHA `ea4a434`.

## 1. Reported defect

Returning from a Session room to the parent Event lobby was slow, and one
participant received the Next.js development error overlay carrying three
Voximplant WebSDK failures:

1. `[WEBSDK] [Connection] Transport creation failed with error TransportTimeoutError: Transport establishing failed with code 408. Rejected due to time`
2. `[WEBSDK] [Connection] ConnectionNetworkError: Failed to connect to gateway. No transport established`
3. `[WEBSDK] [ReInviteQueue_…] Action failed: actionName: "IceRestartAction" reason: Action run failed to timeout`

Affected event `cms7ru4bi0000t8uaoxjonu23`, session join link `DcWu6e0DvNTKR0Cgb7Dlx`,
observed through the local HTTPS reverse tunnel.

## 2. Reproduction

The defect was reproduced deterministically without the tunnel, at two levels.

**Static proof against the vendored SDK.** `node_modules/@voximplant/websdk`
contains:

```js
class Core {
  static init(e) {
    if (Core.instance)
      return Core.instance.logger?.info("Voximplant already initialized. Skip new options."),
             Core.instance;
    ...
  }
}
```

A second `Core.init(...)` returns the first instance and **discards the new
options**, including the logger.

**Behavioural proof against the pre-change code.** Feeding the three observed
messages through the code paths that existed at `ea4a434`:

| Observed failure | `webSdkLogFilter` (session room) | `isRecoverableVoxSignallingError` (lobby) | dev console suppressor allowlist |
| --- | --- | --- | --- |
| Transport 408 | `console.error` | `false` → `console.error` | covers code 500 only, not 408 |
| `ConnectionNetworkError` | `console.error` | `false` → `console.error` | not covered |
| `IceRestartAction` timeout | `console.error` | `false` → `console.error` | not covered |

Every path reached `console.error`, and Next.js raises the development overlay
on `console.error`.

## 3. Root cause

Classification: **MIXED** — `SHARED_WEBSDK_SINGLETON_RACE` +
`RECOVERABLE_PROVIDER_ERROR_MISHANDLED` + `PROVIDER_DISCONNECT_JOIN_OVERLAP`,
surfaced by `LOCAL_REVERSE_TUNNEL_LATENCY_ONLY` but not caused by it.

### Exact failure sequence

1. The Session room mounts first and calls `Core.init({ logger: { callbackLogLevel: Error, onLogCallback: → hook-local webSdkLogFilterRef } })`.
   The callback closes over that hook instance.
2. The user clicks **Back to lobby**. `runExplicitLeaveSequence` persists the
   leave, navigates, and then disconnects the provider. The Session route
   unmounts; nothing detaches the SDK logger, because `Core` has no teardown and
   the callback is owned by the singleton.
3. The Event lobby mounts and calls `Core.init({})`. The SDK logs
   *"Voximplant already initialized. Skip new options."* and returns the same
   instance. The lobby's own (empty) logger options are ignored, so the
   **unmounted Session room's callback now handles the lobby's log stream**.
4. Under reverse-tunnel latency the lobby's gateway connection fails with
   `TransportTimeoutError` 408, then `ConnectionNetworkError`, then a failed
   `IceRestartAction`.
5. Each of these reaches the dead Session callback, matches none of the three
   benign signatures, and is forwarded to `console.error` →
   **full-screen Next.js development error overlay**.
6. Independently, the lobby had **no retry**: the first connect failure set a
   terminal error and cleaned up, so a transient handoff failure permanently
   disabled lobby video until a manual page refresh.
7. `waitForVoxClientIdle()` was **unbounded**. A Session `core.client.disconnect()`
   that never settles (dead transport behind the tunnel) left the lobby waiting
   for media indefinitely, which is the "takes a long time" half of the report.

### Secondary defects found while fixing

- A late Session teardown could call `core.client.disconnect()` on the **shared**
  client after the lobby had already connected on it, dropping the lobby's
  transport. There was no ownership concept on the singleton client.
- If the lobby initialised the singleton first, it passed `{}`, so the SDK's own
  default `enableConsoleLogger: true` applied and printed `Error`-level logs
  straight to `console.error`, bypassing every application filter.
- Failures of our own `/voximplant-access` endpoint (HTTP 403 `invalidAccess`)
  were indistinguishable from application invariant failures and were also being
  logged as fatal.

### Was this introduced by the Wave 1 correction?

**Pre-existing, and exposed by the Wave 1 correction.** Commit `7030e64` made
room exit navigate reliably on the first click. That is what made the
Session→lobby provider handoff happen promptly and repeatedly, which is when the
singleton-logger ownership bug and the missing lobby retry became reachable.
`7030e64` did not create any of the defects above, and its behaviour is
preserved unchanged.

## 4. Provider ownership model

One `Core` instance and one `core.client` exist per page. Two surfaces contend
for it: `session-room` and `event-lobby`.

- **Log ownership** — `lib/voximplant/websdk-core.ts`. `initVoxCore` installs one
  stable `onLogCallback` for the page lifetime. Surfaces register a sink with
  `registerVoxSdkLogSink`; the dispatcher reads the *current* sink at log time.
  Releasing a sink only clears it if it is still current, so a late Session
  unmount cannot detach the lobby that already took over. With no sink
  registered, logs are still classified under a `detached` surface.
- **Client ownership** — `lib/voximplant/browser-client-lifecycle.ts`.
  `acquireVoxClientOwnership(surface)` returns a handle whose `isCurrent()`
  becomes false once another surface claims the client. Teardown always releases
  local media, but only calls `core.client.disconnect()` while it still owns the
  client.

## 5. Route/media decoupling contract

```
USER_INTENT_TO_LEAVE_SESSION
  → EXPLICIT_LEAVE_DISPATCHED        (unchanged from 7030e64)
  → ROUTE_NAVIGATION_COMMITTED       (router.push before provider disconnect)
  → SESSION_ROUTE_UNMOUNTED
  → SESSION_PROVIDER_CLEANUP_FINALIZING   (bounded, ownership-gated)
  → LOBBY_ROUTE_RENDERED             (never waits for media)
  → LOBBY_PROVIDER_JOIN_SERIALIZED   (bounded idle barrier)
  → LOBBY_MEDIA_CONNECTED | LOBBY_MEDIA_DEGRADED
```

The Event lobby shell was already independent of the media transport: only the
event-state bootstrap gates the page, and the video pane is one panel. That is
now covered by tests, and the pane reports a non-blocking status instead of a
bare spinner.

## 6. Operation serialisation and bounds

| Bound | Value | Rationale |
| --- | --- | --- |
| `VOX_CLIENT_IDLE_WAIT_TIMEOUT_MS` | 4000 | The lobby stops waiting for a previous teardown and claims the client. Media degrades; the page never stalls. |
| `VOX_CLIENT_DISCONNECT_TIMEOUT_MS` | 4000 | A hung `disconnect()` releases the shared barrier for the next surface. |
| `VOX_HANDOFF_WINDOW_MS` | 15000 | Self-healing bound on the "intentional handoff" window, so teardown-noise downgrading cannot become permanent. |

`waitForVoxClientIdle` now returns `{ idle, timedOut, waitedMs }` instead of
blocking forever, and never throws: a stuck teardown must degrade media, not
block the page.

The handoff window is opened by `performLeaveAndNavigate` in the Session room and
closed by the lobby once its media connects (`endIntentionalProviderHandoff`),
because the room that opened it has usually unmounted by then.

## 7. Recoverable-error classification

`lib/voximplant/provider-error-classification.ts` classifies by SDK **error
type**, **transport status code** and **failed action name**, combined with the
current lifecycle phase. It never classifies by a broad substring such as
"timeout" — `new Error("Session timeout policy could not be applied")` is still
an application invariant failure.

| Signal | During intentional teardown / handoff | Outside teardown |
| --- | --- | --- |
| `TransportTimeoutError`, code 408 | `EXPECTED_DURING_INTENTIONAL_TEARDOWN` → debug | `RECOVERABLE_TRANSIENT` → warn + bounded retry; terminal once the budget is spent |
| `ConnectionNetworkError` / no transport established | `EXPECTED_DURING_INTENTIONAL_TEARDOWN` → debug | `RECOVERABLE_TRANSIENT` → warn + bounded retry |
| `IceRestartAction` timeout | `EXPECTED_DURING_INTENTIONAL_TEARDOWN` → debug | `RECOVERABLE_TRANSIENT` → warn + bounded retry |
| `AuthError` / transport 401, 403 | `TERMINAL_PROVIDER_FAILURE` → warn + error panel | same |
| `VoxAccessError` 401/403/409 | `TERMINAL_PROVIDER_FAILURE` → warn + error panel | same |
| `VoxAccessError` 408/429/5xx | `RECOVERABLE_TRANSIENT` → warn + bounded retry | same |
| Unrecognised `[WEBSDK]` failure | `TERMINAL_PROVIDER_FAILURE`, `unknown: true` → **console.error** | same |
| Application-origin error (no WebSDK signature) | `APPLICATION_INVARIANT_FAILURE` → **console.error** | same |

### Why terminal provider failures do not use `console.error`

`console.error` is reserved for failures the application cannot present as a
controlled state: our own invariants, and anything the taxonomy does not
recognise. A known provider outage already renders a lobby error panel with a
retry control, so escalating it to `console.error` would replace a usable page
with the development overlay — the exact symptom being fixed. Unknown failures
still reach `console.error` so nothing is silently swallowed.

Every classification emits one structured line:

```
[vox-provider] surface=event-lobby class=RECOVERABLE_TRANSIENT reason=transport_unavailable:408
  phase=connecting scope=Connection errorType=TransportTimeoutError code=408 attempt=1/4 :: <message>
```

## 8. Retry and degraded mode

`lib/voximplant/provider-connect-retry.ts`.

- **Attempts:** 4 (`DEFAULT_PROVIDER_CONNECT_RETRY_POLICY.maxAttempts`).
- **Backoff:** 800 ms, 1600 ms, 3200 ms; capped at 4000 ms.
- **Retryable:** only `RECOVERABLE_TRANSIENT` and
  `EXPECTED_DURING_INTENTIONAL_TEARDOWN`. Terminal and invariant classes stop
  immediately.
- **Terminal state:** lobby error panel plus a `event-lobby-voximplant-retry`
  button that resets the budget (`retryNow`).
- **Reset condition:** successful connect, manual retry, or remount.
- **Cancellation:** unmount calls `cancel()`, which wakes a sleeping backoff and
  publishes `cancelled` exactly once; no state is published afterwards.
- **Single flight:** concurrent `start()` calls share one run, so a double
  invocation cannot produce two provider room memberships.
- **Camera:** transport failures occur before media acquisition, so retries do
  not re-request camera or microphone permission.

While retrying, the lobby shows a non-blocking `event-lobby-video-connecting`
strip (`Connecting video…` / `Video connection delayed, retrying…`) and every
other lobby control stays usable.

## 9. Duplicate-tab compatibility

Unchanged. Server leases, the `vox-room-lifecycle` BroadcastChannel takeover and
the stale-connection banners all behave as before; `intentionalLeaveRef` still
suppresses stale banners only during a deliberate exit. Client ownership is a
separate, page-local concept that governs which surface may drive the shared SDK
client — it never relaxes lease enforcement. Covered by the
`duplicate-tab protection still activates in a real conflicting tab` test, which
asserts a superseded `SessionRoomConnection` row is still produced.

Explicit-leave behaviour from `7030e64` is untouched: one click navigates, a
double click produces at most one leave request, and a failed leave now also
closes the handoff window so the room keeps owning its provider.

## 10. Test seam

`lib/voximplant/provider-fault-simulation.ts` scripts only the provider
transport outcome. It is double-gated:

- `getVoxProviderFaultMode()` returns `"off"` unless
  `EXTERNAL_SERVICES_MODE=mock`, which only the Playwright web server sets.
- The mode is set per test through `POST /api/test/vox-provider-fault`, which
  returns 404 outside mock mode — the same pattern as the existing
  `/api/test/mock-external-service` route.
- The mode reaches the client as a server-component prop, never as a browser
  query parameter.

Modes: `transport-408`, `gateway-unavailable`, `ice-restart-timeout`,
`delayed-connect`, `delayed-disconnect`, `terminal-auth`,
`recover-after-first-failure`. The failure strings are copied verbatim from the
reported WebSDK output so classification is exercised against real messages.

Real navigation, real explicit leave, real React lifecycle, the real lobby shell,
the real connection-status UI and the real state machine all stay under test.

## 11. Test matrix

### Unit — `lib/voximplant/room-lobby-media-handoff.test.ts`, `lib/voximplant/websdk-core.test.ts`

| # | Requirement | Test |
| --- | --- | --- |
| 1 | Session generation becomes stale after navigation | `session generation becomes stale once navigation invalidates it` |
| 2 | Stale Session callback cannot reconnect | `stale session owner cannot reconnect or disconnect after lobby takeover` |
| 3 | Lobby join does not overlap unsafe teardown | `lobby join waits for session teardown on the shared client` (+ two bounded-barrier cases) |
| 4 | Lobby may render before media connects | `lobby reports a non-terminal connecting state while media is pending` |
| 5 | Transport 408 during handoff recoverable | `transport 408 during handoff is expected teardown noise, never console.error` |
| 6 | `ConnectionNetworkError` during handoff recoverable | `gateway ConnectionNetworkError during handoff is expected teardown noise` |
| 7 | ICE restart timeout during teardown expected | `ICE restart timeout during intentional teardown is expected` |
| 8 | Same error outside teardown takes retry/terminal path | `the same provider errors outside teardown retry, then become terminal` |
| 9 | Unknown error not swallowed | `unknown provider and application errors stay visible` |
| 10 | Retry is bounded | `retry stops at the configured attempt budget` |
| 11 | Unmount cancels pending retry | `cancel stops a pending retry and prevents further attempts` |
| 12 | Double invocation idempotent | `concurrent start calls produce a single connect sequence` |
| 13 | Media release called once | `media release runs once across overlapping teardown paths` |
| 14 | No state update after owner invalidated | `no state is published after the runner is cancelled` |

Plus singleton-ownership coverage: both surfaces share one core and one
classifying callback, the lobby sink replaces the session sink, detached logs are
still classified, unclassified SDK failures stay fatal, and benign SDK race logs
remain a single warn line.

### E2E — `tests/e2e/stage-3-12b-room-lobby-media-handoff.spec.ts`

12 independent tests: participant first-click return, facilitator first-click
return, rapid double click, delayed lobby connect, delayed previous teardown,
transport 408, gateway unavailable, ICE restart timeout, bounded-retry recovery,
terminal authorization failure, return from a `FINISHED`/`DEBRIEF_OPEN` session,
and real duplicate-tab protection.

Overlay detection uses `nextjs-portal [data-nextjs-dialog-overlay]` and
`nextjs-portal [data-issues]`. `nextjs-portal` itself is always present in dev
because it hosts the Dev Tools button, so its presence is not a signal.

Console allowlist (everything else fails the test): resource-load failures,
favicon, React DevTools notice, `net::ERR_*`, Fast Refresh, hydration warnings,
and `WebSocket is already in CLOSING or CLOSED state`. The last one is emitted by
Chromium itself when the SDK transport writes a final frame while the shared
socket is already closing during the handoff; it cannot be prevented without
modifying the vendored SDK, and Next.js does not collect it into the overlay.

## 12. Measured timings

| Scenario | Measurement |
| --- | --- |
| Participant leave click → Event lobby shell visible | ~1.3 s warm (13.7 s on the first run of a cold Next.js compile) |
| Facilitator leave click → lobby shell visible | test completes in 6.3 s including room open |
| Delayed lobby provider connect (1.5 s scripted) | lobby shell immediate, connecting strip visible, media connects; test 4.0 s |
| Delayed previous teardown (2.5 s scripted) | lobby shell immediate and usable throughout; test 4.6 s |
| Transport 408 / gateway / ICE, full 4-attempt budget | terminal panel after ~7.6 s per scenario, lobby usable the whole time |
| Bounded-retry recovery | 2.4 s |

Heavy gates: `validate:fast` 67 s, `validate:deploy` 95 s, API smoke 14 s,
browser smoke 33 s, `test:stage310` 31 s, handoff E2E 92 s.

## 13. Local reverse-tunnel limitations

- The tunnel at `https://local.negotaitions.ru` is reachable and serves the app,
  but `/events/<id>/lobby` requires an authenticated session, so the interactive
  matrix in §17 of the task (two real users, cameras on/off, simultaneous
  transitions) could not be executed autonomously.
- The supplied fixtures still exist locally but are no longer in a state that can
  reproduce the original transition: event `cms7ru4bi0000t8uaoxjonu23` is
  `SESSION_CREATED`, and both of its sessions
  (`cms7rw2qe0007t8ua7jwky9nr`, `cmsc46smr002o74ualyqx7ig9`) are
  `negotiationState=FINISHED`, `roomLifecycle=CLOSED`. Join token
  `DcWu6e0DvNTKR0Cgb7Dlx` maps to an `OBSERVER` in the closed session.
- Provider latency under the tunnel is not reproducible on demand, which is why
  the regression suite uses the scripted transport seam instead.

## 14. Remaining risks and deferred issues

- **Session room shell is still gated on media.** `voximplant-negotiation-room-page.tsx`
  renders "Connecting to video room…" until `mediaLoading` clears, so a stalled
  room join still blocks the room page. Only the Event lobby was in scope here.
  Decoupling the room shell is the natural follow-up.
- **`tests/e2e/stage-3-12b-observer-scaling.spec.ts` → "observer rail remains bounded
  across required viewport samples" is budget-marginal on this machine.** It opens
  13 rooms against the live Voximplant gateway inside the repo-wide 60 s per-test
  budget. Measured: fails at 60 s, passes in 72 s with `--timeout=240000`. The
  other 14 tests in that file pass, including the 100-observer case, using the
  same `openRoom` helper. Not caused by this change and deliberately not "fixed"
  by raising a timeout.
- **The lobby video pane is still replaced by the error panel in the terminal
  state.** Other lobby controls remain usable because the pane is one panel of
  the page, but the pane itself shows no participant tiles until retry succeeds.
- **`installVoxRuntimeErrorSuppressor` is no longer used by the lobby.** The SDK
  console logger is now disabled at init, so the global `console.error` patch and
  its restore-ordering hazard were removed from the lobby lifecycle.
  `installVoxCameraErrorSuppressor` is unchanged and still wraps camera
  acquisition only.
- The pending whole-page Event lobby scroll correction remains out of scope.
