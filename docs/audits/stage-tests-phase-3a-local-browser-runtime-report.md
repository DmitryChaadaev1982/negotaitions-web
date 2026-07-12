# Stage Tests Phase 3A — Deterministic Local Browser Runtime

## 1. Executive summary

- Root cause confirmed: shell-provided URL env values (`PLAYWRIGHT_BASE_URL`, `BASE_URL`, `APP_URL`) were taking precedence in default config and could route tests to external domains.
- Selected design: dedicated deterministic local Playwright config (`playwright.local.config.ts`) with pinned localhost base URL and always-on local `webServer`.
- Browser smoke scope: 5 browser-first tests across 3 files, tagged `@browser-smoke`.
- Stability result: 5/5 consecutive green browser-smoke runs, no retries, no skips.
- Readiness verdict: **Conditionally ready** for deterministic local browser smoke; broader tunnel/provider classification is deferred to Phase 3B.

## 2. Previous runtime problem

- URL precedence in default config:
  1. `PLAYWRIGHT_BASE_URL`
  2. `BASE_URL`
  3. `APP_URL`
  4. fallback `http://127.0.0.1:${PLAYWRIGHT_PORT|3100}`
- Shell env leakage:
  - Default config consumed shell URL env values directly.
  - Browser helpers in some specs also consumed shell URL env values directly.
- `webServer` suppression condition:
  - In `playwright.config.ts`, any non-empty external base URL env value disabled Playwright `webServer`.
- Effect:
  - Requests/navigation could target external local domains (for example `https://local.negotaitions.ru`) instead of localhost.
  - Runtime became dependent on certificate/reverse-tunnel state instead of deterministic local server startup.

## 3. Selected runtime design

- Added `playwright.local.config.ts` as explicit deterministic local mode.
- Local base URL is pinned to `http://127.0.0.1:3100`.
- Local `webServer` is always enabled in this config (`npx next dev -p 3100`), with `reuseExistingServer: !process.env.CI`.
- Local `webServer` test env pins safe mock defaults:
  - `EXTERNAL_SERVICES_MODE=mock`
  - `RECORDING_MODE=mock`
  - `TRANSCRIPTION_MODE=mock`
  - `AUTO_TRANSCRIBE_AFTER_RECORDING=false`
- Local config also pins URL env values passed to `webServer` to localhost (`APP_URL`, `BASE_URL`, `PLAYWRIGHT_BASE_URL`, `NEXT_PUBLIC_APP_URL`) so shell-provided external URL values do not route local browser tests externally.
- Why this design:
  - Cross-platform and shell-agnostic (no platform-specific inline env syntax).
  - Does not mutate user system env.
  - Keeps existing default/external workflows in `playwright.config.ts` untouched.
  - Creates explicit deterministic local command surface.

## 4. Files changed

- Config:
  - `playwright.local.config.ts` (new)
- Scripts:
  - `package.json`
- Tests:
  - `tests/e2e/event-flow.spec.ts`
  - `tests/e2e/event-completion.spec.ts`
  - `tests/e2e/phase-6-legal-consent.spec.ts`
  - `tests/e2e/session-navigation.spec.ts` (candidate tag removal after deterministic audit)
- Docs:
  - `docs/testing/e2e-strategy.md`
  - `docs/testing/validation-checklist.md`
  - `docs/audits/stage-tests-phase-3a-local-browser-runtime-report.md` (this report)

## 5. Browser smoke candidate assessment

| file | title | browser capability | deterministic verdict | selected | reason |
|---|---|---|---|---|---|
| `tests/e2e/event-completion.spec.ts` | complete event from lobby closes event and disables session creation | event lobby completion transition | deterministic | yes | stable browser + API assertion under local config |
| `tests/e2e/event-completion.spec.ts` | rejoin after event completed shows completed message | finished event rejoin UX | non-deterministic | no | intermittently missing expected message in local run |
| `tests/e2e/event-flow.spec.ts` | account-first join redirects unauth users and prevents duplicate event participants | protected route/account-first redirect | deterministic | yes | stable redirect + participant idempotency assertion |
| `tests/e2e/event-flow.spec.ts` | event lobby host can finish active session from sessions board | host-driven finish transition from lobby | deterministic | yes | stable finish transition with DB state assertion |
| `tests/e2e/session-navigation.spec.ts` | assigned lobby navigation targets video room directly | event-linked room navigation | non-deterministic | no | account-first redirect to login under local deterministic mode |
| `tests/e2e/phase-6-legal-consent.spec.ts` | 23. Login page loads | baseline page availability | deterministic | yes | stable fast browser availability check |
| `tests/e2e/phase-6-legal-consent.spec.ts` | 24. /join/invalid-token returns 404 or not-found page | invalid join route safety behavior | deterministic | yes | stable browser route-level assertion |

