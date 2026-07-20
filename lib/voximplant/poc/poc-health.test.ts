import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildDefaultPocHealthUrl,
  formatLocalHealthFailure,
  POC_HEALTH_PATH,
  POC_HEALTH_PROTOCOL_VERSION,
  POC_HEALTH_SERVICE,
  probePocHealth,
  sanitizeHealthUrlPath,
} from "@/lib/voximplant/poc/poc-health";
import { getPocWorktreeDiagnostic } from "@/lib/voximplant/poc/poc-paths";

function mockResponse(params: {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}): Response {
  return new Response(JSON.stringify(params.body), {
    status: params.status,
    headers: {
      "content-type": "application/json",
      ...(params.headers ?? {}),
    },
  });
}

test("1. application root 307 is irrelevant to POC health path", () => {
  assert.equal(POC_HEALTH_PATH, "/api/poc/voximplant/server-stop/health");
  assert.notEqual(POC_HEALTH_PATH, "/");
  assert.ok(!buildDefaultPocHealthUrl().endsWith("/"));
  assert.match(
    buildDefaultPocHealthUrl(),
    /\/api\/poc\/voximplant\/server-stop\/health$/,
  );
});

test("2. dedicated health endpoint route returns 200 contract when enabled", () => {
  const routePath = join(
    process.cwd(),
    "app/api/poc/voximplant/server-stop/health/route.ts",
  );
  const source = readFileSync(routePath, "utf8");
  assert.match(source, /POC_HEALTH_SERVICE/);
  assert.match(source, /protocolVersion/);
  assert.match(source, /callbackEnabled: true/);
  assert.match(source, /X-Neg-Poc-Worktree-Fingerprint/);
  assert.match(source, /X-Neg-Poc-Build-Id/);
  assert.match(source, /X-Neg-Poc-Callback-Enabled/);
  assert.match(source, /POC_HEALTH_DISABLED/);
  assert.ok(!source.includes("prisma"));
  assert.ok(!source.includes("DATABASE_URL"));
  assert.ok(!source.includes("mediaSessionAccess"));
  assert.ok(!source.includes("getPocStatePath"));
  assert.ok(!source.includes("getPocRepositoryRoot"));
});

test("3. disabled callback maps to POC_HEALTH_CALLBACK_DISABLED", async () => {
  const expected = getPocWorktreeDiagnostic();
  const result = await probePocHealth({
    healthUrl: buildDefaultPocHealthUrl("http://localhost:3000"),
    timeoutMs: 2000,
    expected,
    fetchImpl: (async () =>
      mockResponse({
        status: 404,
        body: {
          ok: false,
          errorCode: "POC_HEALTH_DISABLED",
          service: POC_HEALTH_SERVICE,
          protocolVersion: POC_HEALTH_PROTOCOL_VERSION,
          callbackEnabled: false,
          branchOrBuildId: expected.branchOrBuildId,
          worktreeFingerprint: expected.worktreeFingerprint,
        },
      })) as typeof fetch,
  });
  assert.equal(result.passed, false);
  assert.equal(result.code, "POC_HEALTH_CALLBACK_DISABLED");
  assert.equal(result.diagnostics.healthFailureReason, "POC_HEALTH_CALLBACK_DISABLED");
});

test("4. exact worktree fingerprint passes", async () => {
  const expected = getPocWorktreeDiagnostic();
  const result = await probePocHealth({
    healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
    timeoutMs: 2000,
    expected,
    fetchImpl: (async () =>
      mockResponse({
        status: 200,
        body: {
          ok: true,
          service: POC_HEALTH_SERVICE,
          protocolVersion: POC_HEALTH_PROTOCOL_VERSION,
          callbackEnabled: true,
          branchOrBuildId: expected.branchOrBuildId,
          worktreeFingerprint: expected.worktreeFingerprint,
        },
        headers: {
          "X-Neg-Poc-Worktree-Fingerprint": expected.worktreeFingerprint,
          "X-Neg-Poc-Build-Id": expected.branchOrBuildId,
          "X-Neg-Poc-Callback-Enabled": "yes",
        },
      })) as typeof fetch,
  });
  assert.equal(result.passed, true);
  assert.equal(result.code, "POC_HEALTH_OK");
  assert.equal(result.diagnostics.healthFailureReason, null);
});

test("5. wrong fingerprint fails with POC_HEALTH_WORKTREE_MISMATCH", async () => {
  const expected = getPocWorktreeDiagnostic();
  const result = await probePocHealth({
    healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
    timeoutMs: 2000,
    expected,
    fetchImpl: (async () =>
      mockResponse({
        status: 200,
        body: {
          ok: true,
          service: POC_HEALTH_SERVICE,
          protocolVersion: POC_HEALTH_PROTOCOL_VERSION,
          callbackEnabled: true,
          branchOrBuildId: expected.branchOrBuildId,
          worktreeFingerprint: "deadbeefdeadbeef",
        },
      })) as typeof fetch,
  });
  assert.equal(result.passed, false);
  assert.equal(result.code, "POC_HEALTH_WORKTREE_MISMATCH");
});

