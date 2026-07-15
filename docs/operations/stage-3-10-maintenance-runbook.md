# Stage 3.10 Maintenance Runbook

## Scope

This runbook documents local/server operations for Stage 3.10 maintenance tasks:

- stale room-connection expiry;
- recording-stop retry delivery worker;
- bounded roomLifecycle backfill and verification.

These commands are safe for manual execution and timer orchestration. They are idempotent and rerunnable.

## Command

Use:

- `npm run maintenance:stage310 -- --task all --dry-run`
- `npm run maintenance:stage310 -- --task expiry --limit 500`
- `npm run maintenance:stage310 -- --task recording-stop --limit 200`
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
4. Keep timer disabled initially: `sudo systemctl disable --now negotiations-stage310-maintenance.timer`
5. Run one-shot manually: `sudo systemctl start negotiations-stage310-maintenance.service`
6. Inspect result: `journalctl -u negotiations-stage310-maintenance.service -n 200 --no-pager`
7. If one-shot is healthy, enable/start timer:
   - `sudo systemctl enable negotiations-stage310-maintenance.timer`
   - `sudo systemctl start negotiations-stage310-maintenance.timer`
8. Check next execution: `systemctl list-timers | rg negotiations-stage310-maintenance`

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
- `--dry-run` mode performs inspection only, without writes.
- Timer can be disabled independently from application service.
- Concurrent worker runs are tolerated by DB-level claim/update guards; stop-operation and connection-expiry claims are idempotent.
- For local test validation, ensure non-production DB is migrated before Stage 3.10 suites:
  - `npx prisma migrate status`
  - `npx prisma migrate deploy` (non-production only)
  - `npx prisma generate && npx prisma validate`

## Current Voximplant Limitation

`SessionRecordingStopOperation` retries are server-owned, but Voximplant stop delivery still requires browser relay (`scenarioMessage`) in the current architecture. The worker preserves durable intent and retries with backoff, then marks terminal operator-attention class `VOXIMPLANT_BROWSER_RELAY_REQUIRED_TERMINAL` after bounded attempts.

## Stage 3.10 A7 operational policy

- Browser relay is the primary stop transport for Voximplant in current architecture.
- Any eligible connected room client may claim and transport an already authorized stop operation.
- Server retries are bounded and do not run indefinitely for browser-dependent delivery.
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
