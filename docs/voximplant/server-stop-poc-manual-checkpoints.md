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

6. **Configure the same control secret** in both places:  
   - Local POC env: `VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET` (min 16 chars)  
   - Dedicated POC scenario: replace `CONTROL_SECRET` / `__PASTE_VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET_HERE__` with that same value (paste mechanism used by this scenario variant)

7. **Run dry-run first** (no provider call):  
   ```bash
   npm run poc:vox:start-conference -- --dry-run
   npm run poc:vox:ping -- --dry-run
   ```

8. **Run live StartConference only with explicit confirmation**:  
   ```bash
   npm run poc:vox:start-conference -- --confirm-live-poc
   ```  
   `--confirm-live-poc` confirms intent for a POC provider call only. It does **not** bypass rule validation, secret validation, production-rule protection, conference-name prefix checks, or scenario identity handshake.

Also set Management API auth as usual (`VOXIMPLANT_API_KEY_PATH` / `VOX_CI_CREDENTIALS` or API key vars).

Optional WebSDK join for Checkpoint B only:  
`VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC=true` + `VOXIMPLANT_SERVER_STOP_POC_SESSION_ID=<local-session-id>`.

---

## Checkpoint A — remote HTTP reachability

1. Activate the dedicated POC scenario + POC routing rule in Voximplant Console (setup above).
2. Dry-run first:  
   `npm run poc:vox:start-conference -- --dry-run`
3. Live start (requires dedicated POC rule id + confirmation):  
   `npm run poc:vox:start-conference -- --confirm-live-poc`
4. Confirm printed fields only: conference name (`neg-poc-server-stop-…`), media session id, URL fingerprint, success/error. Full control URL must never appear.
5. Run: `npm run poc:vox:ping`
6. Confirm ping response includes dedicated POC identity:  
   - `scenarioKind: "voximplant_server_stop_poc"`  
   - `protocolVersion: 1`  
   A generic HTTP 200 without these fields is **not** Checkpoint A success (`UNEXPECTED_SCENARIO_IDENTITY`).
7. In Voximplant logs, search for: `HttpRequest accepted action=ping` and build id `server-stop-poc-2026-07-20-a1`.
8. Confirm signed JSON response fields: `{ ok, action, operationId, state, errorCode, scenarioKind, protocolVersion }`.

Success: server can address the **dedicated POC scenario** via the control URL without browser involvement, and scenario identity is confirmed.

---

## Checkpoint B — real recorder stop

1. Start server-created POC conference:  
   `npm run poc:vox:start-conference -- --confirm-live-poc`
2. Enable WebSDK join override for one local Session only (`VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC=true` + linked session id / `poc-server-stop-*` prefix).
3. Connect one or two WebSDK participants to that exact conference name (`neg-poc-server-stop-…` only).
4. Confirm recording started (scenario auto-starts demo recorder on first participant).
5. Run: `npm run poc:vox:stop-recording`
6. Verify:
   - one command accepted (`state=stop_requested`);
   - one `recorder.stop()`;
   - `RecorderEvents.Stopped` in provider logs;
   - POC callback or terminal evidence (not merely HTTP 200);
   - recording artifact present when provider returns URL;
   - no browser relay involved for the stop command.
7. Re-run `npm run poc:vox:stop-recording` → idempotent (`already_stopped` / reused operationId).

Do **not** treat HTTP 200 alone as Checkpoint B success.

---

## Cleanup

```bash
npm run poc:vox:clear-state
```
