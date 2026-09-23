import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { validateNewPassword } from "@/lib/auth/password-policy";
import { classifyPasswordVerifier, verifyPassword } from "@/lib/auth/crypto";
import {
  DEMO_FACILITATOR_EMAIL,
  DEMO_SEED_PASSWORD,
  demoSeedCaseTitles,
  runSeed,
  type DemoSeedStore,
  type DemoUserCreate,
  type DemoUserIdentity,
} from "@/prisma/seed-demo";

const DB_USER = "seed_user_secret";
const DB_PASSWORD = "super-secret-db-password";
const BCRYPT_SAMPLE =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const ARGON_SAMPLE =
  "$argon2id$v=19$m=19456,t=4,p=1$c2FsdHNhbHQ$dGFn";

type StoredUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  passwordHash: string;
  credentialGeneration: number;
  passwordChangeRequiredAt: string | null;
  status: string;
  globalRole: string;
};

function postgresUrl(
  host: string,
  port: number | null,
  database: string,
  query = "",
): string {
  const portText = port == null ? "" : `:${port}`;
  return `postgresql://${DB_USER}:${DB_PASSWORD}@${host}${portText}/${database}${query}`;
}

function assertNoSecrets(text: string, label: string) {
  assert.equal(text.includes(DB_PASSWORD), false, label);
  assert.equal(text.includes(DB_USER), false, label);
  assert.equal(text.includes(DEMO_SEED_PASSWORD), false, label);
  assert.equal(text.includes("$argon2"), false, label);
  assert.equal(text.includes("$2a$"), false, label);
  assert.equal(text.includes("$2b$"), false, label);
  assert.equal(text.includes("$2y$"), false, label);
  assert.equal(text.includes("postgresql://"), false, label);
  assert.equal(text.includes("postgres://"), false, label);
}

function createHarness(initial: StoredUser | null) {
  let user = initial;
  const calls = {
    createClient: 0,
    find: 0,
    update: 0,
    createUser: 0,
    deleteCases: 0,
    createCase: 0,
    disconnect: 0,
  };
  const updatePayloads: DemoUserIdentity[] = [];
  const createPayloads: DemoUserCreate[] = [];
  const deleteTitles: string[][] = [];
  const logs: string[] = [];

  const store: DemoSeedStore = {
    async findDemoUser() {
      calls.find += 1;
      return user ? { id: user.id, email: user.email } : null;
    },
    async updateDemoUser(_email, data) {
      calls.update += 1;
      updatePayloads.push(data);
      assert.deepEqual(Object.keys(data).sort(), ["name", "role"]);
      if (!user) throw new Error("missing user");
      user = { ...user, name: data.name, role: data.role };
    },
    async createDemoUser(data) {
      calls.createUser += 1;
      createPayloads.push(data);
      assert.equal(user, null);
      assert.deepEqual(Object.keys(data).sort(), ["email", "name", "passwordHash", "role"]);
      user = {
        id: "created-demo-user",
        email: data.email,
        name: data.name,
        role: data.role,
        passwordHash: data.passwordHash,
        credentialGeneration: 0,
        passwordChangeRequiredAt: null,
        status: "PENDING_APPROVAL",
        globalRole: "USER",
      };
      return { id: user.id, email: user.email };
    },
    async deleteDemoCases(_facilitatorId, titles) {
      calls.deleteCases += 1;
      deleteTitles.push([...titles]);
    },
    async createDemoCase() {
      calls.createCase += 1;
    },
    async disconnect() {
      calls.disconnect += 1;
    },
  };

  return {
    calls,
    updatePayloads,
    createPayloads,
    deleteTitles,
    logs,
    user: () => user,
    async run(databaseUrl: string | undefined) {
      return runSeed({
        databaseUrl,
        createClient: () => {
          calls.createClient += 1;
          return store;
        },
        log: (line) => {
          logs.push(line);
        },
      });
    },
  };
}