## 6. Final browser smoke inventory

| file | exact title | user journey | setup/cleanup | expected runtime |
|---|---|---|---|---|
| `tests/e2e/event-completion.spec.ts` | complete event from lobby closes event and disables session creation @browser-smoke | host completes event from lobby and session creation is blocked | `cleanupE2eData` before/after in file | ~8s |
| `tests/e2e/event-flow.spec.ts` | account-first join redirects unauth users and prevents duplicate event participants @browser-smoke | unauth join redirect + idempotent participant behavior | `cleanupE2eData` before/after in file | ~2s |
| `tests/e2e/event-flow.spec.ts` | event lobby host can finish active session from sessions board @browser-smoke | host finishes active session from lobby board | `cleanupE2eData` before/after in file | ~4s |
| `tests/e2e/phase-6-legal-consent.spec.ts` | 23. Login page loads @browser-smoke | basic login page availability | `cleanupE2eData` before/after in file | <1s |
| `tests/e2e/phase-6-legal-consent.spec.ts` | 24. /join/invalid-token returns 404 or not-found page @browser-smoke | invalid join token route behavior | `cleanupE2eData` before/after in file | ~2s |

## 7. Repeated run results

| run | passed | failed | skipped | retries | duration | base URL | webServer started/reused | external domain observed |
|---:|---:|---:|---:|---:|---:|---|---|---|
| 1 | 5 | 0 | 0 | 0 | 24.3s | `http://127.0.0.1:3100` | started | no |
| 2 | 5 | 0 | 0 | 0 | 24.2s | `http://127.0.0.1:3100` | started | no |
| 3 | 5 | 0 | 0 | 0 | 22.8s | `http://127.0.0.1:3100` | started | no |
| 4 | 5 | 0 | 0 | 0 | 24.0s | `http://127.0.0.1:3100` | started | no |
| 5 | 5 | 0 | 0 | 0 | 22.1s | `http://127.0.0.1:3100` | started | no |

Notes:
- No retries were used to hide failures.
- No `local.negotaitions.ru` routing appeared in deterministic local browser smoke run logs.
- No reverse tunnel was required.
- No HTTPS certificate errors occurred.

## 8. Existing DB/API smoke compatibility

- Existing DB/API smoke command remains green:
  - `npm run test:e2e:smoke`
  - Result: 12 passed, 0 failed, 0 skipped, no retries.
- Existing smoke command behavior was not replaced.

## 9. Residual risks

- DB mutation remains part of smoke and requires dedicated non-production DB isolation.
- Browser smoke covers key flows but not all critical journeys yet (for example deeper session materials and richer role matrices).
- `playwright.local.config.ts` duplicates part of default config surface (intentional small duplication for deterministic isolation).
- Some legacy specs still contain manual/env-dependent assumptions (`BASE_URL`/external base patterns).
- CI rollout for browser smoke still needs explicit environment policy and governance in Phase 3B.

## 10. Readiness recommendation

**Conditionally ready**

- Deterministic local browser runtime objective is met for explicit local commands.
- Browser smoke is now stable and local-only in 5/5 consecutive runs.
- Full tunnel/provider classification and preflight policy remains pending Phase 3B.

## 11. Phase 3B recommendation

- Introduce explicit tunnel/provider classification (`@requires-tunnel`) and keep it opt-in.
- Add preflight command(s) for tunnel/provider prerequisites with fail-fast diagnostics.
- Separate deterministic local browser smoke from tunnel/provider/live-provider workflows.
- Keep no tunnel auto-start by default.
