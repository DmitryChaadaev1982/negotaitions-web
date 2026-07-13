# E2E Strategy

## Goals

- Validate end-to-end business flow for cases, events, sessions, materials, and role access.
- Keep provider-integrated flows testable with deterministic defaults.
- Prevent regressions in room lifecycle, recording pipeline, and AI sharing logic.

## Test Layers

- Domain-heavy regression specs (events/sessions/access/materials).
- Provider-focused specs (Voximplant room/lobby/layout/recording diagnostics).
- Diagnostics and environment checks.

## Default Execution Model

- Mock external services by default for stable and cost-safe runs.
- Keep live-provider smoke tests explicit and opt-in only.
- Keep routine validation fast and non-browser-executing where possible.

## Recommended Commands

Routine local validation:

- `npm run validate:fast`

Deploy validation:

- `npm run validate:deploy`

Test inventory only:

- `npm run test:e2e:list`

Explicit browser setup:

- `npm run test:e2e:install`

Deterministic local Playwright inventory:

- `npm run test:e2e:local:list`

Full Playwright regression:

- `npm run test:e2e:full`

Curated deterministic smoke:

- `npm run test:e2e:smoke`

Curated deterministic browser smoke:

- `npm run test:e2e:smoke:browser`

Stage 3.10 focused deterministic regression (provider-free):

- `npm run test:stage310`

Stage 3.10 focused browser smoke subset:

- `npm run test:stage310:browser`

Tunnel preflight and classified suites (opt-in only):

- `npm run test:e2e:tunnel:check`
- `npm run test:e2e:tunnel:list`
- `npm run test:e2e:tunnel`
- `npm run test:e2e:live:list`
- `npm run test:e2e:live`

## Mandatory validation gates

For implementation phases that modify code, tests, config, or runtime behavior, run and report all gates below:

- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

Rules:

- All four gates are mandatory unless the task is strictly audit-only or docs-only.
- If a gate cannot run, report the exact blocker; do not silently omit gates.
- Do not hide failures via retries or by skipping tests.
- `npm run test:e2e:full` remains manual/nightly unless explicitly requested.
- Tunnel/live-provider suites are opt-in and never part of default mandatory gates.
- A change is not merge-ready until applicable mandatory gates pass, or the user explicitly accepts a documented exception.

### Gate execution order

- Run gates sequentially in this exact order:
  1. `npm run validate:fast`
  2. `npm run validate:deploy`
  3. `npm run test:e2e:smoke`
  4. `npm run test:e2e:smoke:browser`
- Do not overlap browser smoke with other local Playwright runs because local config binds port `3100`.

## Phase 4 fixture stabilization policy

- Use run-scoped fixture namespace helpers from `tests/e2e/helpers/db.ts`:
  - `getE2eRunId()`
  - `e2eName(base)`
  - `e2eEmail(base)`
  - `e2eId(base)`
- `E2E_RUN_ID` may be set externally; otherwise it is generated once per Playwright process.
- DB-mutating queries are guarded by a safety assertion:
  - Accepts explicit test DB env (`E2E_DATABASE_URL` or `TEST_DATABASE_URL`), or
  - test/e2e-style DB naming, or
  - explicit local override `E2E_ALLOW_DB_MUTATION=1`.
- Safety guard rejects obviously production-like DB host/name patterns.
- Stage 3.10 browser/API suites require local DB schema aligned with additive migration:
  - run `npx prisma migrate status`
  - run `npx prisma migrate deploy` (non-production only)
  - rerun `npx prisma generate` and `npx prisma validate`
- Cleanup ownership rule:
  - `cleanupE2eData()` must remove only current run namespace data plus rows owned by current run users.
  - New tests must avoid broad wildcard cleanup (`LIKE '%E2E%'`) against shared data.
- Residual legacy suites may still use older cleanup patterns; migrate incrementally and document remaining debt in phase reports.

## Validation Gate Model

`validate:fast` includes:

- Lint
- Prisma validate
- Prisma generate
- Unit tests (`test:unit`)
- Playwright test listing (`test:e2e:list`)

Properties:

- No browser execution
- No reverse tunnel requirement
- No intentional DB mutation by Playwright

`validate:deploy` includes:

- `validate:fast`
- Production build

`test:e2e:full` is:

- Broad Playwright regression
- DB-mutating
- Environment-sensitive
- Not currently the default deploy gate

`test:e2e:smoke` is:

- Chromium-only curated subset (`--project=chromium --grep @smoke`)
- No reverse tunnel required
- Mock-provider compatible (no real Voximplant/Yandex/live callbacks)
- DB-mutating by design (requires dedicated non-production test DB)
- Intended for deploy-adjacent browser/API validation after stability checks

`test:e2e:smoke:browser` is:

- Chromium-only curated browser-first subset (`--config=playwright.local.config.ts --project=chromium --grep @browser-smoke`)
- Deterministic local mode only
- Localhost only (`http://127.0.0.1:3100`)
- Playwright-managed local `webServer`
- Mock external providers only
- No reverse tunnel and no external HTTPS callback dependency

`test:stage310` is:

- Non-provider Stage 3.10 subset (unit + scenario contract + deterministic API/browserless E2E)
- No real provider calls
- No reverse tunnel requirement
- Requires non-production DB with Stage 3.10 migration applied

`test:stage310:browser` is:

- Local deterministic browser subset (`playwright.local.config.ts`)
- Requires Chromium runtime (`npm run test:e2e:install`)
- Uses local Playwright web server, no provider access

`test:all` remains available for backward compatibility as a broad legacy/full-suite command, but it is not the recommended routine deploy gate while full Playwright remains unstable or environment-dependent.

## Playwright Runtime Behavior

- Playwright package installation and browser binary installation are separate steps.
- Normal test commands should not intentionally run `playwright install`.
- Browser installation is an explicit setup step via `npm run test:e2e:install`.
- Running `npx playwright` from repository root resolves the local project dependency.
- Running `npx playwright` outside repository root can trigger a transient package download.
- `PLAYWRIGHT_BROWSERS_PATH` can redirect browser storage from OS defaults.
- Ephemeral sandbox paths for `PLAYWRIGHT_BROWSERS_PATH` can cause repeated browser downloads.
- Default `ms-playwright` cache locations:
  - Windows: `%LOCALAPPDATA%\ms-playwright`
  - Linux: `~/.cache/ms-playwright`

## Runtime Modes

- Deterministic local browser mode: `playwright.local.config.ts` + localhost + managed local `webServer`.
- General/default mode: `playwright.config.ts` + existing env-driven behavior.
- Future tunnel/provider mode: planned for Phase 3B (`@requires-tunnel` + preflight), not implemented in this phase.

## Reverse Tunnel Policy (Phase 1)

- Default tests should not require a reverse tunnel.
- Tunnel-required tests are explicitly classified with `@requires-tunnel`.
- Live-provider tests are explicitly classified with `@live-provider`.
- `test:e2e:tunnel` excludes `@live-provider` tests by default.
- Tunnel auto-start is not supported in Phase 1.
- The current tunnel remains a manual operational step.
- Tunnel preflight fails fast with clear instructions and non-zero exit on failure.
- Tests must never automatically kill a stale remote tunnel by default.
- No SSH auto-start and no stale-tunnel auto-kill are performed by test scripts.

## Future Suite Model (Planned, Not Yet Implemented)

- Playwright smoke: curated Chromium-only critical journeys.
- Tunnel-required tests: explicit opt-in group.
- Provider/live tests: separate manual or dedicated-environment group.
- Full Playwright: manual/nightly until stabilized.

## Phase 2 Smoke Coverage (Current)

Current `@smoke` scope emphasizes deterministic business guards:

- Admin diagnostics secret masking and env grouping sanity.
- Standalone session ownership/invite integrity (facilitator resolution, invite dedupe).
- Event/session invite visibility rules for private resources.
- Public/private authorization and participant dedupe guards.

Intentionally not covered in Phase 2 smoke:

- Real Voximplant conferencing/recording.
- Real SpeechKit/Yandex provider flows.
- Reverse tunnel and HTTPS callback behavior.
- Audio/transcription heavy long workflows.
- Full browser regression and multi-browser/mobile coverage.

## Base URL and Web Server

- With no external base URL env set, Playwright starts local web server automatically from config.
- Setting external `PLAYWRIGHT_BASE_URL`, `BASE_URL`, or `APP_URL` suppresses Playwright `webServer` startup.
- Documentation and runbooks should assume this current behavior.
- Deterministic local config explicitly pins base URL to `http://127.0.0.1:3100` and does not route tests via shell-provided `APP_URL`, `BASE_URL`, `NEXT_PUBLIC_APP_URL`, or `PLAYWRIGHT_BASE_URL`.

## Key E2E Coverage Areas

- Event multi-session lifecycle and assignment behavior.
- Session lifecycle control state and room navigation.
- Recording/transcription/materials flow with role-gated access.
- Speaker mapping and debrief-sharing behaviors.
- Security/access behavior for account-mode restrictions and protected APIs.

## Canonical References

- `tests/e2e/**`
- `docs/testing/stage-3-10-session-lifecycle-scenario-catalog.md`
- `docs/testing/stage-3-10-session-lifecycle-traceability.csv`
- `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md`
- `docs/testing/validation-checklist.md`
- `docs/testing/yandex-poc-smoke-regression-plan.md`
- `docs/audits/archive/old-root-reports/TEST_PLAN.md`
- `docs/audits/archive/old-root-reports/TEST_RESULTS.md`

## Stage 3.10 Checkpoint B guard focus

Checkpoint B adds explicit routing/lifecycle guard expectations:

- room direct URL for `OPEN`, `DEBRIEF_OPEN`, `CLOSED`;
- completed event lobby direct URL server guard;
- refresh/back/stale-tab close handling without reconnect loops;
- closed-room provider credential denial (`ROOM_CLOSED` / `EVENT_CLOSED`).

Deterministic policy checks are anchored in `lib/session-room-access.test.ts`; browser confirmation remains part of `test:stage310` and `test:stage310:browser`.
