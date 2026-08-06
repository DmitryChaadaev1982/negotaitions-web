import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LOCAL_SERVER_ACTION_ORIGINS,
  PRODUCTION_SERVER_ACTION_ORIGINS,
  resolveServerActionAllowedOrigins,
  resolveServerActionAllowedOriginsFromEnv,
} from "@/lib/config/server-action-origins";

const LOCAL_ENTRIES = [
  "local.negotaitions.ru",
  "localhost:3000",
  "localhost:3100",
  "127.0.0.1:3000",
  "127.0.0.1:3100",
];

function productionOrigins(allowLocal?: string): string[] {
  void allowLocal;
  return resolveServerActionAllowedOrigins({
    nodeEnv: "production",
  });
}

test("the production build trusts only the reviewed production hostname", () => {
  assert.deepEqual(productionOrigins(), ["negotaitions.ru"]);
  assert.deepEqual(
    [...PRODUCTION_SERVER_ACTION_ORIGINS],
    ["negotaitions.ru"],
  );
});

test("the production build excludes every local and managed-test origin", () => {
  const origins = productionOrigins();
  for (const local of LOCAL_ENTRIES) {
    assert.ok(
      !origins.includes(local),
      `production allowlist must not contain ${local}`,
    );
  }
  assert.ok(!origins.includes("local.negotaitions.ru"));
  assert.ok(!origins.some((origin) => origin.startsWith("localhost")));
  assert.ok(!origins.some((origin) => origin.startsWith("127.0.0.1")));
});

test("production ignores the removed local-origin switch and similar overrides", () => {
  for (const value of [
    undefined,
    "",
    "  ",
    "false",
    "0",
    "TRUE",
    "True",
    "yes",
    "1",
    "true ",
    "truthy",
  ]) {
    assert.deepEqual(productionOrigins(value), ["negotaitions.ru"]);
    assert.deepEqual(
      resolveServerActionAllowedOriginsFromEnv({
        NODE_ENV: "production",
        NEXT_BUILD_ALLOW_LOCAL_SERVER_ACTION_ORIGINS: value,
        NEXT_BUILD_ALLOW_LOCAL_SERVER_ACTION_ORIGINS_V2: "true",
        ALLOW_LOCAL_SERVER_ACTION_ORIGINS: "true",
      } as NodeJS.ProcessEnv),
      ["negotaitions.ru"],
    );
  }
});

test("development and managed-test builds permit only the exact required local entries", () => {
  for (const nodeEnv of ["development", "test", undefined]) {
    const origins = resolveServerActionAllowedOrigins({
      nodeEnv,
    });
    assert.deepEqual(origins, [
      ...PRODUCTION_SERVER_ACTION_ORIGINS,
      ...LOCAL_ENTRIES,
    ]);
  }
  assert.deepEqual([...LOCAL_SERVER_ACTION_ORIGINS], LOCAL_ENTRIES);
});

test("no wildcard or deceptive hostname is ever emitted", () => {
  const everyOrigin = [
    ...productionOrigins(),
    ...productionOrigins("true"),
    ...resolveServerActionAllowedOrigins({
      nodeEnv: "development",
    }),
  ];
  for (const origin of everyOrigin) {
    assert.ok(!origin.includes("*"), `wildcard origin emitted: ${origin}`);
    assert.ok(!origin.includes("://"), `scheme emitted: ${origin}`);
    assert.ok(!origin.includes("/"), `path emitted: ${origin}`);
    assert.ok(!origin.includes(" "), `whitespace emitted: ${origin}`);
  }
  // Deceptive hostnames that merely contain the production name are absent.
  for (const deceptive of [
    "negotaitions.ru.evil.example",
    "evil-negotaitions.ru",
    "negotaitions.ru:3000",
    "www.negotaitions.ru",
    "*.negotaitions.ru",
  ]) {
    assert.ok(!everyOrigin.includes(deceptive));
  }
});

test("the allowlist is read from the build environment, never from a request", () => {
  const source = readFileSync("lib/config/server-action-origins.ts", "utf8");
  assert.match(source, /parseServerRuntimeSetting\("NODE_ENV", env\)/);
  assert.doesNotMatch(source, /process\s*\.\s*env/);
  // No request-scoped input may reach the allowlist.
  for (const forbidden of [
    "x-forwarded",
    "headers",
    "Request",
    "cookies",
    "referer",
    "req.",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `origin allowlist must not consult ${forbidden}`,
    );
  }
});

test("a browser-supplied forwarded host cannot inject trust", () => {
  const origins = resolveServerActionAllowedOriginsFromEnv({
    NODE_ENV: "production",
    "x-forwarded-host": "attacker.example",
    HTTP_X_FORWARDED_HOST: "attacker.example",
    HTTP_HOST: "attacker.example",
    HTTP_ORIGIN: "https://attacker.example",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(origins, ["negotaitions.ru"]);

  // The removed switch cannot be forged through a header-shaped key either.
  assert.deepEqual(
    resolveServerActionAllowedOriginsFromEnv({
      NODE_ENV: "production",
      HTTP_NEXT_BUILD_ALLOW_LOCAL_SERVER_ACTION_ORIGINS: "true",
    } as NodeJS.ProcessEnv),
    ["negotaitions.ru"],
  );
});

test("next.config wires Server Action origins only through the reviewed resolver", () => {
  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /resolveServerActionAllowedOriginsFromEnv\(\)/);

  const serverActions = config.slice(
    config.indexOf("serverActions"),
    config.indexOf("serverExternalPackages"),
  );
  for (const local of LOCAL_ENTRIES) {
    assert.ok(
      !serverActions.includes(local),
      `next.config still hard-codes ${local} as a Server Action origin`,
    );
  }
  // allowedDevOrigins is a dev-server asset setting, not Server Action trust,
  // and must stay gated behind the development branch.
  assert.match(config, /allowedDevOrigins: isDevelopment/);
});
