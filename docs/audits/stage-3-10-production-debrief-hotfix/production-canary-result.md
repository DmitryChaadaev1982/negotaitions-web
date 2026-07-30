# Stage 3.10 production canary result

Date: 2026-07-30  
Release commit: `3a487713b521f785e6c81d15c776765e9f15cd61`  
Production session: `cms6njs0m000t6nm171at227c`  
Materials: https://negotaitions.ru/sessions/cms6njs0m000t6nm171at227c/materials

## Verdict

- Stage 3.10 production canary: **PASS**
- Stage 3.10 production status: **GO**

Historical incident / failed-path evidence remains in `production-evidence.md` (incident sessions and historical recording-stop reconciliation). This file records only the post-hotfix successful canary and does not replace that evidence.

## Confirmed

1. Timezone occupancy hotfix
2. `OPEN` → `DEBRIEF_OPEN` → `CLOSED`
3. Debrief re-entry
4. 30-second auto-close grace
5. True Voximplant server-side recording stop
6. Corrected Application Secrets synchronization
7. Successful recording persistence and transcription

## Lifecycle

- Facilitator FINISH moved the session to `DEBRIEF_OPEN`, not immediately to `CLOSED`
- Participants remained in the room after negotiations ended
- control-state continued to return HTTP 200 for active connections
- A separately departed connection received 409; remaining connections continued to work
- Re-entry into debrief successfully created a new lease
- After last connection leave/expiry:
  - `lastInvalidatedAt` = `2026-07-29T22:27:36.885Z`
- Room stayed `DEBRIEF_OPEN` during the grace period
- Logs showed sequential `graceRemainingMs` decrease: `13004`, `10498`, `7997`, `4439`, `1934`
- Close:
  - `now` = `2026-07-29T22:28:08.470Z`
  - `graceRemainingMs` = `0`
  - `eligibilityReason` = `grace_period_elapsed`
  - `updateRowCount` = `1`
  - `closed` = `true`
- Observed interval after last invalidation: ~31.585 s
- Final state: `negotiationState` = `FINISHED`; `roomLifecycle` = `CLOSED`

## Recording

- `provider` = `VOXIMPLANT`
- `status` = `COMPLETED`
- `startedAt` = `2026-07-29T22:24:42.588Z`
- `endedAt` = `2026-07-29T22:24:55.204Z`
- `errorMessage` = `null`
- User confirmed recording was saved and successfully transcribed

## Server-side stop

- Stop operation state = `DELIVERED`
- `attemptCount` = `1`
- `lastDeliveryTransport` = `voximplant_server_control`
- `transportAcceptedAt` = `2026-07-29T22:24:55.253Z`
- `commandAcceptedAt` populated
- `providerTerminalAt` populated
- `deliveredAt` populated
- `lastErrorClass` = `null`
- `SessionVoximplantControlChannel` rows = `1`
- `VoximplantCallbackNonce` rows = `3`
- Three POSTs to server-stop-callback returned HTTP 200
- `channel_registered` successfully recorded
- Relay fallback and late webhook reconciliation were **not** the actual transport for this stop

## Non-blocking follow-ups

- Standalone observer `PARTICIPANT` / `OBSERVER` mapping
- Deterministic concurrent manual FINISH / auto-timer regression
- npm dependency vulnerabilities
- Turbopack NFT warning
- Possible long-term migration of absolute DateTime columns to `timestamptz`
