import assert from "node:assert/strict";
import test from "node:test";

import type { ServerRuntimeSetting } from "@/lib/config/server-runtime-settings";
import {
  validateRuntimeSettingRegistry,
  verifyRuntimeConfiguration,
  type RuntimeConfigSource,
} from "../../scripts/verify-runtime-config-drift";

function fixture(sourceText: string): RuntimeConfigSource[] {
  return [{ fileName: "fixture.ts", sourceText }];
}

function fixtureSetting(
  key = "FIXTURE_SETTING",
): Record<string, ServerRuntimeSetting> {
  return {
    [key]: {
      key,
      featureArea: "Fixture",
      ownerModules: ["fixture.ts"],
      parser: { category: "string" },
      classification: "deployment",
      secret: false,
      applicability: "always",
      required: "never",
      diagnostics: {
        group: "Fixture",
        label: key,
        description: "Fixture setting.",
        representation: "value",
      },
    },
  };
}

for (const [label, sourceText] of [
  ["dot access", "const value = process.env.FIXTURE_SETTING;"],
  ["bracket access", 'const value = process.env["FIXTURE_SETTING"];'],
  ["destructuring", "const { FIXTURE_SETTING } = process.env;"],
  ["process.env alias", "const env = process.env; const value = env.FIXTURE_SETTING;"],
  ["dynamic key", "const key = 'FIXTURE_SETTING'; const value = process.env[key];"],
] as const) {
  test(`AST verifier rejects ${label}`, () => {
    const issues = verifyRuntimeConfiguration({
      sources: fixture(sourceText),
      registry: {},
    });
    assert.ok(issues.some((issue) => issue.code === "DIRECT_ENV_ACCESS"));
  });
}

test("AST verifier rejects helper-mediated dynamic accessor reads", () => {
  const issues = verifyRuntimeConfiguration({
    sources: fixture(`
      import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";
      const read = (key: string) => parseServerRuntimeSetting(key);
      read("FIXTURE_SETTING");
    `),
    registry: fixtureSetting(),
  });
  assert.ok(issues.some((issue) => issue.code === "DYNAMIC_SETTING_KEY"));
});

test("AST verifier rejects an unregistered accessor key", () => {
  const issues = verifyRuntimeConfiguration({
    sources: fixture(`
      import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";
      parseServerRuntimeSetting("UNREGISTERED_SETTING");
    `),
    registry: {},
  });
  assert.ok(issues.some((issue) => issue.code === "UNREGISTERED_SETTING"));
});

test("AST verifier rejects an unused registry entry", () => {
  const issues = verifyRuntimeConfiguration({
    sources: fixture("export const nothing = true;"),
    registry: fixtureSetting(),
  });
  assert.ok(issues.some((issue) => issue.code === "UNUSED_REGISTRY_ENTRY"));
});

test("registry validation rejects an unclassified secret", () => {
  const malformed = fixtureSetting();
  malformed.FIXTURE_SETTING = {
    ...malformed.FIXTURE_SETTING,
    parser: { category: "secret" },
    secret: undefined as unknown as boolean,
  };
  const issues = validateRuntimeSettingRegistry(malformed);
  assert.ok(issues.some((issue) => issue.code === "INVALID_REGISTRY_ENTRY"));
});

test("registry validation rejects deployment defaults and test scaffolding", () => {
  const withDefault = fixtureSetting();
  withDefault.FIXTURE_SETTING = {
    ...withDefault.FIXTURE_SETTING,
    parser: { category: "string", defaultValue: "production-shaped-value" },
  };
  assert.ok(
    validateRuntimeSettingRegistry(withDefault).some(
      (issue) => issue.code === "INVALID_REGISTRY_ENTRY",
    ),
  );

  const testOnly = fixtureSetting();
  testOnly.FIXTURE_SETTING = {
    ...testOnly.FIXTURE_SETTING,
    classification: "test_scaffolding",
  };
  assert.ok(
    validateRuntimeSettingRegistry(testOnly).some(
      (issue) => issue.code === "INVALID_REGISTRY_ENTRY",
    ),
  );
});

test("AST verifier accepts a registered literal accessor read", () => {
  const issues = verifyRuntimeConfiguration({
    sources: fixture(`
      import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";
      export const value = parseServerRuntimeSetting("FIXTURE_SETTING");
    `),
    registry: fixtureSetting(),
  });
  assert.deepEqual(issues, []);
});
