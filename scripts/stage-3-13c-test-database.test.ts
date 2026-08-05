import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedStage313cVerifierChildEnvironment,
  deriveStage313cSchemaScopedDatabaseUrl,
  resolveApprovedStage313cTestDatabase,
  Stage313cTestDatabaseRefusal,
  STAGE313C_TEST_SCHEMA,
} from "./stage-3-13c-test-database";

const SAFE_TEST_URL =
  "postgresql://127.0.0.1:5432/negotaitions_security_test";

function approvedEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    STAGE313C_TEST_DATABASE_URL: SAFE_TEST_URL,
    STAGE313C_TEST_DATABASE_APPROVED: "true",
    STAGE313C_TEST_SCHEMA,
    ...overrides,
  };
}

function assertRefusal(
  expectedCode: string,
  operation: () => unknown,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof Stage313cTestDatabaseRefusal);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test("persistent verifier requires explicit approval and exact schema", () => {
  for (const approval of ["", "false", "TRUE", "1"]) {
    assertRefusal("TEST_DATABASE_APPROVAL_REQUIRED", () =>
      resolveApprovedStage313cTestDatabase(
        approvedEnv({ STAGE313C_TEST_DATABASE_APPROVED: approval }),
      ),
    );
  }
  assertRefusal("TEST_DATABASE_SCHEMA_REFUSED", () =>
    resolveApprovedStage313cTestDatabase(
      approvedEnv({ STAGE313C_TEST_SCHEMA: "another_test_schema" }),
    ),
  );
});

test("persistent verifier never falls back to runtime DATABASE_URL", () => {
  assertRefusal("TEST_DATABASE_URL_MISSING", () =>
    resolveApprovedStage313cTestDatabase(
      approvedEnv({
        STAGE313C_TEST_DATABASE_URL: "",
        DATABASE_URL: SAFE_TEST_URL,
      }),
    ),
  );
});

test("persistent verifier rejects unsafe targets and scope overrides", () => {
  assertRefusal("TEST_DATABASE_URL_INVALID", () =>
    resolveApprovedStage313cTestDatabase(
      approvedEnv({ STAGE313C_TEST_DATABASE_URL: "not a URL" }),
    ),
  );
  assertRefusal("TEST_DATABASE_NOT_POSTGRESQL", () =>
    resolveApprovedStage313cTestDatabase(
      approvedEnv({
        STAGE313C_TEST_DATABASE_URL:
          "mysql://127.0.0.1/negotaitions_security_test",
      }),
    ),
  );
  assertRefusal("TEST_DATABASE_NOT_LOCAL", () =>
    resolveApprovedStage313cTestDatabase(
      approvedEnv({
        STAGE313C_TEST_DATABASE_URL:
          "postgresql://database.example.test/negotaitions_security_test",
      }),
    ),
  );
  assertRefusal("TEST_DATABASE_PRODUCTION_LIKE", () =>
    resolveApprovedStage313cTestDatabase(
      approvedEnv({
        STAGE313C_TEST_DATABASE_URL:
          "postgresql://127.0.0.1:5432/negotaitions_prod_test",
      }),
    ),
  );
  assertRefusal("TEST_DATABASE_NAME_NOT_TEST_LIKE", () =>
    resolveApprovedStage313cTestDatabase(
      approvedEnv({
        STAGE313C_TEST_DATABASE_URL:
          "postgresql://127.0.0.1:5432/negotaitions_development",
      }),
    ),
  );
  for (const parameter of [
    "schema=public",
    "Schema=public",
    "options=-c%20search_path%3Dpublic",
    "search_path=public",
    "currentSchema=public",
  ]) {
    assertRefusal("TEST_DATABASE_SCHEMA_OVERRIDE_REFUSED", () =>
      resolveApprovedStage313cTestDatabase(
        approvedEnv({
          STAGE313C_TEST_DATABASE_URL: `${SAFE_TEST_URL}?${parameter}`,
        }),
      ),
    );
  }
});

test("derived child URL is explicitly scoped and authenticated", () => {
  const env = approvedEnv();
  const approved = resolveApprovedStage313cTestDatabase(env);
  const scopedDatabaseUrl =
    deriveStage313cSchemaScopedDatabaseUrl(approved);
  const parsed = new URL(scopedDatabaseUrl);
  assert.equal(parsed.searchParams.get("schema"), STAGE313C_TEST_SCHEMA);
  assert.match(
    parsed.searchParams.get("options") ?? "",
    new RegExp(`search_path=${STAGE313C_TEST_SCHEMA}$`),
  );

  const child = assertApprovedStage313cVerifierChildEnvironment({
    ...env,
    DATABASE_URL: scopedDatabaseUrl,
  });
  assert.equal(child.schemaName, STAGE313C_TEST_SCHEMA);

  assertRefusal("TEST_DATABASE_CHILD_SCOPE_MISSING", () =>
    assertApprovedStage313cVerifierChildEnvironment(env),
  );
  assertRefusal("TEST_DATABASE_CHILD_SCOPE_MISMATCH", () =>
    assertApprovedStage313cVerifierChildEnvironment({
      ...env,
      DATABASE_URL: SAFE_TEST_URL,
    }),
  );
});
