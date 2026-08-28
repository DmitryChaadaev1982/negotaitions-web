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

Command catalog only. When to run L1–L4 is in
[validation-checklist.md](./validation-checklist.md).

Routine L3 checkpoint:

- `npm run validate:fast`

Standalone complete deploy validation:

- `npm run validate:deploy`

Production build only, after a known-green `validate:fast`:

- `npm run validate:build`

Test inventory only:

- `npm run test:e2e:list`
- `npm run test:e2e:db:check` (read-only E2E database preflight)

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

Post-processing Facilitator Lab (Stage 3.15A, fail-closed, headed, real UI).
`STATE_FIXTURE` seeds persisted UI states. `PIPELINE_FIXTURE` (AM01–AM14) seeds
only transcription/telemetry inputs and then runs the real
`autoTriggerSpeakerMappingAfterTranscription` path.

- `npm run lab:post-transcription -- S10`
- `npm run lab:post-transcription -- S10 E02`
- `npm run lab:post-transcription -- S10 --smoke`
- `npm run lab:post-transcription -- AM01 AM02 AM03 AM04 AM04B AM07A AM07B AM07C AM07D AM07E AM11 --smoke`
- `npm run lab:post-transcription -- E05`
- Headed Manual Checkpoint D pauses inside I01/I03 and after N03/N04/N05:
  `I01-A → I01-B → I03-A → I03-B (warning visible) → I03-C → N03 → N04 → N05`.
  Resume is the Playwright Inspector, not chat. I03-B must not auto-confirm
  before the operator inspects the warning. I03 uses the application
  `ConfirmDialog` (`material-change-confirm-dialog`). After Resume the Lab
  clicks Confirm on that same dialog; it does not wait for or replay a native
  `window.confirm`. A ready transcript auto-collapses `#transcription-section`.
  Checkpoint D
  expands it via `toggle-transcript-section` (`aria-expanded` / `data-state`),
  not localized Expand/Развернуть copy, then uses
  `edit-diarized-transcript-button`.
  N05 proves lock plus post-meeting visibility: participant own notes remain
  visible and read-only; other participant notes are absent from that
  participant's server projection; facilitator and authorized observer see
  all negotiation-participant preparation notes as read-only; their own notes
  stay writable. Headed N05 pauses are N05-PARTICIPANT, N05-FACILITATOR, and
  N05-OBSERVER. Visibility is lifecycle-gated and independent of AI publication.
- Headed Manual Checkpoint E starts on S03 (`S03-A` room Debrief quick panel,
  then Start AI → `S03-B` CONFIRMED). Cheap Phase E Lab:
  `S03 S10 S11 E03 I03 --smoke`. MANUAL_CHECKPOINT_E = ACCEPTED.
- Phase F cheap check: ownership/adapter units plus speaker anchors
  `AM01 AM02 AM03 AM04 AM04B AM07A AM07B AM07C AM07D AM07E AM11 --smoke`.
  `/transcribe-recording` is `OLD_ROUTE_MODE=CANONICAL_ADAPTER`, not a fallback.
  MANUAL_CHECKPOINT_F = ACCEPTED. Phase G cleanup is accepted. Phase H focused
  units plus `validate:fast` / `validate:deploy` completed; headed Lab was not
  re-run in Phase H (coverage remains Checkpoints A–G). Checkpoint H is
  ACCEPTED (`docs/handoffs/stage-3-15a-final-validation.md`). Pre-deploy local
  real-session acceptance is a separate operator gate (not Lab fixtures):
  `docs/handoffs/stage-3-15a-local-operator-acceptance.md`.

Stage 3.10 focused deterministic regression (unit + Playwright, includes the
observer smoke suite; excludes the full observer layout matrix):

- `npm run test:stage310`

Observer regression suites (see
[Observer test execution policy](./observer-test-execution-policy.md) for the
trigger matrix — the full layout suite is opt-in and must not be run for
unrelated changes):

- `npm run test:e2e:observer:smoke`
- `npm run test:e2e:observer:layout`
- `npm run test:e2e:observer:smoke:list`
- `npm run test:e2e:observer:layout:list`

Stage 3.10 focused browser smoke subset:

- `npm run test:stage310:browser`

Tunnel preflight and classified suites (opt-in only):

- `npm run test:e2e:tunnel:check`
- `npm run test:e2e:tunnel:list`
- `npm run test:e2e:tunnel`
- `npm run test:e2e:live:list`
- `npm run test:e2e:live`

