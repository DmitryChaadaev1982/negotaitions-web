# Stage Tests / Playwright / Architecture Coverage Audit

## 1. Executive summary

- Overall maturity is **medium**: strong API/domain coverage inside Playwright, decent unit coverage for core transcription/audio/role logic, but weak separation between pure API/integration tests and browser journeys.
- The "Playwright reinstalls every run" symptom is **likely real in current Cursor terminal context** and not caused by project scripts:
  - `PLAYWRIGHT_BROWSERS_PATH` is forced to an ephemeral Cursor sandbox path.
  - That path currently does not exist (`Test-Path $env:PLAYWRIGHT_BROWSERS_PATH` -> `False`).
  - `npx playwright install --dry-run chromium` resolves install target to that ephemeral path, not `%LOCALAPPDATA%\ms-playwright`.
- Current root cause is most likely **environment-level cache override**, not `package.json` scripts.
- Risk level: **Medium-High** for e2e reliability and operator confusion, **Medium** for architecture regression risk.
- Recommended direction: keep default validation fast and local-safe; explicitly split Playwright install, smoke, full, and tunnel-required flows.

## 2. Current package scripts

| script | command | purpose | installs browsers/dependencies | starts server | mutates DB | safe for routine use | comments |
|---|---|---|---|---|---|---|---|
| `dev` | `next dev` | local development | No | Yes (dev) | No direct | Yes | Used by manual/browser-required tests |
| `build` | `next build` | production build check | No | No | No | Yes | part of validation |
| `start` | `next start` | run built app | No | Yes | No direct | Yes | runtime check |
| `lint` | `eslint` | static lint | No | No | No | Yes | safe gate |
| `db:seed` | `prisma db seed` | seed DB | No | No | **Yes** | No (routine) | mutates DB by design |
| `test:unit` | `node --import tsx --test "lib/**/*.test.ts"` | unit tests in `lib/**` | No | No | No direct | Yes | stable fast gate candidate |
| `test:e2e` | `playwright test` | full e2e suite | No implicit install script | May start Playwright `webServer` | **Yes** (fixtures) | No (routine default) | broad suite, env-sensitive |
| `test:e2e:ui` | `playwright test --ui` | interactive e2e UI | No implicit install script | May start `webServer` | **Yes** (fixtures) | No | local debugging only |
| `test:e2e:headed` | `playwright test --headed` | headed e2e run | No implicit install script | May start `webServer` | **Yes** (fixtures) | No | local debugging only |
| `test:all` | `npm run lint && npm run build && npx prisma validate && npm run test:e2e` | broad validation | No explicit browser install | via `test:e2e` | **Yes** via e2e | No | misleading for deploy gate if e2e unstable |
| `smoke:vox-recording` | `tsx scripts/smoke-voximplant-recording.ts` | provider smoke helper | No | No direct | likely Yes | No (routine) | provider/env dependent |
| `vox:scenario:*` | `node scripts/voximplant-*.mjs` | Vox scenario sync/upload/check | No | No | external side effects | No | ops tooling, not routine gate |
| `inspect:audio` | `tsx scripts/inspect-audio-recording.ts` | recording file diagnostics | No | No | No | Yes | safe diagnostics |
| `pause-filter:calibrate` | `tsx scripts/pause-filter-calibrate-session.ts` | calibration tooling | No | No | No direct | Conditional | local debug workflow |

### Script audit answers (A)

1. Scripts exist as listed above; only one unit script and one broad e2e script family.
2. Safe routine: `lint`, `build`, `test:unit`, `npx prisma validate`, `npx prisma generate`, `npx playwright test --list`.
3. No project script directly runs `playwright install`; browser install happens when Playwright binary cache is missing.
4. Server-start scripts: `dev`, `start`; Playwright also auto-starts `npx next dev -p <port>` when no external base URL.
5. DB/data mutation scripts: `db:seed`, most e2e specs via `tests/e2e/helpers/db.ts` and direct SQL inserts/deletes.
6. CI-oriented vs local-only: no tracked CI workflow files in repo; current scripts are local/general-purpose.
7. Misleading names:
   - `test:all` implies canonical gate but includes full e2e (currently not deploy-stable).
   - `test:e2e` mixes DB/API-heavy checks and browser/manual-skipped artifacts.
