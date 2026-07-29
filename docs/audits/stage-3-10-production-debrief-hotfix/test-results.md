# Test results

Server mode for Playwright (when run): **managed** (`run-playwright-mode.mjs --mode=managed`).

## Focused unit + dual-TZ (executed)

```
node --import ./scripts/test-unit-env-bootstrap.mjs --import tsx --test \
  lib/session-room-occupancy.test.ts \
  lib/sql-utc-wall-clock.test.ts \
  lib/sql-utc-wall-clock.pg.test.ts \
  lib/session-room-lifecycle.test.ts \
  lib/session-room-access.test.ts
```

Result: **32 pass / 0 fail** (includes UTC + Europe/Moscow pg probes).

## validate:fast

Previously completed successfully after E2E_DATABASE_URL was available (lint + prisma + unit 578 pass + e2e list). Re-run after helper change recommended before deploy.

## Still to run before deploy (same managed mode)

```
npm run validate:deploy
npm run test:e2e:smoke
npm run test:e2e:smoke:browser
npm run test:stage310
```

Focused e2e (managed):

```
node scripts/run-playwright-mode.mjs --mode=managed -- \
  tests/e2e/session-finish-canonical.spec.ts \
  tests/e2e/voximplant-room-presence.spec.ts \
  --project=chromium
```

## Skipped / pending

- Full browser debrief navigation canary is production manual (see canary plan)
- validate:deploy / smoke suites interrupted earlier in session — must complete before merge to deploy branch
