# Stage Tests Phase 3B — Tunnel and Live-Provider Classification

## 1. Executive summary

- Classified Playwright test inventory: 577 tests (from `npm run test:e2e:list`).
- Tunnel-only count (`@requires-tunnel`): 0.
- Live-provider count (`@live-provider`): 0.
- Overlap count (`@requires-tunnel` + `@live-provider`): 0.
- Preflight verdict: pass/fail logic is correct; current environment fails fast with actionable diagnostics.
- Readiness verdict: **Conditionally ready** (command surface and docs are ready; no proven tunnel/live Playwright cases are currently tagged).

## 2. Current tunnel/provider architecture

- Public tunnel domain: `https://local.negotaitions.ru`.
- Reverse flow: local app (`127.0.0.1:3000`) -> SSH reverse mapping (`127.0.0.1:3300`) -> public tunnel domain.
- Callback dependency: provider callback/webhook scenarios rely on publicly reachable HTTPS endpoint only in dedicated provider/manual flows.
- Provider dependency: live Voximplant/Yandex checks currently exist as explicit scripts/manual diagnostics, while default Playwright runtime remains mock-first/local-capable.

## 3. Classification matrix

| file/script | exact title/purpose | localhost-compatible | tunnel required | live provider required | external side effects | final tags/classification | reasoning |
|---|---|---|---|---|---|---|---|
| `tests/e2e/*.spec.ts` (`@smoke` set via `test:e2e:smoke`) | deterministic DB/API smoke checks | yes | no | no | DB mutation in test DB | normal local | Curated smoke is explicitly deterministic/mock-compatible and currently green without tunnel. |
| `tests/e2e/*.spec.ts` (`@browser-smoke` set via `test:e2e:smoke:browser`) | deterministic localhost browser smoke checks | yes | no | no | DB mutation in test DB | normal local | Runs on `playwright.local.config.ts` with localhost base URL and managed local webServer. |
| `tests/e2e/voximplant-room-parity.spec.ts` | Vox room parity API-state assertions | yes | no | no | DB mutation | normal local | Exercises app API/state in test runtime; no public callback delivery required. |
| `tests/e2e/voximplant-room-presence.spec.ts` | stale-lease/presence API behavior | yes | no | no | DB mutation | normal local | Local API contract checks, no tunnel/public host dependency. |
| `tests/e2e/voximplant-event-lobby.spec.ts` | lobby/provider-path guards and event lifecycle | yes | no | no | DB mutation | normal local | Includes tolerant provider-path assertion (`200/403/409/501/503`) and does not prove mandatory live provider use. |
| `tests/e2e/voximplant-recording-debug.spec.ts` | recording debug endpoint + simulated signed webhook | yes | no | no | DB mutation (test rows) | normal local | Uses simulated webhook and debug endpoint; comments and behavior explicitly avoid real-provider requirement. |
| `tests/e2e/ui-i18n-layout.spec.ts` | `RUN_LIVE_SMOKE_TESTS` placeholder skip test | yes | no | no | none | legacy/unclassified | Placeholder does not call live providers; no proven tunnel/provider dependency. |
| `scripts/smoke-voximplant-recording.ts` | Vox recording smoke script with simulated webhook | usually yes (local dev server) | no | conditional | can mutate session/recording state | manual script only | Explicit manual smoke utility, not part of Playwright mandatory gates. |
| `scripts/yandex-speechkit-smoke.ts` | direct Yandex SpeechKit API smoke | no (requires external API access) | no | yes | external API usage/cost | manual script only | Requires real Yandex credentials and performs live external API call. |
| `scripts/yandex-ai-smoke.ts` | direct Yandex AI REST smoke | no (requires external API access) | no | yes | external API usage/cost | manual script only | Requires real Yandex credentials and live model invocation. |
| `scripts/yandex-saved-negotiation-benchmark.ts` | benchmark transcript across Yandex models | no (requires external API access) | no | yes | external API usage/cost | manual script only | Dedicated benchmarking script with explicit live-model calls and artifacts. |
| `scripts/debug/vox-audio-activity-browser-smoke.mjs` | browser debug smoke against tunnel room URL | no (default target is tunnel URL) | yes | possible | runtime/debug side effects | manual script only | Defaults to `https://local.negotaitions.ru/...`, intended for manual diagnostics with tunnel-ready environment. |

