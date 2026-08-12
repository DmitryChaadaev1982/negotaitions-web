# Deployment Runbook

## Scope

This runbook captures current deployment/runtime expectations for the Yandex POC architecture. It does not introduce new deployment commands.

## Runtime Paths

- Canonical source path on server: `/var/www/negotaitions/app-git`.
- Runtime app path: `/var/www/negotaitions/app` (symlink to `app-git`).
- Artifact storage root: `/var/www/negotaitions-artifacts`.
- Secure env backup root: `/var/www/negotaitions-secure-backups`.

## Process Model

- Service name: `negotaitions-poc`.
- Runtime start command pattern: `npm run start` / `next start -H 127.0.0.1`.
- Reverse proxy model: nginx in front of app service.
- Trusted client IP: after controlled nginx activation, overwrite
  `X-NegotAItions-Client-IP` from `$remote_addr` and set
  `TRUSTED_PROXY_ENABLED=true`. See
  `docs/audits/stage-3-13c-proxy-readiness/` and
  `deploy/nginx/trusted-client-ip-snippet.conf`.
- Provider-event ingestion, when approved later, runs as a separate
  disabled-by-default `negotiations-email-provider-events.service` using
  dedicated Data Streams credentials and a PostgreSQL advisory single-consumer
  lock. It is not part of the app service and has no delivery-worker dependency.

### Future nginx activation (not executed in Stage 3.13C)

1. Backup current site files under `/etc/nginx/sites-available/`.
2. Patch **every** vhost that terminates TLS for the app with
   `deploy/nginx/trusted-client-ip-snippet.conf`.
3. `sudo nginx -t`.
4. Reload nginx (`reload`, not restart).
5. Verify localhost listeners and both IPv4 / IPv6 direct-access paths do not
   expose an alternate unauthenticated start surface.
6. Live spoof canary: forged forwarding headers must not create new identities.
7. Enabled-mode same-origin HTTPS test against the canonical origin.
8. Rollback trust first: set `TRUSTED_PROXY_ENABLED=false` and restart the
   application, then restore nginx backups and reload.
9. Committed verifier: `npm run verify:stage313c:trusted-proxy`
   (live checks require explicit `TARGET_HOST`; never auto-modifies production).

This block is a numbered gate inside the email activation order. See
`docs/operations/email-yandex-activation-runbook.md` step 9: the gate runs after
backlog quarantine and before Postbox configuration or the canary.

## Credential-dispatch fence connection requirement

`lib/auth/credential-dispatch-fence.ts` serializes credential mutation against
password-reset dispatch with PostgreSQL **session** advisory locks
(`pg_try_advisory_lock` / `pg_advisory_unlock`).

- Every statement in one fence lifetime — acquire, the fenced operation's own
  connections, and unlock — must reach the same PostgreSQL backend. A session
  advisory lock lives in the backend that took it.
- The fence therefore uses a dedicated `pg` `Client` that must connect
  **directly** to PostgreSQL, or through a pooler mode that preserves session
  affinity (session pooling). Connection release happens on unlock, error, or
  connection/process death.
- **Transaction-mode pooling is unsupported for this fence.** In transaction
  mode the unlock can land on a different backend, so the lock would leak until
  that backend closes while the fence appears released.
- Introducing PgBouncer (or any transaction-pooling layer) in front of this
  application requires either a fence redesign (for example transaction-scoped
  `pg_advisory_xact_lock` within a single transaction) or explicit validation
  that session affinity is preserved end to end. Do not add transaction pooling
  as a routine capacity change.
- Production `max_connections` must leave headroom for the Prisma pool **plus**
  one short-lived fence connection per concurrent credential mutation and per
  concurrent worker dispatch. Size it for peak reset traffic plus the worker
  batch size, not for the Prisma pool alone.
- Hold time is bounded: acquisition is limited by
  `CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS` (default 5000 ms, allowed 50..30000)
  and the fenced provider call is limited by
  `EMAIL_PROVIDER_REQUEST_TIMEOUT_MS`. Those two bounds are what keep fence
  connections short-lived.

## Secrets And Env

- `.env.production` is runtime secret material and must never be committed.
- Keep secret values in server-side secure storage and service environment wiring only.
- Production operational workers receive env through
  `/etc/negotaitions/env.production` via systemd `EnvironmentFile=`.
  Standalone ops scripts do not load the application `.env.production` when
  `NODE_ENV=production`; missing injected settings fail through normal runtime
  config validation.
