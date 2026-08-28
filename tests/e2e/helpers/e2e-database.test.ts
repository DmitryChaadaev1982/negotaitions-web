import assert from "node:assert/strict";
import test from "node:test";

import {
  assertIsolatedE2eDatabase,
  buildE2eServerEnvironment,
  getSanitizedE2eDatabaseDescriptor,
  maskCredentialsInUrl,
  maskDatabaseName,
  resolveE2eDatabaseUrl,
} from "./e2e-database";

const VALID_E2E_URL =
  "postgresql://negotiations:negotiations_password@localhost:5433/negotiations_e2e?schema=public";
const VALID_DEV_URL =
  "postgresql://negotiations:negotiations_password@localhost:5432/negotiations?schema=public";

type EnvSnapshot = NodeJS.ProcessEnv;

function snapshotEnv(): EnvSnapshot {
  return { ...process.env };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

function withEnv(
  values: Record<string, string | undefined>,
  run: () => void,
): void {
  const snapshot = snapshotEnv();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    restoreEnv(snapshot);
  }
}

test("accepts valid localhost:5433/negotiations_e2e", () => {
  withEnv(
    {
      E2E_DATABASE_URL: VALID_E2E_URL,
      DATABASE_URL: VALID_DEV_URL,
    },
    () => {
      const url = resolveE2eDatabaseUrl();
      assert.equal(url, VALID_E2E_URL);
      const descriptor = getSanitizedE2eDatabaseDescriptor(url);
      assert.equal(descriptor.hostClass, "local");
      assert.equal(descriptor.port, 5433);
      assert.equal(descriptor.database, "negotiations_e2e");
    },
  );
});

test("refuses missing E2E_DATABASE_URL", () => {
  withEnv(
    {
      E2E_DATABASE_URL: undefined,
      DATABASE_URL: VALID_DEV_URL,
      TEST_DATABASE_URL: VALID_E2E_URL,
    },
    () => {
      assert.throws(
        () => resolveE2eDatabaseUrl(),
        /E2E_DATABASE_URL is required/,
      );
    },
  );
});

test("refuses malformed URL", () => {
  withEnv(
    {
      E2E_DATABASE_URL: "not-a-valid-url",
      DATABASE_URL: VALID_DEV_URL,
    },
    () => {
      assert.throws(
        () => resolveE2eDatabaseUrl(),
        /valid PostgreSQL connection string/,
      );
    },
  );
});

test("refuses E2E_DATABASE_URL equal to DATABASE_URL", () => {
  withEnv(
    {
      E2E_DATABASE_URL: VALID_E2E_URL,
      DATABASE_URL: VALID_E2E_URL,
    },
    () => {
      assert.throws(
        () => assertIsolatedE2eDatabase(),
        /must not equal DATABASE_URL/,
      );
    },
  );
});

test("refuses same host port database under different textual URL", () => {
  withEnv(
    {
      E2E_DATABASE_URL:
        "postgresql://negotiations:negotiations_password@127.0.0.1:5433/negotiations_e2e",
      DATABASE_URL:
        "postgres://negotiations:negotiations_password@localhost:5433/negotiations_e2e?schema=public",
    },
    () => {
      assert.throws(
        () => assertIsolatedE2eDatabase(),
        /same host, port, and database/,
      );
    },
  );
});

test("refuses localhost development database negotiations", () => {
  withEnv(
    {
      E2E_DATABASE_URL:
        "postgresql://negotiations:negotiations_password@localhost:5432/negotiations",
      DATABASE_URL: VALID_DEV_URL,
    },
    () => {
      assert.throws(
        () => resolveE2eDatabaseUrl(),
        /development database negotiations/,
      );
    },
  );
});

test("refuses database without e2e or test marker", () => {
  withEnv(
    {
      E2E_DATABASE_URL:
        "postgresql://negotiations:negotiations_password@localhost:5433/negotiations",
      DATABASE_URL: VALID_DEV_URL,
    },
    () => {
      assert.throws(
        () => resolveE2eDatabaseUrl(),
        /without test marker/,
      );
    },
  );
});

