# Stage 3.19B — Vox Room Long-Idle Consistency

## Authority

This is the authoritative requirement/change-plan manifest for Stage 3.19B.
Architecture, privacy, access, database, and operations documents remain the
domain/safety authorities. CP0 forensics are supporting evidence only.

Production incident recorded: `cmt8lfu7w0000w9m1xq6hlfpj`.
Do not include secrets or provider access URLs.

Status values: `APPROVED`, `IMPLEMENTED`, `PENDING`, `NOT_STARTED`, `PASS`.

```
STAGE_ID = 3.19B
STAGE_NAME = Vox Room Long-Idle Consistency
STAGE_KIND = product / provider recovery
PRODUCT_BEHAVIOR_CHANGE = YES
CHECKPOINT_0 = PASS
IMPLEMENTATION_WAVE = CP1
CP1 = IMPLEMENTED
OA-LIVE-VOX = LOCAL_PASS / PRODUCTION_CANARY_PENDING
VALIDATION = RC validate:fast + validate:deploy PASS
EVAL_REGISTRY = RECONCILED
FINALIZATION = RC
RELEASE_CANDIDATE = THIS_COMMIT
```

## Change Impact Analysis

```
CHANGE: Clear stale remotes on actual provider disconnect; one bounded
        Session-room rejoin while the Session remains operable; generation
        fencing; classify ReInvite/IceRestart timeout and NotReadableError
        correctly; conservative endpoint snapshot reconciliation
INVARIANTS: Vox 408 is tolerated, not prevented; Vox disconnect is not a
            Session Leave; no lease/heartbeat change; no Scenario/DB/env
            change; no recording/transcription/AI/lifecycle change;
            IceRestart while the call remains up is not a full rejoin;
            camera Device-in-use is non-terminal
IMPACT: client, provider integration, tests/evals, architecture docs
UNITS: CU-1 classification, CU-2 disconnect cleanup + bounded rejoin,
       CU-3 snapshot reconciliation, CU-4 layout defense, CU-5 lobby parity
KERNEL: CU-2 generation-fenced cleanup/rejoin (reconnect storm / Leave
        auto-rejoin / old-gen corruption)
EVAL: EVAL-S319B-STALE-REMOTE-CLEAR, EVAL-S319B-BOUNDED-REJOIN,
      EVAL-S319B-GENERATION-FENCE, EVAL-S319B-ICE-REINVITE-CLASS,
      EVAL-S319B-DEVICE-CLASS, EVAL-S319B-SNAPSHOT-RECONCILE
STRATEGY: A — keep together; shared helpers must stay consistent
VALIDATION_PLAN: L1 focused unit/classification/mounted/mock-E2E;
                 git diff --check; relevant lint/type sanity.
                 validate:fast / deploy / smoke / L4 / live-provider
                 automated suite NOT_RUN at this checkpoint.
                 LIVE_VOX_OPERATOR_ACCEPTANCE REQUIRED / PENDING.
```

## CU-1 — Provider signal classification

**Business contract.** Production-shaped WebSDK lines must classify as
recoverable media/signalling or local-device failure, not unclassified
terminal:

- JSON-in-message `"actionName":"IceRestartAction"` plus
  `Action run failed to timeout`
- `ReInviteFailedDueTimeout`
- StreamManager `NotReadableError: Device in use`

Genuinely terminal auth/security failures stay terminal.

**Result:** `IMPLEMENTED`

## CU-2 — Disconnect cleanup and one bounded rejoin

**Business contract.** An actual current-generation conference disconnect
clears remotes and conference-connected state immediately. Unexpected
disconnect while the user is still on the room surface, the Session remains
operable (`sessionCloseState.isClosed === false` and the lease is not stale),
and teardown was not our own Leave/unmount/stale path, starts exactly one
bounded rejoin through the existing access/join path with a new generation.
Expected disconnects never auto-rejoin. Failed rejoin stays disconnected.

**Result:** `IMPLEMENTED`

## CU-3 — Conservative endpoint snapshot

**Business contract.** The existing 1s snapshot loop must not wipe remotes
just because the local SDK map is transiently empty while the current call
is still joined/connected. EndpointRemoved and actual disconnect still
remove remotes. A non-empty authoritative snapshot may drop a missing id.

**Result:** `IMPLEMENTED`

## CU-4 — Tile defense-in-depth

**Business contract.** `VoximplantVideoLayout` must not treat stale remotes
as live when the current client is not joined. Provider state remains
canonical.

**Result:** `IMPLEMENTED`

## CU-5 — Event lobby parity

**Business contract.** Inspect lobby. Share only helpers that are safe for
both surfaces (classification, conservative snapshot, disconnect remote
clear). Do not copy Session bounded rejoin into lobby.

**Result:** `IMPLEMENTED`

## CP1 checkpoint

Implementation is complete for the application-side recovery contract.
Local live Vox operator acceptance is PASS, including unexpected 408
recovery. Production operator canary remains PENDING after technical
activation. Focused Stage 3.19B tests 75/75 PASS. `validate:fast` and
`validate:deploy` PASS for this RC. Playwright smoke/browser and live
provider automated suites were not in the authorized RC command list.

## Out of scope

Vox Scenario, Prisma/migrations, SessionRoomConnection lease TTL, heartbeat
cadence, production env, recording, transcription, AI, Session/Event
lifecycle policy, publication, role assignment, Stage 3.19A readiness,
presence SSE demo gate, preventing Vox 408 itself.