- Keep application `.env.production` and `/etc/negotaitions/env.production`
  mode `600`. Do not make either file readable by `www-data`.
- Secret creation/staging may use `umask 077` and explicit `600`; do not run the
  whole application deployment under a broad restrictive umask.

## Runtime Permission Normalization

After operations that can recreate filesystem modes, normalize only the
repository-owned runtime artifacts that systemd workers need to read:

1. checkout / fast-forward the repository;
2. install dependencies as required by the deployment plan;
3. run Prisma generation (`npm run prisma:generate` or the deployment's
   equivalent);
4. run `npm run ops:runtime-permissions:apply`;
5. run `npm run ops:runtime-permissions:check`;
6. restart/start application or worker systemd units only after both commands
   succeed.

The normalizer uses Git index metadata for tracked files and touches only
the explicitly allowlisted runtime source files, parent source directories
needed for traversal, the `app/generated` parent traversal directory, and
`app/generated/prisma`. Generated Prisma must be normalized after every Prisma
generation because that tree is ignored by Git.

Never replace this with `chmod -R` across the repository. The normalizer must not
modify `.env`, `.env.*`, `.git/`, `node_modules/`, `/etc/`, backup files,
credential files, or unrelated untracked data. It fails closed if a symlink is
found inside `app/generated/prisma`.

The implementation uses no-follow descriptor chmod where the Node/Linux runtime
supports it. Other platforms retain fail-closed pre/post validation and assume
the deployment tree is not concurrently replaced by a privileged actor during
the single-file chmod window.

## Stage 3.13C-F account-security deployment boundary

- Do not roll old and new app/worker versions together. Stop every old app,
  worker, timer, and ad-hoc email sweep before applying migrations or starting
  the new runtime.
- Apply and verify the additive migration overlay before new runtime start.
- Install `EMAIL_SENSITIVE_PAYLOAD_KEY` before the new runtime accepts ACTIVE
  password-reset requests.
- Keep delivery disabled while reviewing and applying bounded stale/legacy
  password-reset backlog quarantine.
- Keep the normal worker stopped for the canary. The canary must select exactly
  one eligible `EmailMessage` through the manual systemd unit.
- The normal delivery service orders after `negotaitions-poc.service` and
  remains static; persist background delivery only with
  `sudo systemctl enable --now negotiations-email-worker.timer` after the
  provider/outbox production canary passes and approval is explicit. Roll back
  with `sudo systemctl disable --now negotiations-email-worker.timer`.
- Run `npm run email:retention:dry-run` and verify retention windows before
  persisting retention with
  `sudo systemctl enable --now negotiations-email-retention.timer`. Roll back
  with `sudo systemctl disable --now negotiations-email-retention.timer`. Do not
  enable `negotiations-email-retention.service` directly.
- Keep provider-event ingestion disabled until the Data Streams subscription,
  dedicated credentials, checkpoints, and sanitized failure ledger are reviewed.
- Run runtime permission normalization after checkout/install/Prisma generation
  and before starting provider-event, delivery, retention, or maintenance
  workers.
- Do not enable the worker timer until that one message is accepted and the
  operational review passes.

After real remediated reset traffic starts, pre-remediation code is not a normal
safe rollback target. Disable delivery, set `TRUSTED_PROXY_ENABLED=false` when
proxy trust is implicated, keep old processes stopped, and forward-fix on the
remediated schema. Do not roll back additive migration history.

Production nginx verification and Postbox/DNS/credential activation are
controlled production actions outside local implementation and validation.

## Standard Validation Steps

Run from repository before deployment:

- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npm run test:unit`
- `npm run test:stage310` (provider-free Stage 3.10 foundation regression)

## Prisma Migration Paths

Use standard Prisma commands for clean databases, development databases, CI databases, and new environments:

- `npx prisma migrate deploy`
- `npx prisma migrate status`

The existing Yandex POC production database has two legitimate historical migration rows that predate the current squashed baseline and are archived outside `prisma/migrations`. For that database only, do not block on ordinary Prisma history divergence. Use the guarded production overlay documented in `docs/operations/prisma-production-history-repair-20260804.md`:

- `npm run prisma:production:status`
- `npm run prisma:production:deploy -- --confirm-legacy-production-history`
- `npm run prisma:production:status`

The overlay must refuse empty, development, or mismatched databases. Do not manually edit `_prisma_migrations` and do not use `prisma migrate resolve` for this repair.

## Stage 3.13E deployment preflight and release order

The active `neg-conf-main-room` Voximplant scenario is already RC4:

- build marker:
  `main-room-recording-reconciliation-2026-08-12-rc4`;
- exported source SHA256:
  `040e7c5557c3156133a48556da1a6b86976f058fb969f111d9c673c9a2368553`;
- local backup artifact:
  `artifacts/voximplant-backups/2026-08-12-rc4-active/`.

Do not upload or replace the Voximplant scenario during this application
rollout. The server rollout consists of the guarded database migration and the
application release only.

Run the following read-only checks immediately before stopping the old
application. Deployment is blocked if any query returns a row.

Active recording/provider work:

```sql
SELECT r."id", r."sessionId", r."provider", r."status", r."updatedAt"
FROM "Recording" AS r
WHERE r."status" IN ('STARTING', 'RECORDING', 'PAUSED')
   OR (
     r."status" = 'PROCESSING'
     AND COALESCE(UPPER(r."provider"), '') LIKE '%LIVEKIT%'
   );
```

`PROCESSING` is included only for the LiveKit path because
LiveKit maps provider `EGRESS_ENDING` to that state. Voximplant stop relay treats
`PROCESSING`, `STOPPED`, `COMPLETED`, and `FAILED` as terminal for provider-stop
delivery. A normal historical `STOPPED` row is therefore not a blocker.
For a legacy row with a null/unknown provider, resolve the effective provider
from the deployed `VIDEO_PROVIDER`; classify `PROCESSING` as blocking only when
that effective provider is LiveKit.
Voximplant's transient `stopping` provider state is represented by an active
`SessionRecordingStopOperation`, not by a `RecordingStatus.STOPPING` enum value.

Undelivered active server-stop work:

```sql
SELECT
  o."id",
  o."sessionId",
  o."recordingId",
  o."operationId",
  o."state",
  o."nextRetryAt",
  r."status" AS "recordingStatus"
FROM "SessionRecordingStopOperation" AS o
JOIN "Recording" AS r ON r."id" = o."recordingId"
WHERE o."deliveredAt" IS NULL
  AND (
    o."state" IN ('PENDING', 'DELIVERING')
    OR (o."state" = 'FAILED' AND o."nextRetryAt" IS NOT NULL)
  )
  AND r."status" NOT IN ('PROCESSING', 'STOPPED', 'COMPLETED', 'FAILED');
```

An undelivered operation coupled to one of those terminal recording states is
historical/reconcilable bookkeeping, not evidence that a provider recorder is
still running. Review it separately, but do not block deployment on that fact
alone.

Active raw transcription or transcript enhancement:

```sql
SELECT t."id", t."sessionId", t."status", t."updatedAt"
FROM "Transcript" AS t
WHERE t."status" IN (
  'QUEUED',
  'DOWNLOADING_RECORDING',
  'COMPRESSING_AUDIO',
  'TRANSCRIBING'
)
OR (
  t."processingMetadata" #>> '{transcriptEnhancement,status}'
    IN ('RUNNING', 'IN_PROGRESS')
  AND (
    t."processingMetadata" #>> '{transcriptEnhancement,startedAt}' IS NULL
    OR (
      t."processingMetadata" #>> '{transcriptEnhancement,startedAt}'
    )::timestamptz > NOW() - INTERVAL '10 minutes'
  )
);
```

The ten-minute enhancement predicate matches
`ENHANCEMENT_RUNNING_STALE_MS`. `COMPLETED`, `FAILED`, `PARTIAL`, and `SKIPPED`
enhancement outcomes are terminal and do not block.

Active AI analysis execution:

```sql
SELECT
  a."id",
  a."sessionId",
  a."status",
  a."runToken",
  a."leaseExpiresAt",
  a."updatedAt"