## L4 / final validation gates

When to run broad gates is defined by the L1–L4 ladder in
[validation-checklist.md](./validation-checklist.md) and
[engineering-workflow.md](./engineering-workflow.md). This section is the command set for **L4** — a final code/config/test/runtime
package boundary, material high-risk boundary, or deploy readiness — not an
instruction to rerun product suites after every small edit or every docs-only
commit.

For L4 of implementation that modifies code, tests, config, or runtime
behavior, run and report all gates below:

- `npm run validate:fast`
- `npm run validate:build`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

Rules:

- Intermediate checkpoints may stop at L1–L3 when the current approved packet
  does not yet justify L4. That does not waive these gates at the later
  commit/deploy/package boundary.
- When L4 applies, all four gates are mandatory unless the task is strictly
  audit-only or docs-only.
- If a required gate cannot run, report the exact blocker; do not silently omit gates.
- Do not hide failures via retries or by skipping tests.
- `npm run test:e2e:full` remains manual/nightly unless explicitly requested.
- Tunnel/live-provider suites are opt-in and never part of default mandatory gates.
- A change is not merge-ready until applicable L4 gates pass, or the user explicitly accepts a documented exception.

### Gate execution order

- When L4 runs, run gates sequentially in this exact order:
  1. `npm run validate:fast`
  2. `npm run validate:build`
  3. `npm run test:e2e:smoke`
  4. `npm run test:e2e:smoke:browser`
- Execute `validate:fast` / `validate:build` / `validate:deploy` from the
  primary agent or operator PowerShell. Do not delegate those commands to a
  Cursor subagent. See `docs/testing/validation-checklist.md`.
- `npm run validate:deploy` remains the complete standalone deploy validation
  (`validate:fast` then `validate:build`). Do not treat it as build-only.
- Do not overlap browser smoke with other local Playwright runs because local config binds port `3100`.

## Phase 4 fixture stabilization policy

- Use run-scoped fixture namespace helpers from `tests/e2e/helpers/db.ts`:
  - `getE2eRunId()`
  - `e2eName(base)`
  - `e2eEmail(base)`
  - `e2eId(base)`
- Managed Vox E2E identity pool (exactly four slots): `FACILITATOR_01`,
  `PARTICIPANT_01`, `PARTICIPANT_02`, `OBSERVER_01`.
  - Canonical helper: `ensureManagedVoxE2EUser(slot)` in
    `tests/e2e/helpers/db.ts` (descriptors in
    `tests/e2e/helpers/managed-vox-e2e-identities.ts`).
  - Each slot has a fixed application `User.id` and a reserved email outside
    ordinary cleanup wildcards (`@e2e-reserved.test`). Recreating a missing
    row uses the same id, so production `buildVoximplantUsernameForUser`
    derives the same `ng_u_*` username after a local DB reset.
  - Use these slots only for tests that actually POST the Vox access routes
    under an intentional `VIDEO_PROVIDER=voximplant` run. Do not convert
    observer scaling or provider-independent suites.
  - Real-Vox access tests that sit in a shared serial fixture must create a
    dedicated Session/Event, `SessionParticipant`/`EventParticipant`, and
    auth cookie for the managed slot. They must not rewrite
    `SessionParticipant.userId` (or equivalent shared membership) on the
    serial fixture.
  - DB fixture tests must not insert an ACTIVE `VideoProviderIdentity` with
    `providerUsername` `ng_u_fixture_*` on a canonical managed slot. That
    short-circuits production provisioning and hides the real `ng_u_*`.
  - Concurrency: `MAX_1_LIVE_LOGIN_PER_SLOT`. Playwright `workers` stay `1`.
    Worker-scoped pools are a future explicit change if workers increase.
  - Historical remote Vox users are not automatically cleaned by ordinary
    E2E cleanup. Stage 3.24A stops new leaks. The authorized one-time
    orphan apply completed in CP2-R2; do not rerun it during validation.
    Further inventory uses the operator-gated dry-run tool
    `npm run vox:orphan-cleanup`. A later apply still requires explicit
    authorization, `--apply`, `--expected-count`, fingerprint agreement,
    and `VOX_ORPHAN_CLEANUP_ALLOW_APPLY=1`. The E2E database is not a keep
    source except for the four fixed managed IDs.
  - Production identity/provisioning source is unchanged.
