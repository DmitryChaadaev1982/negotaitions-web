# Stage Tests Phase 4 — Fixture Stabilization

## 1. Executive summary

- Current fixture risk before changes was medium-high because shared `%E2E%` cleanup and unguarded `DATABASE_URL` could delete unrelated rows or target the wrong DB.
- Implemented run-scoped fixture namespace (`E2E_RUN_ID`) and DB mutation safety guardrails in shared e2e helper code.
- Stabilized smoke-critical fixture setup in selected files and converted a small high-value subset of skip-only role-assignment schema checks into runnable deterministic tests.
- Repeated smoke result: 5/5 DB/API smoke runs and 5/5 browser smoke runs passed without retries.
- Readiness verdict: **Conditionally ready** (smoke fixture layer is stabilized for selected scope; legacy broad cleanup remains in non-migrated suites).

## 2. Current fixture architecture

- Shared DB helper: `tests/e2e/helpers/db.ts`.
- DB access model: direct SQL via `pg` pool and helper `query()`.
- Setup model: mostly file-local helpers plus shared fixture helpers (`createE2eCase`, `createE2eEvent`, `createActiveUser`).
- Cleanup model: `cleanupE2eData()` in many suites via `beforeAll/afterAll`.
- Run model (new): per-process run namespace via `E2E_RUN_ID`/auto-generated ID with helper functions:
  - `getE2eRunId()`
  - `e2eName(base)`
  - `e2eEmail(base)`
  - `e2eId(base)`

## 3. Problems found

- Broad cleanup risk:
  - shared `%E2E%` title cleanup and broad test-user predicates in previous helper logic.
- Shared-ID/collision risk:
  - direct `Date.now()/Math.random()` across files with no explicit run namespace.
- DB safety gap:
  - DB URL was consumed directly without explicit test-target safety checks.
- Failure-leak risk:
  - suites relying only on file-level `beforeAll/afterAll` can leak rows if interrupted.
- Concurrency risk:
  - many suites serialize with shared DB and cleanup assumptions; global workers remain `1`.
- Fixed waits:
  - still present outside selected scope (`phase-5-privacy`, `phase-6-3-account-ux`), not migrated in Phase 4.
- Skip-only critical behavior:
  - `phase-6-11b-session-role-assignment.spec.ts` contains many documentation/manual skips.

## 4. Test DB safety model

- Env resolution order in shared helper:
  - `E2E_DATABASE_URL` -> `TEST_DATABASE_URL` -> `DATABASE_URL`.
- Safety assertion behavior:
  - runs before mutating SQL statements (`INSERT/UPDATE/DELETE/TRUNCATE/ALTER/DROP/CREATE`);
  - parses host + DB name without printing credentials;
  - rejects obvious production-like host/name markers unless explicit local override.
- Accepted test signals:
  - explicit `E2E_DATABASE_URL` or `TEST_DATABASE_URL`;
  - test/e2e/dev-like DB naming/host patterns;
  - `E2E_ALLOW_DB_MUTATION=1` explicit local override.
- Transitional compatibility:
  - preserves `DATABASE_URL` fallback, but guarded.

## 5. Run namespace model

- `E2E_RUN_ID`:
  - uses `process.env.E2E_RUN_ID` when provided;
  - otherwise auto-generates once per process using timestamp + pid + random suffix.
- Naming helpers:
  - `e2eName(base)` for readable titles,
  - `e2eEmail(base)` for run-scoped unique emails,
  - `e2eId(base)` for run-scoped IDs.
- Concurrency implication:
  - selected smoke fixtures become run-owned and significantly lower cross-run collision risk.

## 6. Cleanup changes

| file/helper | old behavior | new behavior | scope | residual risk |
|---|---|---|---|---|
| `tests/e2e/helpers/db.ts` | broad `%E2E%` title cleanup + broad user predicate | run-scoped cleanup by `E2E_RUN_ID` marker + run-owned user cleanup | shared e2e helper | non-migrated legacy suites still rely on older fixture assumptions |
| `tests/e2e/helpers/db.ts` | no DB target safety guard | mutating SQL requires safe test-target assertion | all tests using shared `query()` | users can still bypass with explicit `E2E_ALLOW_DB_MUTATION=1` |
| `tests/e2e/helpers/db.ts` | ad-hoc IDs/email/title generation | centralized run-scoped `e2eName/e2eEmail/e2eId` | shared factory/helper layer | not every legacy file uses new helpers yet |

## 7. Fixture factories

- Shared entities supported (existing + stabilized naming):
  - User (`createActiveUser`)
  - NegotiationCase (`createE2eCase`, `createTestCase`)
  - TrainingEvent (`createE2eEvent`)
  - Session and related rows via existing helper functions