8. Single recommended validation command today: **`validate:fast` (proposed in section 10)**, not current `test:all`.
9. Playwright install is **not** accidentally baked into current npm scripts.
10. `npx` downloads when local binary missing in current directory/context (confirmed in non-repo cwd earlier), and browsers download when cache path is empty.

## 3. Playwright dependency and browser installation model

### Package versions and resolution

- `@playwright/test` is in `devDependencies` (`^1.61.0`), lock resolved to `1.61.0`.
- No separate direct top-level `playwright` dependency in `package.json`; `playwright` CLI comes via `@playwright/test`.
- In repo root:
  - `npm ls @playwright/test playwright` resolves cleanly to `@playwright/test@1.61.0` and `playwright@1.61.0`.
  - `npx playwright --version` returns `1.61.0` without downloading.
- Outside repo root (wrong cwd), `npx playwright --version` installed transient `playwright@1.61.1` (expected npx behavior when local package not found).

### Cache behavior and install triggers

- Expected stable browser cache defaults:
  - Windows: `%LOCALAPPDATA%\ms-playwright`
  - Linux: `~/.cache/ms-playwright`
- In this environment:
  - `%LOCALAPPDATA%\ms-playwright` exists and contains browser binaries.
  - But `PLAYWRIGHT_BROWSERS_PATH` is set to:
    `C:\Users\dvcha\AppData\Local\Temp\cursor-sandbox-cache\...\playwright`
  - That path currently does not exist.
  - Dry run shows Playwright will install into that ephemeral path.

### Install verdict (normal vs abnormal)

- **Normal:** first install on a new machine or empty cache path.
- **Abnormal for day-to-day local runs:** repeated download caused by per-session ephemeral `PLAYWRIGHT_BROWSERS_PATH`.
- This is environment/tooling behavior, not a repo script bug.

### Local diagnostic commands for user shell

Run in your own PowerShell (outside isolated agent context) to verify runtime reality:

```powershell
Get-ChildItem Env:PLAYWRIGHT* -ErrorAction SilentlyContinue
Test-Path "$env:LOCALAPPDATA\ms-playwright"
Get-ChildItem "$env:LOCALAPPDATA\ms-playwright" -ErrorAction SilentlyContinue
Test-Path "$env:PLAYWRIGHT_BROWSERS_PATH"
npx playwright install --dry-run chromium
```

## 4. Playwright config and runtime model

- Config files:
  - `playwright.config.ts` only (no multi-config split).
  - No `globalSetup` / `globalTeardown`.
- Base URL resolution:
  - `PLAYWRIGHT_BASE_URL` -> `BASE_URL` -> `APP_URL` -> fallback `http://127.0.0.1:<PLAYWRIGHT_PORT|3100>`.
- `webServer` behavior:
  - Enabled only when no external base URL.
  - Command: `npx next dev -p <port>`.
  - `reuseExistingServer: !process.env.CI`.
  - Injects mock/test-safe env (`EXTERNAL_SERVICES_MODE=mock`, `RECORDING_MODE=mock`, `TRANSCRIPTION_MODE=mock`, `AUTO_TRANSCRIBE_AFTER_RECORDING=false`).
- Projects:
  - Only one project: `chromium`.
  - No Firefox/WebKit/mobile projects.
- Timeouts/retries:
  - test timeout 60s, expect timeout 10s.
  - workers=1, serial tendency.
  - retries not explicitly configured (Playwright default applies).
- Artifacts:
  - `trace: on-first-retry`, `video: retain-on-failure`, reporter includes list + html.
