import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExplicitPocRuleIdForLive,
  assertLivePocConfirmation,
  assertPocConferenceName,
  assertPocRuleNotProduction,
  assertPocScenarioIdentity,
  maskRuleIdentifier,
  POC_CONFERENCE_NAME_PREFIX,
  PocSafetyError,
  resolveDedicatedPocRule,
} from "@/lib/voximplant/poc/poc-safety";

test("dedicated POC rule resolves only from POC env vars", () => {
  const resolved = resolveDedicatedPocRule({
    VOXIMPLANT_SERVER_STOP_POC_RULE_ID: "poc-rule-111",
    VOXIMPLANT_SERVER_STOP_POC_RULE_NAME: "neg-poc-server-stop-rule",
    VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-rule-999",
    VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
  });
  assert.equal(resolved.ruleId, "poc-rule-111");
  assert.equal(resolved.ruleName, "neg-poc-server-stop-rule");
});

test("no fallback to production rule id or name", () => {
  const resolved = resolveDedicatedPocRule({
    VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-rule-999",
    VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
  });
  assert.equal(resolved.ruleId, null);
  assert.equal(resolved.ruleName, null);
  assert.equal(resolved.fromDedicatedPocEnv, false);

  assert.throws(
    () => assertExplicitPocRuleIdForLive(resolved),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "POC_RULE_ID_REQUIRED",
  );
});

test("POC rule ID matching production refuses", () => {
  assert.throws(
    () =>
      assertPocRuleNotProduction({
        pocRule: {
          ruleId: "same-id",
          ruleName: "neg-poc-server-stop-rule",
          fromDedicatedPocEnv: true,
        },
        production: {
          productionRuleId: "same-id",
          productionRuleName: "negotaitions-negotiation-room-rule",
          productionScenarioName: "neg-conf-main-room",
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError &&
      err.code === "POC_RULE_MATCHES_PRODUCTION" &&
      !JSON.stringify(err.toSanitizedLog()).includes("secret"),
  );
});

test("POC rule name matching production refuses", () => {
  assert.throws(
    () =>
      assertPocRuleNotProduction({
        pocRule: {
          ruleId: "poc-111",
          ruleName: "negotaitions-negotiation-room-rule",
          fromDedicatedPocEnv: true,
        },
        production: {
          productionRuleId: "prod-999",
          productionRuleName: "negotaitions-negotiation-room-rule",
          productionScenarioName: "neg-conf-main-room",
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "POC_RULE_MATCHES_PRODUCTION",
  );
});

test("known production rule name refuse even without env match", () => {
  assert.throws(
    () =>
      assertPocRuleNotProduction({
        pocRule: {
          ruleId: "poc-111",
          ruleName: "negotaitions-conference-rule",
          fromDedicatedPocEnv: true,
        },
        production: {
          productionRuleId: null,
          productionRuleName: null,
          productionScenarioName: null,
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "POC_RULE_MATCHES_PRODUCTION",
  );
});

test("missing --confirm-live-poc refuses", () => {
  assert.throws(
    () => assertLivePocConfirmation(false),
    (err: unknown) =>
      err instanceof PocSafetyError &&
      err.code === "LIVE_POC_CONFIRMATION_REQUIRED",
  );
});

test("confirm-live-poc passes confirmation gate", () => {
  assert.doesNotThrow(() => assertLivePocConfirmation(true));
});

test("invalid conference prefix refuses", () => {
  assert.throws(
    () => assertPocConferenceName("negotiation-session-abc"),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "INVALID_POC_CONFERENCE_NAME",
  );
});

test("safe conference prefix passes", () => {
  assert.doesNotThrow(() =>
    assertPocConferenceName(`${POC_CONFERENCE_NAME_PREFIX}12345`),
  );
});

test("ping rejects missing scenarioKind", () => {
  assert.throws(
    () =>
      assertPocScenarioIdentity({
        scenarioKind: null,
        protocolVersion: 1,
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "UNEXPECTED_SCENARIO_IDENTITY",
  );
});

test("ping rejects wrong scenarioKind", () => {
  assert.throws(
    () =>
      assertPocScenarioIdentity({
        scenarioKind: "neg-conf-main-room",
        protocolVersion: 1,
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "UNEXPECTED_SCENARIO_IDENTITY",
  );
});

test("ping rejects wrong protocolVersion", () => {
  assert.throws(
    () =>
      assertPocScenarioIdentity({
        scenarioKind: "voximplant_server_stop_poc",
        protocolVersion: 2,
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "UNEXPECTED_SCENARIO_IDENTITY",
  );
});

test("ping accepts dedicated POC scenario identity", () => {
  assert.doesNotThrow(() =>
    assertPocScenarioIdentity({
      scenarioKind: "voximplant_server_stop_poc",
      protocolVersion: 1,
    }),
  );
});

test("production rule fingerprint is masked", () => {
  const masked = maskRuleIdentifier("1234567890");
  assert.ok(masked);
  assert.notEqual(masked, "1234567890");
  assert.ok(masked.includes("…"));
});
