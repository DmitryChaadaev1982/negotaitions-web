import assert from "node:assert/strict";
import test from "node:test";

import {
  decidePgGate,
  isExplicitPgCommand,
  PG_INFRASTRUCTURE_REQUIRED_MESSAGE,
  requirePgDatabase,
} from "./pg-test-gate";

test("an available database always runs the body", () => {
  assert.deepEqual(
    decidePgGate({ databaseReady: true, unavailableReason: "n/a", env: {} }),
    { kind: "run" },
  );
});

test("the fast gate skips a missing database instead of failing", () => {
  const decision = decidePgGate({
    databaseReady: false,
    unavailableReason: "E2E_DATABASE_URL is not set",
    env: {},
  });
  assert.equal(decision.kind, "skip");
});

test("an explicit PG command reports the infrastructure requirement as a failure", () => {
  const decision = decidePgGate({
    databaseReady: false,
    unavailableReason: "E2E_DATABASE_URL is not set",
    env: { PG_TESTS_REQUIRED: "1" },
  });
  assert.equal(decision.kind, "fail");
  assert.equal(decision.kind === "fail" && decision.reason.startsWith(PG_INFRASTRUCTURE_REQUIRED_MESSAGE), true);
});

test("isExplicitPgCommand only trusts the explicit marker", () => {
  assert.equal(isExplicitPgCommand({}), false);
  assert.equal(isExplicitPgCommand({ PG_TESTS_REQUIRED: "0" }), false);
  assert.equal(isExplicitPgCommand({ PG_TESTS_REQUIRED: "1" }), true);
});

test("requirePgDatabase marks the fast gate skipped and throws for explicit commands", () => {
  const skips: string[] = [];
  const ran = requirePgDatabase(
    { skip: (reason) => skips.push(reason ?? "") },
    { databaseReady: false, unavailableReason: "no database" },
  );
  assert.equal(ran, false);
  assert.deepEqual(skips, ["no database"]);

  const previous = process.env.PG_TESTS_REQUIRED;
  process.env.PG_TESTS_REQUIRED = "1";
  try {
    assert.throws(
      () =>
        requirePgDatabase(
          { skip: () => {} },
          { databaseReady: false, unavailableReason: "no database" },
        ),
      /PG_INFRASTRUCTURE_REQUIRED/,
    );
  } finally {
    if (previous === undefined) delete process.env.PG_TESTS_REQUIRED;
    else process.env.PG_TESTS_REQUIRED = previous;
  }
});
