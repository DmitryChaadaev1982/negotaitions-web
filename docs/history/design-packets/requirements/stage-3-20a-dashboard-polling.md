# Stage 3.20A — Dashboard Polling Consistency

## Authority

This is the authoritative requirement/change-plan manifest for Stage 3.20A.
Architecture, privacy, access, database, and operations documents remain the
domain/safety authorities. The production incident is supporting evidence only.

Status values: `APPROVED`, `IMPLEMENTED`, `PENDING`, `NOT_STARTED`, `PASS`.

```
STAGE_ID = 3.20A
STAGE_NAME = Dashboard Polling Consistency
STAGE_KIND = product / UI / data-refresh
PRODUCT_BEHAVIOR_CHANGE = YES
CHECKPOINT_0 = PASS
IMPLEMENTATION_WAVE = CU-1 + CU-2 + CU-3
CU-1 = IMPLEMENTED
CU-2 = IMPLEMENTED
CU-3 = IMPLEMENTED
UI_OPERATOR_CHECKPOINT = REQUIRED / PENDING
VALIDATION = L1 focused + coupled list tests; CP1 correction; L3/L4 NOT_RUN
EVAL_REGISTRY = RECONCILED
FINALIZATION = AWAITING_UI_OPERATOR_ACCEPTANCE
```

## Change Impact Analysis

```
CHANGE: Mounted /dashboard refreshes Session and Event lists using the same
        visible-list poll already used by /sessions and /events
INVARIANTS: Active/Archive derivation unchanged; list-page semantics unchanged;
            last-good Sessions and Events are independent; no schema/env/deps;
            no leaked or duplicate intervals
IMPACT: client, polling/refetch, presentation projection, tests/evals, docs
UNITS: CU-1 shared visible-list poll, CU-2 Dashboard snapshot apply,
       CU-3 focused tests + mapped docs
KERNEL: none (no DB/auth/lifecycle). CU-2 is the product-correctness kernel.
EVAL: EVAL-S320A-DASH-MOUNTED-LIST-REFRESH (MOUNTED_TRANSITION)
STRATEGY: A — keep together so poll + projection cannot drift
VALIDATION_PLAN: L1 T01-T15 + coupled list/dashboard-selection tests;
                 changed-file lint; git diff --check; eval registry check.
                 validate:fast / validate:deploy / L4 NOT_RUN.
                 UI_OPERATOR_CHECKPOINT REQUIRED.
```

## CU-1 — Canonical visible-list poll

**Business contract.** `/sessions`, `/events`, and `/dashboard` share one
refresh primitive: immediate fetch on mount, **2_000 ms** interval while the
document is visible, immediate refresh on `visibilitychange` → visible and on
`focus`, `cache: "no-store"`, in-flight suppression, abort/cleanup on unmount,
and preserve last-good rows when a poll fails.

Shared primitive: `startVisibleListPoll` / `useVisibleListPoll` /
`LIST_OVERVIEW_POLL_INTERVAL_MS = 2_000`.

A newly created Session or Event on an already-mounted, continuously visible
Dashboard must appear within one 2-second cycle without manual refresh or
refocus.

**Result:** `IMPLEMENTED`

## CU-2 — Dashboard uses the same list sources

**Business contract.** A mounted `/dashboard` must converge to newly created
Sessions and Events from `/api/sessions/list` and `/api/events/list` without
reload. Projection stays `buildAccountDashboardViewModel` (same Active/Archive
and hierarchy rules as the server page). One poll loop per mount fetches both
lists in parallel. Each side has independent last-good state. A successful
Session response updates Sessions even if Events fail, and the reverse. The
view model is rebuilt from latest-good Sessions + latest-good Events. A failed
side never blanks the other side.

**Result:** `IMPLEMENTED`

## CU-3 — Focused mounted-transition coverage

**Business contract.** Deterministic tests prove initial render, Session/Event
appearance without remount, no duplicates, last-good preservation, recovery,
independent side failure, cleanup, single interval, visibility pause, and
2_000 ms cadence alignment.

**Result:** `IMPLEMENTED`
