# Call graph — facilitator FINISH → materials

```
Facilitator click FINISH
  → POST /api/sessions/:id/control (action=FINISH)
    → decideSessionRoomAccess (pre-finish OPEN/null → ALLOW)
    → validate lease (optional connectionId)
    → applyAutoTransitions (AUTO_TIMER only if remaining≤0; incident ran ~10s of 120s)
    → completeSessionCanonical(ROOM_FACILITATOR_FINISH)
         tx:
           read Session (+ event)
           deriveEffectiveRoomLifecycle
           countActiveSessionRoomConnections(tx, now)   ← occupancy clock
           decideFinishRoomLifecycle
           session.update(FINISHED + roomLifecycle)
           claimRecordingStopIntent
         post-tx:
           closeAllOpenPauseIntervals
           deliverRecordingStopOperation
         log: canonical_session_finish_decision
    → buildControlState response 200
  → clients poll GET control-state
    → decideSessionRoomAccess
         CLOSED → 409 ROOM_CLOSED + redirectTo materials
         DEBRIEF_OPEN+FINISHED → 200 ALLOW_DEBRIEF
    → client window.location.replace(redirectTo)
```

## Write sites (production-critical)

| field | writers |
|---|---|
| negotiationState | `completeSessionCanonical` via `getControlUpdateData(FINISH)` |
| roomLifecycle | `completeSessionCanonical`; `closeDebriefRoomIfEmpty` CAS; maintenance backfill |
| disconnectedAt / expiresAt / supersededAt / revokedAt | lease claim/renew/leave/expiry sweep (Prisma Date) |

## Post-finish reconciliation

`closeDebriefRoomIfEmpty` requires DEBRIEF_OPEN + zero occupancy + grace.  
Incident CLOSED within ~5–8 ms of `negotiationEndedAt` → canonical finish write, not grace close.
