# 13 — Voximplant server-stop POC (isolated)

Isolated proof of concept for server-controlled conference recording stop via Management API `StartConference` + media session HTTP control. Not integrated into `completeSessionCanonical()` / production room lifecycle.

## One-command workflow

Primary entrypoint (replaces manual Checkpoint B sequencing):

```bash
npm run poc:vox:run -- --dry-run
npm run poc:vox:run -- --mode=transport --confirm-live-poc
npm run poc:vox:run -- --mode=full --confirm-live-poc --confirm-local-db-write
npm run poc:vox:last-report
npm run poc:vox:cleanup -- --run-id <runId> --confirm-cleanup --confirm-local-db-write
```

Orchestrator scripts: `scripts/poc/voximplant-server-stop/run-poc.ts`, `show-last-report.ts`, `cleanup-poc.ts`.

Helpers: `lib/voximplant/poc/**` and `lib/voximplant/poc/orchestrator/**`.

## Static env versus dynamic run state

**Static env only (no per-Session editing, no Next.js restart):**

- `VOXIMPLANT_SERVER_STOP_POC_RULE_ID`
- `VOXIMPLANT_SERVER_STOP_POC_RULE_NAME` (optional)
- `VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET`
- `VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET`
- `VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED`
- `VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC`

**Removed runtime dependence:** `VOXIMPLANT_SERVER_STOP_POC_SESSION_ID` (Session id comes from the active run pointer).

**Run-scoped local state:**

- `.agent/voximplant-server-stop/runs/<runId>/state.json`
- `.agent/voximplant-server-stop/runs/<runId>/report.json`
- `.agent/voximplant-server-stop/runs/<runId>/events.json`
- `.agent/voximplant-server-stop/runs/<runId>/voximplant.log.sanitized.txt`
- `.agent/voximplant-server-stop/current.json` (atomic active-run pointer)

The access route reads the active run pointer on every POC access request and selects the POC conference only when flag + linked Session + ACTIVE runtime + safe conference prefix all match. Otherwise `negotiation-{sessionId}` is preserved.

## Modes

| Mode | Confirms | Provider | DB Session | Browser | Recording stop |
| --- | --- | --- | --- | --- | --- |
| `--dry-run` | none | no | no | no | no |
| `--mode=transport --confirm-live-poc` | live | StartConference + ping | no | no | no |
| `--mode=full --confirm-live-poc --confirm-local-db-write` | live + local DB | full E2E | temp entities | 2 contexts | server control URL |

## Safety confirmations

- Live provider calls require `--confirm-live-poc`.
- Full-mode local DB writes require `--confirm-local-db-write` and a localhost / safe-hostname `DATABASE_URL` (typed refusals: `UNSAFE_DATABASE_TARGET`, `LOCAL_DB_WRITE_CONFIRMATION_REQUIRED`).
- Dedicated POC rule only; production rule deny-list; conference prefix `neg-poc-server-stop-`.
- Never print control URLs, control/callback secrets, or DB credentials.

## Expected runtime

Bounded phase timeouts (callback self-test, StartConference, browser join, recording start, command callback, terminal callback, artifact, log fetch). Idle media sessions without WebSDK participants still expire ~60s; full mode joins browsers before stop.

## PASS criteria (full mode)

- callback self-test (`CALLBACK_SELF_TEST_PASSED`)
- both WebSDK joins + same server-started conference
- recording started through application flow
- `TRANSPORT_ACCEPTED` + `command_accepted` + `recording_stopped` / provider terminal
- one effective stop (idempotent re-stop)
- no browser recording-control relay for stop
- artifact evidence present  
Log fetch may be `LOG_FETCH_UNAVAILABLE` without failing PASS.

## Cleanup

On full PASS (without `--keep-session`): close browsers, clear active pointer, delete only cleanup-manifest entities, retain report + sanitized logs, retain provider artifact.

On failure: retain Session + run evidence; print `npm run poc:vox:cleanup -- …`. Cleanup always requires `--confirm-cleanup` and never deletes provider recordings automatically.

## Log redaction

`lib/voximplant/poc/log-sanitize.ts` removes `accessURL` / `accessSecureURL`, signatures, Authorization, and header maps. History retrieval uses Management API `GetCallHistory` (`call_session_history_id`, `with_records`) when authorized.

## Scope / non-goals

- Manual legacy scripts still available under `scripts/poc/voximplant-server-stop/` for troubleshooting
- Scenario variant: `docs/voximplant/neg-conf.server-stop-poc.scenario.js`
- POC callback: `POST /api/poc/voximplant/server-stop/callback` (flag-gated)
- No Prisma migration / no production room lifecycle integration
- No automatic live provider calls from tests
- No auto-deploy / scenario upload

## Manual Checkpoint B (fallback)

The old manual Checkpoint B procedure remains documented in `docs/voximplant/server-stop-poc-manual-checkpoints.md` as a troubleshooting fallback when the orchestrator cannot be used.
