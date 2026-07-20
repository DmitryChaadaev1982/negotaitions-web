# Server-stop POC — Manual Checkpoints (FALLBACK / DO NOT AUTO-EXECUTE)

> **Preferred path:** use the bounded orchestrator  
> `npm run poc:vox:run -- --confirm-live-poc` (transport/full/dry-run).  
> This document remains as a **fallback troubleshooting procedure** when the
> orchestrator cannot be used.

## Checkpoint A setup (required before any live StartConference)

Configure an **isolated** Voximplant rule/scenario pair. Do **not** replace or edit the production room scenario (`neg-conf-main-room`). Routing rules launch the scenarios attached to them, so the POC rule/scenario pair must remain isolated from ordinary room traffic.

1. **Dedicated POC scenario** named `neg-conf-server-stop-poc`  
   Paste `docs/voximplant/neg-conf.server-stop-poc.scenario.js` into that scenario only.

2. **Dedicated POC routing rule** attached **only** to `neg-conf-server-stop-poc`  
   Do not point the production/default room rule at this scenario.

3. **Exact Voximplant Console routing (full browser-first mode)**  
   - Rule name (suggested): `neg-poc-server-stop-rule`  
   - Pattern (destination / conference): `neg-poc-server-stop-*` (or regex `^neg-poc-server-stop-.*`)  
   - Scenario: `neg-conf-server-stop-poc` only (build marker `server-stop-poc-2026-07-20-c1`)  
   - **Priority / order: above** `negotaitions-conference-rule` (and any other production conference rule) so POC names never fall through to `neg-conf`  
   - Do **not** edit `negotaitions-conference-rule` / production pattern  
   Ordinary `negotiation-{sessionId}` room traffic must not match the POC pattern.

4. **The POC rule must not be the production room rule**  
   Known production rule names include `negotaitions-negotiation-room-rule` (and legacy `negotaitions-conference-rule`). The live command refuses if the configured POC rule id/name matches production configuration. Full mode also refuses `session_registered` callbacks that report production rule/scenario/build.

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
   VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC=true
   ```  
   Scenario paste:  
   ```text
   POC_CALLBACK_URL = "https://<your-reachable-host>/api/poc/voximplant/server-stop/callback"
   CALLBACK_SECRET  = "<same as VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET>"
   ```  
   Start the Next.js app from **this POC worktree** so the callback route can receive events. The route returns 404 unless the enable flag is true.

8. **No per-Session env editing / no restart for Session binding**  
   The orchestrator (or manual `StartConference` + run pointer) binds `linkedSessionId` dynamically via `.agent/voximplant-server-stop/current.json`. Do **not** set `VOXIMPLANT_SERVER_STOP_POC_SESSION_ID`.

9. **Run dry-run first** (no provider call):  
   ```bash
   npm run poc:vox:run -- --dry-run
   ```

10. **Preferred live commands:**  
    ```bash
    npm run poc:vox:run -- --mode=transport --confirm-live-poc
    npm run poc:vox:run -- --mode=full --confirm-live-poc --confirm-local-db-write
    ```

Also set Management API auth as usual (`VOXIMPLANT_API_KEY_PATH` / `VOX_CI_CREDENTIALS` or API key vars).

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

### Revised confirmation procedure (manual fallback)

1. Activate dedicated POC scenario + rule; configure callback URL + `CALLBACK_SECRET`; enable local callback flag; start POC app.
2. Dry-run: `npm run poc:vox:run -- --dry-run`
3. Live transport: `npm run poc:vox:run -- --mode=transport --confirm-live-poc`  
   Or legacy: `npm run poc:vox:start-conference -- --confirm-live-poc` then `npm run poc:vox:ping`
4. Confirm printed fields only: conference name (`neg-poc-server-stop-…`), media session id, URL fingerprint. Full control URL must never appear.  
   **Never paste raw `Application.Started`** (contains `accessURL` / `accessSecureURL`).
5. Local-only (no provider): `npm run poc:vox:test-callback -- --dry-run` then `npm run poc:vox:test-callback`.
6. Join selection diagnostic: `npm run poc:vox:join-plan`.

---

## Checkpoint B — real recorder stop (FALLBACK troubleshooting)

> Prefer: `npm run poc:vox:run -- --mode=full --confirm-live-poc --confirm-local-db-write`

Idle media sessions without WebSDK participants terminate after ~**60 seconds**. Manual sequence if orchestrator is unavailable:

1. Start server-created POC conference:  
   `npm run poc:vox:start-conference -- --confirm-live-poc`
2. Ensure POC app/runtime is running (callback enabled) so async evidence can be received.
3. Join WebSDK participants to the **active run** linked Session (flag on; dynamic `current.json` binding — no Session env edit).
4. Confirm recording started (application negotiation start / recording-control start).
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
npm run poc:vox:cleanup -- --dry-run
npm run poc:vox:cleanup -- --run-id <runId> --confirm-cleanup --confirm-local-db-write
# legacy local state clear (does not delete DB entities):
npm run poc:vox:clear-state
```
