# 13 — Voximplant server-stop POC (isolated)

Isolated proof of concept for server-controlled conference recording stop via Management API `StartConference` + media session HTTP control. Not integrated into `completeSessionCanonical()` / production room lifecycle.

## Scope

- Manual scripts under `scripts/poc/voximplant-server-stop/`
- Helpers under `lib/voximplant/poc/`
- Scenario variant: `docs/voximplant/neg-conf.server-stop-poc.scenario.js`
- Local ignored state: `.agent/voximplant-server-stop-poc.json`

## Non-goals

- No Prisma migration / DB persistence of control URLs
- No automatic live provider calls from tests
- No auto-deploy / scenario upload
- No change to default WebSDK join naming unless `VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC=true` and the Session is explicitly POC-marked

## Safety contract (Checkpoint A)

- **Dedicated POC rule only:** `VOXIMPLANT_SERVER_STOP_POC_RULE_ID` (required for live). Optional `VOXIMPLANT_SERVER_STOP_POC_RULE_NAME`. Never falls back to `VOXIMPLANT_MANAGEMENT_RULE_ID`, `VOXIMPLANT_RULE_NAME`, or GetRules discovery.
- **Production deny-list:** refuse with `POC_RULE_MATCHES_PRODUCTION` before any provider request when POC rule id/name matches production rule/scenario configuration.
- **Explicit live confirmation:** every real `StartConference` requires `--confirm-live-poc` (`LIVE_POC_CONFIRMATION_REQUIRED` otherwise; no network call).
- **Conference name prefix:** live names must start with `neg-poc-server-stop-` (`INVALID_POC_CONFERENCE_NAME`).
- **Scenario identity handshake:** ping must return `scenarioKind: "voximplant_server_stop_poc"` and `protocolVersion: 1` (`UNEXPECTED_SCENARIO_IDENTITY` otherwise).
- **Control URL hygiene:** full `media_session_access_secure_url` stored only in ignored local state; logs/errors expose fingerprint only.

## Contract (verified from `@voximplant/apiclient-nodejs`)

`StartConference` request (HTTP snake_case): `conference_name`, `rule_id`, optional `application_id` / `application_name`, `script_custom_data`.

Response fields: `media_session_access_url`, `media_session_access_secure_url`, `call_session_history_id`, `result`.

## Manual checkpoints

See `docs/voximplant/server-stop-poc-manual-checkpoints.md`.