- Isolation/data model:
  - Most e2e files call `cleanupE2eData()` in `beforeAll/afterAll`.
  - Many tests use direct SQL inserts/deletes via `tests/e2e/helpers/db.ts`.
  - Suite mutates DB heavily; safety depends on dedicated test DB.
- Important inconsistency:
  - Some file comments claim Playwright webServer is not auto-started; current config does auto-start unless external base URL is set.

## 5. Reverse tunnel dependency model

### Current state

- No Playwright test tagging/project model for tunnel dependency (`@requires-tunnel` not present).
- `local.negotaitions.ru` is referenced in docs and debug scripts, not in core Playwright config.
- Tunnel need today is mostly for **real provider callback/public-domain flows**, not default mock-mode e2e.
- `next.config.ts` explicitly allows `local.negotaitions.ru` in dev origins.

### Which tests likely need tunnel?

- Default mock-mode API/browser tests: generally **localhost-capable**.
- Tunnel likely needed for:
  - real webhook callback flows,
  - live Vox/Yandex provider smoke flows,
  - scripts/debug runs targeting `https://local.negotaitions.ru`.
- Current e2e suite mostly tests mocked/stubbed pathways; tunnel dependency is implicit and undocumented per test.

### Policy assessment

The proposed policy is sound:
- Normal tests should not require tunnel.
- Tunnel-required tests should be explicit (`@requires-tunnel`).
- Separate project/command for tunnel tests is recommended.
- Auto-start tunnel should be opt-in (`E2E_AUTO_START_TUNNEL=1`), with timeout and clear failure.
- Never auto-kill remote stale ports unless explicit opt-in (`E2E_ALLOW_TUNNEL_KILL=1`).

### Recommendation

- Default: fail fast with actionable message if tunnel-required test runs without tunnel.
- Keep manual command as primary baseline; optional automation only behind env flags.

## 6. Test inventory

### Counts

- Tracked test files total (`*test.ts|tsx`, `*spec.ts|tsx`): **83**
- Playwright e2e files: **39**
- Unit/component files outside `tests/e2e`: **44**
- Playwright listed tests: **577 tests in 39 files**

### Playwright focus map

- Session/event/lobby/materials/recording/transcription/speaker-mapping: strongly represented.
- Auth/account/legal/i18n/admin: represented across multiple phase specs.
- Legacy/manual-heavy:
  - `phase-6-11b-session-role-assignment.spec.ts` has many `test.skip(true)` placeholders/documentation tests.
  - Several files conditionally skip when env/service unavailable.
- Skipped/manual indicators:
  - `test.skip(true)` for manual paths.
  - `RUN_LIVE_SMOKE_TESTS` gating in i18n spec.
  - LiveKit-dependent test skips when service not configured.

### State mutation and dependencies

- DB required/mutating: most e2e files (`helpers/db.ts` plus inline SQL).
- Dev server required: subset with browser navigation and explicit `BASE_URL` expectations.
- Tunnel required: not explicitly tagged; mainly implied by live-provider/public-callback workflows, docs, and debug scripts.
- External providers:
  - mostly mocked in default Playwright webServer env;
  - real-provider smoke flows appear as manual/debug/opt-in.

### Smoke candidates (current likely stable)

- `admin-diagnostics-env.spec.ts`
- `event-flow.spec.ts` core API/account-flow checks
- `event-completion.spec.ts`
- `session-navigation.spec.ts`
- selected `phase-6-legal-consent.spec.ts` static/API checks

### Unstable/legacy candidates

- `phase-6-11b-session-role-assignment.spec.ts` (many skip/documentation tests)
- files with mixed DB/API/browser/manual sections and environment-dependent comments
- full suite as a deploy gate remains high-risk without curation

## 7. Architecture coverage matrix

