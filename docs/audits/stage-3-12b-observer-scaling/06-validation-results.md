# Validation Results

Base SHA: `a7d721878b58b5f83f931c9323d55fffcc904f3b`

Environment verification:
- Source `.env` existed: yes.
- Working tree preflight status: clean.
- Target `.env` existed: yes.
- Prisma client generation was refreshed before managed Playwright validation.

Automated validation:
- `tests/e2e/voximplant-layout-camera-model.spec.ts`: PASS, 25 passed.
- `tests/e2e/stage-3-12b-observer-scaling.spec.ts`: PASS, 5 passed.
- `npm run validate:fast`: PASS.
- `npm run validate:deploy`: PASS.
- `npm run test:e2e:smoke`: PASS, 12 passed.
- `npm run test:e2e:smoke:browser`: PASS, 5 passed.
- `npm run test:stage310`: PASS, 102 unit checks and 30 browser checks passed.

Layout results:
- Observer rail height: corrected from `9.25rem` (148 CSS px) to responsive `10rem` / `11.25rem` / `11.75rem`; desktop measured height is 188 CSS px.
- Participant-stage 1440x900 count tolerance: PASS, width delta 0 CSS px and height delta 0.875 CSS px across counts 0, 1, 2, 4, 5, 8, 12, 30, 50, 100.
- Zero-to-one observer rail height shift: PASS, 0 CSS px.
- Centered while fitting: PASS at 1, 2, and 4 observers; 4 observers measured `railScrollWidth=894`, `railClientWidth=894`, no arrows.
- Fit-to-overflow transition: PASS at 5 observers; measured `railScrollWidth=1072`, `railClientWidth=894`, `scrollLeft=0`, first observer visible, right arrow visible, left arrow absent.
- Manual scroll states: PASS at 30 observers; start `scrollLeft=0`, middle `scrollLeft=606` with both arrows, end `scrollLeft=5578` with left arrow only.
- Vertical clipping: PASS at 1440x900, 1366x768, 1280x720, 1024x768, 768x1024, and 390x844; tile and control bottoms stay at least 4 CSS px above rail inner bottom.
- Page horizontal overflow: PASS, max page scroll width delta 0 CSS px.
- Rail no-wrap: PASS, all measured observer tile tops stayed on one row.
- Stable ordering: PASS; camera, microphone, connection, and speaking state do not reorder observers.

Manual regression:
- Participant role check: covered by focused browser fixture and Stage 3.10 browser regression.
- Observer role check: covered by focused browser fixture and observer explicit-leave Stage 3.10 regression.
- Facilitator role check: covered by focused browser fixture and Stage 3.10 browser regression.
- `OPEN`: covered by focused browser fixture and Stage 3.10 browser regression.
- `DEBRIEF_OPEN`: covered by focused browser fixture and Stage 3.10 browser regression.
- `CLOSED` / materials redirect: covered by `decideSessionRoomAccess` and Stage 3.10 regression.

Notes:
- An initial live-mode browser attempt redirected to login because the already-running development server used the non-E2E database. The live server was stopped and all final browser validation was rerun with the requested managed E2E environment.

## Stage 3.12B Observer Suite Split (test/docs only)

Date: 2026-08-03

Runtime SHA whose heavy gates remain authoritative: `ad7f60a`. No runtime
production file was changed by this task, so those gates were not rerun.

Policy and trigger matrix: `docs/testing/observer-test-execution-policy.md`.

Suite split:
- `@observer-smoke`: 7 tests, counts 0-5 and 12 plus one 390x844 sample.
- `@observer-layout`: 24 tests, counts 0, 1, 4, 5, 8, 12, 30, 50, 100 at
  1440x900 plus 1366x768, 1280x720, 1024x768, 768x1024 and 390x844 samples.
- The previous monolithic `observer rail remains bounded across required
  viewport samples` test opened 13 rooms in one test and exceeded the 60 s
  timeout. It is replaced by one Playwright test per viewport/count sample.

Automated validation:
- `npm run test:e2e:observer:smoke`: PASS, 7 passed, 53.0 s reported / 58 s wall.
- `npm run test:e2e:observer:layout`: PASS, 24 passed, 2.1 min reported / 134 s
  wall; slowest individual test 9 s, no timeout.
- `npm run test:stage310`: PASS, 102 unit checks and 37 browser checks, 70.7 s
  wall; observer smoke included, `--grep-invert @observer-layout` keeps the full
  matrix out.
- `npm run validate:fast`: PASS, 58.5 s, 669 tests discovered in 45 files.
- `npm run validate:deploy`: intentionally not run. Only test files, test
  scripts, `.gitignore` and documentation changed; no production TypeScript
  import, build configuration or Playwright config was touched, and
  `validate:fast` already covers lint, Prisma validate/generate, unit tests and
  Playwright discovery.

Provider dependency:
- Unchanged by this task. Layout scenarios still call
  `POST /api/sessions/:id/voximplant/access` and attempt a WebSDK connection;
  `?media=off` skips only camera/microphone capture.
- During the layout run the gateway transport failed
  (`TransportInternalError ... code 500`) and all geometry assertions still
  passed, confirming that tile geometry derives from the server roster.
- Provider-neutral rendering would require a guarded runtime seam in
  `app/room/[sessionId]/page.tsx`, which is out of scope here. Routine
  provider-touching room opens dropped from 31 to 7 instead.

Note:
- One `test:stage310` attempt failed with `Unable to initialize Voximplant
  (404)`. The cause was editing files while the managed Next.js dev server was
  running: the recompile made API routes transiently return the Next.js HTML
  404. Rerunning without concurrent edits passed. This rule is now recorded in
  `AGENTS.md`.

## Stage 3.12B-O Stale Observer Tile Correction

Date: 2026-07-30

Base SHA: `e3c132436c619c578b3b51a07d0a0d681af9c5c0`

Focused validation:
- Exact helper scenario: PASS via `npx playwright test --config=playwright.local.config.ts tests/e2e/voximplant-layout-camera-model.spec.ts --project=chromium -g "observer rail membership follows logical room presence"`; 1 passed.
- Full layout-camera-model direct live run produced 26 passing test lines before the shell was interrupted.
- Required managed `tests/e2e/stage-3-12b-observer-scaling.spec.ts`: BLOCKED by `MANAGED_SERVER_PORT_CONFLICT` because port 3000 was already occupied by the existing `npm run dev`.
- Required managed `tests/e2e/voximplant-layout-camera-model.spec.ts`: BLOCKED by the same port conflict.

Validation gates:
- `npm run validate:fast`: PASS when run with `PLAYWRIGHT_BASE_URL=http://localhost:3000` to avoid starting a second dev server for the Playwright list step. Existing lint warnings only.
- `npm run validate:deploy`: PASS with the same external Playwright base URL; includes successful production build.
- `npm run test:e2e:smoke`: BLOCKED by `MANAGED_SERVER_PORT_CONFLICT`.
- `npm run test:e2e:smoke:browser`: BLOCKED by `MANAGED_SERVER_PORT_CONFLICT`.
- `npm run test:stage310`: 102 unit checks PASS; managed browser portion BLOCKED by `MANAGED_SERVER_PORT_CONFLICT`.

Manual regression:
- Not rerun by the agent because the existing local dev server is already in use and the live server/database did not match the E2E fixtures.
- Actual lease-expiry delay observed manually by the agent: not measured.
- The corrected provider-bound rail membership no longer waits for the two-minute lease when the provider/media participant is gone.
