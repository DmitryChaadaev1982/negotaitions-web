# Stage 3.10 Maintenance Runbook

## Scope

This runbook documents local/server operations for Stage 3.10 maintenance tasks:

- stale room-connection expiry;
- debrief auto-close reconciliation with grace window;
- recording-stop retry delivery worker;
- bounded roomLifecycle backfill and verification.

These commands are safe for manual execution and timer orchestration. They are idempotent and rerunnable.

## Command

Use:

- `npm run maintenance:stage310 -- --task all --dry-run`
- `npm run maintenance:stage310 -- --task expiry --limit 500`
- `npm run maintenance:stage310 -- --task recording-stop --limit 200`
- `npm run maintenance:stage310 -- --task nonce-cleanup`
- `npm run maintenance:stage310 -- --task backfill --batch-size 500 --cursor-after-id <id>`
- `npm run maintenance:stage310 -- --task verify-backfill`

Output is JSON with counters only (no secrets, no participant names/emails).

The command is a raw `tsx` / Node operational CLI, not a Next bundled
server. Local/non-production runs load project `.env*` from the current
working directory before Prisma or required config is constructed.
Production systemd injects `/etc/negotaitions/env.production` and
`NODE_ENV=production`; that mode must not depend on local Next env
loading. Do not wrap the command in `node -e` or inject `DATABASE_URL`
manually for the normal operator path.

Local integrated acceptance of the empty-Debrief closer also requires
the operator's actual project `.env` to set the canonical timeout:

```
SESSION_DEBRIEF_EMPTY_CLOSE_MS=60000
```

Do not copy this into live production env from a documentation pass.
Canonical wins over the legacy `DEBRIEF_AUTO_CLOSE_GRACE_MS` alias.

## Systemd Templates

Templates are provided in:

- `deploy/systemd/negotiations-stage310-maintenance.service`
- `deploy/systemd/negotiations-stage310-maintenance.timer`

Install and validation steps (server-side, disabled-first):

1. Copy both files into `/etc/systemd/system/`.
2. `sudo systemctl daemon-reload`
3. `sudo systemd-analyze verify /etc/systemd/system/negotiations-stage310-maintenance.service /etc/systemd/system/negotiations-stage310-maintenance.timer`
4. After the last checkout/dependency-install/Prisma-generate operation, run
   `npm run ops:runtime-permissions:apply` from `/var/www/negotaitions/app`.
5. Run `npm run ops:runtime-permissions:check` and do not start the one-shot or
   timer unless it succeeds.
6. Keep timer disabled initially: `sudo systemctl disable --now negotiations-stage310-maintenance.timer`
7. Run one-shot manually: `sudo systemctl start negotiations-stage310-maintenance.service`
8. Inspect result: `journalctl -u negotiations-stage310-maintenance.service -n 200 --no-pager`
9. If one-shot is healthy, enable/start timer:
   - `sudo systemctl enable negotiations-stage310-maintenance.timer`
   - `sudo systemctl start negotiations-stage310-maintenance.timer`
10. Check next execution: `systemctl list-timers | rg negotiations-stage310-maintenance`

Disable/rollback steps:

1. `sudo systemctl stop negotiations-stage310-maintenance.timer`
2. `sudo systemctl disable negotiations-stage310-maintenance.timer`
3. Optional unit removal after verification:
   - `sudo rm /etc/systemd/system/negotiations-stage310-maintenance.service`
   - `sudo rm /etc/systemd/system/negotiations-stage310-maintenance.timer`
   - `sudo systemctl daemon-reload`
4. Leave additive DB schema and history tables in place.

The app can be rolled back without dropping Stage 3.10 additive schema objects.

## Safety Notes

- Do not expose maintenance operations via public unauthenticated HTTP endpoint.
- Do not run against production until checkpoint review approves rollout.
- The systemd service receives production settings from
  `/etc/negotaitions/env.production`; do not make the application
  `.env.production` readable by `www-data`.
- Runtime permissions must be normalized after checkout/install/Prisma
  generation and before starting `negotiations-stage310-maintenance.service` or
  its timer.