| architecture domain | current coverage level | existing tests | missing critical tests | recommended type | priority |
|---|---|---|---|---|---|
| Authentication and account-first join | Good | `event-flow`, `phase-4-account-navigation`, `phase-4-2-overview-guard`, `phase-6-4-*` | dedicated login/register error matrix under API-only harness | API route + integration | P1 |
| Cases | Partial | `phase-6-6-case-access`, `event-case-library` | delete/archive/cancel semantics and ownership edge transitions | unit + API | P1 |
| Standalone sessions | Good | `phase-6-10-*`, `session-lifecycle`, `phase-6-12-*` | stronger deterministic browser smoke subset | Playwright smoke + API | P1 |
| Events/lobby | Good | `event-flow`, `event-multi-session`, `voximplant-event-lobby` | tunnel/live callback contract tests split from defaults | manual + tagged Playwright | P1 |
| Role assignment (participant/facilitator/observer/slot exclusivity) | Good | `phase-6-11b`, `phase-6-12`, `event-flow` | convert skip-only checks to runnable deterministic specs | API + integration | P0 |
| Room lifecycle (prep/running/pause/finish/debrief) | Partial | `session-lifecycle`, `event-completion`, `session-materials-processing` | explicit pause/resume edge tests under account-first flow | API + Playwright | P1 |
| Event-linked sessions | Good | `event-flow`, `phase-6-12`, `current-product-workflow` | fewer manual assumptions, stronger fixture isolation | API + Playwright smoke | P1 |
| Rejoin flows | Partial | `session-navigation`, `phase-4-*`, `event-completion` | account-first vs guest compatibility matrix in one deterministic suite | API route | P1 |
| Voximplant access/token/session setup | Partial | `voximplant-room-*`, `voximplant-event-lobby`, `session-lifecycle` | explicit live-provider contract tests tagged/manual | tagged Playwright + manual | P1 |
| Recording start/stop | Partial | `session-materials-processing`, `event-completion`, `voximplant-recording-debug` | provider-failure contract matrix, retry semantics | API + integration | P1 |
| Pause intervals | Partial | unit tests in `lib/transcription/*pause*`, docs workflows | end-to-end pause interval propagation assertions in e2e | integration + API | P1 |
| `source_audio_cut` | Partial | unit coverage exists; docs runbooks | stable integration tests around artifacts/metadata | integration | P1 |
| Transcription | Good | `session-materials-processing`, `two-pass-transcription`, `diarization-speaker-mapping` | tunnel/live provider separation and tagging | API + tagged Playwright | P1 |
| Transcript segments | Good | `two-pass-transcription`, `diarization-speaker-mapping` | malformed segment and partial-provider payload edge cases | unit + integration | P2 |
| Speaker mapping | Good | `diarization-speaker-mapping`, `session-materials-processing`, many unit tests | deterministic perf/scale tests for large segments | unit + integration | P2 |
| AI analysis/debrief | Partial | `debrief-ai-sharing`, `session-materials-processing`, `phase-6-9` | explicit provider timeout/quota fallback matrix | API + integration | P1 |
| Materials page | Good | `session-materials-processing`, `debrief-ai-sharing`, `session-navigation` | stricter browser smoke assertions for role-gated UI | Playwright smoke | P2 |
| Visibility/public/private/invites | Good | `phase-6-4-visibility-access`, `phase-6-11a`, `phase-6-8` | archive/delete visibility transitions | API + integration | P1 |
| Delete/cancel/archive semantics | Weak | partial cancel/complete in `event-completion` | explicit archive/delete lifecycle tests for cases/events/sessions | API + integration | P0 |
| i18n and locale | Partial | `ui-i18n-layout`, `phase-6-2-1-locale-persistence`, unit dict tests | deeper locale persistence across rejoin/session pages | Playwright + unit | P2 |
| Legal/auth pages | Good | `phase-6-legal-consent`, `ui-i18n-layout` | negative-path consent analytics toggles and cookie persistence matrix | Playwright + API | P2 |
| Admin/host permissions | Good | `admin-user-management`, `phase-1-1-security`, `phase-6-8` | narrower API-only permission matrix to reduce e2e load | API route | P1 |
| API transition guards | Good | `phase-1-1-security`, `phase-6-12`, `phase-6-9` | explicit finite-state transition table tests | unit + API | P1 |
| Error handling and edge cases | Partial | many scattered checks, mock failure checks | centralized deterministic failure matrix for providers/DB contention | integration | P1 |

