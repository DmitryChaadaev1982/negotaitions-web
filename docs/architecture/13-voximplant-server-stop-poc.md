# 13 — Voximplant server-stop POC (isolated)

Isolated proof of concept for server-controlled conference recording stop via Management API `StartConference` + media session HTTP control. Not integrated into `completeSessionCanonical()` / production room lifecycle.

## Scope

- Manual scripts under `scripts/poc/voximplant-server-stop/`
- Helpers under `lib/voximplant/poc/`
- Scenario variant: `docs/voximplant/neg-conf.server-stop-poc.scenario.js`
- POC-only callback route: `POST /api/poc/voximplant/server-stop/callback` (flag-gated)
- Local ignored state: `.agent/voximplant-server-stop-poc.json`

## Non-goals

- No Prisma migration / DB persistence of control URLs or callback events
- No automatic live provider calls from tests
- No auto-deploy / scenario upload
- No change to default WebSDK join naming unless `VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC=true` and the Session is explicitly POC-marked

## Checkpoint A result (revised)

**PASSED (transport + HMAC + dedicated scenario):**

- Dedicated POC scenario launched (`neg-conf-server-stop-poc`, ruleId observed in live run)
- Control URL obtained from `StartConference`
- Signed HTTP command reached the scenario (`AppEvents.HttpRequest` registered)
- Control HMAC accepted (`HttpRequest accepted action=ping`)
- Correct scenario confirmed by VoxEngine log (not by HTTP response body)

**False assumption corrected:** synchronous response-body identity verification via `AppEvents.HttpRequest` returning arbitrary JSON (`scenarioKind` / `protocolVersion`) is **unsupported** by the observed platform contract. An empty/non-JSON HTTP 200 is valid transport behavior and must not produce `UNEXPECTED_SCENARIO_IDENTITY`.

**Revised automated confirmation:** after transport accept, wait for a signed asynchronous POC callback (`eventType=command_accepted`, matching `operationId`, dedicated `scenarioKind` / `protocolVersion`).

## Control transport semantics

HTTP 2xx from `media_session_access_secure_url` means only `TRANSPORT_ACCEPTED`.

It does **not** mean:

- scenario identity verified
- command executed
- recorder stopped
- provider terminal state reached

Typed outcomes include: `TRANSPORT_ACCEPTED`, `TRANSPORT_REJECTED`, `TRANSPORT_TIMEOUT`, `COMMAND_ACCEPTED`, `COMMAND_REJECTED`, `PROVIDER_TERMINAL`, plus ping-specific `PING_COMMAND_CONFIRMED` / `PING_CALLBACK_TIMEOUT` / `PING_CALLBACK_REJECTED`.

## Async POC callback

- Route: `POST /api/poc/voximplant/server-stop/callback`
- Enabled only when `VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED=true` (default off)
- Secret: `VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET` (scenario `CALLBACK_SECRET`) — **never** reuse `CONTROL_SECRET`
- HMAC-SHA256 + timestamp window + nonce replay protection + constant-time compare
- Events appended to local `.agent/voximplant-server-stop-poc.json` (bounded, e.g. 50); no DB writes

## Recorder stop evidence (Checkpoint B)

| Signal | Timestamp field |
| --- | --- |
| HTTP 2xx on `stop_recording` | `transportAcceptedAt` |
| `command_accepted` callback | `commandAcceptedAt` |
| `recording_stopped` (`RecorderEvents.Stopped`) callback | `providerTerminalAt` |

POC stop is successful only when `providerTerminalAt` exists. Repeated `operationId` remains idempotent. Production `Recording` rows are not altered.

## Session lifetime

Real observation: server-created POC session without WebSDK participants terminated after ~60 seconds.

Local status tracks `runtimeStatus`: `ACTIVE` | `EXPIRED` | `UNKNOWN`. Expired control URLs must not be reused; require a fresh `StartConference`. Idle keep-alive is out of scope.

## Log redaction

Never paste raw `Application.Started` (contains `accessURL` / `accessSecureURL`). Diagnostics show URL fingerprints only; signatures and complete header maps are redacted (`lib/voximplant/poc/log-sanitize.ts`).

## Safety contract

- **Dedicated POC rule only:** `VOXIMPLANT_SERVER_STOP_POC_RULE_ID` (required for live). Optional `VOXIMPLANT_SERVER_STOP_POC_RULE_NAME`. Never falls back to production rule config or GetRules discovery.
- **Production deny-list:** refuse with `POC_RULE_MATCHES_PRODUCTION` before any provider request when POC rule matches production.
- **Explicit live confirmation:** every real `StartConference` requires `--confirm-live-poc`.
- **Conference name prefix:** live names must start with `neg-poc-server-stop-`.
- **Control URL hygiene:** full control URL stored only in ignored local state; logs expose fingerprint only.

## Contract (verified from `@voximplant/apiclient-nodejs`)

`StartConference` request (HTTP snake_case): `conference_name`, `rule_id`, optional `application_id` / `application_name`, `script_custom_data`.

Response fields: `media_session_access_url`, `media_session_access_secure_url`, `call_session_history_id`, `result`.

## Manual checkpoints

See `docs/voximplant/server-stop-poc-manual-checkpoints.md`.