- Defaults:
  - run-scoped IDs/titles/emails/tokens for shared helper-created rows.
- Overrides:
  - helper APIs keep explicit input overrides (title/email/etc.) where previously supported.
- Created ID tracking:
  - run-namespace ownership is used as cleanup ownership signal; no global hidden fixture state added.

## 8. Stabilized tests

| file | test | changes | isolated run result | repeated result |
|---|---|---|---|---|
| `tests/e2e/phase-6-10-standalone-sessions-auth-role.spec.ts` | smoke DB/API subset | UID generation moved to run-scoped helper (`e2eId`) | pass | 5/5 pass |
| `tests/e2e/phase-6-11a-global-visibility-ownership.spec.ts` | smoke DB/API subset | UID generation moved to run-scoped helper (`e2eId`) | pass | 5/5 pass |
| `tests/e2e/phase-6-4-visibility-access.spec.ts` | smoke DB/API subset | UID generation moved to run-scoped helper (`e2eId`) | pass | 5/5 pass |
| `tests/e2e/event-flow.spec.ts` | browser smoke flow + fixture-heavy setup | run-scoped participant token generation for inserted extra participants | pass | 5/5 pass |
| `tests/e2e/phase-6-legal-consent.spec.ts` | browser smoke + registration fixture | run-scoped registration email (`e2eEmail`) | pass | 5/5 pass |
| `tests/e2e/phase-6-11b-session-role-assignment.spec.ts` | selected skip-only tests | converted 3 schema-critical checks from skip to runnable deterministic assertions | pass | pass in gate runs |

## 9. Skipped/legacy tests

- Converted from skip-only in `phase-6-11b`:
  - `API05 — assignParticipantRole allows null roleId (unassign)`
  - `STRUCT03 — addAccountParticipantSchema allows PARTICIPANT without sessionRoleId`
  - `STRUCT04 — assignParticipantRoleSchema validates correctly`
- Retained skipped tests in `phase-6-11b`:
  - browser/manual scenario tests requiring authenticated multi-user interactive fixtures;
  - DB/action behavior tests that still require app-action/runtime wiring beyond fixture-only stabilization.

## 10. Repeated smoke results

### DB/API smoke (`npm run test:e2e:smoke`) — 5 runs

| run | passed | failed | skipped | retries | duration | cleanup warnings | collision warnings |
|---:|---:|---:|---:|---:|---:|---|---|
| 1 | 12 | 0 | 0 | 0 | 7.4s | none | none |
| 2 | 12 | 0 | 0 | 0 | 7.6s | none | none |
| 3 | 12 | 0 | 0 | 0 | 7.9s | none | none |
| 4 | 12 | 0 | 0 | 0 | 8.3s | none | none |
| 5 | 12 | 0 | 0 | 0 | 7.6s | none | none |

### Browser smoke (`npm run test:e2e:smoke:browser`) — 5 runs

| run | passed | failed | skipped | retries | duration | cleanup warnings | collision warnings |
|---:|---:|---:|---:|---:|---:|---|---|
| 1 | 5 | 0 | 0 | 0 | 23.4s | none | none |
| 2 | 5 | 0 | 0 | 0 | 23.7s | none | none |
| 3 | 5 | 0 | 0 | 0 | 23.0s | none | none |
| 4 | 5 | 0 | 0 | 0 | 23.8s | none | none |
| 5 | 5 | 0 | 0 | 0 | 23.4s | none | none |

## 11. Mandatory gate results

- `npm run validate:fast` — **pass**
- `npm run validate:deploy` — **pass**
- `npm run test:e2e:smoke` — **pass** (`12 passed`)
- `npm run test:e2e:smoke:browser` — **pass** (`5 passed`)

All mandatory gates were executed sequentially.

## 12. Residual risks

- Remaining broad cleanup exists in non-migrated legacy suites.
- Shared DB model still requires `workers=1` for safe default execution.
- Many non-smoke suites still depend on file-level serial setup/cleanup patterns.
- `phase-6-11b` still contains many manual/documentation skip tests.
- Fixed wait usage remains in non-selected files and should be reduced in later phases.

## 13. Readiness recommendation

**Conditionally ready**

- Selected smoke-critical fixture layer is stabilized and repeatable.
- Additional migration is required before claiming global e2e fixture safety across the full suite.

## 14. Recommended next phase

- Expand architecture coverage with selective API/integration extraction for DB-only assertions now living in large Playwright specs.
- Continue legacy cleanup migration by replacing broad wildcard deletion in additional high-risk files.
- Incrementally convert critical skip-only role/assignment scenarios from manual stubs to deterministic runnable tests with dedicated fixture builders.
