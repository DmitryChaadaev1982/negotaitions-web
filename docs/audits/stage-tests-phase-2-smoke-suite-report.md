# Stage Tests Phase 2 — Smoke Suite Report

## 1. Executive summary

- Selected test count: **12**
- Selected file count: **4**
- Total repeated-run runtime (5 runs): **42.0s** (avg **8.4s**)
- Stability verdict: **5/5 consecutive green runs**, no retries, no skips
- Deploy-adjacent recommendation: **Conditionally ready**
  - Ready for a deterministic DB/API smoke gate.
  - Not yet covering browser-first event/room finish/materials flows in this phase due environment-driven base URL instability outside local webServer defaults.

## 2. Candidate assessment

| file | test title | capability | DB mutation | provider dependency | tunnel dependency | deterministic verdict | selected yes/no | reason |
|---|---|---|---|---|---|---|---|---|
| `tests/e2e/admin-diagnostics-env.spec.ts` | secret masking helper masks keys/passwords/tokens | admin/env safety | no | no | no | deterministic | yes | pure function assertion, no env coupling |
| `tests/e2e/admin-diagnostics-env.spec.ts` | grouped diagnostics include Voximplant and Yandex vars | admin diagnostics grouping | no | no (naming only) | no | deterministic | yes | pure in-process checks |
| `tests/e2e/event-flow.spec.ts` | account-first join redirects unauth users and prevents duplicate event participants | account-first protected route | yes | no | no (intended) | non-deterministic in current env | no | page/request routing followed external local domain |
| `tests/e2e/event-flow.spec.ts` | event lobby session setup uses role-slot rules and observer flow | lobby role-slot exclusivity | yes | no | no (intended) | non-deterministic in current env | no | browser/baseURL behavior environment-sensitive |
| `tests/e2e/event-flow.spec.ts` | event lobby host can finish active session from sessions board | host finish action | yes | no | no (intended) | non-deterministic in current env | no | same baseURL/environment sensitivity |
| `tests/e2e/event-completion.spec.ts` | complete event from lobby closes event and disables session creation | event finish terminal transition | yes | no | no (intended) | non-deterministic in current env | no | API requests resolved to external local domain/cert |
| `tests/e2e/session-navigation.spec.ts` | assigned lobby navigation targets video room directly | event-linked session access | yes | mock external service endpoint | no (intended) | non-deterministic in current env | no | request fixture route environment-sensitive |
| `tests/e2e/session-navigation.spec.ts` | finished session rejoin routes to materials | materials after finish | yes | no | no (intended) | non-deterministic in current env | no | dependent on same request routing model |
| `tests/e2e/phase-6-legal-consent.spec.ts` | 23. Login page loads | basic UI availability | no | no | no | non-deterministic in current env | no | relative navigation resolved to external local domain |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | createSession: facilitatorId in DB is resolvedFacilitatorUserId, not always creator | standalone ownership guard | yes | no | no | deterministic | yes | DB-only invariant, isolated IDs |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | external email → SessionInvite row is created | standalone invite path | yes | no | no | deterministic | yes | DB-only invite creation check |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | duplicate registered user in session is prevented | assignment/identity exclusivity guard | yes | no | no | deterministic | yes | DB constraint behavior, repeatable |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | duplicate external email invite is prevented | invite dedupe guard | yes | no | no | deterministic | yes | deterministic upsert assertion |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | invited registered user can access private session | standalone access path | yes | no | no (intended) | non-deterministic in current env | no | request fixture used external local domain |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | unrelated user is denied access to private session | negative authorization | yes | no | no (intended) | non-deterministic in current env | no | same request environment issue |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | account room entry auto-creates OBSERVER participant by default | standalone room auto-join behavior | yes | no | no (intended) | non-deterministic in current env | no | same request environment issue |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | 4. Private event NOT visible to unrelated ACTIVE user | private visibility guard | yes | no | no | deterministic | yes | DB-level visibility query test |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | 5. Private event visible to invited user (EventInvite) | invited event access | yes | no | no | deterministic | yes | DB-level invite visibility check |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | 13. Standalone PRIVATE session visible to invited user (SessionInvite) | invited session access | yes | no | no | deterministic | yes | DB-level invite visibility check |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | 18. No duplicate EventParticipant when same user joins again (idempotent) | participant dedupe/guard | yes | no | no | deterministic | yes | deterministic idempotency assertion |
| `tests/e2e/phase-6-11a-global-visibility-ownership.spec.ts` | 19. Email-invited user sees Private Event | ownership + email invite visibility | yes | no | no | deterministic | yes | DB-only visibility path |
| `tests/e2e/phase-6-11a-global-visibility-ownership.spec.ts` | 22. Email-invited user sees Private Session | ownership + email invite session visibility | yes | no | no | deterministic | yes | DB-only visibility path |

## 3. Final smoke inventory

