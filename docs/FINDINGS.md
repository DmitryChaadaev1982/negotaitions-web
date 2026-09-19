# Baseline findings

Unresolved issues discovered during the documentation baseline
reconciliation against production candidate
`308c1c74eb355724fd3377354c07d9821a0cb3f1`.

This Change Unit did **not** change product behavior. Findings are for a
future Change Unit or independent review.

Severity:

- P0/P1 — product correctness or security
- P2/P3 — documentation debt or non-blocking residuals

## P1

### FIND-01 — Management versus negotiation-control facilitator identity

- **CLASS:** AMBIGUOUS_REQUIREMENT
- **PRODUCT REQUIREMENT / INTENT:** Binding session owner is
  `Session.facilitatorId`. Binding management is ADMIN, Event host, Event
  facilitator, and that owner. Negotiation control requires identity
  alignment with `Session.facilitatorId`. Repository evidence does **not**
  prove that a FACILITATOR `SessionParticipant` who is not
  `Session.facilitatorId` is an intended manager.
- **IMPLEMENTATION REALITY:** `canManageSession` (`lib/access-control.ts`)
  also returns true when `SessionParticipant.type === "FACILITATOR"`
  (account or join token). `decideSessionManagementAuthorization` treats a
  resolved FACILITATOR participant as management even without an owner
  match. Comments in that helper call the type path “the token/account
  equivalent of the Session-facilitator rule,” which assumes equivalence
  rather than authorizing a second non-owner facilitator. Negotiation
  control (`app/api/sessions/[sessionId]/control/route.ts`) requires
  facilitator participant **and** `participant.userId === session.facilitatorId`.
- **PROVENANCE (narrow):** The original ownership-model helper granted
  management to ADMIN, Event host, and FACILITATOR participant type
  (commit `1407757`). Later code states `facilitatorId` is owner “by
  product decision” and adds `isSessionFacilitatorOwner` without removing
  the type-based grant. AUTH tests keep facilitator behavior when owner
  and FACILITATOR row coincide (`AUTH-06`, `AUTH-FINAL-05`); they do not
  assert management for a FACILITATOR row whose `userId` is not
  `facilitatorId`. Historical Stage 3.23A text says “Session facilitator /
  facilitator participant,” which reads as labels for the same role, not
  as a second manager. Current implementation therefore does not become a
  product requirement.
- **EVIDENCE:** `lib/access-control.ts` `canManageSession`;
  `lib/session-management-auth.ts` `decideSessionManagementAuthorization`;
  control route facilitator binding; `lib/session-management-auth.test.ts`;
  `lib/access-control.test.ts`.
- **RISK:** If participant rows drift from `facilitatorId`, a caller can
  manage materials without control, or the reverse. Reassignment
  (`reassignSessionFacilitator`, `ambiguousFacilitatorState`) mitigates
  but does not prove impossibility.
- **RECOMMENDED FUTURE CHANGE UNIT:** Decide whether FACILITATOR
  participant type without `facilitatorId` match is intended management,
  then align control/materials/projection if not. Do not reopen BUG02.
  Do not treat this documentation baseline as that decision.

### FIND-02 — Admin materials projection row is earliest FACILITATOR participant

- **CLASS:** AMBIGUOUS_REQUIREMENT / internal inconsistency
- **PRODUCT REQUIREMENT / INTENT:** Display and owner identity use
  `Session.facilitatorId`. Participant membership may enrich a materials
  payload. No proven product requirement names which FACILITATOR row to
  use when several exist. Earliest-by-`createdAt` is not a binding
  requirement.
- **IMPLEMENTATION REALITY:** `loadFacilitatorParticipantForManagerView`
  (`lib/session-management-auth.ts`) selects the earliest
  `type: FACILITATOR` by `createdAt`. Reassignment uses
  `resolveCanonicalFacilitatorParticipantId` with `facilitatorId`.
- **EVIDENCE:** `lib/session-management-auth.ts`;
  `lib/session-facilitator.ts`; `lib/session-overview-people.ts`.
- **RISK:** Under corrupted/legacy rows, admin materials context can attach
  to a non-owner FACILITATOR participant while lists show the
  `facilitatorId` user.
- **RECOMMENDED FUTURE CHANGE UNIT:** Use the same canonical participant
  resolver for manager projection, or explicitly accept earliest-row as
  the contract. Do not promote the current helper into a requirement
  solely because it exists.

## P2

### FIND-03 — PostgreSQL truncates one email-ingestion unique index name

- **CLASS:** IMPLEMENTED_AND_REQUIRED with known identifier truncation
- **REQUIREMENT / EXPECTED CONTRACT:** Unique indexes should have explicit
  names ≤ 63 bytes.
- **ACTUAL IMPLEMENTATION:** Migration
  `20260806113000_add_email_provider_event_ingestion` declares
  `EmailProviderIngestionFailure_provider_streamName_shardId_sequenceNumber_key`
  (76 characters). PostgreSQL truncates to 63 bytes. Current migration is
  intentionally not rewritten.
- **EVIDENCE:** Historical residual FINAL-05 in
  `docs/history/remediation/backlog/stage-3-13c-final-review-residuals.md`
  (path after archive). Prisma migration file as cited there.
- **RISK:** Future identifier with the same first 63 bytes could collide.
- **RECOMMENDED FUTURE CHANGE UNIT:** Planned migration-history cleanup with
  an explicit short unique-index name. Do not rewrite committed SQL in this
  baseline.

