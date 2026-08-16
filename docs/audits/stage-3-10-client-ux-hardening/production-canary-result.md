# Stage 3.10 Client UX Hardening - Production Canary Result

## 1. Release identity

- Production branch: `origin/deploy/yandex-poc`
- Deployed SHA: `45feca7b46b89d08775ab799a4e95f235f9ebe9e`
- Build ID: `Im6zeoKR7rtLtY-P8ySOj`
- Deployment timestamp: 2026-07-30 approximately 16:40 MSK
- Server: `negotaitions-app-poc`
- Service: `negotaitions-poc` active
- Production URL: `https://negotaitions.ru`
- Event ID: `cms7kkg3n00001rm10x0lnxhc`
- Event URL: `https://negotaitions.ru/events/cms7kkg3n00001rm10x0lnxhc/`
- Session ID: `cms7kp93q00041rm1akvt26co`

## 2. Pre-deployment evidence

- Feature implementation commit: `17194a37c7eec56a51ef33d4be7ccfa5d93c0acb`.
- Fixture correction commit: `45feca7b46b89d08775ab799a4e95f235f9ebe9e`.
- Pre-deployment production source SHA: `3a487713b521f785e6c81d15c776765e9f15cd61`.
- Production branch `origin/deploy/yandex-poc` was fast-forwarded to `45feca7`.
- No dependency changes were included.
- No migrations were included.
- Production `.env.production` remained unchanged.
- Server backup was created at `/var/www/negotaitions-secure-backups/stage310-client-ux-20260730-163605`.
- Rollback branch was created: `rollback/stage310-client-ux-20260730-163605`.

> **Current policy note (does not rewrite this canary record):** `.next-pre-deploy`
> and historical env-snapshot patterns used in this stage are **not** the
> current production rollback policy. Current rollback is Git SHA / build with
> the current valid authoritative runtime env. See
> `docs/operations/deployment-runbook.md`.

## 3. Automated validation

- Focused helper tests: 26 PASS.
- `validate:fast`: 601/601 unit, 615 E2E discovered.
- `validate:deploy`: 601/601 unit, build/typecheck PASS.
- API smoke: 12/12.
- Browser smoke: 5/5.
- `test:stage310`: 102/102 unit + 30/30 E2E.
- `voximplant-event-lobby`:
  - pre-fix reproduction: 5 passed, 1 failed, 1 did not run;
  - post-fix: 7/7;
  - three stability reruns: 7/7 each.
- `session-finish-canonical`: 9/9 twice.
- `event-completion`: 12/12.
- `voximplant-room-presence`: 21/21.

The failing lobby test was a stale fixture defect. The fixture used a token-only `EventParticipant` and selected a facilitator without `userId`; `PATCH` saved the draft, then `POST createSessionFromEvent` correctly returned `facilitatorInvalid`. The fixture was aligned with the current production contract, and production validation was not weakened.

## 4. Local manual regression

Passed:

- facilitator, participants and observer entry;
- role separation;
- refresh and hard refresh;
- SSR presence without hydration flicker;
- short and long disconnect;
- reconnect after lease expiry;
- tab close without explicit leave;
- explicit leave;
- empty OPEN room remains OPEN;
- lobby polling without refresh;
- hidden/visible polling recovery;
- facilitator finish to DEBRIEF_OPEN;
- server-side recording stop;
- individual debrief leave and re-entry;
- re-entry during grace cancels old closure;
- closure after last departure and grace;
- recording, transcription and materials polling;
- event completion;
- UI regression without critical findings.

Local incident:

- `Unable to initialize Voximplant (404)` appeared after local server/tunnel interruption.
- `.env` had been copied after the dev server started.
- The Next.js process retained stale environment.
- Restarting the local dev server resolved the same Session.
- Classification: local runtime/configuration issue, not product defect.

## 5. Production canary

PASS:

- Event lobby updates without refresh;
- participant presence entry/exit;
- hidden/visible polling recovery;
- room title `roomLabel — session title`;
- refresh without duplicate participant or presence flicker;
- correct role and controls separation;
- facilitator finish to DEBRIEF_OPEN;
- recording stop progress and completion;
- participant leave and debrief re-entry;
- re-entry during grace;
- auto-close after final departure;
- recording availability;
- transcription start;
- materials status progression without rollback.

## 6. Operational logs

- Journal lines reviewed: 312.
- Structured records with `area`/`event`: 151.
- Relevant structured records: 128.
- Fatal/unhandled: 0.
- HTTP 5xx: 0.
- Service active.
- Release SHA matched.
- Lifecycle ended with `room_closed_after_expiry`.

`hostTokenProvided` is a boolean diagnostic field name. No host token value is logged. The sensitive-field scanner match was a false positive, and no secret exposure was found.

## 7. Known non-blocking observations

- Existing Turbopack NFT trace warning for active-audio-builder/transcription route.
- Build and TypeScript passed.
- Warning is not introduced by Client UX Hardening.
- Repeated `debrief_auto_close_decision` and reconciliation records create log noise.
- Backlog item: reduce duplicate lifecycle logs by logging state transitions or `activeConnectionCount` changes rather than each reconciliation pass.

## 8. Rollback

Safe rollback uses the retained rollback branch and runtime backup:

- Rollback branch: `rollback/stage310-client-ux-20260730-163605`.
- Backup runtime: `/var/www/negotaitions-secure-backups/stage310-client-ux-20260730-163605/.next-pre-deploy`.
- Preserve production evidence.
- Do not use `git reset --hard`.
- Do not leave the repository in detached HEAD.
- Recovery returns to `deploy/yandex-poc` using `git switch` and `git pull --ff-only`.

> **Current policy note:** the `.next-pre-deploy` path above is a historical
> canary artifact. It is not the current durable rollback mechanism. Rebuild
> from the accepted Git SHA; keep the current valid production env. See
> `docs/operations/deployment-runbook.md`.

No untested rollback commands are introduced here.

## 9. Final verdict

Stage 3.10 Client UX Hardening: PASS
Production canary: PASS
Release status: GO
Production SHA: 45feca7b46b89d08775ab799a4e95f235f9ebe9e

## 10. Deferred items

Non-blocking backlog outside the completed Stage 3.10 Client UX Hardening scope:

- consolidated session lifecycle display;
- further materials stop semantics;
- client finalization/post-close relay only if a reproducible defect appears;
- UI optimization as a separate stage;
- operational lifecycle log deduplication;
- browser-level deterministic out-of-order polling test.

Current correct debrief access remains DEBRIEF_OPEN + ALLOW_DEBRIEF during grace, without requiring another active participant.
