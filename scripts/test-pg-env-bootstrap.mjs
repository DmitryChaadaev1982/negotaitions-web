/**
 * Bootstrap for the explicit `test:pg:*` commands.
 *
 * It layers the standard unit-test environment and then marks the run as an
 * explicitly requested PostgreSQL gate, so a missing isolated E2E database is
 * reported as an infrastructure failure instead of a silent skip. The flag name
 * is asserted against `lib/test-helpers/pg-test-gate.ts` by the gate tests.
 */
import "./test-unit-env-bootstrap.mjs";

process.env.PG_TESTS_REQUIRED = "1";
