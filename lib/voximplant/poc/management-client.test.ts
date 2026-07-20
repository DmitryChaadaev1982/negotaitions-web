import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStartConferenceHttpParams,
  buildStartConferencePublicResult,
  parseStartConferenceResponse,
  resolvePocManagementConfig,
  startConference,
  type PocManagementConfig,
} from "@/lib/voximplant/poc/management-client";
import { PocSafetyError } from "@/lib/voximplant/poc/poc-safety";
import { fingerprintControlUrl, redactControlUrlFields } from "@/lib/voximplant/poc/url-fingerprint";

const baseConfig: PocManagementConfig = {
  accountId: "123",
  applicationId: "456",
  applicationName: "negotaitions-video-poc",
  ruleId: "poc-rule-789",
  ruleName: "neg-poc-server-stop-rule",
  auth: { type: "api_key", apiKey: "secret-api-key-value" },
};

test("StartConference request uses verified parameter names", () => {
  const params = buildStartConferenceHttpParams({
    conferenceName: "neg-poc-server-stop-1",
    ruleId: "poc-rule-789",
    applicationId: "456",
    applicationName: "negotaitions-video-poc",
    scriptCustomData: "{\"poc\":true}",
  });
  assert.equal(params.conference_name, "neg-poc-server-stop-1");
  assert.equal(params.rule_id, "poc-rule-789");
  assert.equal(params.application_id, "456");
  assert.equal(params.application_name, "negotaitions-video-poc");
  assert.equal(params.script_custom_data, "{\"poc\":true}");
});

test("response parsing captures media_session_access_url fields", () => {
  const parsed = parseStartConferenceResponse({
    result: 1,
    media_session_access_url: "http://example.invalid/session/abc",
    media_session_access_secure_url: "https://example.invalid/session/abc",
    call_session_history_id: 999,
  });
  assert.equal(parsed.mediaSessionAccessUrl, "http://example.invalid/session/abc");
  assert.equal(
    parsed.mediaSessionAccessSecureUrl,
    "https://example.invalid/session/abc",
  );
  assert.equal(parsed.callSessionHistoryId, "999");
});

test("secrets and full control URL are redacted from logs", () => {
  const full = "https://api.voximplant.com/platform_api/session/SECRETTOKEN123";
  const finger = fingerprintControlUrl(full);
  assert.notEqual(finger, full);
  assert.ok(!finger.includes("SECRETTOKEN123"));

  const redacted = redactControlUrlFields({
    media_session_access_url: full,
    api_key: "should-stay-but-url-redacted",
  });
  assert.notEqual(redacted.media_session_access_url, full);
  assert.ok(!String(redacted.media_session_access_url).includes("SECRETTOKEN123"));
});

test("dry-run StartConference performs no network call", async () => {
  let fetchCalls = 0;
  const result = await startConference({
    config: baseConfig,
    conferenceName: "neg-poc-server-stop-dry",
    dryRun: true,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network should not be called");
    },
    env: {
      VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-should-not-be-used",
      VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
    },
  });
  assert.equal(result.dryRun, true);
  assert.equal(fetchCalls, 0);
  assert.equal(result.request.conference_name, "neg-poc-server-stop-dry");
  assert.equal(result.request.rule_id, "poc-rule-789");
  assert.equal(result.missingPocRule, false);
});

test("dry-run with missing POC rule reports missing and makes no provider call", async () => {
  let fetchCalls = 0;
  const result = await startConference({
    config: { ...baseConfig, ruleId: null, ruleName: null },
    conferenceName: "neg-poc-server-stop-dry",
    dryRun: true,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network should not be called");
    },
    env: {
      VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-rule-999",
      VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
    },
  });
  assert.equal(result.dryRun, true);
  assert.equal(fetchCalls, 0);
  assert.equal(result.missingPocRule, true);
  assert.equal(result.request.rule_id, "<missing-poc-rule-id>");
  assert.notEqual(result.request.rule_id, "prod-rule-999");
});

test("missing explicit POC rule refuses live call with no request", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      startConference({
        config: { ...baseConfig, ruleId: null, ruleName: null },
        conferenceName: "neg-poc-server-stop-live",
        confirmLivePoc: true,
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("network should not be called");
        },
        env: {
          VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-rule-999",
          VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "POC_RULE_ID_REQUIRED",
  );
  assert.equal(fetchCalls, 0);
});

test("no fallback to production rule for live StartConference", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      startConference({
        config: { ...baseConfig, ruleId: null, ruleName: null },
        conferenceName: "neg-poc-server-stop-live",
        confirmLivePoc: true,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", { status: 200 });
        },
        env: {
          VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-rule-999",
          VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "POC_RULE_ID_REQUIRED",
  );
  assert.equal(fetchCalls, 0);
});

test("POC rule ID matching production refuses before provider call", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      startConference({
        config: { ...baseConfig, ruleId: "prod-rule-999" },
        conferenceName: "neg-poc-server-stop-live",
        confirmLivePoc: true,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", { status: 200 });
        },
        env: {
          VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-rule-999",
          VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "POC_RULE_MATCHES_PRODUCTION",
  );
  assert.equal(fetchCalls, 0);
});

