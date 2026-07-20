# Server-stop POC — Manual Checkpoints (DO NOT AUTO-EXECUTE)

## Checkpoint A setup (required before any live StartConference)

Configure an **isolated** Voximplant rule/scenario pair. Do **not** replace or edit the production room scenario (`neg-conf-main-room`). Routing rules launch the scenarios attached to them, so the POC rule/scenario pair must remain isolated from ordinary room traffic.

1. **Dedicated POC scenario** named `neg-conf-server-stop-poc`  
   Paste `docs/voximplant/neg-conf.server-stop-poc.scenario.js` into that scenario only.

2. **Dedicated POC routing rule** attached **only** to `neg-conf-server-stop-poc`  
   Do not point the production/default room rule at this scenario.

3. **POC-only routing pattern**, for example:  
   `^neg-poc-server-stop-.*`  
   Ordinary `negotiation-{sessionId}` room traffic must not match this pattern.

4. **The POC rule must not be the production room rule**  
   Known production rule names include `negotaitions-negotiation-room-rule` (and legacy `negotaitions-conference-rule`). The live command refuses if the configured POC rule id/name matches production configuration.

5. **Configure the exact POC rule ID locally** (required for live calls):  
   - `VOXIMPLANT_SERVER_STOP_POC_RULE_ID=<dedicated-poc-rule-id>`  
   - Optional: `VOXIMPLANT_SERVER_STOP_POC_RULE_NAME=<dedicated-poc-rule-name>`  
   - Do **not** rely on `VOXIMPLANT_MANAGEMENT_RULE_ID`, `VOXIMPLANT_RULE_NAME`, or automatic rule discovery. There is no production fallback.

6. **Configure separate secrets** (do not reuse one value for both):  
   - Control (server → scenario):  
     - Local: `VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET` (min 16 chars)  
     - Scenario paste: `CONTROL_SECRET` / `__PASTE_VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET_HERE__`  
   - Callback (scenario → app):  
     - Local: `VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET` (min 16 chars, different from control)  
     - Scenario paste: `CALLBACK_SECRET` / `__PASTE_VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET_HERE__`

7. **Exact local callback configuration** (POC-only; never product default):  
   ```bash
   VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED=true
   VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET=<dedicated-callback-secret-min-16>
   ```  
   Scenario paste:  
   ```text
   POC_CALLBACK_URL = "https://<your-reachable-host>/api/poc/voximplant/server-stop/callback"
   CALLBACK_SECRET  = "<same as VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET>"
   ```  
   Start the Next.js app so the callback route can receive events. The route returns 404 unless the enable flag is true.

8. **Run dry-run first** (no provider call):  
   ```bash
   npm run poc:vox:start-conference -- --dry-run
   npm run poc:vox:ping -- --dry-run
   ```

9. **Run live StartConference only with explicit confirmation**:  
   ```bash
   npm run poc:vox:start-conference -- --confirm-live-poc
   ```  
   `--confirm-live-poc` confirms intent for a POC provider call only. It does **not** bypass rule validation, secret validation, production-rule protection, or conference-name prefix checks.

Also set Management API auth as usual (`VOXIMPLANT_API_KEY_PATH` / `VOX_CI_CREDENTIALS` or API key vars).

Optional WebSDK join for Checkpoint B only:  
`VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC=true` + `VOXIMPLANT_SERVER_STOP_POC_SESSION_ID=<local-session-id>`.

---

## Checkpoint A — remote HTTP reachability (result)

### PASSED

- Dedicated POC scenario launched (`neg-conf-server-stop-poc`)
- Control URL obtained
- HTTP command reached scenario (`AppEvents.HttpRequest` registered; log: `HttpRequest accepted action=ping`)
- Control HMAC accepted
- Correct scenario confirmed by VoxEngine log

### Corrected assumption

Synchronous response-body identity (`scenarioKind` / `protocolVersion` in the control URL HTTP response) was a **false assumption**. Observed platform behavior: HTTP 200 without those fields is valid transport; clients must not classify it as `UNEXPECTED_SCENARIO_IDENTITY`.

### Revised confirmation procedure

1. Activate dedicated POC scenario + rule; configure callback URL + `CALLBACK_SECRET`; enable local callback flag; start POC app.
2. Dry-run: `npm run poc:vox:start-conference -- --dry-run` then `npm run poc:vox:ping -- --dry-run`
3. Live start: `npm run poc:vox:start-conference -- --confirm-live-poc`  
   Confirm printed fields only: conference name (`neg-poc-server-stop-…`), media session id, URL fingerprint. Full control URL must never appear.  
   **Never paste raw `Application.Started`** (contains `accessURL` / `accessSecureURL`).
4. Immediately ensure callback receiver is running (session idle TTL ≈ 60s without WebSDK).
5. Run: `npm run poc:vox:ping`  
   - HTTP 2xx ⇒ `TRANSPORT_ACCEPTED` only  
   - Success ⇒ `PING_COMMAND_CONFIRMED` when matching signed callback arrives (`scenarioKind=voximplant_server_stop_poc`, `protocolVersion=1`, `eventType=command_accepted`, `action=ping`, same `operationId`)  
   - Optional: `--no-wait` for transport-only diagnostics (explicitly non-terminal)
6. In Voximplant logs, search for: `HttpRequest accepted action=ping` and build id `server-stop-poc-2026-07-20-a2`.

---

## Checkpoint B — real recorder stop (timing revised)

Idle media sessions without WebSDK participants terminate after ~**60 seconds**. Sequence:

1. Start server-created POC conference:  
   `npm run poc:vox:start-conference -- --confirm-live-poc`
2. **Immediately** start POC app/runtime (callback enabled) so async evidence can be received before idle expiry.
3. **Connect a WebSDK participant before idle scenario termination** (enable join override for one local Session: `VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC=true` + linked session id / `poc-server-stop-*` prefix). Join the exact conference name (`neg-poc-server-stop-…` only).
4. Confirm recording started (scenario auto-starts demo recorder on first participant).
5. Run: `npm run poc:vox:stop-recording`
6. Verify evidence model:
   - HTTP 2xx → `transportAcceptedAt` (`TRANSPORT_ACCEPTED` only)
   - `command_accepted` callback → `commandAcceptedAt` (not terminal)
   - `recording_stopped` / `RecorderEvents.Stopped` callback → `providerTerminalAt` (**required for success**)
   - recording artifact present when provider returns URL
   - no browser relay involved for the stop command
7. Re-run `npm run poc:vox:stop-recording` → idempotent (same `operationId`).

Do **not** treat HTTP 200 alone as Checkpoint B success. Do **not** reuse an expired control URL; require a fresh StartConference.

---

## Cleanup

```bash
npm run poc:vox:clear-state
```
