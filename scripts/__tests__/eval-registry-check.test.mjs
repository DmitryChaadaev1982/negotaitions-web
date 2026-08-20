import assert from "node:assert/strict";
import test from "node:test";

import {
  checkEvalRegistry,
  isLiteralEvidencePath,
  parseRegistryJson,
  validateRegistryDocument,
} from "../eval-registry-lib.mjs";

function validEval(overrides = {}) {
  return {
    id: "EVAL-PP-EXAMPLE-STATE",
    invariant: "Example invariant.",
    risk: "LOW",
    evalType: "STATE",
    fixtureType: "UNIT",
    expectedDomainResult: "domain holds",
    expectedUiResult: null,
    automation: "AUTOMATED",
    transitionKind: "STATIC",
    historicalCohort: null,
    requirements: ["PT-00"],
    providerCalls: false,
    productionSafe: true,
    evidence: ["lib/example.test.ts"],
    coverageStatus: "COVERED",
    ...overrides,
  };
}

function validRegistry(evals) {
  return {
    version: 1,
    idPolicy: "EVAL-<DOMAIN>-<SLUG>",
    maintenance: "Update only for important invariants.",
    evals,
  };
}

test("real registry file passes structural validation", () => {
  const result = checkEvalRegistry({ repositoryRoot: process.cwd() });
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("rejects duplicate eval ids", () => {
  const result = validateRegistryDocument(
    validRegistry([validEval(), validEval()]),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Duplicate eval id EVAL-PP-EXAMPLE-STATE/);
});

test("rejects missing required field", () => {
  const entry = validEval();
  delete entry.invariant;
  const result = validateRegistryDocument(validRegistry([entry]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /missing required field `invariant`/);
});

test("rejects invalid enum and incorrect field type", () => {
  const result = validateRegistryDocument(
    validRegistry([
      validEval({
        evalType: "MOUNTED",
        providerCalls: "yes",
        coverageStatus: "PASS",
      }),
    ]),
  );
  assert.equal(result.ok, false);
  const joined = result.errors.join("\n");
  assert.match(joined, /evalType has invalid enum value "MOUNTED"/);
  assert.match(joined, /providerCalls must be a boolean/);
  assert.match(joined, /coverageStatus has invalid enum value "PASS"/);
});

test("rejects invalid JSON syntax", () => {
  const parsed = parseRegistryJson("{");
  assert.equal(parsed.document, null);
  assert.match(parsed.errors.join("\n"), /Invalid JSON/);
});

test("literal evidence paths skip commands and globs", () => {
  assert.equal(isLiteralEvidencePath("lib/ai/legacy-null-material-edit.test.ts"), true);
  assert.equal(isLiteralEvidencePath("npm run lab:post-transcription -- I03"), false);
  assert.equal(isLiteralEvidencePath("lib/**/*.test.ts"), false);
});

test("missing literal evidence path fails when checking the filesystem", () => {
  const result = validateRegistryDocument(
    validRegistry([validEval({ evidence: ["lib/does-not-exist.test.ts"] })]),
    {
      checkEvidencePaths: true,
      pathExists: () => false,
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /evidence path does not exist/);
});