- `--dry-run` mode performs inspection only, without writes.
- Timer can be disabled independently from application service.
- Concurrent worker runs are tolerated by DB-level claim/update guards; stop-operation and connection-expiry claims are idempotent.
- Session lifecycle reconciliation uses one policy and one finalizer:
  - lease validity (explicit leave or expired lease reconciliation; lease TTL is 120000 ms);
  - `SESSION_DEBRIEF_EMPTY_CLOSE_MS` (default 60000 ms; legacy alias `DEBRIEF_AUTO_CLOSE_GRACE_MS` only when the canonical variable is unset);
  - `SESSION_DEBRIEF_MAX_DURATION_MS` (default 7200000 ms) from `negotiationEndedAt`;
  - `SESSION_ABANDONED_CLOSE_MS` (default 10800000 ms) for non-Debrief empty Sessions, floored by parent `Event.scheduledAt` when present.
- The systemd timer cadence is 15 seconds. That cadence is not a business timeout.
- Lifecycle correctness does not depend on `Persistent=true`. That flag only
  affects whether systemd records a missed timer firing. Authoritative `dueAt`
  is reconstructed from current DB state on every sweep, including the first
  sweep after process or server return. `OnBootSec=15s` makes that first
  evaluation prompt after the timer is activated.
- Stage 3.18A production deploy must set these three variables explicitly in
  **both** `/var/www/negotaitions/app/.env.production` (application
  request-driven reconciliation) and `/etc/negotaitions/env.production`
  (this maintenance unit). Canonical wins over the legacy alias; do not
  edit live env from this documentation pass:
  - `SESSION_DEBRIEF_EMPTY_CLOSE_MS=60000`
  - `SESSION_DEBRIEF_MAX_DURATION_MS=7200000`
  - `SESSION_ABANDONED_CLOSE_MS=10800000`
  If either file still has only `DEBRIEF_AUTO_CLOSE_GRACE_MS=30000` and the
  canonical empty-close variable is absent, that consumer would intentionally
  retain 30 seconds. Repository validation must not enable this timer.
- Reconnect during the empty-Debrief window keeps the session active; empty close happens only with zero current-generation connections. Occupied Debrief still closes at the 2h hard maximum.
- For local test validation, ensure non-production DB is migrated before Stage 3.10 suites:
  - `npx prisma migrate status`
  - `npx prisma migrate deploy` (non-production only)
  - `npx prisma generate && npx prisma validate`

## Server-stop Sweep Policy

`recording-stop` task now handles:

- due `PENDING` and `FAILED` operations;
- timed-out `DELIVERING` operations where server transport was accepted but provider terminal callback is still missing;
- no-op behavior for already `DELIVERED` operations.

Mode-specific behavior:

- `disabled`: legacy browser relay path unchanged.
- `prefer_server_with_relay_fallback`: server stop first, bounded browser fallback only when registration/transport fails.
- `prefer_server_no_relay_fallback`: server stop only; failures stay server-owned retryable records.

`nonce-cleanup` removes expired `VoximplantCallbackNonce` rows only (hashed nonces, no raw nonce persistence).

## Stage 3.10 A7 operational policy

- Server-side Voximplant control is the canonical terminal stop transport when
  either `prefer_server_*` mode is configured.
- Browser relay is permitted only as bounded fallback in
  `prefer_server_with_relay_fallback`, or as the legacy path while mode is
  `disabled`.
- Any eligible connected room client may claim and transport an already
  authorized fallback stop operation; it cannot originate a new stop request.
- Server retries are bounded and terminal success still requires provider
  callback evidence.
- Terminal relay-required diagnostics remain operational signals, not blockers for session/event completion/materials access.
- If a valid client reconnects during debrief (`DEBRIEF_OPEN`), the same existing operation may be claimed and relayed again (no new operation row).
- Webhook/provider reconciliation can still mark operation delivered after prior relay timeout/failure diagnostics.

### Diagnostic categories used in operations review

- relay requested
- relay claimed by client
- relay acknowledged
- no eligible client
- waiting provider finalization
- provider auto-finalized
- webhook delayed
- provider finalization timed out

## Related test evidence

- `docs/testing/stage-3-10-session-lifecycle-scenario-catalog.md`
- `docs/testing/stage-3-10-session-lifecycle-traceability.csv`
- `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md`

## Systemd Review Notes

- `User`/`Group`: `www-data` (matches existing service ownership conventions).
- `WorkingDirectory`: `/var/www/negotaitions/app` (runtime symlink path from deployment runbook).
- `ExecStart`: absolute npm path for non-interactive systemd (`/usr/bin/npm`).
- `Type=oneshot` + timer cadence: overlap-safe with DB claim semantics.
- `TimeoutStartSec=180`: bounded execution window.
- `NoNewPrivileges=true`: hardening baseline for maintenance process.
