import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scenarioPath = resolve(
  process.cwd(),
  "docs/voximplant/neg-conf.main-room.scenario.js",
);
const scenarioSource = readFileSync(scenarioPath, "utf8");

// Stage 3.10 traceability:
// ST310-VOX-011, ST310-VOX-012, ST310-VOX-013, ST310-VOX-014, ST310-VOX-015, ST310-VOX-016

test("scenario build marker is release-candidate marker", () => {
  assert.match(
    scenarioSource,
    /SCENARIO_BUILD_ID\s*=\s*"main-room-recording-reconciliation-2026-08-12-rc4"/,
  );
});

test("strict recording controller auth is enabled", () => {
  assert.match(scenarioSource, /STRICT_RECORDING_CONTROLLER_AUTH\s*=\s*true/);
});

test("untrusted controller fallback is disabled", () => {
  assert.match(scenarioSource, /DEVELOPMENT_ONLY_ALLOW_UNTRUSTED_CONTROLLER\s*=\s*false/);
});

test("message-level callback URL override is disabled", () => {
  assert.match(scenarioSource, /ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE\s*=\s*false/);
  assert.match(
    scenarioSource,
    /function resolveEffectiveWebhookBaseUrl\(\)\s*\{[\s\S]*return normalizeWebhookBaseUrl\(WEBHOOK_BASE_URL \|\| null\);/,
  );
  assert.doesNotMatch(scenarioSource, /cachedWebhookBaseUrlFromMessage/);
  assert.doesNotMatch(scenarioSource, /var messageWebhookBaseUrl\s*=/);
  assert.doesNotMatch(scenarioSource, /var stopMessageWebhookBaseUrl\s*=/);
});

test("required secrets are loaded from trusted scenario env config", () => {
  assert.match(scenarioSource, /readSecretFromScenarioEnv\(\s*"VOXIMPLANT_RECORDING_WEBHOOK_SECRET"/);
  assert.match(scenarioSource, /readSecretFromScenarioEnv\(\s*"RECORDING_CONTROL_SECRET",\s*"VOXIMPLANT_RECORDING_CONTROL_SECRET"/);
  assert.match(scenarioSource, /readSecretFromScenarioEnv\(\s*"SERVER_STOP_CONTROL_SECRET"/);
  assert.match(scenarioSource, /readSecretFromScenarioEnv\(\s*"SERVER_STOP_CALLBACK_SECRET"/);
  assert.match(
    scenarioSource,
    /applyWebhookEnvironmentConfig\(\);[\s\S]*applyRecordingControlEnvironmentConfig\(\);[\s\S]*applyServerStopEnvironmentConfig\(\);/,
  );
});

test("secret precedence is explicit and compatibility aliases remain controlled", () => {
  assert.match(scenarioSource, /function readSecretFromScenarioEnv\([\s\S]*primaryKey[\s\S]*compatibilityAliasKey/);
  assert.match(
    scenarioSource,
    /isVoxEngineSecretStorageAvailable[\s\S]*VoxEngine\.getSecretValue[\s\S]*process_env_fallback/,
  );
  assert.match(scenarioSource, /source:\s*"vox_secret_primary"/);
  assert.match(scenarioSource, /source:\s*"vox_secret_alias"/);
  assert.match(scenarioSource, /source:\s*"missing"/);
  assert.match(scenarioSource, /VOXIMPLANT_RECORDING_WEBHOOK_SECRET[\s\S]*WEBHOOK_SECRET/);
  assert.match(scenarioSource, /RECORDING_CONTROL_SECRET[\s\S]*VOXIMPLANT_RECORDING_CONTROL_SECRET/);
  assert.match(scenarioSource, /SERVER_STOP_CONTROL_SECRET[\s\S]*VOXIMPLANT_SERVER_STOP_CONTROL_SECRET/);
  assert.match(scenarioSource, /SERVER_STOP_CALLBACK_SECRET[\s\S]*VOXIMPLANT_SERVER_STOP_CALLBACK_SECRET/);
});

test("missing required secrets fail closed", () => {
  assert.match(scenarioSource, /var WEBHOOK_SECRET\s*=\s*""/);
  assert.match(scenarioSource, /var RECORDING_CONTROL_SECRET\s*=\s*""/);
  assert.match(scenarioSource, /var SERVER_STOP_CONTROL_SECRET\s*=\s*""/);
  assert.match(scenarioSource, /var SERVER_STOP_CALLBACK_SECRET\s*=\s*""/);
  assert.match(scenarioSource, /webhook skipped: WEBHOOK_SECRET not configured/);
  assert.match(scenarioSource, /RECORDING_CONTROL_SECRET_UNAVAILABLE/);
  assert.match(
    scenarioSource,
    /if \(!isServerStopSecretConfigured\(SERVER_STOP_CONTROL_SECRET\)\) \{[\s\S]*config_unavailable/,
  );
  assert.match(
    scenarioSource,
    /!isServerStopSecretConfigured\(SERVER_STOP_CALLBACK_SECRET\)[\s\S]*CALLBACK_SECRET_UNAVAILABLE/,
  );
});

test("no committed secret literal values are present", () => {
  assert.doesNotMatch(scenarioSource, /var WEBHOOK_SECRET\s*=\s*"(?!")[^"]+"/);
  assert.doesNotMatch(scenarioSource, /var RECORDING_CONTROL_SECRET\s*=\s*"(?!")[^"]+"/);
  assert.doesNotMatch(scenarioSource, /var SERVER_STOP_CONTROL_SECRET\s*=\s*"(?!")[^"]+"/);
  assert.doesNotMatch(scenarioSource, /var SERVER_STOP_CALLBACK_SECRET\s*=\s*"(?!")[^"]+"/);
});

test("callback origin allowlist includes local and production only", () => {
  assert.match(
    scenarioSource,
    /RECORDING_CONTROL_ALLOWED_WEBHOOK_ORIGINS\s*=\s*\{[\s\S]*"https:\/\/local\.negotaitions\.ru":[\s\S]*"https:\/\/negotaitions\.ru":/,
  );
  assert.match(scenarioSource, /function normalizeRecordingControlWebhookOrigin\(/);
});

test("signed recording-control schema includes required claims", () => {
  assert.match(scenarioSource, /protocolVersion/);
  assert.match(scenarioSource, /issuedAt/);
  assert.match(scenarioSource, /expiresAt/);
  assert.match(scenarioSource, /nonce/);
  assert.match(scenarioSource, /controllerUserId/);
  assert.match(scenarioSource, /controllerRole/);
  assert.match(scenarioSource, /canControlRecording/);
  assert.match(scenarioSource, /webhookBaseUrl/);
  assert.match(scenarioSource, /buildRecordingControlCanonicalPayload/);
});

test("recording-control timestamp validation uses bounded skew and distinct diagnostics", () => {
  assert.match(
    scenarioSource,
    /RECORDING_CONTROL_CLOCK_SKEW_SECONDS\s*=\s*30/,
  );
  assert.match(
    scenarioSource,
    /evaluateRecordingControlTimeWindow\(/,
  );
  assert.match(scenarioSource, /RECORDING_CONTROL_NOT_YET_VALID/);
  assert.match(scenarioSource, /RECORDING_CONTROL_EXPIRED/);
  assert.match(scenarioSource, /clockDeltaSeconds=/);
  assert.match(scenarioSource, /allowedSkewSeconds=/);
});

test("signed pre-binding start failures may use allowlisted callback origin", () => {
  assert.match(
    scenarioSource,
    /source:\s*"signed_prebinding_origin"/,
  );
  assert.match(
    scenarioSource,
    /reportSignedStartFailure\(/,
  );
  assert.match(
    scenarioSource,
    /preferred_origin_invalid[\s\S]*RECORDING_CONTROL_WEBHOOK_ORIGIN_INVALID/,
  );
});

test("recording-control verification order is explicit", () => {
  assert.match(
    scenarioSource,
    /\/\/ 1\. parse message[\s\S]*\/\/ 2\. validate schema[\s\S]*\/\/ 3\. validate secret availability[\s\S]*\/\/ 4\. verify HMAC[\s\S]*\/\/ 5\. validate issuedAt\/expiresAt[\s\S]*\/\/ 6\. validate exact allowlisted webhook origin[\s\S]*\/\/ 7\. validate action\/requestId\/sessionId\/conferenceName\/participant claims[\s\S]*\/\/ 8\. validate canControlRecording=true[\s\S]*\/\/ 9\. bind provider-session identity and callback origin[\s\S]*\/\/ 10\. validate nonce\/replay\/idempotency outcome before reserving execution[\s\S]*\/\/ 11\. reserve nonce for command execution after immutable checks\.[\s\S]*\/\/ 12\. register server-stop control channel once \(async acknowledgement required\)[\s\S]*\/\/ 13\. fence command execution[\s\S]*\/\/ 14\. execute recording action/,
  );
});

test("fenced recording protocol keeps command and attempt identities distinct", () => {
  assert.match(
    scenarioSource,
    /RECORDING_CONTROL_FENCED_PROTOCOL_VERSION\s*=\s*"rc3-hmac-sha256-recording-attempt-v1"/,
  );
  assert.match(scenarioSource, /currentRecordingContext\.recordingAttemptId/);
  assert.match(scenarioSource, /recordingAttemptId:\s*claims\.recordingAttemptId/);
  assert.match(scenarioSource, /RECORDING_ATTEMPT_MISMATCH/);
});

test("recording callback retries are Promise-based, bounded, and fenced-only", () => {
  assert.match(
    scenarioSource,
    /var maxAttempts = fencedCallback \? 3 : 1/,
  );
  assert.match(
    scenarioSource,
    /requestPromise = Net\.httpRequestAsync\(url,[\s\S]*requestPromise\.then\([\s\S]*\)\.catch\(/,
  );
  assert.match(scenarioSource, /statusCode === 408/);
  assert.match(scenarioSource, /statusCode === 429/);
  assert.match(scenarioSource, /statusCode >= 500/);
  for (const code of [-4, -6, -7, -8]) {
    assert.match(scenarioSource, new RegExp(`statusCode === ${code}`));
  }
  assert.match(scenarioSource, /webhook retries exhausted/);
});

test("recorder handlers capture immutable instance and attempt context", () => {
  assert.match(
    scenarioSource,
    /function attachRecorderEventHandlers\(recorderInstance,\s*recorderContext\)/,
  );
  assert.match(
    scenarioSource,
    /addSafeEventListener\(recorderInstance,\s*"RecorderEvents",\s*"Started"/,
  );
  assert.match(scenarioSource, /isCurrentRecorderContext\(ctx\)/);
  assert.match(scenarioSource, /requestBestEffortRecorderCleanup\(/);
  assert.match(scenarioSource, /orphanedRecorderContexts/);
  assert.match(scenarioSource, /RECORDER_CLEANUP_MAX_ATTEMPTS = 2/);
  assert.match(
    scenarioSource,
    /if \(ctx\.cleanupRequested\) \{[\s\S]*"LATE_STARTED_AFTER_CLEANUP"[\s\S]*return;[\s\S]*ctx\.state = STATE_RECORDING;/,
  );
});

test("STARTING webhook omits startedAt until Recorder.Started", () => {
  assert.match(
    scenarioSource,
    /buildStatusPayload\(requestId,\s*STATE_STARTING,[\s\S]*null,\s*getCurrentContextWebhookBaseUrl\(\)/,
  );
  assert.match(
    scenarioSource,
    /"RecorderEvents",\s*"Started"[\s\S]*ctx\.startedAt = ctx\.startedAt \|\| safeNowIso\(\)[\s\S]*\{ startedAt: ctx\.startedAt \}/,
  );
});

test("nonce replay cache supports idempotency and conflict rejection", () => {
  assert.match(scenarioSource, /RECORDING_CONTROL_NONCE_CACHE/);
  assert.match(scenarioSource, /inspectRecordingControlNonce\(/);
  assert.match(scenarioSource, /beginRecordingControlNonceExecution\(/);
  assert.match(scenarioSource, /markRecordingControlNonceOutcome\(/);
  assert.match(scenarioSource, /duplicate_processed/);
  assert.match(scenarioSource, /duplicate_conflict/);
  assert.match(scenarioSource, /duplicate_rejected/);
  assert.match(scenarioSource, /RECORDING_CONTROL_NONCE_PREVIOUSLY_REJECTED/);
  assert.match(
    scenarioSource,
    /sendCurrentStatus\(call,\s*requestId,\s*claims\.recordingAttemptId \|\| null\);/,
  );
});

test("provider-session binding is required and immutable", () => {
  assert.match(scenarioSource, /RECORDING_CONTROL_BINDING/);
  assert.match(
    scenarioSource,
    /RECORDING_CONTROL_BINDING\.sessionId !== claims\.sessionId[\s\S]*RECORDING_CONTROL_BINDING\.conferenceName !== claims\.conferenceName[\s\S]*RECORDING_CONTROL_BINDING\.webhookBaseUrl !== normalizedOrigin/,
  );
  assert.match(scenarioSource, /RECORDING_CONTROL_BINDING_CONFLICT/);
  assert.match(
    scenarioSource,
    /recording_control_binding_missing|recording_control_binding_mismatch/,
  );
});

test("registration occurs after verification and requires async durable acknowledgement", () => {
  assert.match(
    scenarioSource,
    /\/\/ 12\. register server-stop control channel once \(async acknowledgement required\)[\s\S]*registerServerStopControlChannel\(RECORDING_CONTROL_BINDING\)/,
  );
  assert.match(scenarioSource, /SERVER_STOP_CONTROL_CHANNEL_REGISTRATION/);
  assert.match(scenarioSource, /SERVER_STOP_REGISTRATION_STATE_NOT_SENT/);
  assert.match(scenarioSource, /SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT/);
  assert.match(scenarioSource, /SERVER_STOP_REGISTRATION_STATE_ACKNOWLEDGED/);
  assert.match(scenarioSource, /SERVER_STOP_REGISTRATION_STATE_FAILED_RETRYABLE/);
  assert.match(scenarioSource, /SERVER_STOP_REGISTRATION_STATE_FAILED_TERMINAL/);
  assert.match(scenarioSource, /parseServerStopRegistrationAcknowledgement/);
  assert.match(
    scenarioSource,
    /accepted[\s\S]*persisted[\s\S]*stateScope[\s\S]*SERVER_STOP_DURABLE_STATE_SCOPES/,
  );
  assert.match(scenarioSource, /SERVER_STOP_REGISTRATION_MAX_ATTEMPTS/);
  assert.match(scenarioSource, /buildServerStopRegistrationBackoffMs/);
});

test("registration retries are bounded and in-flight duplicate sends are blocked", () => {
  assert.match(
    scenarioSource,
    /SERVER_STOP_REGISTRATION_ATTEMPT_TIMEOUT_MS\s*=\s*15000/,
  );
  assert.match(
    scenarioSource,
    /armServerStopRegistrationAttemptWatchdog[\s\S]*clearServerStopRegistrationAttemptWatchdog/,
  );
  assert.match(
    scenarioSource,
    /registration\.state === SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT[\s\S]*pending:\s*true/,
  );
  assert.match(
    scenarioSource,
    /registration\.attemptCount >= SERVER_STOP_REGISTRATION_MAX_ATTEMPTS[\s\S]*REGISTRATION_ATTEMPTS_EXHAUSTED/,
  );
  assert.match(
    scenarioSource,
    /SERVER_STOP_REGISTRATION_STATE_FAILED_RETRYABLE[\s\S]*registration\.nextRetryAtMs[\s\S]*nowMs < registration\.nextRetryAtMs/,
  );
});

test("registration acknowledgement rejects non-durable or malformed 2xx responses", () => {
  assert.match(
    scenarioSource,
    /if \(!rawText\) \{[\s\S]*ACK_EMPTY/,
  );
  assert.match(
    scenarioSource,
    /JSON\.parse\(rawText\)[\s\S]*ACK_INVALID_JSON/,
  );
  assert.match(
    scenarioSource,
    /accepted[\s\S]*=== true[\s\S]*persisted[\s\S]*=== true[\s\S]*SERVER_STOP_DURABLE_STATE_SCOPES/,
  );
});

test("registration state machine handles network failure and non-2xx retry paths", () => {
  assert.match(
    scenarioSource,
    /if \(!result\) \{[\s\S]*NETWORK_OR_TIMEOUT[\s\S]*retryable:\s*true/,
  );
  assert.match(
    scenarioSource,
    /if \(statusCode < 200 \|\| statusCode >= 300\) \{[\s\S]*HTTP_/,
  );
  assert.match(
    scenarioSource,
    /isServerStopRegistrationTerminalStatusCode[\s\S]*retryable:\s*!isServerStopRegistrationTerminalStatusCode/,
  );
});

test("registration does not retry after acknowledged success and allows retry after retryable failure", () => {
  assert.match(
    scenarioSource,
    /if \(registration\.state === SERVER_STOP_REGISTRATION_STATE_ACKNOWLEDGED\) \{[\s\S]*duplicate:\s*true/,
  );
  assert.match(
    scenarioSource,
    /registration\.state = SERVER_STOP_REGISTRATION_STATE_FAILED_RETRYABLE[\s\S]*registration\.nextRetryAtMs = Date\.now\(\) \+ backoffMs/,
  );
  assert.match(
    scenarioSource,
    /registration\.state = SERVER_STOP_REGISTRATION_STATE_ACKNOWLEDGED[\s\S]*registration\.nextRetryAtMs = 0/,
  );
});

test("missing accessSecureURL does not fabricate fallback registration URL", () => {
  assert.match(scenarioSource, /ACCESS_SECURE_URL_UNAVAILABLE/);
  assert.match(
    scenarioSource,
    /resolveServerStopControlUrl\(\)\s*\{[\s\S]*normalizeControlAccessSecureUrl\(providerControlAccessSecureUrl\)/,
  );
  assert.doesNotMatch(scenarioSource, /SERVER_STOP_DEFAULT_CONTROL_PATH/);
  assert.doesNotMatch(scenarioSource, /control\/server-stop/);
});

test("strict authorization relies on signed claims, not heuristic caller identity", () => {
  assert.match(
    scenarioSource,
    /function isAuthorizedRecordingController\([\s\S]*payload\.claims\.canControlRecording/,
  );
  assert.match(scenarioSource, /STRICT_AUTH_CLAIM_DENIED/);
  assert.doesNotMatch(scenarioSource, /looksLikeFacilitatorIdentity/);
});

test("recording and stop callbacks fail closed to bound callback origin", () => {
  assert.match(scenarioSource, /resolveBoundWebhookBaseUrl/);
  assert.match(scenarioSource, /getCurrentContextWebhookBaseUrl/);
  assert.match(scenarioSource, /resolveServerStopCallbackOrigin/);
  assert.match(
    scenarioSource,
    /RECORDING_CONTROL_BINDING_MISSING[\s\S]*RECORDING_CONTROL_BINDING_MISMATCH/,
  );
  assert.match(
    scenarioSource,
    /buildServerStopCallbackUrl\(\s*sessionId,\s*callbackBaseUrl\)\s*\{[\s\S]*normalizeWebhookBaseUrl\(callbackBaseUrl \|\| null\)/,
  );
  assert.match(
    scenarioSource,
    /buildServerStopCallbackUrl\(sessionId,\s*callbackBaseUrl\)/,
  );
});

test("recording-status callbacks keep legacy static fallback only outside RC2 bound sessions", () => {
  assert.match(scenarioSource, /resolveRecordingStatusWebhookOrigin/);
  assert.match(
    scenarioSource,
    /if \(RECORDING_CONTROL_BINDING\) \{[\s\S]*binding_mismatch[\s\S]*binding_origin_missing[\s\S]*BINDING_ORIGIN_MISMATCH/,
  );
  assert.match(
    scenarioSource,
    /legacy_static_origin/,
  );
});

test("rule identity is derived from startup event and defaults to unknown", () => {
  assert.match(scenarioSource, /SERVER_STOP_RULE_IDENTITY\s*=\s*"unknown"/);
  assert.match(scenarioSource, /resolveServerStopRuleIdentity\(event\)/);
  assert.match(scenarioSource, /extractProviderRuleIdentityCandidate/);
  assert.match(
    scenarioSource,
    /event && event\.dialplanName[\s\S]*event && event\.dialplanId/,
  );
});

test("Recorder.Stopped diagnostics log actual callback origin source", () => {
  assert.match(
    scenarioSource,
    /resolveRecordingStatusWebhookOrigin\([\s\S]*callbackOriginSource=/,
  );
  assert.doesNotMatch(
    scenarioSource,
    /var resolvedBase = resolveEffectiveWebhookBaseUrl\(\)[\s\S]*webhook URL=/,
  );
});

test("scenario does not retain POC identifiers", () => {
  assert.ok(!scenarioSource.includes("server-poc-webhook-fix"));
  assert.ok(!scenarioSource.includes("poc/voximplant-server-stop"));
  assert.ok(!scenarioSource.includes("neg-conf-server-stop-poc"));
  assert.doesNotMatch(scenarioSource, /\bpoc\b/i);
});

test("scenario keeps local callback origin support while rejecting localhost values", () => {
  assert.ok(scenarioSource.includes("https://local.negotaitions.ru"));
  assert.match(scenarioSource, /https:\/\/negotaitions\.ru/);
  assert.match(scenarioSource, /normalizeRecordingControlWebhookOrigin/);
});

test("ConferenceEvents.Stopped requests recorder shutdown stop", () => {
  assert.match(
    scenarioSource,
    /ConferenceEvents", "Stopped"[\s\S]*requestRecorderStopForScenarioShutdown\("ConferenceEvents\.Stopped"\)/,
  );
});

test("AppEvents.Terminating requests recorder shutdown stop", () => {
  assert.match(
    scenarioSource,
    /AppEvents", "Terminating"[\s\S]*requestRecorderStopForScenarioShutdown\("AppEvents\.Terminating"\)/,
  );
});

test("CallEvents.Disconnected remains participant counter only", () => {
  const disconnectedBlock =
    scenarioSource.match(
      /CallEvents", "Disconnected", function \(\) \{[\s\S]*?\n  \}, "CallEvents\.Disconnected"\);/,
    )?.[0] ?? "";
  assert.ok(disconnectedBlock.length > 0);
  assert.ok(!disconnectedBlock.includes("stopRecording("));
  assert.ok(!disconnectedBlock.includes("requestRecorderStopForScenarioShutdown("));
});

test("stopRecording handles already-stopping and already-stopped states", () => {
  assert.match(
    scenarioSource,
    /if \(recordingState === STATE_STOPPING\) \{[\s\S]*Recording stop is already in progress\./,
  );
  assert.match(
    scenarioSource,
    /if \(recordingState === STATE_IDLE \|\| recordingState === STATE_STOPPED\) \{[\s\S]*Recording is not active\./,
  );
});

test("server-side stop callback event names are present", () => {
  assert.match(scenarioSource, /provider_session_registered/);
  assert.match(scenarioSource, /recording_stop_command_accepted/);
  assert.match(scenarioSource, /recording_stopped/);
  assert.match(scenarioSource, /recording_stop_failed/);
});

test("server-side stop control HTTP handler is registered", () => {
  assert.match(scenarioSource, /AppEvents", "HttpRequest"[\s\S]*handleServerStopHttpRequest/);
  assert.match(scenarioSource, /x-vox-stop-signature/);
  assert.match(scenarioSource, /SERVER_STOP_PROTOCOL_VERSION/);
});

test("server-side stop handler supports signature fallback in query", () => {
  assert.match(scenarioSource, /function readQueryValueFromPath\(/);
  assert.match(
    scenarioSource,
    /readQueryValueFromPath\(path,\s*"x-vox-stop-signature"\)/,
  );
});

test("browser-side recording start flow remains present", () => {
  assert.match(
    scenarioSource,
    /if \(claims\.action === ACTION_START\) \{[\s\S]*startRecording\(call,\s*requestId\);/,
  );
  assert.match(scenarioSource, /parseRecordingControlPayload\(/);
  assert.match(scenarioSource, /if \(claims\.action === ACTION_PAUSE\)/);
  assert.match(scenarioSource, /if \(claims\.action === ACTION_RESUME\)/);
  assert.match(
    scenarioSource,
    /sendCurrentStatus\(call,\s*requestId,\s*claims\.recordingAttemptId \|\| null\);/,
  );
});

test("RC4 exact-attempt status uses a bounded immutable terminal cache", () => {
  assert.match(scenarioSource, /TERMINAL_RECORDING_ATTEMPT_CACHE_MAX = 8/);
  assert.match(
    scenarioSource,
    /TERMINAL_RECORDING_ATTEMPT_CACHE_TTL_MS = 60 \* 60 \* 1000/,
  );
  assert.match(scenarioSource, /function cacheTerminalRecorderContext\(/);
  assert.match(scenarioSource, /if \(terminalRecordingAttemptCache\[ctx\.recordingAttemptId\]\) \{[\s\S]*return;/);
  assert.match(scenarioSource, /function getExactRecordingAttemptStatus\(/);
  assert.match(scenarioSource, /action === "get_recording_status"/);
  assert.match(scenarioSource, /recording_attempt_unknown/);
});

test("server-side stop protocol callbacks remain present", () => {
  assert.match(
    scenarioSource,
    /sendServerStopCallback\(\s*"provider_session_registered"[\s\S]*sendServerStopCallback\(\s*"recording_stop_command_accepted"/,
  );
  assert.match(
    scenarioSource,
    /sendServerStopCallback\(\s*"recording_stopped"[\s\S]*sendServerStopCallback\(\s*"recording_stop_failed"/,
  );
});
