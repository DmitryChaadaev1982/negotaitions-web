import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { extractPrismaSchema } from "@/lib/prisma-connection-string";

/** Synthetic userinfo fixture; never a real credential. */
const SECRET = "synthetic-fixture-value";

test("PostgreSQL URI with schema passes the schema through", () => {
  assert.equal(
    extractPrismaSchema(
      `postgresql://app:${SECRET}@localhost:5432/negotiations?schema=stage3_13c_final_remediation`,
    ),
    "stage3_13c_final_remediation",
  );
  assert.equal(
    extractPrismaSchema(
      `postgresql://app:${SECRET}@localhost:5432/negotiations?schema=%20custom%20&application_name=x`,
    ),
    "custom",
  );
});

test("PostgreSQL URI without schema keeps the previous no-override behavior", () => {
  assert.equal(
    extractPrismaSchema(`postgresql://app:${SECRET}@localhost:5432/negotiations`),
    undefined,
  );
  assert.equal(
    extractPrismaSchema(
      `postgresql://app:${SECRET}@localhost:5432/negotiations?schema=&sslmode=disable`,
    ),
    undefined,
  );
  assert.equal(
    extractPrismaSchema(
      `postgresql://app:${SECRET}@localhost:5432/negotiations?schema=%20%20`,
    ),
    undefined,
  );
});

test("postgres:// URI is treated as a PostgreSQL URI", () => {
  assert.equal(
    extractPrismaSchema("postgres://localhost:5432/negotiations?schema=alt"),
    "alt",
  );
});

test("libpq keyword/value DSN does not fail and yields no override", () => {
  for (const dsn of [
    `host=localhost port=5432 dbname=negotiations user=app password=${SECRET}`,
    "dbname=negotiations options=-c search_path=stage3_13c_final_remediation",
    "host=/var/run/postgresql dbname=negotiations",
  ]) {
    assert.equal(extractPrismaSchema(dsn), undefined);
  }
});

test("malformed or non-PostgreSQL values fall back to no override", () => {
  for (const malformed of [
    "",
    "   ",
    "://missing-scheme?schema=alt",
    "not a connection string at all",
    "mysql://localhost:3306/negotiations?schema=alt",
    "prisma://accelerate.example/?schema=alt",
  ]) {
    assert.equal(extractPrismaSchema(malformed), undefined);
  }
});

test("schema extraction never reveals connection-string credentials", async () => {
  const schema = extractPrismaSchema(
    `postgresql://app:${SECRET}@localhost:5432/negotiations?schema=owned`,
  );
  assert.equal(schema, "owned");
  assert.ok(!schema.includes(SECRET));
  assert.ok(!schema.includes("app"));
  assert.ok(!schema.includes("localhost"));

  const helperSource = await readFile(
    path.join(process.cwd(), "lib", "prisma-connection-string.ts"),
    "utf8",
  );
  assert.ok(!/console\./.test(helperSource));

  const clientSource = await readFile(
    path.join(process.cwd(), "lib", "prisma.ts"),
    "utf8",
  );
  assert.ok(!/console\./.test(clientSource));
  assert.ok(!clientSource.includes("${connectionString}"));
  assert.match(clientSource, /extractPrismaSchema\(connectionString\)/);
});
