# Stage 3.10 Post-Deploy Checklist

## Core Product Checks

- [ ] Login succeeds for admin/facilitator.
- [ ] Sessions overview loads and completion action responds.
- [ ] Session detail completion action works.
- [ ] Standalone room access rules: OPEN allow, CLOSED redirect.
- [ ] Event lobby is blocked for completed events.
- [ ] Administrative completion endpoint idempotency verified.

## Presence + Lifecycle Checks

- [ ] Explicit leave disconnects only caller.
- [ ] Refresh within grace keeps room continuity.
- [ ] Debrief rejoin works for authorized users.
- [ ] Last-disconnect closure behavior verified.
- [ ] Event completion enforces CLOSED behavior.

## Recording + Materials Checks

- [ ] Stop operation created once per recording.
- [ ] Relay acknowledgment/convergence observed.
- [ ] Stopped webhook received.
- [ ] Recording status transitions to STOPPED/COMPLETED.
- [ ] Materials page accessible.
- [ ] Transcript pipeline starts.

## Operations Checks

- [ ] One-shot maintenance command succeeds.
- [ ] Timer still disabled until one-shot reviewed.
- [ ] Timer enabled only after manual one-shot validation.
- [ ] First timer run checked in journal.
- [ ] No repeated maintenance failures.

## Observability Commands

```bash
journalctl -u negotaitions-poc -n 300 --no-pager
journalctl -u negotiations-stage310-maintenance.service -n 300 --no-pager
```
