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

Full Playwright regression:

- `npm run test:e2e:full`

Curated deterministic smoke:

- `npm run test:e2e:smoke`

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

## Reverse Tunnel Policy (Phase 1)

- Default tests should not require a reverse tunnel.
- Tunnel-required tests will be explicitly classified in a later phase.
- Tunnel auto-start is not supported in Phase 1.
- The current tunnel remains a manual operational step.
- Future tunnel preflight should fail fast with clear instructions instead of hanging.
- Tests must never automatically kill a stale remote tunnel by default.
- Phase 3 will introduce explicit tunnel classification/preflight; Phase 2 smoke excludes tunnel-only checks.

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

## Key E2E Coverage Areas

- Event multi-session lifecycle and assignment behavior.
- Session lifecycle control state and room navigation.
- Recording/transcription/materials flow with role-gated access.
- Speaker mapping and debrief-sharing behaviors.
- Security/access behavior for account-mode restrictions and protected APIs.

## Canonical References

- `tests/e2e/**`
- `docs/testing/validation-checklist.md`
- `docs/testing/yandex-poc-smoke-regression-plan.md`
- `docs/audits/archive/old-root-reports/TEST_PLAN.md`
- `docs/audits/archive/old-root-reports/TEST_RESULTS.md`