| file | exact test title | capability | test type | setup/cleanup model | expected runtime |
|---|---|---|---|---|---|
| `tests/e2e/admin-diagnostics-env.spec.ts` | admin diagnostics env display › secret masking helper masks keys/passwords/tokens @smoke | admin/env health safety | API/unit-style | none required | < 0.1s |
| `tests/e2e/admin-diagnostics-env.spec.ts` | admin diagnostics env display › grouped diagnostics include Voximplant and Yandex vars @smoke | env grouping sanity | API/unit-style | none required | < 0.1s |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | Part 2 - Facilitator selection at creation › createSession: facilitatorId in DB is resolvedFacilitatorUserId, not always creator @smoke | standalone ownership guard | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | Part 3 - Account-based participant add (no guest) › external email → SessionInvite row is created @smoke | standalone invite path | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | Part 3 - Account-based participant add (no guest) › duplicate registered user in session is prevented @smoke | participant uniqueness guard | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | Part 3 - Account-based participant add (no guest) › duplicate external email invite is prevented @smoke | invite dedupe guard | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-11a-global-visibility-ownership.spec.ts` | Phase 6.11A — Access rules: Events (DB) › 19. Email-invited user sees Private Event @smoke | private event invite visibility | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-11a-global-visibility-ownership.spec.ts` | Phase 6.11A — Access rules: Sessions (DB) › 22. Email-invited user sees Private Session @smoke | private session invite visibility | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | Phase 6.4 — Visibility rules (DB-level) › 4. Private event NOT visible to unrelated ACTIVE user @smoke | negative authorization guard | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | Phase 6.4 — Visibility rules (DB-level) › 5. Private event visible to invited user (EventInvite) @smoke | positive invite authorization | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | Phase 6.4 — Visibility rules (DB-level) › 13. Standalone PRIVATE session visible to invited user (SessionInvite) @smoke | standalone invite authorization | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | Phase 6.4 — Visibility rules (DB-level) › 18. No duplicate EventParticipant when same user joins again (idempotent) @smoke | role/access participant dedupe guard | DB/API | file-level `cleanupE2eData` before/after | ~0.1s |

## 4. Changes made

- Added `@smoke` tags to selected deterministic tests only.
- Added script: `"test:e2e:smoke": "playwright test --project=chromium --grep @smoke"`.
- No application code changes.
- No dependency or lockfile changes.
- Updated testing docs:
  - `docs/testing/e2e-strategy.md`
  - `docs/testing/validation-checklist.md`

## 5. Repeated run results

| run number | passed | failed | skipped | retries | duration | notes |
|---|---:|---:|---:|---:|---:|---|
| 1 | 12 | 0 | 0 | 0 | 8.4s | clean pass |
| 2 | 12 | 0 | 0 | 0 | 8.5s | clean pass |
| 3 | 12 | 0 | 0 | 0 | 8.5s | clean pass |
| 4 | 12 | 0 | 0 | 0 | 8.1s | clean pass |
| 5 | 12 | 0 | 0 | 0 | 8.5s | clean pass |

Pre-selection exploratory run failures were environment-driven (`local.negotaitions.ru` routing and missing browser binary) and were resolved by smoke curation + explicit browser install step (`npm run test:e2e:install`) without app-code changes.

## 6. Coverage provided

- account/auth: private resource visibility and invite-based access constraints.
- standalone session: facilitator ownership and invitation/dedup semantics.
- event/lobby: private event invite visibility and participant idempotency guards.
- role/access: duplicate participant/invite prevention and private visibility boundaries.
- finish/materials: **not directly covered in final deterministic subset** (documented gap).
- visibility/security: unrelated-user denial on private event plus invite-positive paths.

## 7. Deliberate exclusions

- Real Voximplant conferencing/recording.
- Real SpeechKit/Yandex provider calls.
- Reverse tunnel and callback-domain checks.
- Audio/transcription-heavy long workflows.
- Full browser UI regression and multi-browser/mobile.
- Skip/documentation-only/manual tests.
- Unstable environment-sensitive tests requiring external base URL behavior.

## 8. Residual risks

- Smoke remains DB-mutating; requires dedicated non-production database.
- Current deterministic set is mostly DB/API-level and light on browser journey assertions.
- Event finish/materials browser transitions are not yet included in stable smoke.
- Shared cleanup patterns can still collide if DB is used concurrently by other runs.
- Tunnel/provider behaviors remain unclassified until Phase 3.

## 9. Recommendation

**Conditionally ready**

The suite is stable and deterministic for deploy-adjacent checks where the goal is fast authorization/visibility/ownership guard validation on a dedicated test DB. It is not yet sufficient as the sole critical-journey browser smoke because finish/materials and richer room/lobby browser paths are intentionally excluded pending environment-decoupled stabilization.

## 10. Phase 3 recommendation

1. Introduce explicit `@requires-tunnel` tagging and keep it out of default smoke.
2. Add a tunnel preflight script/command with clear fail-fast diagnostics.
3. Split smoke into:
   - default deterministic (`@smoke`),
   - tunnel/provider smoke (`@requires-tunnel` + opt-in),
   - full regression (`test:e2e:full`).
4. Re-introduce selected browser journey tests (event finish/materials/rejoin) only after base URL environment dependency is neutralized in a deterministic way.