- `E2E_RUN_ID` may be set externally; otherwise it is generated once per Playwright process.
- Database isolation is enforced by `tests/e2e/helpers/e2e-database.ts`:
  - `E2E_DATABASE_URL` is mandatory for Playwright tests and E2E helpers.
  - `DATABASE_URL` and `TEST_DATABASE_URL` are not accepted as E2E fallbacks.
  - E2E and development targets must differ by host/port/database tuple.
  - Production-like host/database names are refused.
  - Remote E2E databases require explicit `E2E_ALLOW_REMOTE_DATABASE=1`.
- Playwright-managed `webServer` processes override `DATABASE_URL` to the resolved `E2E_DATABASE_URL`.
- Ordinary managed Playwright validation (`playwright.local.config.ts`,
  including `test:e2e:smoke`, `test:e2e:smoke:browser`, and `test:stage310`
  browser legs) pins `VIDEO_PROVIDER=livekit` through
  `resolveManagedPlaywrightVideoProvider()`. Operator `.env`
  `VIDEO_PROVIDER=voximplant` is not inherited. Intentional real-Vox runs
  set `PLAYWRIGHT_VIDEO_PROVIDER=voximplant`. `playwright.config.ts`
  already pins LiveKit.
- Manual `npm run dev` outside Playwright continues to use development `DATABASE_URL` on port `5432`.
- Run read-only E2E database preflight before browser suites:
  - `npm run test:e2e:db:check`
- Local Docker E2E database service:
  - service: `postgres_e2e`
  - container: `negotiations_postgres_e2e`
  - exposed port: `5433`
  - database: `negotiations_e2e`
- Stage 3.10 browser/API suites require local DB schema aligned with additive migration:
  - run `npx --no-install prisma migrate status`
  - run `npx --no-install prisma migrate deploy` (non-production only)
  - rerun `npm run prisma:generate` and `npm run prisma:validate`
- Cleanup ownership rule:
  - `cleanupE2eData()` must remove only current run namespace data plus rows owned by current run users.
  - Managed Vox slot Users, reserved emails, and `VideoProviderIdentity`
    rows are preserved. Per-test Session/Event memberships, rooms,
    invites, and run-owned domain rows for those users are still removed.
  - New tests must avoid broad wildcard cleanup (`LIKE '%E2E%'`) against shared data.
- Residual legacy suites may still use older cleanup patterns; migrate incrementally and document remaining debt in phase reports.

## Validation Gate Model

`validate:fast` is the existing L3 checkpoint gate (not universally exhaustive;
see the coverage note in [validation-checklist.md](./validation-checklist.md)).
It includes:

- Native-dialog guard (`check:native-dialogs`)
- Lint
- Prisma validate
- Prisma generate
- Unit tests (`test:unit`, including deterministic tests under `lib/**`,
  `app/**`, `components/**`, and `scripts/__tests__/**`)
- Playwright test listing (`test:e2e:list`)

Properties:

- No browser execution
- No reverse tunnel requirement
- No intentional DB mutation by Playwright

`validate:build` includes:

- Production build only

`validate:deploy` includes:

- `validate:fast`
- `validate:build`

Use `validate:deploy` when invoking deploy validation as a single standalone
command. The L4 sequence uses `validate:fast` then `validate:build` so the fast
gate is not executed twice.

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
- Setting external `PLAYWRIGHT_BASE_URL` or `BASE_URL` suppresses Playwright `webServer` startup.
- `APP_URL` configures the application runtime and must not by itself route deterministic E2E traffic through the reverse tunnel or normal development app.
- Managed deterministic local config explicitly pins base URL to `http://127.0.0.1:3100` and does not route tests via shell-provided `APP_URL`, `BASE_URL`, `NEXT_PUBLIC_APP_URL`, or `PLAYWRIGHT_BASE_URL`.
- Managed local runs require port `3100` to be free. A normal development server on port `3000` is a separate runtime and is not an E2E target.
- Managed local runs set `NEXT_DIST_DIR=.next-e2e`, keeping the E2E Next dev server's lock/build output separate from the normal development server's `.next` directory.

## Key E2E Coverage Areas

- Event multi-session lifecycle and assignment behavior.
- Session lifecycle control state and room navigation.
- Recording/transcription/materials flow with role-gated access.
- Speaker mapping and debrief-sharing behaviors.
- Security/access behavior for account-mode restrictions and protected APIs.

## Canonical References

- `tests/e2e/**`
- `docs/testing/engineering-workflow.md`
- `docs/testing/observer-test-execution-policy.md`
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
