import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GET } from "./route";

const CANONICAL_PATH = "/api/health";
const FORBIDDEN_BODY = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "password",
  "secret",
  "process.env",
  "envGroups",
  "recentEvents",
  "voximplant",
  "usage",
  "127.0.0.1:3300",
  "172.29.172.1",
];

async function listenLocal(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url.split("?")[0] === CANONICAL_PATH) {
      const response = await GET();
      const body = Buffer.from(await response.arrayBuffer());
      res.statusCode = response.status;
      for (const [name, value] of response.headers.entries()) {
        res.setHeader(name, value);
      }
      res.end(body);
      return;
    }
    if (url.split("?")[0] === CANONICAL_PATH) {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("local health fixture did not bind a TCP port");
  }
  return {
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

test("H1 canonical health route exists and exports GET only", () => {
  const source = readFileSync("app/api/health/route.ts", "utf8");
  assert.match(source, /export async function GET\(/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)\(/);
  assert.doesNotMatch(source, /apiRequireAdminUser|admin-health|prisma/);
});

test("H2 GET returns 200 with the existing health response convention", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(payload, { status: "ok" });
});

test("H3 response contains no secrets or internal diagnostics", async () => {
  const response = await GET();
  const text = await response.text();
  for (const forbidden of FORBIDDEN_BODY) {
    assert.doesNotMatch(text, new RegExp(forbidden, "i"), forbidden);
  }
  assert.equal(Object.keys(JSON.parse(text)).join(","), "status");
});

test("H4 non-GET methods are not implemented on the route module", async () => {
  const exported = await import("./route");
  assert.equal("POST" in exported, false);
  assert.equal("PUT" in exported, false);
  assert.equal("DELETE" in exported, false);
});

test("H2/H4 local HTTP fixture GET 127.0.0.1 returns 200 and POST is 405", async () => {
  const fixture = await listenLocal();
  try {
    const url = `http://127.0.0.1:${fixture.port}${CANONICAL_PATH}`;
    const get = await fetch(url);
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), { status: "ok" });
    const post = await fetch(url, { method: "POST" });
    assert.equal(post.status, 405);
  } finally {
    await fixture.close();
  }
});

test("H7 admin health remains a separate authenticated diagnostic route", () => {
  const publicSource = readFileSync("app/api/health/route.ts", "utf8");
  const adminSource = readFileSync("app/api/admin/health/route.ts", "utf8");
  assert.match(adminSource, /apiRequireAdminUser/);
  assert.match(adminSource, /createAdminHealthGet/);
  assert.doesNotMatch(publicSource, /apiRequireAdminUser|createAdminHealthGet|getEnvironmentConfigStatus/);
  assert.doesNotMatch(adminSource, /export async function GET\(\) \{\s*return NextResponse\.json\(\s*\{\s*status:\s*"ok"/);
});
