import assert from "node:assert/strict";
import test from "node:test";

import {
  assertE2eDatabaseUrl,
  assertLocalManualDatabaseUrl,
  assertProductionOverrideDatabaseUrl,
} from "@/lib/voximplant/orphan-user-cleanup-io";

test("local manual URL must be localhost:5432", () => {
  assert.deepEqual(
    assertLocalManualDatabaseUrl(
      "postgresql://negotiations:negotiations_password@localhost:5432/negotiations",
    ),
    { host: "localhost", port: 5432, database: "negotiations" },
  );
  assert.throws(
    () =>
      assertLocalManualDatabaseUrl(
        "postgresql://negotiations:negotiations_password@localhost:5433/negotiations_e2e",
      ),
    /localhost:5432/,
  );
});

test("E2E correlation URL must be localhost:5433", () => {
  assert.deepEqual(
    assertE2eDatabaseUrl(
      "postgresql://negotiations:negotiations_password@localhost:5433/negotiations_e2e",
    ),
    { host: "localhost", port: 5433, database: "negotiations_e2e" },
  );
  assert.throws(
    () =>
      assertE2eDatabaseUrl(
        "postgresql://negotiations:negotiations_password@localhost:5432/negotiations",
      ),
    /localhost:5433/,
  );
});

test("production override refuses local manual and E2E databases", () => {
  assert.throws(
    () =>
      assertProductionOverrideDatabaseUrl(
        "postgresql://negotiations:negotiations_password@localhost:5432/negotiations",
      ),
    /must not target the local/,
  );
  assert.throws(
    () =>
      assertProductionOverrideDatabaseUrl(
        "postgresql://user:pass@example.com:5432/not_production",
      ),
    /does not look like the documented production database/,
  );
  assert.deepEqual(
    assertProductionOverrideDatabaseUrl(
      "postgresql://user:pass@rc1b-example.mdb.yandexcloud.net:6432/negotaitions_poc",
    ),
    {
      host: "rc1b-example.mdb.yandexcloud.net",
      port: 6432,
      database: "negotaitions_poc",
    },
  );
});