test("POC rule name matching production refuses before provider call", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      startConference({
        config: {
          ...baseConfig,
          ruleId: "poc-distinct-111",
          ruleName: "negotaitions-negotiation-room-rule",
        },
        conferenceName: "neg-poc-server-stop-live",
        confirmLivePoc: true,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", { status: 200 });
        },
        env: {
          VOXIMPLANT_MANAGEMENT_RULE_ID: "other-prod-id",
          VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "POC_RULE_MATCHES_PRODUCTION",
  );
  assert.equal(fetchCalls, 0);
});

test("missing --confirm-live-poc performs no request", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      startConference({
        config: baseConfig,
        conferenceName: "neg-poc-server-stop-live",
        confirmLivePoc: false,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", { status: 200 });
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError &&
      err.code === "LIVE_POC_CONFIRMATION_REQUIRED",
  );
  assert.equal(fetchCalls, 0);
});

test("correct confirmation still runs all safety checks", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      startConference({
        config: {
          ...baseConfig,
          ruleId: "prod-rule-999",
          ruleName: "neg-poc-ok-name",
        },
        conferenceName: "neg-poc-server-stop-live",
        confirmLivePoc: true,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", { status: 200 });
        },
        env: {
          VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-rule-999",
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "POC_RULE_MATCHES_PRODUCTION",
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    () =>
      startConference({
        config: baseConfig,
        conferenceName: "negotiation-session-xyz",
        confirmLivePoc: true,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", { status: 200 });
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "INVALID_POC_CONFERENCE_NAME",
  );
  assert.equal(fetchCalls, 0);
});

test("invalid conference prefix refuses live call", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    () =>
      startConference({
        config: baseConfig,
        conferenceName: "negotiation-abc",
        confirmLivePoc: true,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", { status: 200 });
        },
      }),
    (err: unknown) =>
      err instanceof PocSafetyError && err.code === "INVALID_POC_CONFERENCE_NAME",
  );
  assert.equal(fetchCalls, 0);
});

test("safe conference prefix passes and live call may proceed", async () => {
  let fetchCalls = 0;
  const controlUrl = "https://example.invalid/session/full-secret-token";
  const result = await startConference({
    config: baseConfig,
    conferenceName: "neg-poc-server-stop-ok",
    confirmLivePoc: true,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          result: 1,
          media_session_access_secure_url: controlUrl,
          call_session_history_id: "42",
        }),
        { status: 200 },
      );
    },
    env: {
      VOXIMPLANT_MANAGEMENT_RULE_ID: "different-prod-id",
      VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
    },
  });
  assert.equal(fetchCalls, 1);
  assert.equal(result.dryRun, false);
  assert.equal(result.request.rule_id, "poc-rule-789");
  assert.ok(result.publicResult);
  assert.ok(!JSON.stringify(result.publicResult).includes("full-secret-token"));
});

test("public result never includes full control URL", () => {
  const publicResult = buildStartConferencePublicResult(
    {
      result: 1,
      mediaSessionAccessUrl: "https://example.invalid/session/full-secret",
      mediaSessionAccessSecureUrl: "https://example.invalid/session/full-secret",
      callSessionHistoryId: "42",
      rawKeys: [],
    },
    "neg-poc-server-stop-1",
  );
  assert.equal(publicResult.mediaSessionId, "42");
  assert.ok(publicResult.controlUrlFingerprint);
  assert.ok(!JSON.stringify(publicResult).includes("full-secret"));
});

test("resolvePocManagementConfig ignores production rule env", () => {
  const config = resolvePocManagementConfig({
    VOXIMPLANT_MANAGEMENT_ACCOUNT_ID: "acc-1",
    VOXIMPLANT_MANAGEMENT_API_KEY: "key-1",
    VOXIMPLANT_MANAGEMENT_APPLICATION_ID: "app-1",
    VOXIMPLANT_MANAGEMENT_RULE_ID: "prod-rule",
    VOXIMPLANT_RULE_NAME: "negotaitions-negotiation-room-rule",
    VOXIMPLANT_SERVER_STOP_POC_RULE_ID: "poc-only-rule",
    VOXIMPLANT_SERVER_STOP_POC_RULE_NAME: "neg-poc-server-stop-rule",
  });
  assert.equal(config.ruleId, "poc-only-rule");
  assert.equal(config.ruleName, "neg-poc-server-stop-rule");
});

test("live confirmation refusal details never include full control URL", async () => {
  try {
    await startConference({
      config: baseConfig,
      conferenceName: "neg-poc-server-stop-live",
      confirmLivePoc: false,
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    assert.fail("expected refusal");
  } catch (err) {
    assert.ok(err instanceof PocSafetyError);
    const log = JSON.stringify(err.toSanitizedLog());
    assert.ok(!log.includes("session/"));
    assert.ok(!log.includes("api_key"));
    assert.ok(!log.includes(baseConfig.auth.type === "api_key" ? baseConfig.auth.apiKey : ""));
  }
});
