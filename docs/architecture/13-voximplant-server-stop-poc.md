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

## Report execution kind and results

Reports persist explicit fields (do not infer dry-run only from `cleanupStatus`):

- `dryRun: boolean`
- `executionKind: DRY_RUN | LIVE`
- `providerCalls` / `dbWrites` / `browserExecution` (actual execution flags; all `false` for dry-run)
- `plannedPhases` (planned work; not completed evidence)
- `localDatabaseTargetSanitized` (from preflight; never raw `DATABASE_URL` / credentials)

Result enum:

| Result | Meaning |
| --- | --- |
| `DRY_RUN_PASS` | Planning-only dry-run validation succeeded |
| `PASS` | Live transport/full success under strict evidence criteria |
| `FAIL` | Live or confirmation failure |
| `INCONCLUSIVE` | Timeout / inconclusive live evidence |

`npm run poc:vox:last-report` prints `DRY RUN — NO PROVIDER / DB / BROWSER EXECUTION.` for dry-run reports.

## Safety confirmations

- Live provider calls require `--confirm-live-poc`.
- Full-mode local DB writes require `--confirm-local-db-write` and a localhost / safe-hostname `DATABASE_URL` (typed refusals: `UNSAFE_DATABASE_TARGET`, `LOCAL_DB_WRITE_CONFIRMATION_REQUIRED`).
- Dedicated POC rule only; production rule deny-list; conference prefix `neg-poc-server-stop-`.
- Never print control URLs, control/callback secrets, or DB credentials.

## Expected runtime

Bounded phase timeouts (callback self-test, browser prewarm, StartConference, live browser join, recording start, command callback, terminal callback, artifact, log fetch). Idle media sessions without WebSDK participants still expire ~60s.

Full mode uses two browser phases so launch/auth do not consume the idle window:

1. **browser_prewarm** (before StartConference): launch contexts, fake media, auth cookies/join-token room shells; hold `/voximplant/access` until live.
2. **StartConference** + activate run pointer.
3. **browser_join** (live): release both access/joins concurrently under a short budget (~25s).

Prewarm auth is role-split:

- **Facilitator**: install canonical `auth_session=<rawSessionToken>` (same contract as `lib/auth` / E2E `createUserSession`) via a Playwright **URL-bound** cookie (`url` + `httpOnly`/`sameSite`/`secure` from `appBaseUrl` protocol). Never pass `url` together with `domain`/`path`. Never put `User.id` / `UserSession.id` into the cookie.
- **Facilitator verification** (required before `AUTH_ACCEPTED` / StartConference): GET protected `/sessions/{sessionId}` — must not redirect to `/login`, host must remain `appBaseUrl`, temporary Session must be accessible. Nested typed reasons: `AUTH_COOKIE_MISSING`, `AUTH_COOKIE_REJECTED`, `AUTH_SESSION_NOT_FOUND`, `AUTH_USER_MISMATCH`, `AUTH_REDIRECTED_TO_LOGIN`, `AUTH_PROTECTED_ROUTE_DENIED`, `AUTH_VERIFICATION_HTTP_ERROR` (outer `FACILITATOR_AUTH_FAILED` when unclassified).
- **Participant** (guest access closed): own `auth_session` / `UserSession` (never the facilitator cookie) + one navigation through the canonical join-token invite URL (`/room/{sessionId}?joinToken=…`). Join token is invite-claim only — not a guest identity and not exchanged into a cookie. The temporary fixture creates a distinct participant `User` + `UserSession` and returns `facilitatorAuth` / `participantAuth` separately. Live join resumes the durable account-mode context (does not re-hit joinToken). Access is account-cookie only (`apiRequireActiveUser` + `ensureAccountRoomParticipant`).
- **Prewarm-only replay**: `npm run poc:vox:test-browser-prewarm -- --run-id <runId>` and `npm run poc:vox:test-participant-access -- --run-id <runId>` (provider-free access/POC_STATE check with temporary run pointer restore). Legacy runs lacking `participantAuthCookie` return `LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE` (no DB repair).
- **Isolated local fixture mode**: `npm run poc:vox:test-participant-access -- --create-fixture --confirm-local-db-write` creates a temporary namespaced fixture, validates participant auth + POC_STATE access (no provider calls), then deletes only cleanup-manifest entities.

Typed prewarm auth failures (not collapsed to `BROWSER_LAUNCHED`):