test("refuses production-like hostname", () => {
  withEnv(
    {
      E2E_DATABASE_URL:
        "postgresql://negotiations:negotiations_password@prod-db.internal:5433/negotiations_e2e",
      DATABASE_URL: VALID_DEV_URL,
      E2E_ALLOW_REMOTE_DATABASE: "1",
    },
    () => {
      assert.throws(
        () => resolveE2eDatabaseUrl(),
        /production-like E2E database host/,
      );
    },
  );
});

test("refuses production-like database name", () => {
  withEnv(
    {
      E2E_DATABASE_URL:
        "postgresql://negotiations:negotiations_password@localhost:5433/negotaitions_prod",
      DATABASE_URL: VALID_DEV_URL,
    },
    () => {
      assert.throws(
        () => resolveE2eDatabaseUrl(),
        /production-like E2E database name/,
      );
    },
  );
});

test("refuses remote target by default", () => {
  withEnv(
    {
      E2E_DATABASE_URL:
        "postgresql://negotiations:negotiations_password@ci-db.example.com:5433/negotiations_e2e",
      DATABASE_URL: VALID_DEV_URL,
      E2E_ALLOW_REMOTE_DATABASE: undefined,
    },
    () => {
      assert.throws(
        () => resolveE2eDatabaseUrl(),
        /remote E2E database by default/,
      );
    },
  );
});

test("explicit remote opt-in still refuses production-like targets", () => {
  withEnv(
    {
      E2E_DATABASE_URL:
        "postgresql://negotiations:negotiations_password@ci-db.example.com:5433/negotiations_prod",
      DATABASE_URL: VALID_DEV_URL,
      E2E_ALLOW_REMOTE_DATABASE: "1",
    },
    () => {
      assert.throws(
        () => resolveE2eDatabaseUrl(),
        /production-like E2E database name/,
      );
    },
  );
});

test("masks credentials in errors and logs", () => {
  const masked = maskCredentialsInUrl(VALID_E2E_URL);
  assert.match(masked, /localhost:5433\/negotiations_e2e/);
  assert.doesNotMatch(masked, /negotiations_password/);
  assert.equal(maskDatabaseName("negotiations_e2e"), "nego***e2e");
});

test("buildE2eServerEnvironment overrides inherited VIDEO_PROVIDER with explicit livekit", () => {
  withEnv(
    {
      E2E_DATABASE_URL: VALID_E2E_URL,
      DATABASE_URL: VALID_DEV_URL,
      VIDEO_PROVIDER: "voximplant",
    },
    () => {
      const env = buildE2eServerEnvironment({
        VIDEO_PROVIDER: "livekit",
      });
      assert.equal(env.VIDEO_PROVIDER, "livekit");
    },
  );
});

test("buildE2eServerEnvironment sets DATABASE_URL to E2E_DATABASE_URL", () => {
  withEnv(
    {
      E2E_DATABASE_URL: VALID_E2E_URL,
      DATABASE_URL: VALID_DEV_URL,
      APP_URL: "http://127.0.0.1:3100",
    },
    () => {
      const env = buildE2eServerEnvironment({
        EXTERNAL_SERVICES_MODE: "mock",
      });

      assert.equal(env.DATABASE_URL, VALID_E2E_URL);
      assert.equal(env.E2E_DATABASE_URL, VALID_E2E_URL);
      assert.equal(env.EXTERNAL_SERVICES_MODE, "mock");
      assert.equal(env.APP_URL, "http://127.0.0.1:3100");
    },
  );
});

test("direct Prisma helper and Playwright webServer receive the same URL", () => {
  withEnv(
    {
      E2E_DATABASE_URL: VALID_E2E_URL,
      DATABASE_URL: VALID_DEV_URL,
    },
    () => {
      const helperUrl = resolveE2eDatabaseUrl();
      const serverEnv = buildE2eServerEnvironment();
      assert.equal(helperUrl, serverEnv.DATABASE_URL);
      assert.equal(helperUrl, serverEnv.E2E_DATABASE_URL);
    },
  );
});