### FIND-04 — Non-production ops static imports can read config before bootstrap

- **CLASS:** DOCUMENTED_NOT_IMPLEMENTED as a product defect; deferred ops
  hygiene
- **REQUIREMENT / EXPECTED CONTRACT:** Ops entrypoints bootstrap env before
  reading typed config.
- **ACTUAL IMPLEMENTATION:** Some local/non-production scripts still static-
  import config before `bootstrapOperationalEnv()`. Production systemd units
  inject `/etc/negotaitions/env.production`.
- **EVIDENCE:** Historical residual L-01 (same backlog file as FIND-03).
- **RISK:** Local-only misconfiguration; not a production blocker.
- **RECOMMENDED FUTURE CHANGE UNIT:** Convert remaining non-production
  entrypoints to bootstrap-then-dynamic-import.

### FIND-05 — Obsolete origin-variable names remain in tests

- **CLASS:** HISTORICAL_ONLY test fixture names
- **REQUIREMENT / EXPECTED CONTRACT:** Tests should not imply removed
  `NEXT_BUILD_ALLOW_LOCAL_SERVER_ACTION_ORIGINS` runtime knobs.
- **ACTUAL IMPLEMENTATION:** `lib/config/server-action-origins.test.ts`
  still mentions obsolete names. Production resolver ignores them.
- **EVIDENCE:** Historical residual FINAL-06.
- **RISK:** None at runtime; reviewer confusion.
- **RECOMMENDED FUTURE CHANGE UNIT:** Replace fixtures with a generic
  unknown-override test.

### FIND-06 — `canEditSession` is defined but unused on production routes

- **CLASS:** IMPLEMENTED_NOT_DOCUMENTED (dead helper)
- **REQUIREMENT / EXPECTED CONTRACT:** Management uses `canManageSession`.
- **ACTUAL IMPLEMENTATION:** `canEditSession` in `lib/access-control.ts` is
  not wired to production Session routes (E2E helper mirrors it).
- **EVIDENCE:** `lib/access-control.ts`; production grep of `canEditSession`.
- **RISK:** Future callers may assume a distinct edit authority.
- **RECOMMENDED FUTURE CHANGE UNIT:** Remove or document as unused, or
  wire it if a distinct edit contract is required.

## P2

### FIND-08 — BUG04 Slice B peer/endpoint convergence is implemented

- **CLASS:** RESOLVED (BUG04 Slice B)
- **PRODUCT REQUIREMENT / INTENT:** Unstable-network session rooms should
  recover Layer-3 media without losing Layer-1 presence, and remote tiles
  should converge on live tracks when endpoints replace each other.
- **IMPLEMENTATION REALITY:** Slice A remains Layer-3 recovery. Slice B
  adds `lib/voximplant/participant-media-selection.ts` plus a single
  session-room selection owner
  (`lib/voximplant/peer-media-selection-runtime.ts`): logical identity is
  normalized Vox username; endpoint id is transport identity; live-track-first
  selection is shared by the session-room event path, background snapshot
  reconcile, video tiles, and remote-audio playback. Equal-quality overlap
  retains the previously selected endpoint for both video and audio.
  Remote HTMLAudioElement playback is selected-endpoint and
  selected-current-stream only (`lib/voximplant/remote-audio-playback.ts`):
  an obsolete same-endpoint stream is not playback-eligible. Refresh is not
  required. Event lobby does not copy session-room peer selection.
- **EVIDENCE:** `docs/architecture/05-voximplant-integration.md`;
  `lib/voximplant/participant-media-selection.ts`;
  `lib/voximplant/peer-media-selection-runtime.ts`;
  `lib/voximplant/remote-audio-playback.ts`;
  `components/voximplant-video-layout.tsx`;
  `lib/voximplant/use-voximplant-room.ts`.
- **RISK:** None remaining for the Slice B peer-convergence contract.
- **RECOMMENDED FUTURE CHANGE UNIT:** None for this gap.

## P3

### FIND-07 — `/api/livekit/sidebar` name versus dual-provider use

- **CLASS:** AMBIGUOUS_REQUIREMENT (naming)
- **REQUIREMENT / EXPECTED CONTRACT:** Session room clients poll a shared
  sidebar roster for both LiveKit and Voximplant.
- **ACTUAL IMPLEMENTATION:** Route remains `/api/livekit/sidebar` and is
  consumed by Vox rooms. Canonical `05-voximplant-integration.md` now
  records this.
- **EVIDENCE:** `docs/architecture/05-voximplant-integration.md`;
  Vox room polling.
- **RISK:** Operators may think Vox rooms do not use the route.
- **RECOMMENDED FUTURE CHANGE UNIT:** Optional rename is a behavior-adjacent
  routing change; not part of this documentation baseline.

## Resolved in this documentation Change Unit

- FINAL-04 (account-security origin archaeology) — canonical
  `account-security-email-flows.md` now states production origins as
  exactly `negotaitions.ru` and lists local origins as development-only.
- Unique active knowledge from stage requirement manifests, AI lifecycle
  supplement, timezone occupancy incident, and email retention policy is
  recovered into canonical architecture/requirements.
- Historical documents are archived under `docs/history/` and are no
  longer required reading for current architecture.

## Out of scope

- Reopening BUG02 / session-admin enhancement implementation
- Production mutations, real-provider calls, Yandex/Vox UAT
