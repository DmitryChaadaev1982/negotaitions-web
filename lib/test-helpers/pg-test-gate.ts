/**
 * Selection policy for PostgreSQL-mutating tests.
 *
 * `validate:fast` excludes these files by name (`*.pg.test.ts`, `tests/pg-race/**`),
 * so they never enter the fast gate at all. When an operator invokes an explicit
 * `test:pg:*` command the database is a hard requirement: a missing isolated E2E
 * database is reported as a failure instead of being silently skipped.
 */

export const PG_TESTS_REQUIRED_ENV = "PG_TESTS_REQUIRED";

export const PG_INFRASTRUCTURE_REQUIRED_MESSAGE =
  "PG_INFRASTRUCTURE_REQUIRED: this command needs an isolated E2E PostgreSQL database. " +
  "Set E2E_DATABASE_URL to a non-production database and re-run.";

export function isExplicitPgCommand(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return env[PG_TESTS_REQUIRED_ENV] === "1";
}

export type PgGateDecision =
  | { kind: "run" }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; reason: string };

export function decidePgGate(params: {
  databaseReady: boolean;
  unavailableReason: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): PgGateDecision {
  if (params.databaseReady) return { kind: "run" };
  if (isExplicitPgCommand(params.env)) {
    return { kind: "fail", reason: `${PG_INFRASTRUCTURE_REQUIRED_MESSAGE} (${params.unavailableReason})` };
  }
  return { kind: "skip", reason: params.unavailableReason };
}

export type PgGateTestContext = {
  skip: (reason?: string) => void;
};

/**
 * Returns `true` when the caller should execute the database body. Marks the
 * test skipped, or throws the infrastructure requirement, otherwise.
 */
export function requirePgDatabase(
  t: PgGateTestContext,
  params: { databaseReady: boolean; unavailableReason: string },
): boolean {
  const decision = decidePgGate(params);
  if (decision.kind === "run") return true;
  if (decision.kind === "fail") throw new Error(decision.reason);
  t.skip(decision.reason);
  return false;
}