test("6. wrong build fails with POC_HEALTH_BUILD_MISMATCH", async () => {
  const expected = getPocWorktreeDiagnostic();
  const result = await probePocHealth({
    healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
    timeoutMs: 2000,
    expected,
    fetchImpl: (async () =>
      mockResponse({
        status: 200,
        body: {
          ok: true,
          service: POC_HEALTH_SERVICE,
          protocolVersion: POC_HEALTH_PROTOCOL_VERSION,
          callbackEnabled: true,
          branchOrBuildId: "wrong/branch",
          worktreeFingerprint: expected.worktreeFingerprint,
        },
      })) as typeof fetch,
  });
  assert.equal(result.passed, false);
  assert.equal(result.code, "POC_HEALTH_BUILD_MISMATCH");
});

test("7. wrong protocol fails with POC_HEALTH_PROTOCOL_MISMATCH", async () => {
  const expected = getPocWorktreeDiagnostic();
  const result = await probePocHealth({
    healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
    timeoutMs: 2000,
    expected,
    fetchImpl: (async () =>
      mockResponse({
        status: 200,
        body: {
          ok: true,
          service: POC_HEALTH_SERVICE,
          protocolVersion: 99,
          callbackEnabled: true,
          branchOrBuildId: expected.branchOrBuildId,
          worktreeFingerprint: expected.worktreeFingerprint,
        },
      })) as typeof fetch,
  });
  assert.equal(result.passed, false);
  assert.equal(result.code, "POC_HEALTH_PROTOCOL_MISMATCH");
});

test("8. malformed body fails with POC_HEALTH_INVALID_BODY", async () => {
  const expected = getPocWorktreeDiagnostic();
  const result = await probePocHealth({
    healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
    timeoutMs: 2000,
    expected,
    fetchImpl: (async () =>
      mockResponse({
        status: 200,
        body: { ok: true },
      })) as typeof fetch,
  });
  assert.equal(result.passed, false);
  assert.equal(result.code, "POC_HEALTH_INVALID_BODY");
});

test("9. timeout fails with POC_HEALTH_TIMEOUT", async () => {
  const expected = getPocWorktreeDiagnostic();
  const result = await probePocHealth({
    healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
    timeoutMs: 50,
    expected,
    fetchImpl: (async (_url, init) => {
      await new Promise<void>((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
      throw new Error("unreachable");
    }) as typeof fetch,
  });
  assert.equal(result.passed, false);
  assert.equal(result.code, "POC_HEALTH_TIMEOUT");
});

test("13. no secret/path/control URL exposed in health helpers", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/poc-health.ts"),
    "utf8",
  );
  assert.ok(!source.includes("DATABASE_URL"));
  assert.ok(!source.includes("CONTROL_SECRET"));
  assert.ok(!source.includes("CALLBACK_SECRET"));
  assert.equal(
    sanitizeHealthUrlPath(
      "https://user:pass@local.negotaitions.ru/api/poc/voximplant/server-stop/health",
    ),
    POC_HEALTH_PATH,
  );
  assert.equal(
    formatLocalHealthFailure("POC_HEALTH_WORKTREE_MISMATCH"),
    "LOCAL_HEALTH_FAILED: POC_HEALTH_WORKTREE_MISMATCH",
  );
});

test("15. default health URL is dedicated POC path not admin/root", () => {
  const url = buildDefaultPocHealthUrl("http://localhost:3000");
  assert.equal(
    url,
    "http://localhost:3000/api/poc/voximplant/server-stop/health",
  );
  assert.ok(!url.includes("/api/admin/health"));
  const tunnel = buildDefaultPocHealthUrl();
  assert.ok(tunnel.includes(POC_HEALTH_PATH));
  assert.ok(tunnel.startsWith("https://local.negotaitions.ru"));
});

test("cli default health derives from app base not admin health", async () => {
  const { parsePocOrchestratorArgs } = await import(
    "@/lib/voximplant/poc/orchestrator/cli-args"
  );
  const previousHealth = process.env.POC_HEALTH_URL;
  const previousPublic = process.env.POC_PUBLIC_BASE_URL;
  delete process.env.POC_HEALTH_URL;
  delete process.env.POC_PUBLIC_BASE_URL;
  try {
    const options = parsePocOrchestratorArgs([]);
    assert.equal(
      options.healthUrl,
      "http://localhost:3000/api/poc/voximplant/server-stop/health",
    );
    const tunnel = parsePocOrchestratorArgs([
      "--public-base-url",
      "https://local.negotaitions.ru",
    ]);
    assert.equal(
      tunnel.healthUrl,
      "https://local.negotaitions.ru/api/poc/voximplant/server-stop/health",
    );
  } finally {
    if (previousHealth === undefined) delete process.env.POC_HEALTH_URL;
    else process.env.POC_HEALTH_URL = previousHealth;
    if (previousPublic === undefined) delete process.env.POC_PUBLIC_BASE_URL;
    else process.env.POC_PUBLIC_BASE_URL = previousPublic;
  }
});