FROM "AiAnalysis" AS a
WHERE a."status" IN ('QUEUED', 'ANALYZING')
  AND (
    (
      a."runToken" IS NOT NULL
      AND a."leaseExpiresAt" IS NOT NULL
      AND a."leaseExpiresAt" > NOW()
    )
    OR (
      (a."runToken" IS NULL OR a."leaseExpiresAt" IS NULL)
      AND a."updatedAt" > NOW() - INTERVAL '30 minutes'
    )
  );
```

The 30-minute legacy fallback matches the default
`AI_ANALYSIS_LEGACY_STALE_AFTER_MS`; substitute the deployed configured
duration if production overrides that value. Expired leased work and stale
legacy rows are reclaimable, not currently executing work.

Exact release order:

1. Verify branch/SHA, backups, and the preserved RC4 source/hash.
2. Run the read-only transient-work queries above; require zero blocking rows.
3. Stop the old application process so no old and new runtime overlap.
4. Stage the reviewed application release and install dependencies as required.
5. Run `npm run prisma:production:status`.
6. Run
   `npm run prisma:production:deploy -- --confirm-legacy-production-history`.
7. Run `npm run prisma:production:status` again and require up-to-date status.
8. Generate Prisma client and apply/check runtime permission normalization.
9. Build/start the new application.
10. Verify health, Session Debrief return/close behavior, and one disposable
    room/recording/materials canary. Confirm the active Vox marker remains RC4.

The migration is additive. Application rollback leaves it applied and leaves
RC4 active. Stop the new runtime, repeat the transient-work preflight, restore
application `601704bafde7da219fe1f1e37737e7769a09a6f9`, generate its Prisma
client/build as required, normalize permissions, start it, and run the rollback
canary. Do not reverse the migration or rewrite migration history.

No exact RC3 source exists in repository files or Git history, and Voximplant's
scenario API exports only the current source rather than version history. This
does not block the rollback above because RC4 retains the RC2 protocol used by
application `601704...`. It would be a rollback risk only if an RC3 scenario
restore became mandatory; no exact RC3 artifact is currently recoverable.

## Post-Deploy Checks

- Verify service health via admin diagnostics and endpoint checks.
- Verify one room -> recording -> webhook completion cycle.
- Verify materials status progression for a completed session.
- For Stage 3.10 maintenance timer rollout: verify dry-run command first (`npm run maintenance:stage310 -- --task all --dry-run`) before enabling timer.

## Stage 3.10 Release Order (Exact)

1. Confirm backups and rollback owner.
2. Stage code at `/var/www/negotaitions/app` and install dependencies if the
   deployment plan requires it.
3. Apply migration (`npx prisma migrate deploy`).
4. Verify migration status (`npx prisma migrate status`) and run Prisma
   generation if the deployment did not already do so.
5. Run `npm run ops:runtime-permissions:apply`.
6. Run `npm run ops:runtime-permissions:check`.
7. Restart `negotaitions-poc` only after runtime permission check succeeds.
8. Run smoke (`npm run test:e2e:smoke` and browser smoke subset as applicable).
9. Run backfill dry-run + first bounded batch.
10. Verify counters (`npm run maintenance:stage310 -- --task verify-backfill`).
11. Continue bounded backfill with cursor resume.
12. Deploy Vox scenario manually and run disposable provider canary.
13. Install maintenance units disabled, run manual one-shot.
14. Enable timer only after one-shot review.

## Vox scenario rollout safety (manual, non-automatic)

The `neg-conf-main-room` scenario artifact is manually deployed. For Stage 3.10 A7 rollout, prepare and execute in this order:

1. repository scenario diff review (`docs/voximplant/neg-conf.main-room.scenario.js`);
2. local syntax/static checks of scenario source;
3. scenario drift check (`npm run vox:scenario:check`);
4. backup/export currently deployed scenario source/build marker;
5. paste/upload new scenario source;
6. verify rule binding still points to `neg-conf-main-room`;
7. run disposable canary conference;
8. verify start/pause/resume/finish + participant relay + build marker + stopped webhook + recording output + transcription pipeline;
9. keep rollback-ready previous scenario source/build marker.

Provider-dependent checks in this block remain manual canaries and must not be moved into default CI validation commands.

Do not treat this as automatic deploy from app code. Existing facilitator relay must remain compatible before and after app deployment.

## Source Notes

- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
- `docs/deployment/yandex-poc-server-parameters.md`
- `docs/operations/stage-3-10-maintenance-runbook.md`
- `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md`