async function refusalMessage(databaseUrl: string | undefined): Promise<string> {
  const harness = createHarness(null);
  try {
    await harness.run(databaseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(harness.calls.createClient, 0);
    assert.equal(harness.calls.find, 0);
    assert.equal(harness.calls.disconnect, 0);
    assert.equal(harness.logs.some((line) => line.includes("Seed target accepted")), false);
    return message;
  }
  throw new Error("seed was accepted");
}

const PRESERVED_URL = postgresUrl("localhost", 5432, "negotiations");

test("SEED-T01 unsafe database targets refuse before mutation", async () => {
  const targets: Array<{ label: string; url: string | undefined; detail: string }> = [
    {
      label: "preserved-localhost",
      url: PRESERVED_URL,
      detail: "preserved development database localhost:5432/negotiations",
    },
    {
      label: "preserved-ipv4",
      url: postgresUrl("127.0.0.1", 5432, "negotiations"),
      detail: "preserved development database localhost:5432/negotiations",
    },
    {
      label: "preserved-ipv6",
      url: postgresUrl("[::1]", 5432, "Negotiations"),
      detail: "preserved development database localhost:5432/negotiations",
    },
    {
      label: "preserved-default-port",
      url: postgresUrl("localhost", null, "negotiations"),
      detail: "preserved development database localhost:5432/negotiations",
    },
    {
      label: "preserved-bind-all",
      url: postgresUrl("0.0.0.0", 5432, "negotiations"),
      detail: "preserved development database localhost:5432/negotiations",
    },
    {
      label: "preserved-postgres-scheme",
      url: `postgres://${DB_USER}:${DB_PASSWORD}@localhost:5432/negotiations`,
      detail: "preserved development database localhost:5432/negotiations",
    },
    {
      label: "canonical-name-other-port",
      url: postgresUrl("localhost", 5433, "negotiations"),
      detail: "canonical development database name",
    },
    {
      label: "yandex-host",
      url: postgresUrl("rc1b-example.mdb.yandexcloud.net", 6432, "negotiations_e2e"),
      detail: "production-like database host",
    },
    {
      label: "production-host-label",
      url: postgresUrl("prod-db.internal", 5432, "negotiations_e2e"),
      detail: "production-like database host",
    },
    {
      label: "production-database-name",
      url: postgresUrl("localhost", 5432, "negotaitions_prod"),
      detail: "production-like database name",
    },
    {
      label: "production-database-spelling",
      url: postgresUrl("localhost", 5433, "negotiations_prod"),
      detail: "production-like database name",
    },
    {
      label: "rehearsal-name",
      url: postgresUrl("localhost", 5432, "negotiations_rehearsal"),
      detail: "not an approved disposable seed target",
    },
    {
      label: "backup-clone",
      url: postgresUrl("127.0.0.1", 5432, "negotiations_backup"),
      detail: "not an approved disposable seed target",
    },
    {
      label: "remote-disposable",
      url: postgresUrl("db.example.com", 5433, "negotiations_e2e"),
      detail: "remote database host",
    },
    {
      label: "missing-url",
      url: undefined,
      detail: "DATABASE_URL is not set",
    },
    {
      label: "blank-url",
      url: "   ",
      detail: "DATABASE_URL is not set",
    },
    {
      label: "keyword-dsn",
      url: `host=localhost port=5433 dbname=negotiations_e2e user=${DB_USER} password=${DB_PASSWORD}`,
      detail: "not a parseable PostgreSQL connection URI",
    },
    {
      label: "wrong-protocol",
      url: `http://${DB_USER}:${DB_PASSWORD}@localhost:5433/negotiations_e2e`,
      detail: "must be a PostgreSQL connection URI",
    },
  ];

  for (const target of targets) {
    const message = await refusalMessage(target.url);
    assert.equal(message.includes("Refusing seed:"), true, target.label);
    assert.equal(message.includes(target.detail), true, target.label);
    assertNoSecrets(message, target.label);
  }
});

test("SEED-T02 environment mode does not authorize an unsafe target", async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "development";
    const developed = await refusalMessage(PRESERVED_URL);
    assert.equal(developed.includes("preserved development database"), true);
    assertNoSecrets(developed, "development");

    process.env.NODE_ENV = "production";
    const produced = await refusalMessage(PRESERVED_URL);
    assert.equal(produced.includes("preserved development database"), true);
    assertNoSecrets(produced, "production");
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("SEED-T03 approved local disposable targets may proceed", async () => {
  const previous = process.env.NODE_ENV;
  const targets = [
    postgresUrl("localhost", 5433, "negotiations_e2e"),
    postgresUrl("127.0.0.1", 5432, "negotiations_test"),
    postgresUrl("[::1]", 5433, "negotiations_testing"),
    postgresUrl("0.0.0.0", 5433, "negotiations_e2e"),
    `postgresql://localhost:5433/negotiations_e2e`,
  ];
  try {
    process.env.NODE_ENV = "production";
    for (const [index, url] of targets.entries()) {
      const harness = createHarness({
        id: `existing-${index}`,
        email: DEMO_FACILITATOR_EMAIL,
        name: "Old Name",
        role: "PARTICIPANT",
        passwordHash: "stored-verifier-do-not-replace",
        credentialGeneration: 4,
        passwordChangeRequiredAt: "2020-01-01T00:00:00.000Z",
        status: "ACTIVE",
        globalRole: "ADMIN",
      });
      const result = await harness.run(url);
      assert.equal(result.userCreated, false);
      assert.equal(harness.calls.createClient, 1);
      assert.equal(harness.calls.createUser, 0);
      assert.equal(harness.user()?.passwordHash, "stored-verifier-do-not-replace");
      assert.equal(harness.logs.some((line) => line.startsWith("Seed target accepted:")), true);
      assertNoSecrets(harness.logs.join("\n"), `proceed-${index}`);
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("Q01-Q10 query parameters cannot retarget the authorized seed database", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRemoteFlag = process.env.E2E_ALLOW_REMOTE_DATABASE;
  const previousPgPort = process.env.PGPORT;
  const approved = postgresUrl("localhost", 5433, "negotiations_e2e");
  const overrides: Array<{ label: string; url: string; code: string }> = [
    {
      label: "Q03-host",
      url: postgresUrl("localhost", 5433, "negotiations_e2e", "?host=remote.example.com"),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q04-port",
      url: postgresUrl("localhost", 5433, "negotiations_e2e", "?port=6432"),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q05-host-port",
      url: postgresUrl(
        "localhost",
        5433,
        "negotiations_e2e",
        "?host=remote.example.com&port=6432",
      ),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q09-duplicate-host",
      url: postgresUrl(
        "localhost",
        5433,
        "negotiations_e2e",
        "?host=remote.example.com&host=10.1.2.3",
      ),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q09-encoded-host",
      url: postgresUrl(
        "localhost",
        5433,
        "negotiations_e2e",
        "?host=remote%2Eexample%2Ecom",
      ),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q09-host-case",
      url: postgresUrl("localhost", 5433, "negotiations_e2e", "?HOST=remote.example.com"),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q09-encoded-name",
      url: postgresUrl("localhost", 5433, "negotiations_e2e", "?%68ost=remote.example.com"),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q09-hostaddr",
      url: postgresUrl("localhost", 5433, "negotiations_e2e", "?hostaddr=10.1.2.3"),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q09-hash",
      url: `${approved}#host=remote.example.com`,
      code: "TARGET_OVERRIDE_NOT_ALLOWED",
    },
    {
      label: "Q09-sslmode",
      url: postgresUrl("localhost", 5433, "negotiations_e2e", "?sslmode=disable"),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
    {
      label: "Q10-schema",
      url: postgresUrl("localhost", 5433, "negotiations_e2e", "?schema=public"),
      code: "UNSUPPORTED_QUERY_PARAMETER",
    },
  ];

  try {
    process.env.NODE_ENV = "development";
    process.env.E2E_ALLOW_REMOTE_DATABASE = "1";

    const harness = createHarness({
      id: "query-approved",
      email: DEMO_FACILITATOR_EMAIL,
      name: "Old Name",
      role: "PARTICIPANT",
      passwordHash: "stored-verifier-do-not-replace",
      credentialGeneration: 4,
      passwordChangeRequiredAt: "2020-01-01T00:00:00.000Z",
      status: "ACTIVE",
      globalRole: "ADMIN",
    });
    const allowed = await harness.run(approved);
    assert.equal(allowed.userCreated, false, "Q01");
    assert.equal(harness.calls.createClient, 1, "Q01");
    const accepted = harness.logs.join("\n");
    assert.equal(accepted.includes("host=localhost, port=5433"), true, "Q01");
    assert.equal(accepted.includes("remote.example.com"), false, "Q06");
    assertNoSecrets(accepted, "Q01");

    const preserved = await refusalMessage(PRESERVED_URL);
    assert.equal(preserved.includes("preserved development database"), true, "Q02");
    assertNoSecrets(preserved, "Q02");

    for (const override of overrides) {
      const harnessForOverride = createHarness(null);
      let message = "";
      try {
        await harnessForOverride.run(override.url);
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      assert.equal(harnessForOverride.calls.createClient, 0, override.label);
      assert.equal(
        harnessForOverride.logs.some((line) => line.includes("Seed target accepted")),
        false,
        override.label,
      );
      assert.equal(
        harnessForOverride.logs.some((line) => line.includes("host=localhost")),
        false,
        override.label,
      );
      assert.equal(message.includes(override.code), true, override.label);
      assert.equal(message.includes("localhost"), false, override.label);
      assert.equal(message.includes("remote.example.com"), false, override.label);
      assert.equal(message.includes("6432"), false, override.label);
      assertNoSecrets(message, override.label);
    }

    process.env.PGPORT = "6432";
    const portOverride = await refusalMessage(postgresUrl("localhost", null, "negotiations_e2e"));
    assert.equal(portOverride.includes("TARGET_OVERRIDE_NOT_ALLOWED"), true, "PGPORT");
    assert.equal(portOverride.includes("6432"), false, "PGPORT");
    assertNoSecrets(portOverride, "PGPORT");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousRemoteFlag === undefined) delete process.env.E2E_ALLOW_REMOTE_DATABASE;
    else process.env.E2E_ALLOW_REMOTE_DATABASE = previousRemoteFlag;
    if (previousPgPort === undefined) delete process.env.PGPORT;
    else process.env.PGPORT = previousPgPort;
  }
});

test("SEED-T04 SEED-T05 new seeded credential uses canonical policy and Argon2id", async () => {
  const policy = validateNewPassword({ password: DEMO_SEED_PASSWORD });
  assert.equal(policy.ok, true);

  const harness = createHarness(null);
  const result = await harness.run(postgresUrl("localhost", 5433, "negotiations_e2e"));
  assert.equal(result.userCreated, true);
  assert.equal(result.email, DEMO_FACILITATOR_EMAIL);
  assert.equal(harness.calls.createUser, 1);
  assert.equal(harness.calls.update, 0);

  const created = harness.createPayloads[0];
  assert.ok(created);
  assert.equal(Object.hasOwn(created, "credentialGeneration"), false);
  assert.equal(Object.hasOwn(created, "passwordChangeRequiredAt"), false);
  assert.equal(Object.hasOwn(created, "status"), false);
  assert.equal(classifyPasswordVerifier(created.passwordHash), "argon2id-current");
  assert.equal(created.passwordHash.includes("$2a$"), false);
  assert.equal(created.passwordHash.includes("$2b$"), false);
  assert.equal(await verifyPassword(DEMO_SEED_PASSWORD, created.passwordHash), true);
  assert.equal(await verifyPassword(`${DEMO_SEED_PASSWORD}-no`, created.passwordHash), false);
  assert.equal(harness.user()?.credentialGeneration, 0);
  assert.equal(harness.logs.some((line) => line.includes("database=nego***e2e")), true);
  assert.equal(harness.logs.some((line) => line.includes("negotiations_e2e")), false);
  assertNoSecrets(harness.logs.join("\n"), "new-user-logs");
});

test("SEED-T06 SEED-T07 SEED-T10 rerun preserves credentials and refreshes demo cases", async () => {
  const harness = createHarness({
    id: "existing-demo-user",
    email: DEMO_FACILITATOR_EMAIL,
    name: "Old Name",
    role: "PARTICIPANT",
    passwordHash: "stored-verifier-do-not-replace",
    credentialGeneration: 4,
    passwordChangeRequiredAt: "2020-01-01T00:00:00.000Z",
    status: "ACTIVE",
    globalRole: "ADMIN",
  });
  const url = postgresUrl("localhost", 5433, "negotiations_e2e");
  const titles = demoSeedCaseTitles();

  const first = await harness.run(url);
  const second = await harness.run(url);

  assert.equal(first.userCreated, false);
  assert.equal(second.userCreated, false);
  assert.equal(harness.calls.createUser, 0);
  assert.equal(harness.calls.update, 2);
  assert.equal(harness.calls.deleteCases, 2);
  assert.equal(harness.calls.createCase, titles.length * 2);
  assert.equal(harness.calls.disconnect, 2);
  assert.deepEqual(harness.deleteTitles[0], titles);
  assert.deepEqual(harness.deleteTitles[1], titles);
  for (const payload of harness.updatePayloads) {
    assert.deepEqual(Object.keys(payload).sort(), ["name", "role"]);
    assert.equal(payload.name, "Demo Facilitator");
    assert.equal(payload.role, "FACILITATOR");
  }

  const stored = harness.user();
  assert.ok(stored);
  assert.equal(stored.passwordHash, "stored-verifier-do-not-replace");
  assert.equal(stored.credentialGeneration, 4);
  assert.equal(stored.passwordChangeRequiredAt, "2020-01-01T00:00:00.000Z");
  assert.equal(stored.status, "ACTIVE");
  assert.equal(stored.globalRole, "ADMIN");
  assert.equal(stored.name, "Demo Facilitator");
  assert.equal(harness.logs.filter((line) => line.includes("Seed user already exists")).length, 2);
  assert.equal(harness.logs.filter((line) => line === "Cases created: 2").length, 2);
  assertNoSecrets(harness.logs.join("\n"), "rerun-logs");
});

test("SEED-T08 SEED-T09 seed failure output redacts passwords, hashes, and database URLs", async () => {
  const url = postgresUrl("localhost", 5433, "negotiations_e2e");
  const harness = createHarness(null);
  const store: DemoSeedStore = {
    async findDemoUser() {
      return null;
    },
    async updateDemoUser() {
      throw new Error("update should not run");
    },
    async createDemoUser(data) {
      throw new Error(
        `write failed ${url} user=${DB_USER} password=${DB_PASSWORD} ${data.passwordHash} ${DEMO_SEED_PASSWORD} ${BCRYPT_SAMPLE} ${ARGON_SAMPLE}`,
      );
    },
    async deleteDemoCases() {
      throw new Error("cases should not run");
    },
    async createDemoCase() {
      throw new Error("cases should not run");
    },
    async disconnect() {
      harness.calls.disconnect += 1;
    },
  };

  let message = "";
  try {
    await runSeed({
      databaseUrl: url,
      createClient: () => store,
      log: (line) => {
        harness.logs.push(line);
      },
    });
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }

  assert.equal(message.includes("Seed failed:"), true);
  assert.equal(message.includes("[REDACTED_DATABASE_URL]"), true);
  assert.equal(message.includes("[REDACTED_PASSWORD]"), true);
  assert.equal(message.includes("[REDACTED_PASSWORD_HASH]"), true);
  assert.equal(harness.calls.disconnect, 1);
  assertNoSecrets(message, "failure-message");
  assertNoSecrets(harness.logs.join("\n"), "failure-logs");
  assert.equal(harness.logs.some((line) => line.includes("Seed completed successfully.")), false);
});

test("seed command sources do not consult environment mode or legacy bcrypt seeding", () => {
  const root = process.cwd();
  const files = [
    "lib/db/seed-target-safety.ts",
    "prisma/seed-demo.ts",
    "prisma/seed.ts",
  ];
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.equal(source.includes("NODE_ENV"), false, file);
    assert.equal(source.includes("E2E_ALLOW_REMOTE_DATABASE"), false, file);
    assert.equal(source.includes("bcrypt"), false, file);
    assert.equal(source.includes("demo1234"), false, file);
    assert.equal(source.includes("@/lib/prisma"), false, file);
    assert.equal(source.includes("@/lib/demo-user"), false, file);
  }

  const cli = readFileSync(path.join(root, "prisma/seed.ts"), "utf8");
  assert.equal(cli.includes("runSeed("), true);
  assert.equal(cli.includes("databaseUrl: process.env.DATABASE_URL"), true);
  assert.equal(cli.includes("createClient: createPrismaClient"), true);
  assert.equal(cli.includes("passwordHash"), false);

  const demo = readFileSync(path.join(root, "prisma/seed-demo.ts"), "utf8");
  assert.equal(demo.includes("assertNewPasswordPolicy"), true);
  assert.equal(demo.includes("hashPassword"), true);
  assert.equal(demo.includes("console."), false);
});