- `AUTH_COOKIE_INSTALL_FAILED` — facilitator cookie install
- `PARTICIPANT_CONTEXT_SETUP_FAILED` — participant join-token context setup
- `PARTICIPANT_AUTH_ARTIFACT_MISSING` / `PARTICIPANT_AUTH_COOKIE_REJECTED` / `PARTICIPANT_AUTH_USER_MISMATCH` / `PARTICIPANT_AUTH_SESSION_NOT_FOUND` / `PARTICIPANT_REDIRECTED_TO_LOGIN` / `PARTICIPANT_SESSION_ACCESS_DENIED` — participant auth verification
- `LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE` — retained run missing participant UserSession cookie artifact
- nested `AUTH_*` codes above when facilitator verification fails

Sanitized diagnostics may include role, failing operation, error name, redacted bounded message, `cookieBindingMode` (`URL_BOUND` | `DOMAIN_BOUND`), `appBaseUrl` host, `secure`, auth strategy, final path/host, redirect-to-login, user match, session access — never cookie values, join tokens, or full tokenized URLs.

Inspect a run: `npm run poc:vox:inspect-run -- --run-id <runId>` (sanitized phase timeline; no secrets/tokens/control URLs). Browser failures retain artifacts under `.agent/voximplant-server-stop/runs/<runId>/browser/{facilitator,participant}/`.

## PASS criteria (full mode)

Live `PASS` only (dry-run uses `DRY_RUN_PASS` and does not require live evidence):

- callback self-test (`CALLBACK_SELF_TEST_PASSED`)
- both WebSDK joins + same server-started conference
- recording started through application flow
- `TRANSPORT_ACCEPTED` + `command_accepted` + `recording_stopped` / provider terminal
- one effective stop (idempotent re-stop)
- no browser recording-control relay for stop
- artifact evidence present  
Log fetch may be `LOG_FETCH_UNAVAILABLE` without failing PASS.

Transport live `PASS` still requires callback confirmation (`commandAccepted`) after transport acceptance.

## Cleanup

On full PASS (without `--keep-session`): close browsers, clear active pointer, delete only cleanup-manifest entities, retain report + sanitized logs, retain provider artifact.

On failure: retain Session + run evidence; print `npm run poc:vox:cleanup -- …`. Cleanup always requires `--confirm-cleanup` and never deletes provider recordings automatically.

## Log redaction

`lib/voximplant/poc/log-sanitize.ts` removes `accessURL` / `accessSecureURL`, signatures, Authorization, and header maps. History retrieval uses Management API `GetCallHistory` (`call_session_history_id`, `with_records`) when authorized.

## Callback self-test preflight

Live runs probe a dedicated flag-gated health endpoint before the signed synthetic callback:

1. `GET /api/poc/voximplant/server-stop/health` → HTTP 200 with `ok`, `service=voximplant_server_stop_poc`, `protocolVersion=1`, `callbackEnabled=true`, matching worktree fingerprint + build id
2. Signed synthetic `POST /api/poc/voximplant/server-stop/callback` → `CALLBACK_ACCEPTED`
3. Event persisted in active run state, then synthetic evidence cleared → `callbackSelfTest=true`

Health must not use the application root (auth 307) or `/api/admin/health`. Typed health failures (`POC_HEALTH_*`) are nested under outer `LOCAL_HEALTH_FAILED` in reports (`healthFailureReason`, `healthUrlPath`, fingerprints/build ids — never host credentials or raw bodies).

Default health URL: `{POC_APP_BASE_URL|http://localhost:3000}/api/poc/voximplant/server-stop/health`. Override with `--health-url`, `POC_HEALTH_URL`, or `--public-base-url` / `POC_PUBLIC_BASE_URL` (e.g. `https://local.negotaitions.ru`) when the tunnel is reachable from Node.

## Scope / non-goals

- Manual legacy scripts still available under `scripts/poc/voximplant-server-stop/` for troubleshooting
- Scenario variant: `docs/voximplant/neg-conf.server-stop-poc.scenario.js`
- POC health: `GET /api/poc/voximplant/server-stop/health` (flag-gated; not production admin health)
- POC callback: `POST /api/poc/voximplant/server-stop/callback` (flag-gated)
- No Prisma migration / no production room lifecycle integration
- No automatic live provider calls from tests
- No auto-deploy / scenario upload

## Manual Checkpoint B (fallback)

The old manual Checkpoint B procedure remains documented in `docs/voximplant/server-stop-poc-manual-checkpoints.md` as a troubleshooting fallback when the orchestrator cannot be used.
