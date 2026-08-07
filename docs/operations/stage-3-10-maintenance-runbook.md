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
- Empty-room reconciliation uses two gates:
  - lease validity (explicit leave or expired lease reconciliation; lease TTL is 120000 ms);
  - `DEBRIEF_AUTO_CLOSE_GRACE_MS` (default 30000 ms) after the last definitive disconnect signal.
- Reconnect during the grace window keeps the session active; completion/closure happens only with zero valid connections.
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