## 8. Best practice assessment

### 8.1 Test pyramid

- Current shape is e2e-heavy for API/domain rules.
- Positive: 44 non-e2e tests exist, especially for transcription/audio logic.
- Gap: many permission/visibility/business-rule checks still live in Playwright instead of API/integration harnesses.

### 8.2 Determinism

- Good use of generated IDs and cleanup helpers.
- Risks:
  - broad shared cleanup patterns (`LIKE '%E2E%'`) can collide if DB is shared.
  - many serial tests and stateful flows reduce parallel reliability.
  - skip-heavy files hide unvalidated behavior.

### 8.3 Environment isolation

- Mock external modes are configured in Playwright webServer env (good default).
- Environment assumptions are mixed: some tests expect manual dev server and/or `BASE_URL`.
- Tunnel/live-provider separation is not explicit in tagging/projects.

### 8.4 Speed

- Good fast gates already used manually (`lint`, `build`, `prisma validate`, `test:unit`, `--list`).
- Full `test:e2e` is too broad for routine/deploy.

### 8.5 Maintainability

- Strengths: broad domain naming by stage/topic.
- Weaknesses: mixed modes in single files (DB/API/browser/manual placeholders), inconsistent comments, missing explicit tagging taxonomy.

### 8.6 Reliability diagnostics

- Reasonable traces/video defaults.
- No explicit retries policy tuning by category.
- Failure diagnostics exist but not partitioned by smoke/full/tunnel classes.

### 8.7 Security/data safety

- Strong emphasis on token leakage/privacy checks.
- But e2e mutates DB heavily; requires strict test DB isolation policy.

### 8.8 CI readiness

- No repo CI workflow definitions found.
- Current suite is not ready as universal CI gate without tiering.
- Local-only/tunnel/provider-sensitive flows need explicit segregation.

### Best-practice score

- Score: **6.5/10**
- Residual risk: **Medium-High** until script taxonomy + suite tiering + tunnel tagging are implemented.

## 9. Problems found

1. **Browser cache path override causes repeated installs**
   - `PLAYWRIGHT_BROWSERS_PATH` points to ephemeral Cursor sandbox path.
2. **Script taxonomy is too coarse**
   - no install/list/smoke/full split for e2e.
3. **`test:all` semantics are risky**
   - implies reliable gate but includes full unstable e2e.
4. **No explicit tunnel classification**
   - tests needing public callback/domain are not tagged/project-scoped.
5. **Mixed test modes in same files**
   - DB/API/browser/manual placeholders increase maintenance burden.
6. **Coverage gaps in destructive lifecycle semantics**
   - delete/cancel/archive behavior lacks dedicated robust coverage.

## 10. Recommended target test commands

Proposed script model (do not implement in this audit phase):

```json
{
  "test:unit": "node --import tsx --test \"lib/**/*.test.ts\"",
  "test:e2e:list": "playwright test --list",
  "test:e2e:install": "playwright install chromium",
  "test:e2e:smoke": "playwright test --project=chromium --grep @smoke --grep-invert @requires-tunnel",
  "test:e2e:tunnel:check": "node scripts/e2e/check-reverse-tunnel.mjs",
  "test:e2e:tunnel": "npm run test:e2e:tunnel:check && playwright test --project=chromium --grep @requires-tunnel",
  "test:e2e:full": "playwright test --project=chromium",
  "validate:fast": "npm run lint && npm run build && npx prisma validate && npx prisma generate && npm run test:unit && npm run test:e2e:list",
  "validate:deploy": "npm run validate:fast",
  "validate:e2e:smoke": "npm run validate:fast && npm run test:e2e:smoke"
}
```

