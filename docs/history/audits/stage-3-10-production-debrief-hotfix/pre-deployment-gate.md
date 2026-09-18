# Pre-deployment gate

Date: 2026-07-30  
Branch: `fix/stage-3-10-production-debrief-hotfix`  
Hotfix: `f94257bf643e3c23f411f389bc3e7d4d9c20c03e`

## Decision: **GO**

All mandatory commands exited 0; Stage 3.10 suite green; no unresolved class **A** timezone comparison remains on FINISH/occupancy/lease-count path; class **B** items are outside the live lifecycle compare path and are non-blocking.

At the time this pre-deployment gate was recorded, merge and production deployment had not yet been executed and were awaiting explicit approval.

## Checklist

| Criterion | Result |
|---|---|
| `validate:deploy` exit 0 | PASS (retry after local lightningcss native install) |
| `test:e2e:smoke` exit 0 | PASS (12/12) |
| `test:e2e:smoke:browser` exit 0 | PASS (5/5) |
| `test:stage310` exit 0 | PASS (102 unit + 30 e2e) |
| No failing Stage 3.10 tests | PASS |
| Branch changes limited to hotfix/tests/audit | PASS (`origin/deploy/yandex-poc...HEAD` = 18 files in hotfix commit + gate docs commit) |
| Unresolved class B in lifecycle/lease compare path | PASS (none) |
| Concurrent FINISH harness | Non-blocking follow-up |

## Class B items (explicit)

| Item | FINISH→DEBRIEF path? | Lease expiry / grace / stop deadlines? | Deploy blocker? | Why |
|---|---|---|---|---|
| DB `DEFAULT CURRENT_TIMESTAMP` on many `createdAt` columns | No — finish occupancy uses Prisma-written `expiresAt` / JS Date, not createdAt defaults | No for lease expiry (expiresAt set explicitly by Prisma); no for grace (JS Date); no for stop deadlines (JS Date) | **No** | Affects raw SQL inserts that rely on DB default under session TZ; production lease/finish path does not use those defaults for the broken comparison |
| E2E fixtures `NOW()` / `updatedAt=NOW()` | No in production runtime | Only test DB seeds; may skew fixture clocks if e2e DB TZ ≠ UTC | **No** | Test-only; managed e2e suites passed; not shipped runtime |

## Lifecycle path residual risk

No remaining raw `expiresAt > NOW()` (or equivalent) in production occupancy/finish/close CAS after hotfix. Prisma lease expiry/renewal remains JS Date (**D**).

## Historical commands awaiting approval at gate time

These commands reflect the repository state at pre-deployment gate time. Merge, production deploy, and the production canary were subsequently completed successfully; see [production-canary-result.md](./production-canary-result.md).

```bash
git checkout deploy/yandex-poc
git merge --ff-only origin/fix/stage-3-10-production-debrief-hotfix
git push origin deploy/yandex-poc
# then production pull/build/restart + canary
```

## Final production canary closeout

Gate decision above remains the pre-deploy GO. After release `3a487713b521f785e6c81d15c776765e9f15cd61`, production canary session `cms6njs0m000t6nm171at227c` completed: **PASS** / production status **GO**.

Non-blocking follow-ups unchanged (observer mapping, concurrent FINISH/auto-timer, npm vulns, Turbopack NFT, optional timestamptz migration).

Evidence: [production-canary-result.md](./production-canary-result.md).
