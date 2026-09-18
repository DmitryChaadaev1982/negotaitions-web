import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * `tsconfig.json` type-checks every `**\/*.ts`, and `next build` fails on an
 * import specifier that still carries a `.ts` extension because
 * `allowImportingTsExtensions` is off. Keep dynamic imports extensionless.
 */
const SOURCE_GLOBS = [
  "instrumentation.ts",
  "app/**/*.ts",
  "app/**/*.tsx",
  "components/**/*.ts",
  "components/**/*.tsx",
  "lib/**/*.ts",
  "lib/**/*.tsx",
  "scripts/**/*.ts",
  "tests/**/*.ts",
  "prisma/**/*.ts",
];

const TS_EXTENSION_IMPORT = /import\(\s*(?:\/\*[^*]*\*\/\s*)*["'`][^"'`]+\.tsx?["'`]/gu;

function sourceFiles() {
  const files = new Set();
  for (const pattern of SOURCE_GLOBS) {
    for (const file of globSync(pattern)) {
      const normalized = file.replace(/\\/gu, "/");
      if (normalized.includes("/node_modules/")) continue;
      if (normalized.startsWith("app/generated/")) continue;
      files.add(normalized);
    }
  }
  return [...files].sort();
}

test("no build-graph source uses a dynamic import specifier ending in .ts", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const contents = readFileSync(file, "utf8");
    for (const match of contents.matchAll(TS_EXTENSION_IMPORT)) {
      offenders.push(`${file}: ${match[0].replace(/\s+/gu, " ")}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Use the extensionless specifier instead:\n${offenders.join("\n")}`,
  );
});

test("the UAT launcher still resolves its live harness module", () => {
  const launcher = readFileSync("scripts/uat-enhancement-large.ts", "utf8");
  const specifiers = [...launcher.matchAll(/import\(\s*["'`]([^"'`]+)["'`]\s*\)/gu)].map(
    (match) => match[1],
  );
  assert.ok(specifiers.length >= 3, "expected the launcher to lazy-load the live harness");
  for (const specifier of specifiers) {
    assert.doesNotMatch(specifier, /\.tsx?$/u);
  }
  assert.ok(specifiers.includes("../tests/e2e/helpers/large-realistic-uat-live"));
});

test("instrumentation keeps Node-only dependencies out of the Edge graph", () => {
  const instrumentation = readFileSync("instrumentation.ts", "utf8");
  const code = instrumentation.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
  assert.doesNotMatch(code, /^import .*node:/mu);
  assert.doesNotMatch(code, /process\.cwd\(/u);
  assert.match(code, /process\.env\.NEXT_RUNTIME === "nodejs"/u);
  assert.match(code, /await import\("\.\/lib\/instrumentation\/node-runtime"\)/u);

  const nodeRuntime = readFileSync("lib/instrumentation/node-runtime.ts", "utf8");
  assert.match(nodeRuntime, /NODE_ENV[^\n]*production/u);
});

test("native UAT observer file-URL graph does not use tsconfig path aliases", () => {
  const observer = readFileSync("tests/e2e/helpers/large-realistic-uat-provider-observe.ts", "utf8");
  const runtimeImports = observer
    .replace(/^import\s+type[\s\S]*?;$/gmu, "")
    .replace(/^import\s+\{[^}]*\}\s+from\s+["'][^"']+["'];$/gmu, (statement) =>
      statement.includes("import type") ? "" : statement,
    );
  assert.doesNotMatch(observer, /from\s+["']@\//u);
  assert.doesNotMatch(observer, /import\(\s*["']@\//u);
  assert.doesNotMatch(runtimeImports, /from\s+["']\.[^"']+["']/u);
  assert.match(observer, /provider-calls\.jsonl/u);
  assert.match(observer, /\.debug\/large-realistic-uat/u);

  const constants = readFileSync("tests/e2e/helpers/large-realistic-uat-constants.ts", "utf8");
  assert.match(constants, /LARGE_REALISTIC_UAT_PROVIDER_CALLS_FILE = "provider-calls\.jsonl"/u);
  assert.match(constants, /LARGE_REALISTIC_UAT_REPORT_DIR = "\.debug\/large-realistic-uat"/u);

  const nodeRuntime = readFileSync("lib/instrumentation/node-runtime.ts", "utf8");
  assert.doesNotMatch(nodeRuntime, /from\s+["']@\//u);
  assert.match(nodeRuntime, /pathToFileURL/u);
  assert.match(nodeRuntime, /webpackIgnore: true/u);
  assert.match(nodeRuntime, /turbopackIgnore: true/u);
  assert.match(nodeRuntime, /from "\.\.\/services\/transcript-enhancement-provider-observation"/u);
});