## 4. Tags added

- `@requires-tunnel`: none added (no proven Playwright test requiring mandatory public callback/domain routing).
- `@live-provider`: none added (no proven Playwright spec requiring real provider execution by design).

## 5. Preflight implementation

- Target URL resolution: `E2E_TUNNEL_URL || https://local.negotaitions.ru`.
- Checks: URL parse + bounded HTTPS GET to `/login` with 7s timeout.
- Success behavior: prints target, probe URL, HTTP status, and `Tunnel preflight passed.`.
- Failure behavior: prints target, categorized error, likely causes, manual SSH command, required env, exits non-zero.
- Security safeguards: no SSH spawn, no process kill, no secret printing, no TLS verification bypass, no remote-state mutation.

## 6. Package scripts

- Added:
  - `test:e2e:tunnel:check` -> `node scripts/e2e/check-reverse-tunnel.mjs`
  - `test:e2e:tunnel:list` -> `playwright test --list --grep @requires-tunnel`
  - `test:e2e:tunnel` -> `npm run test:e2e:tunnel:check && playwright test --project=chromium --grep @requires-tunnel --grep-invert @live-provider`
  - `test:e2e:live:list` -> `playwright test --list --grep @live-provider`
  - `test:e2e:live` -> `playwright test --project=chromium --grep @live-provider`
- Overlap/exclusion behavior: tunnel suite explicitly excludes live-provider tags by default.
- Safety model: explicit opt-in only; no automatic SSH start and no stale tunnel process termination.

## 7. Mandatory validation gates

- Canonical Markdown updated:
  - `docs/testing/e2e-strategy.md`
  - `docs/testing/validation-checklist.md`
  - `docs/testing/yandex-poc-smoke-regression-plan.md`
  - `AGENTS.md`
- Mandatory gate commands (unchanged):
  - `npm run validate:fast`
  - `npm run validate:deploy`
  - `npm run test:e2e:smoke`
  - `npm run test:e2e:smoke:browser`
- Exceptions policy documented: only audit/docs-only tasks may skip; otherwise blockers must be reported explicitly.

## 8. Validation results

- `npm pkg get scripts`: success; new tunnel/live scripts present.
- `node scripts/e2e/check-reverse-tunnel.mjs`: expected fail-fast in current environment (`network_error`, non-zero exit, actionable output).
- `npm run test:e2e:tunnel:list`: 0 tests (No tests found).
- `npm run test:e2e:live:list`: 0 tests (No tests found).
- `npm run validate:fast`: pass.
- `npm run validate:deploy`: pass.
- `npm run test:e2e:smoke`: pass (`12 passed`).
- `npm run test:e2e:smoke:browser`: pass (`5 passed`) when run sequentially; parallel overlap can transiently hit `EADDRINUSE` on `3100`.
- Tunnel/live execution beyond listing: not run (intentional, safety policy respected).

## 9. Residual risks

- Tunnel endpoint availability remains VPN/SSH dependent.
- Remote reverse-port staleness can still block manual tunnel usage.
- Certificate/domain correctness remains an external operational dependency.
- Live-provider scripts can incur external cost and mutate external provider state.
- Credentials and non-production environment isolation remain mandatory prerequisites.
- Callback delivery reliability remains an ops/runtime concern outside deterministic local smoke.

## 10. Readiness recommendation

**Conditionally ready**

- Ready for Phase 3B command/documentation model and fail-fast preflight behavior.
- Classification is accurate to current repo state (no proven tunnel/live Playwright test cases).

## 11. Recommended next phase

- Recommended: **narrower provider-contract test phase** to introduce explicitly isolated live-provider/tunnel Playwright tests only where callback/provider requirements are demonstrably real.