Notes:
- Keep browser install separate from test run.
- Keep smoke set explicit and curated.
- Keep tunnel tests opt-in and isolated.

## 11. Recommended validation gates

- Fast local gate:
  - `npm run validate:fast`
- Commit gate:
  - `npm run lint && npm run test:unit`
- Deploy gate (current safest):
  - `npm run validate:deploy`
- Smoke e2e gate (optional near-term):
  - `npm run validate:e2e:smoke`
- Full regression gate:
  - `npm run test:e2e:full` (manual/nightly, not blocking deploy yet)
- Tunnel-required gate:
  - `npm run test:e2e:tunnel` (manual or dedicated environment)

## 12. Recommended implementation phases

### Phase 1 — scripts/docs cleanup (no-risk)

- Add explicit scripts: e2e list/install/smoke/full/tunnel check placeholders.
- Clarify docs on Playwright browser cache behavior and environment overrides.
- Document that repeated install can come from `PLAYWRIGHT_BROWSERS_PATH`.
- No dependency updates, no behavior rewrites.

### Phase 2 — smoke suite definition

- Tag stable critical tests as `@smoke`.
- Build minimal deterministic Chromium smoke command.
- Keep full suite separate.

### Phase 3 — reverse tunnel preflight

- Add `scripts/e2e/check-reverse-tunnel.mjs`.
- Add `@requires-tunnel` tag/project split.
- Optional tunnel auto-start only behind env flag.

### Phase 4 — fixture stabilization

- Harden DB cleanup/data factories.
- Reduce skip/documentation-only tests by converting critical cases into runnable deterministic tests.
- Tighten auth/session helper reuse.

### Phase 5 — architecture coverage expansion

- Add targeted unit/API tests for transition guards, delete/cancel/archive semantics, and edge matrices.
- Keep provider interactions mocked by default; isolate real-provider suites.

## 13. Phase 1 implementation prompt

Use this prompt in Cursor for Phase 1 only:

```text
Use GPT-5.3 Codex.

Task: Phase 1 test-infra cleanup only (safe changes).

Scope:
- Update package scripts and docs only.
- No dependency updates.
- No package-lock changes.
- No test logic rewrites.
- No Prisma schema/migration changes.
- No full Playwright refactor.

Goals:
1) Add clear scripts:
   - test:e2e:list
   - test:e2e:install
   - test:e2e:smoke (placeholder grep model)
   - test:e2e:tunnel:check (placeholder command if script file not yet implemented)
   - test:e2e:tunnel
   - test:e2e:full
   - validate:fast
   - validate:deploy
   - validate:e2e:smoke
2) Ensure existing test:unit remains unchanged.
3) Keep current test:e2e behavior accessible (alias or equivalent).
4) Add/refresh docs under docs/testing:
   - Explain Playwright browser cache locations.
   - Explain how PLAYWRIGHT_BROWSERS_PATH can cause repeated downloads.
   - Document recommended local validation flow and tunnel policy.
   - Document that tunnel-required tests are not in default fast gate.

Validation:
- npm pkg get scripts
- npx playwright --version
- npx playwright test --list

Output:
- Summary of script changes and docs changes.
- No commits.
```

## 14. Open decisions

1. Should tunnel-required tests support optional auto-start SSH (`E2E_AUTO_START_TUNNEL=1`) or stay manual-only?
2. What exact smoke set should be deploy-adjacent (which 10-20 tests/files)?
3. Should full Playwright ever become blocking CI gate, or remain nightly/manual?
4. Which provider-integrated tests remain manual vs automated with mocks/fakes?
5. Should DB-mutating Playwright specs be split into `integration` (API-only) and `browser` directories to enforce pyramid discipline?

