/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

// ============================================================
// NEGOTIATION ROOM SCENARIO (STAGE 5.4 ARTIFACT, NOT ACTIVE APP RUNTIME)
// ============================================================
//
// This file is a production-oriented VoxEngine scenario artifact for later
// manual paste into Voximplant Console. It does NOT change app runtime behavior.
//
// Stage 5.4.1 additions:
// - HTTP webhook to server on every recording status change;
// - HMAC-SHA256 signature on each webhook using VOXIMPLANT_RECORDING_WEBHOOK_SECRET;
// - sessionId resolved from recording_control message fields (not applicationName).
//
// IMPORTANT: This artifact must be manually copied/deployed to Voximplant Console.
// App runtime does not auto-deploy scenario changes.
//
// Canonical conference name format: negotiation-{sessionId}
// (see lib/voximplant/conference-name.ts buildVoximplantConferenceName)
//
// sessionId resolution order (fail closed if none match):
//   1. recording_control.message.sessionId
//   2. parse from recording_control.message.conferenceName
//   3. log error and skip webhook (recording may still work locally)
//
// Do NOT derive sessionId from VoxEngine.applicationName() — it is the static app name.
//
// Webhook endpoint:
//   POST {WEBHOOK_BASE_URL}/api/sessions/{sessionId}/voximplant/recording-status
//   Header: X-Voximplant-Signature: hmac-sha256={hex}
//   Body: JSON recording status payload (see buildStatusPayload)
//
// Goals:
// - keep conference stable even if recording or webhook fails;
// - support recording_control/start|pause|resume|stop|status;
// - return typed recording_status payloads compatible with current PoC shape;
// - add explicit authorization placeholder for future Stage 4 identity model.

require(Modules.Conference);

// Requirement: use Recorder module, but never let recorder availability
// break the conference path.
try {
  require(Modules.Recorder);
} catch (err) {
  Logger.write("[neg-conf-prod] Modules.Recorder require failed: " + safeToString(err));
}

// ── Scenario version marker (server POC paste-ready) ─────────────────────────
//
// Search Voximplant logs for this build id to confirm the correct scenario is running.
// __LOCAL_DEV_BUILD__ is replaced by scripts/voximplant-sync-scenario.mjs when using CI sync.
var SCENARIO_BUILD_ID   = "server-poc-webhook-fix-2026-07-04";
var SCENARIO_SOURCE_NAME = "neg-conf-main-room";

// Audio recording mode:
// - "lossless" => { video: false, lossless: true }
// - "hd_mp3"   => { video: false, hd_audio: true }
// Never combine lossless + hd_audio.
var RECORDING_AUDIO_MODE = "lossless"; // "lossless" | "hd_mp3"

// SECURITY SWITCH:
// - true  => deny by default unless trusted identity check passes.
// - false => DEVELOPMENT_ONLY fallback may allow commands.
var STRICT_RECORDING_CONTROLLER_AUTH = false;

// DEVELOPMENT_ONLY fallback:
// - keep true only while Stage 4 trusted identity plumbing is not integrated.
// - must be removed or disabled for production hardening.
var DEVELOPMENT_ONLY_ALLOW_UNTRUSTED_CONTROLLER = true;

// ── Webhook configuration (server POC paste-ready) ───────────────────────────
//
// WEBHOOK_BASE_URL defaults to the production server POC origin.
// WEBHOOK_SECRET must be replaced manually before pasting into Voximplant Console
// (see docs/voximplant/server-poc-scenario-paste-checklist.md).
//
// process.env.WEBHOOK_BASE_URL / WEBHOOK_SECRET may override when valid (see applyWebhookEnvironmentConfig).
// recording_control.message.webhookBaseUrl may override base URL when ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE=true.
//
// If WEBHOOK_BASE_URL or WEBHOOK_SECRET are not configured, webhook calls are skipped with explicit logs.
// The conference and recording remain stable — only server-side status tracking is lost.

var WEBHOOK_BASE_URL = "https://negotaitions.ru";
var WEBHOOK_SECRET   = "__PASTE_VOXIMPLANT_RECORDING_WEBHOOK_SECRET_HERE__";

// Stage 5.4.2: when true, recording_control.message.webhookBaseUrl may override WEBHOOK_BASE_URL.
// Set false for strict production; keep true for local tunnel testing.
var ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE = true;

// Cached webhook base URL from the last trusted recording_control message.
var cachedWebhookBaseUrlFromMessage = null;

// Canonical conference name prefix — must match lib/voximplant/conference-name.ts (negotiation-{sessionId}).
// sessionId is resolved first from recording_control.message.sessionId; conferenceName parsing is fallback only.
var CONFERENCE_NAME_PREFIX = "negotiation-";

// Last sessionId resolved from a trusted recording_control message.
var resolvedSessionId = null;

var STARTING_TIMEOUT_MS = 10000;
var STOPPING_TIMEOUT_MS = 10000;
var RESUMING_TIMEOUT_MS = 7000;

var STATE_IDLE = "idle";
var STATE_STARTING = "starting";
var STATE_RECORDING = "recording";
var STATE_PAUSED = "paused";
var STATE_RESUMING = "resuming";
var STATE_STOPPING = "stopping";
var STATE_STOPPED = "stopped";
var STATE_ERROR = "error";

var ACTION_START = "start";
var ACTION_PAUSE = "pause";
var ACTION_RESUME = "resume";
var ACTION_STOP = "stop";
var ACTION_STATUS = "status";

var conference = null;
var recorder = null;
var recordingState = STATE_IDLE;
var participants = 0;
var activeCallIds = {};
var scenarioStartedAt = Date.now();
var lastControllerCall = null;
var lastRequestId = null;
var lastErrorCode = null;
var lastErrorMessage = null;
var recordingUrl = null;
var recordingId = null;
var objectKey = null;
var pausedAt = null;
var resumedAt = null;

var startingWatchdogId = null;
var stoppingWatchdogId = null;
var resumingWatchdogId = null;

// ── Durable recording context (Stage 5.4.7) ─────────────────────────────────
//
// Populated on action=start; stopRequestId added on action=stop.
// Read in Recorder.Stopped to send the completion webhook.
// Cleared only after the webhook send has been attempted.
var currentRecordingContext = null;

// Fallback: last conferenceName seen in any recording_control message.
// Used to recover sessionId in Recorder.Stopped when currentRecordingContext is null.
var lastConferenceName = null;

function safeToString(value) {
  if (value === undefined || value === null) return "";
  try {
    if (typeof value === "string") return value;
    if (value.message) return String(value.message);
    return String(value);
  } catch (e) {
    return "value_to_string_failed";
  }
}

// ── Webhook helpers (Stage 5.4) ───────────────────────────────────────────────

// ── Pure JS SHA-256 + HMAC-SHA256 fallback (Stage 5.4.12) ────────────────────
//
// VoxEngine's embedded JS runtime does not expose Node's crypto.createHmac.
// This pure-JS implementation (FIPS 180-4 SHA-256 + RFC 2104 HMAC) is used
// when the Node crypto API is unavailable.
//
// Verified against Node.js crypto output — all test vectors match:
//   hmacSha256Hex("test", "secret")
//   => 0329a06b62cd16b33eb6792be8c60b158d89a2ee3a876fce9a881ebb488c0914
//   (generated via: node -e "require('crypto').createHmac('sha256','secret').update('test').digest('hex')")

function _rotr32(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function _pjsSha256(bytes) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var m = bytes.slice();
  var l = m.length * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  m.push(0, 0, 0, 0, (l >>> 24) & 0xff, (l >>> 16) & 0xff, (l >>> 8) & 0xff, l & 0xff);
  for (var i = 0; i < m.length; i += 64) {
    var w = [];
    for (var j = 0; j < 16; j++) {
      w[j] = (m[i+j*4]<<24) | (m[i+j*4+1]<<16) | (m[i+j*4+2]<<8) | m[i+j*4+3];
    }
    for (var j = 16; j < 64; j++) {
      var s0 = _rotr32(w[j-15],7) ^ _rotr32(w[j-15],18) ^ (w[j-15]>>>3);
      var s1 = _rotr32(w[j-2],17) ^ _rotr32(w[j-2],19) ^ (w[j-2]>>>10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) | 0;
    }
    var a=H[0], b=H[1], c=H[2], d=H[3], e=H[4], f=H[5], g=H[6], h=H[7];
    for (var j = 0; j < 64; j++) {
      var S1 = _rotr32(e,6) ^ _rotr32(e,11) ^ _rotr32(e,25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K[j] + w[j]) | 0;
      var S0 = _rotr32(a,2) ^ _rotr32(a,13) ^ _rotr32(a,22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  var out = [];
  for (var i = 0; i < 8; i++) {
    out.push((H[i]>>>24)&0xff, (H[i]>>>16)&0xff, (H[i]>>>8)&0xff, H[i]&0xff);
  }
  return out;
}

function _pjsStrToUtf8(s) {
  var b = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) {
      b.push(c);
    } else if (c < 0x800) {
      b.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      var lo = s.charCodeAt(++i);
      var cp = 0x10000 + ((c & 0x3FF) << 10) + (lo & 0x3FF);
      b.push(0xF0|(cp>>18), 0x80|((cp>>12)&0x3F), 0x80|((cp>>6)&0x3F), 0x80|(cp&0x3F));
    } else {
      b.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
  }
  return b;
}

/**
 * Pure-JS HMAC-SHA256: supports UTF-8 payload and key; returns lowercase hex.
 * Used as fallback when Node's crypto.createHmac is unavailable.
 */
function _pjsHmacSha256Hex(msgStr, keyStr) {
  var keyBytes = _pjsStrToUtf8(keyStr);
  var msgBytes = _pjsStrToUtf8(msgStr);
  if (keyBytes.length > 64) keyBytes = _pjsSha256(keyBytes);
  while (keyBytes.length < 64) keyBytes.push(0);
  var ipad = [], opad = [];
  for (var i = 0; i < 64; i++) {
    ipad.push(keyBytes[i] ^ 0x36);
    opad.push(keyBytes[i] ^ 0x5C);
  }
  var inner = _pjsSha256(ipad.concat(msgBytes));
  var outer = _pjsSha256(opad.concat(inner));
  var hex = "";
  for (var i = 0; i < outer.length; i++) {
    hex += ("0" + (outer[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

// HMAC provider resolved once at startup; logged via runHmacSelfTest().
var _hmacProvider = (typeof crypto !== "undefined" && crypto && typeof crypto.createHmac === "function")
  ? "node_crypto"
  : "pure_js";

/**
 * Compute HMAC-SHA256 hex digest of payload using the webhook secret.
 *
 * Provider selection (Stage 5.4.12):
 *   - node_crypto: crypto.createHmac available (standard Node / some VoxEngine builds)
 *   - pure_js:     pure-JS fallback (VoxEngine embedded runtime without Node crypto)
 *
 * Security contract:
 *   - Never logs secret
 *   - Never logs the generated HMAC value
 *   - On failure logs only a safe reason string
 */
function computeHmacSha256Hex(payload, secret) {
  try {
    if (_hmacProvider === "node_crypto") {
      var hmac = crypto.createHmac("sha256", secret);
      hmac.update(payload);
      return hmac.digest("hex");
    }
    return _pjsHmacSha256Hex(payload, secret);
  } catch (e) {
    log("HMAC computation failed: " + safeToString(e));
    return null;
  }
}

/**
 * Self-test for HMAC computation (Stage 5.4.12).
 * Runs once at scenario startup; logs provider and pass/fail only.
 * Never logs secret or generated HMAC values.
 *
 * Expected value verified via:
 *   node -e "require('crypto').createHmac('sha256','secret').update('test').digest('hex')"
 *   => 0329a06b62cd16b33eb6792be8c60b158d89a2ee3a876fce9a881ebb488c0914
 */
function runHmacSelfTest() {
  var SELF_TEST_EXPECTED = "0329a06b62cd16b33eb6792be8c60b158d89a2ee3a876fce9a881ebb488c0914";
  log("hmac provider=" + _hmacProvider);
  try {
    var result = computeHmacSha256Hex("test", "secret");
    var passed = (result === SELF_TEST_EXPECTED);
    log("HMAC self-test passed=" + passed);
    if (!passed) {
      log("HMAC self-test failed");
    }
  } catch (e) {
    log("HMAC self-test failed: exception " + safeToString(e));
  }
}

/**
 * Parse sessionId from canonical conference name: negotiation-{sessionId}
 */
function parseSessionIdFromConferenceName(name) {
  if (!name || typeof name !== "string") return null;
  if (!name.startsWith(CONFERENCE_NAME_PREFIX)) return null;
  var id = name.slice(CONFERENCE_NAME_PREFIX.length);
  return id || null;
}

/**
 * Resolve sessionId for webhook delivery.
 * Priority: message.sessionId → parse message.conferenceName → cached resolvedSessionId.
 * Never uses VoxEngine.applicationName().
 */
function resolveSessionId(context) {
  if (context && context.sessionId) {
    var direct = String(context.sessionId).trim();
    if (direct) return direct;
  }
  if (context && context.conferenceName) {
    var fromName = parseSessionIdFromConferenceName(String(context.conferenceName));
    if (fromName) return fromName;
  }
  if (resolvedSessionId) return resolvedSessionId;
  return null;
}

/**
 * Normalize and validate a webhook base URL without relying on new URL().
 * Returns the cleaned URL string on success, or null if invalid.
 * Requirements: non-empty string, https:// prefix, no localhost/127.0.0.1/.local,
 * no /api/sessions path already appended, trailing slashes stripped.
 */
function normalizeWebhookBaseUrl(value) {
  if (!value || typeof value !== "string") return null;
  var trimmed = value.trim();
  if (!trimmed) return null;
  // Require HTTPS
  if (trimmed.indexOf("https://") !== 0) return null;
  // Strip trailing slashes
  trimmed = trimmed.replace(/\/+$/, "");
  // Must have something after https://
  if (trimmed.length <= "https://".length) return null;
  var lower = trimmed.toLowerCase();
  // Reject localhost / loopback / .local TLD
  var afterScheme = lower.slice("https://".length);
  var hostPart = afterScheme.split("/")[0];
  if (hostPart === "localhost" || hostPart === "127.0.0.1") return null;
  if (hostPart.slice(-6) === ".local") return null;
  // Reject if caller accidentally included /api/sessions already
  if (lower.indexOf("/api/sessions") !== -1) return null;
  return trimmed;
}

/**
 * Returns true when WEBHOOK_SECRET looks like a real configured secret (not a placeholder).
 * Never logs the secret value.
 */
function isWebhookSecretConfigured(secret) {
  if (!secret || typeof secret !== "string") return false;
  var trimmed = secret.trim();
  if (!trimmed) return false;
  if (trimmed === "__PASTE_VOXIMPLANT_RECORDING_WEBHOOK_SECRET_HERE__") return false;
  if (trimmed.indexOf("PASTE") !== -1) return false;
  if (trimmed.indexOf("REPLACE") !== -1) return false;
  if (trimmed.length < 16) return false;
  return true;
}

/**
 * Apply VoxEngine environment overrides for webhook config (after normalize helpers exist).
 * Env values override static defaults only when they pass validation.
 */
function applyWebhookEnvironmentConfig() {
  try {
    if (typeof process !== "undefined" && process.env) {
      if (process.env.WEBHOOK_BASE_URL) {
        var envBase = normalizeWebhookBaseUrl(String(process.env.WEBHOOK_BASE_URL).trim());
        if (envBase) WEBHOOK_BASE_URL = envBase;
      }
      var envSecret = null;
      if (process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET) {
        envSecret = String(process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET).trim();
      } else if (process.env.WEBHOOK_SECRET) {
        envSecret = String(process.env.WEBHOOK_SECRET).trim();
      }
      if (envSecret && isWebhookSecretConfigured(envSecret)) {
        WEBHOOK_SECRET = envSecret;
      }
    }
  } catch (envReadErr) {
    Logger.write("[neg-conf-prod] env read failed: " + safeToString(envReadErr));
  }
}

/**
 * Log webhook configuration summary (no secrets). Call once at AppStarted.
 */
function logWebhookConfigSummary() {
  var normalizedStaticBase = normalizeWebhookBaseUrl(WEBHOOK_BASE_URL || null);
  log("webhook config:" +
      " scenarioBuildId=" + SCENARIO_BUILD_ID +
      " source=" + SCENARIO_SOURCE_NAME +
      " WEBHOOK_BASE_URL_set=" + Boolean(WEBHOOK_BASE_URL) +
      " normalizedWebhookBaseUrl=" + (normalizedStaticBase || "null") +
      " WEBHOOK_SECRET_configured=" + isWebhookSecretConfigured(WEBHOOK_SECRET) +
      " WEBHOOK_SECRET_length=" + (WEBHOOK_SECRET ? String(WEBHOOK_SECRET).length : 0) +
      " allowMessageWebhookBaseUrl=" + Boolean(ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE) +
      " conferenceNamePrefix=" + CONFERENCE_NAME_PREFIX +
      " hmacProvider=" + _hmacProvider);
}

/**
 * Resolve effective webhook base URL using a 4-level preference chain.
 * a) explicitWebhookBaseUrl  (passed by caller — usually stored context URL)
 * b) currentRecordingContext.webhookBaseUrl  (durable per-recording context)
 * c) cachedWebhookBaseUrlFromMessage  (module-level cache from any past message)
 * d) WEBHOOK_BASE_URL  (static environment variable)
 * Returns the first valid normalized URL, or null.
 */
function resolveEffectiveWebhookBaseUrl(explicitWebhookBaseUrl) {
  var contextWebhookBaseUrl = (currentRecordingContext && currentRecordingContext.webhookBaseUrl)
    ? currentRecordingContext.webhookBaseUrl : null;
  var candidates = [
    explicitWebhookBaseUrl || null,
    contextWebhookBaseUrl,
    cachedWebhookBaseUrlFromMessage,
    WEBHOOK_BASE_URL || null,
  ];
  for (var i = 0; i < candidates.length; i++) {
    var n = normalizeWebhookBaseUrl(candidates[i]);
    if (n) return n;
  }
  return null;
}

/**
 * Send a recording status webhook to the server.
 * Non-blocking: errors are logged but do not affect the conference or recording.
 *
 * @param {string} sessionId - The application session ID
 * @param {object} statusPayload - The recording_status message payload
 * @param {object} [extraFields] - Optional extra fields: startedAt, stoppedAt
 * @param {string} [explicitWebhookBaseUrl] - Override for webhook base URL resolution
 *   (pass the webhookBaseUrl stored in currentRecordingContext so Recorder.Stopped
 *   does not depend solely on the module-level cachedWebhookBaseUrlFromMessage).
 */
function sendRecordingWebhook(sessionId, statusPayload, extraFields, explicitWebhookBaseUrl) {
  var contextWebhookBaseUrl = (currentRecordingContext && currentRecordingContext.webhookBaseUrl)
    ? currentRecordingContext.webhookBaseUrl : null;
  var effectiveBaseUrl = resolveEffectiveWebhookBaseUrl(explicitWebhookBaseUrl || null);
  var webhookStatus = (statusPayload && statusPayload.status) ? String(statusPayload.status) : "unknown";
  var requestIdPresent = Boolean(statusPayload && statusPayload.requestId);
  var sessionIdPresent = Boolean(sessionId);
  var objectKeyPresent = Boolean(statusPayload && statusPayload.objectKey);
  var recordingUrlPresent = Boolean(statusPayload && statusPayload.recordingUrl);
  var secretConfigured = isWebhookSecretConfigured(WEBHOOK_SECRET);

  log("webhook decision:" +
      " status=" + webhookStatus +
      " requestId present=" + requestIdPresent +
      " sessionId present=" + sessionIdPresent +
      " effectiveWebhookBaseUrl present=" + Boolean(effectiveBaseUrl) +
      " WEBHOOK_BASE_URL_set=" + Boolean(WEBHOOK_BASE_URL) +
      " cachedWebhookBaseUrlFromMessage present=" + Boolean(cachedWebhookBaseUrlFromMessage) +
      " contextWebhookBaseUrl present=" + Boolean(contextWebhookBaseUrl) +
      " WEBHOOK_SECRET_configured=" + secretConfigured +
      " objectKeyPresent=" + objectKeyPresent +
      " recordingUrlPresent=" + recordingUrlPresent);

  if (!effectiveBaseUrl) {
    log("webhook skipped: missing effectiveWebhookBaseUrl");
    return;
  }
  if (!secretConfigured) {
    log("webhook skipped: WEBHOOK_SECRET not configured");
    return;
  }
  if (!sessionId) {
    log("webhook skipped: sessionId unresolved");
    return;
  }

  var url = effectiveBaseUrl + "/api/sessions/" + encodeURIComponent(sessionId) + "/voximplant/recording-status";

  var webhookPayload = {
    status: statusPayload.status,
    requestId: statusPayload.requestId || null,
    recordingId: statusPayload.recordingId || null,
    objectKey: statusPayload.objectKey || null,
    recordingUrl: statusPayload.recordingUrl || null,
    errorCode: statusPayload.errorCode || null,
    message: statusPayload.message || null,
  };

  if (extraFields) {
    if (extraFields.startedAt) webhookPayload.startedAt = extraFields.startedAt;
    if (extraFields.stoppedAt) webhookPayload.stoppedAt = extraFields.stoppedAt;
  }

  var body = "";
  try {
    body = JSON.stringify(webhookPayload);
  } catch (jsonErr) {
    log("webhook skipped: JSON serialization failed: " + safeToString(jsonErr));
    return;
  }

  var hmacHex = computeHmacSha256Hex(body, WEBHOOK_SECRET);
  if (!hmacHex) {
    log("webhook skipped: HMAC computation unavailable");
    return;
  }

  // Part C: log that we are about to POST (non-secret — URL contains no credentials).
  log("webhook POST attempted url=" + url + " status=" + webhookPayload.status +
      " objectKeyPresent=" + Boolean(webhookPayload.objectKey) +
      " recordingUrlPresent=" + Boolean(webhookPayload.recordingUrl));

  try {
    Net.httpRequestAsync(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Voximplant-Signature": "hmac-sha256=" + hmacHex,
      },
      postData: body,
    }, function (result) {
      var respCode = safeToString(result && result.code);
      var respBody = "";
      try {
        respBody = (result && result.text) ? String(result.text).slice(0, 200) : "";
      } catch (readErr) {
        respBody = "body_read_failed";
      }
      if (result && result.code >= 200 && result.code < 300) {
        log("webhook response status=" + respCode + " body=" + respBody);
      } else {
        log("webhook response non-2xx status=" + respCode + " body=" + respBody);
      }
    });
  } catch (httpErr) {
    log("webhook send error: " + safeToString(httpErr));
  }
}

function safeCall(call, methodName, fallbackValue) {
  if (!call || typeof call[methodName] !== "function") {
    return fallbackValue;
  }
  try {
    return call[methodName]();
  } catch (e) {
    return fallbackValue;
  }
}

function getCallId(call) {
  return safeToString(safeCall(call, "id", "unknown-call-id")) || "unknown-call-id";
}

function safeNowIso() {
  try {
    return new Date().toISOString();
  } catch (e) {
    return null;
  }
}

function log(message) {
  Logger.write(
    "[neg-conf-prod] uptime_ms=" + (Date.now() - scenarioStartedAt) +
      " participants=" + participants +
      " state=" + recordingState +
      " " + message,
  );
}

function getNamespaceRef(name) {
  try {
    if (name === "AppEvents" && typeof AppEvents !== "undefined") return AppEvents;
    if (name === "CallEvents" && typeof CallEvents !== "undefined") return CallEvents;
    if (name === "ConferenceEvents" && typeof ConferenceEvents !== "undefined") return ConferenceEvents;
    if (name === "RecorderEvents" && typeof RecorderEvents !== "undefined") return RecorderEvents;
  } catch (e) {
    return null;
  }
  return null;
}

function getEventConstant(namespaceName, eventName) {
  var ns = getNamespaceRef(namespaceName);
  if (!ns) {
    log("event namespace unavailable: " + namespaceName + "." + eventName);
    return null;
  }
  try {
    var constant = ns[eventName];
    if (constant === undefined || constant === null) {
      log("event constant unavailable: " + namespaceName + "." + eventName);
      return null;
    }
    return constant;
  } catch (e) {
    log("event constant read failed: " + namespaceName + "." + eventName + " err=" + safeToString(e));
    return null;
  }
}

function addSafeEventListener(target, namespaceName, eventName, handler, label) {
  if (!target) {
    log("skip listener (no target): " + (label || namespaceName + "." + eventName));
    return false;
  }
  var constant = getEventConstant(namespaceName, eventName);
  if (!constant) {
    log("skip listener (missing constant): " + (label || namespaceName + "." + eventName));
    return false;
  }
  try {
    target.addEventListener(constant, handler);
    log("listener registered: " + (label || namespaceName + "." + eventName));
    return true;
  } catch (e) {
    log("listener registration failed: " + (label || namespaceName + "." + eventName) + " err=" + safeToString(e));
    return false;
  }
}

function clearWatchdog(timerId) {
  if (timerId !== null) {
    clearTimeout(timerId);
  }
  return null;
}

function clearAllWatchdogs() {
  startingWatchdogId = clearWatchdog(startingWatchdogId);
  stoppingWatchdogId = clearWatchdog(stoppingWatchdogId);
  resumingWatchdogId = clearWatchdog(resumingWatchdogId);
}

function normalizeObjectKeyFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  // Best-effort extraction only. Real handoff may come from webhook/status API later.
  var marker = ".net/";
  var idx = url.indexOf(marker);
  if (idx < 0) return null;
  var tail = url.substring(idx + marker.length);
  return tail || null;
}

function buildStatusPayload(requestId, status, message, errorCode) {
  return {
    type: "recording_status",
    requestId: requestId || null,
    status: status,
    message: message || undefined,
    recordingUrl: recordingUrl || null,
    recordingId: recordingId || null,
    objectKey: objectKey || null,
    pausedAt: pausedAt || null,
    resumedAt: resumedAt || null,
    errorCode: errorCode || null,
    // Stage 5.4.9: scenario version diagnostic — allows browser to confirm which build is running.
    scenarioBuildId: SCENARIO_BUILD_ID,
    scenarioSourceName: SCENARIO_SOURCE_NAME,
  };
}

function sendStatus(call, requestId, status, message, errorCode) {
  var payload = buildStatusPayload(requestId, status, message, errorCode);
  if (!call) {
    log("sendStatus skipped (no call): status=" + status + " requestId=" + (requestId || "none"));
    return;
  }
  try {
    call.sendMessage(JSON.stringify(payload));
    log(
      "status sent status=" + status +
        " requestId=" + (requestId || "none") +
        (errorCode ? " errorCode=" + errorCode : ""),
    );
  } catch (e) {
    log("sendStatus failed: " + safeToString(e));
  }
}

function setErrorState(errorCode, message) {
  recordingState = STATE_ERROR;
  lastErrorCode = errorCode || "UNKNOWN_RECORDING_ERROR";
  lastErrorMessage = message || "Recording operation failed.";
}

function safeRecorderMute(muteOn) {
  if (!recorder) return false;
  if (typeof recorder.mute !== "function") return false;
  try {
    recorder.mute(Boolean(muteOn));
    return true;
  } catch (e) {
    return false;
  }
}

function extractTrustedIdentity(call) {
  // Best effort only. Actual trust model should be wired with Stage 4 identities.
  var username = safeCall(call, "callerid", null) || safeCall(call, "displayName", null) || null;
  var customData = null;
  if (typeof call.customData === "function") {
    try {
      customData = call.customData();
    } catch (e) {
      customData = null;
    }
  }
  return {
    username: username ? String(username) : null,
    customData: customData || null,
  };
}

function looksLikeFacilitatorIdentity(identity) {
  if (!identity) return false;

  // Placeholder examples. Replace with strict trusted checks in Stage 4.
  if (identity.username && /facilitator/i.test(identity.username)) {
    return true;
  }
  if (identity.customData && typeof identity.customData === "string") {
    try {
      var parsed = JSON.parse(identity.customData);
      if (parsed && parsed.role === "facilitator") return true;
    } catch (e) {
      // ignore malformed custom data
    }
  }
  return false;
}

function isAuthorizedRecordingController(call, payload) {
  var identity = extractTrustedIdentity(call);
  var trustedFacilitator = looksLikeFacilitatorIdentity(identity);

  if (trustedFacilitator) {
    return { allowed: true, reason: "trusted_identity" };
  }

  if (STRICT_RECORDING_CONTROLLER_AUTH) {
    return { allowed: false, reason: "STRICT_AUTH_NO_TRUSTED_IDENTITY" };
  }

  if (DEVELOPMENT_ONLY_ALLOW_UNTRUSTED_CONTROLLER) {
    // DEVELOPMENT_ONLY fallback. payload.role is untrusted and only informative.
    return { allowed: true, reason: "DEVELOPMENT_ONLY_FALLBACK" };
  }

  return { allowed: false, reason: "UNTRUSTED_CONTROLLER" };
}

/**
 * Parse a recording_control payload from a raw text or object.
 * Handles three shapes the browser relay may deliver:
 *   A. event.text is JSON recording_control directly:
 *        {"type":"recording_control", ...}
 *   B. event.text is a relay wrapper with payload as string:
 *        {"name":"message","payload":"{\"type\":\"recording_control\",...}"}
 *   C. event.text is a relay wrapper with payload as object:
 *        {"name":"message","payload":{"type":"recording_control",...}}
 * Returns the normalized recording_control object, or null if not applicable.
 * Never throws.
 */
function parseRecordingControlPayload(rawTextOrObject) {
  try {
    var outer;
    if (typeof rawTextOrObject === "string") {
      try { outer = JSON.parse(rawTextOrObject); } catch (e) { return null; }
    } else if (rawTextOrObject && typeof rawTextOrObject === "object") {
      outer = rawTextOrObject;
    } else {
      return null;
    }
    if (!outer) return null;

    // Unwrap shape B/C: {"name":"message","payload":...}
    var inner = outer;
    if (outer.name === "message" && outer.payload !== undefined) {
      if (typeof outer.payload === "string") {
        try { inner = JSON.parse(outer.payload); } catch (e) { return null; }
      } else if (outer.payload && typeof outer.payload === "object") {
        inner = outer.payload;
      } else {
        return null;
      }
    }

    if (!inner || inner.type !== "recording_control") return null;

    var action = inner.action ? String(inner.action) : "";
    var requestId = inner.requestId ? String(inner.requestId) : "";
    if (!requestId) return null;
    if (
      action !== ACTION_START &&
      action !== ACTION_PAUSE &&
      action !== ACTION_RESUME &&
      action !== ACTION_STOP &&
      action !== ACTION_STATUS
    ) {
      return null;
    }
    return {
      type: "recording_control",
      action: action,
      requestId: requestId,
      sessionId: inner.sessionId ? String(inner.sessionId) : undefined,
      conferenceName: inner.conferenceName ? String(inner.conferenceName) : undefined,
      webhookBaseUrl: inner.webhookBaseUrl ? String(inner.webhookBaseUrl) : undefined,
      participantId: inner.participantId ? String(inner.participantId) : undefined,
      role: inner.role ? String(inner.role) : undefined,
    };
  } catch (e) {
    return null;
  }
}

function attachRecorderEventHandlers(commandRequestId) {
  addSafeEventListener(recorder, "RecorderEvents", "Started", function (e) {
    log("Recorder.Started handler entered");
    startingWatchdogId = clearWatchdog(startingWatchdogId);
    if (recordingState !== STATE_STARTING) {
      return;
    }
    recordingState = STATE_RECORDING;
    recordingUrl = (e && e.url) ? String(e.url) : recordingUrl;
    recordingId = (e && e.id) ? String(e.id) : recordingId;
    objectKey = normalizeObjectKeyFromUrl(recordingUrl);
    log("Recorder.Started:" +
        " recordingUrl present=" + Boolean(recordingUrl) +
        " extractedFileKey present=" + Boolean(objectKey) +
        " recordingId present=" + Boolean(recordingId) +
        " context present=" + Boolean(currentRecordingContext) +
        " context sessionId present=" + Boolean(currentRecordingContext && currentRecordingContext.sessionId) +
        " context webhookBaseUrl present=" + Boolean(currentRecordingContext && currentRecordingContext.webhookBaseUrl));
    var statusPayload = buildStatusPayload(commandRequestId || lastRequestId, STATE_RECORDING, "Recording is active.", null);
    sendStatus(lastControllerCall, commandRequestId || lastRequestId, STATE_RECORDING, "Recording is active.", null);
    log("webhook POST intent status=recording sessionId=" + (resolvedSessionId || "null"));
    sendRecordingWebhook(resolvedSessionId, statusPayload, { startedAt: safeNowIso() });
  }, "RecorderEvents.Started");

  addSafeEventListener(recorder, "RecorderEvents", "Stopped", function (e) {
    stoppingWatchdogId = clearWatchdog(stoppingWatchdogId);

    // ── Part C: diagnostics — handler entered ───────────────────────────────
    log("Recorder.Stopped handler entered");

    // ── Part A: read durable context captured at start/stop ─────────────────
    var ctx = currentRecordingContext;
    var ctxPresent = Boolean(ctx);
    var ctxSessionId   = (ctx && ctx.sessionId)        ? ctx.sessionId        : null;
    var ctxWebhookUrl  = (ctx && ctx.webhookBaseUrl)   ? ctx.webhookBaseUrl   : null;
    var ctxStopReqId   = (ctx && ctx.stopRequestId)    ? ctx.stopRequestId    : null;
    var ctxConfName    = (ctx && ctx.conferenceName)   ? ctx.conferenceName   : null;

    log("context present=" + ctxPresent +
        " sessionId present=" + Boolean(ctxSessionId || resolvedSessionId) +
        " context webhookBaseUrl present=" + Boolean(ctxWebhookUrl));

    // ── Update recording state and URL fields ────────────────────────────────
    recordingState = STATE_STOPPED;
    recordingUrl   = (e && e.url) ? String(e.url) : recordingUrl;
    recordingId    = (e && e.id)  ? String(e.id)  : recordingId;
    objectKey      = objectKey || normalizeObjectKeyFromUrl(recordingUrl);

    var stoppedRecordingUrl = recordingUrl;
    var stoppedObjectKey    = objectKey;
    var fileKeyPresent      = Boolean(stoppedObjectKey);
    var effectiveStopRequestId = ctxStopReqId || lastRequestId || null;

    log("recordingUrl present=" + Boolean(stoppedRecordingUrl) +
        " extractedFileKey present=" + fileKeyPresent +
        " recordingId present=" + Boolean(recordingId) +
        " context present=" + ctxPresent +
        " context sessionId present=" + Boolean(ctxSessionId) +
        " context webhookBaseUrl present=" + Boolean(ctxWebhookUrl) +
        " stopRequestId present=" + Boolean(effectiveStopRequestId));

    // ── Part A.5: use stop requestId; do not fall back to start requestId ───
    // commandRequestId is the START requestId captured in the closure.
    // ctxStopReqId / lastRequestId are both updated to the STOP requestId.

    // Build payload and send browser status using the stop requestId.
    var statusPayload = buildStatusPayload(effectiveStopRequestId, STATE_STOPPED, "Recording stopped.", null);
    sendStatus(lastControllerCall, effectiveStopRequestId, STATE_STOPPED, "Recording stopped.", null);

    // ── Part D.1: resolve sessionId with cascading fallback ─────────────────
    var stoppedSessionId = ctxSessionId || resolvedSessionId || null;
    if (!stoppedSessionId && ctxConfName) {
      stoppedSessionId = parseSessionIdFromConferenceName(ctxConfName);
      if (stoppedSessionId) log("sessionId recovered from context.conferenceName=" + stoppedSessionId);
    }
    if (!stoppedSessionId && lastConferenceName) {
      stoppedSessionId = parseSessionIdFromConferenceName(lastConferenceName);
      if (stoppedSessionId) log("sessionId recovered from lastConferenceName=" + stoppedSessionId);
    }

    // ── Part B.3: resolve webhook base URL from context, then fallback ───────
    // Pass stored context URL explicitly so sendRecordingWebhook does not rely
    // solely on the module-level cachedWebhookBaseUrlFromMessage.
    var webhookBaseUrlForRequest = ctxWebhookUrl || cachedWebhookBaseUrlFromMessage || null;

    // Part C: log the full webhook URL we will POST to (no secret included)
    var resolvedBase = resolveEffectiveWebhookBaseUrl(webhookBaseUrlForRequest);
    var webhookTargetUrl = (stoppedSessionId && resolvedBase)
      ? resolvedBase + "/api/sessions/" + stoppedSessionId + "/voximplant/recording-status"
      : null;
    log("webhook URL=" + (webhookTargetUrl || "null (will be skipped)"));

    // Set recorder = null only after all synchronous payload building is done.
    recorder = null;

    // Part C: explicit pre-attempt log so we can see intent even if POST fails
    log("webhook POST intent status=stopped sessionId=" + (stoppedSessionId || "null") +
        " fileKeyPresent=" + fileKeyPresent +
        " recordingUrlPresent=" + Boolean(stoppedRecordingUrl) +
        " stopRequestId=" + (effectiveStopRequestId || "null"));

    // ── Part B: send signed completion webhook to Next.js ───────────────────
    // Part D.2: if fileKey extraction failed, still send webhook (with recordingUrl
    // and fileKeyPresent=false in logs) so the server gets stoppedAt at minimum.
    sendRecordingWebhook(stoppedSessionId, statusPayload, { stoppedAt: safeNowIso() }, webhookBaseUrlForRequest);

    // ── Part A/D: clear context only after webhook attempt ──────────────────
    currentRecordingContext = null;
    log("context cleanup after webhook attempt");
  }, "RecorderEvents.Stopped");

  addSafeEventListener(recorder, "RecorderEvents", "Error", function (e) {
    clearAllWatchdogs();
    var safeErrorCode = safeToString(e && e.code) || "RECORDER_EVENT_ERROR";
    var safeErrorMsg = safeToString(e && e.message) || "Recorder error event.";
    setErrorState(safeErrorCode, safeErrorMsg);
    log("Recorder.Error handler entered code=" + safeErrorCode + " message=" + safeErrorMsg);
    var statusPayload = buildStatusPayload(commandRequestId || lastRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    sendStatus(lastControllerCall, commandRequestId || lastRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    log("webhook POST intent status=error sessionId=" + (resolvedSessionId || "null"));
    sendRecordingWebhook(resolvedSessionId, statusPayload, null);
    recorder = null;
  }, "RecorderEvents.Error");
}

function startRecording(call, requestId) {
  if (recordingState === STATE_STARTING || recordingState === STATE_RECORDING) {
    sendStatus(call, requestId, recordingState, "Recording already active.", null);
    return;
  }
  if (
    recordingState !== STATE_IDLE &&
    recordingState !== STATE_STOPPED &&
    recordingState !== STATE_ERROR
  ) {
    sendStatus(call, requestId, recordingState, "Start is not valid from current state.", null);
    return;
  }
  if (!conference) {
    setErrorState("CONFERENCE_NOT_READY", "Conference is not initialized.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    return;
  }
  if (typeof VoxEngine.createRecorder !== "function") {
    setErrorState("RECORDER_API_UNAVAILABLE", "VoxEngine.createRecorder is unavailable.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    return;
  }
  if (typeof conference.sendMediaTo !== "function") {
    setErrorState("CONFERENCE_MEDIA_ROUTING_UNAVAILABLE", "conference.sendMediaTo is unavailable.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    return;
  }

  recordingState = STATE_STARTING;
  lastControllerCall = call;
  lastRequestId = requestId;
  lastErrorCode = null;
  lastErrorMessage = null;
  pausedAt = null;
  resumedAt = null;
  sendStatus(call, requestId, STATE_STARTING, "Recording start requested.", null);
  log("webhook POST intent status=starting sessionId=" + (resolvedSessionId || "null"));
  sendRecordingWebhook(resolvedSessionId, buildStatusPayload(requestId, STATE_STARTING, "Recording start requested.", null), { startedAt: safeNowIso() });

  try {
    var options = {
      video: false,
      name: "negotiation-room-audio-only",
      recordNamePrefix: "negotiation-room/audio/",
    };
    if (RECORDING_AUDIO_MODE === "lossless") {
      options.lossless = true;
    } else {
      options.hd_audio = true;
    }

    recorder = VoxEngine.createRecorder(options);
    if (!recorder) {
      setErrorState("RECORDER_CREATE_FAILED", "Recorder was not created.");
      sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
      return;
    }

    attachRecorderEventHandlers(requestId);
    conference.sendMediaTo(recorder);

    startingWatchdogId = setTimeout(function () {
      startingWatchdogId = null;
      if (recordingState === STATE_STARTING) {
        setErrorState("STARTING_TIMEOUT", "Recorder did not enter recording state in time.");
        sendStatus(lastControllerCall, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
        recorder = null;
      }
    }, STARTING_TIMEOUT_MS);
  } catch (e) {
    setErrorState("START_RECORDING_EXCEPTION", safeToString(e));
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    recorder = null;
  }
}

function pauseRecording(call, requestId) {
  if (recordingState !== STATE_RECORDING) {
    sendStatus(call, requestId, recordingState, "Pause is valid only from recording state.", null);
    return;
  }
  if (!recorder) {
    setErrorState("RECORDER_MISSING_ON_PAUSE", "Recorder is missing.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    return;
  }
  if (typeof recorder.mute !== "function") {
    setErrorState("RECORDER_MUTE_UNAVAILABLE", "Recorder pause API is unavailable.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    return;
  }
  try {
    recorder.mute(true);
    recordingState = STATE_PAUSED;
    pausedAt = safeNowIso();
    lastControllerCall = call;
    lastRequestId = requestId;
    sendStatus(call, requestId, STATE_PAUSED, "Recording paused via recorder.mute(true).", null);
  } catch (e) {
    setErrorState("PAUSE_EXCEPTION", safeToString(e));
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
  }
}

function resumeRecording(call, requestId) {
  if (recordingState !== STATE_PAUSED) {
    sendStatus(call, requestId, recordingState, "Resume is valid only from paused state.", null);
    return;
  }
  if (!recorder) {
    setErrorState("RECORDER_MISSING_ON_RESUME", "Recorder is missing.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    return;
  }
  if (typeof recorder.mute !== "function") {
    setErrorState("RECORDER_MUTE_UNAVAILABLE", "Recorder resume API is unavailable.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    return;
  }

  try {
    recordingState = STATE_RESUMING;
    lastControllerCall = call;
    lastRequestId = requestId;
    sendStatus(call, requestId, STATE_RESUMING, "Recording resume requested.", null);

    recorder.mute(false);
    recordingState = STATE_RECORDING;
    resumedAt = safeNowIso();
    sendStatus(call, requestId, STATE_RECORDING, "Recording resumed via recorder.mute(false).", null);

    // Defensive watchdog for future async resume behavior.
    resumingWatchdogId = setTimeout(function () {
      resumingWatchdogId = null;
      if (recordingState === STATE_RESUMING) {
        setErrorState("RESUMING_TIMEOUT", "Recorder did not finish resuming in time.");
        sendStatus(lastControllerCall, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
      }
    }, RESUMING_TIMEOUT_MS);
  } catch (e) {
    setErrorState("RESUME_EXCEPTION", safeToString(e));
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
  }
}

function stopRecording(call, requestId) {
  if (
    recordingState !== STATE_RECORDING &&
    recordingState !== STATE_PAUSED &&
    recordingState !== STATE_STARTING &&
    recordingState !== STATE_ERROR
  ) {
    sendStatus(call, requestId, "not_recording", "Recording is not active.", null);
    return;
  }
  if (!recorder) {
    recordingState = STATE_STOPPED;
    sendStatus(call, requestId, STATE_STOPPED, "Recorder not present; treated as stopped.", null);
    return;
  }

  recordingState = STATE_STOPPING;
  lastControllerCall = call;
  lastRequestId = requestId;
  startingWatchdogId = clearWatchdog(startingWatchdogId);
  resumingWatchdogId = clearWatchdog(resumingWatchdogId);
  sendStatus(call, requestId, STATE_STOPPING, "Recording stop requested.", null);
  log("webhook POST intent status=stopping sessionId=" + (resolvedSessionId || "null"));
  sendRecordingWebhook(resolvedSessionId, buildStatusPayload(requestId, STATE_STOPPING, "Recording stop requested.", null), null);

  try {
    if (typeof recorder.stop === "function") {
      recorder.stop();
    } else if (typeof recorder.stopRecord === "function") {
      recorder.stopRecord();
    } else {
      setErrorState("RECORDER_STOP_UNAVAILABLE", "Recorder stop method unavailable.");
      sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
      log("webhook POST intent status=error reason=RECORDER_STOP_UNAVAILABLE sessionId=" + (resolvedSessionId || "null"));
      sendRecordingWebhook(
        resolvedSessionId,
        buildStatusPayload(requestId, STATE_ERROR, lastErrorMessage, lastErrorCode),
        null,
      );
      return;
    }

    stoppingWatchdogId = setTimeout(function () {
      stoppingWatchdogId = null;
      if (recordingState === STATE_STOPPING) {
        setErrorState("STOPPING_TIMEOUT", "Recorder did not stop in time.");
        sendStatus(lastControllerCall, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
        recorder = null;
      }
    }, STOPPING_TIMEOUT_MS);
  } catch (e) {
    setErrorState("STOP_EXCEPTION", safeToString(e));
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    log("webhook POST intent status=error reason=STOP_EXCEPTION sessionId=" + (resolvedSessionId || "null"));
    sendRecordingWebhook(
      resolvedSessionId,
      buildStatusPayload(requestId, STATE_ERROR, lastErrorMessage, lastErrorCode),
      null,
    );
    recorder = null;
  }
}

function sendCurrentStatus(call, requestId) {
  var msg = "Current recording state.";
  if (recordingState === STATE_ERROR && lastErrorMessage) {
    msg = "Current recording state error: " + lastErrorMessage;
  }
  sendStatus(call, requestId, recordingState, msg, lastErrorCode);
}

function onRecordingControlMessage(call, payload) {
  var normalizedFromMessage = normalizeWebhookBaseUrl(payload.webhookBaseUrl || null);
  log("recording_control received:" +
      " action=" + payload.action +
      " requestId present=" + Boolean(payload.requestId) +
      " sessionId present=" + Boolean(payload.sessionId) +
      " conferenceName present=" + Boolean(payload.conferenceName) +
      " webhookBaseUrl present=" + Boolean(payload.webhookBaseUrl) +
      " normalizedWebhookBaseUrl present=" + Boolean(normalizedFromMessage));

  var sessionId = resolveSessionId(payload);
  if (!sessionId) {
    sendStatus(
      call,
      payload.requestId,
      STATE_ERROR,
      "Session ID could not be resolved from recording control message.",
      "SESSION_ID_UNRESOLVED",
    );
    log("recording control rejected: sessionId unresolved requestId=" + payload.requestId);
    return;
  }
  resolvedSessionId = sessionId;

  // Keep lastConferenceName updated for Recorder.Stopped recovery fallback.
  if (payload.conferenceName) {
    lastConferenceName = String(payload.conferenceName);
  }

  // Stage 5.4.11: use normalizeWebhookBaseUrl — no new URL() dependency.
  if (ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE && normalizedFromMessage) {
    cachedWebhookBaseUrlFromMessage = normalizedFromMessage;
    log("cachedWebhookBaseUrlFromMessage updated present=true");
  }

  var auth = isAuthorizedRecordingController(call, payload);
  if (!auth.allowed) {
    sendStatus(call, payload.requestId, STATE_ERROR, "Recording control is not authorized.", "UNAUTHORIZED_RECORDING_CONTROLLER");
    log("recording control denied callId=" + getCallId(call) + " reason=" + auth.reason);
    return;
  }

  log(
    "recording_control action=" + payload.action +
      " requestId=" + payload.requestId +
      " callId=" + getCallId(call) +
      " controller authorized reason=" + auth.reason,
  );

  // ── Maintain durable currentRecordingContext ──────────────────────────────

  if (payload.action === ACTION_START) {
    // Stage 5.4.11: resolve webhookBaseUrl with explicit preference order:
    //   1. normalized URL from this message (most authoritative)
    //   2. previously cached URL from a past message
    //   3. static WEBHOOK_BASE_URL environment variable
    var messageWebhookBaseUrl = normalizeWebhookBaseUrl(payload.webhookBaseUrl || null);
    // Update cache so later Recorder.Stopped calls can use it even without context.
    if (ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE && messageWebhookBaseUrl) {
      cachedWebhookBaseUrlFromMessage = messageWebhookBaseUrl;
    }
    var contextWebhookBaseUrl =
      messageWebhookBaseUrl ||
      cachedWebhookBaseUrlFromMessage ||
      normalizeWebhookBaseUrl(WEBHOOK_BASE_URL || null) ||
      null;

    log("ACTION_START webhook resolve:" +
        " incoming webhookBaseUrl present=" + Boolean(payload.webhookBaseUrl) +
        " normalized webhookBaseUrl present=" + Boolean(messageWebhookBaseUrl) +
        " cachedWebhookBaseUrlFromMessage present=" + Boolean(cachedWebhookBaseUrlFromMessage) +
        " context webhookBaseUrl present=" + Boolean(contextWebhookBaseUrl));

    // Create a fresh context; webhookBaseUrl stored so Recorder.Stopped can use it
    // even if cachedWebhookBaseUrlFromMessage is replaced by a later message.
    currentRecordingContext = {
      sessionId: sessionId,
      conferenceName: payload.conferenceName || null,
      webhookBaseUrl: contextWebhookBaseUrl,
      participantId: payload.participantId || null,
      startRequestId: payload.requestId,
      stopRequestId: null,
    };
    log("recording context created sessionId=" + sessionId +
        " context webhookBaseUrl present=" + Boolean(currentRecordingContext.webhookBaseUrl));
    startRecording(call, payload.requestId);
    return;
  }

  if (payload.action === ACTION_STOP) {
    // Stage 5.4.11: refresh URL from stop message if valid, then fill any gap.
    var stopMessageWebhookBaseUrl = normalizeWebhookBaseUrl(payload.webhookBaseUrl || null);
    if (ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE && stopMessageWebhookBaseUrl) {
      cachedWebhookBaseUrlFromMessage = stopMessageWebhookBaseUrl;
    }

    if (currentRecordingContext) {
      // Store stopRequestId; refresh webhookBaseUrl in case tunnel rotated.
      currentRecordingContext.stopRequestId = payload.requestId;
      if (stopMessageWebhookBaseUrl) {
        currentRecordingContext.webhookBaseUrl = stopMessageWebhookBaseUrl;
      } else if (!currentRecordingContext.webhookBaseUrl) {
        // Fill gap from cache or static env
        currentRecordingContext.webhookBaseUrl =
          cachedWebhookBaseUrlFromMessage ||
          normalizeWebhookBaseUrl(WEBHOOK_BASE_URL || null) ||
          null;
      }
      log("recording context updated stopRequestId=" + payload.requestId +
          " context webhookBaseUrl present=" + Boolean(currentRecordingContext.webhookBaseUrl));
    } else {
      // Context was lost (e.g. scenario restart); reconstruct from this message.
      var stopContextWebhookBaseUrl =
        stopMessageWebhookBaseUrl ||
        cachedWebhookBaseUrlFromMessage ||
        normalizeWebhookBaseUrl(WEBHOOK_BASE_URL || null) ||
        null;
      currentRecordingContext = {
        sessionId: sessionId,
        conferenceName: payload.conferenceName || null,
        webhookBaseUrl: stopContextWebhookBaseUrl,
        participantId: payload.participantId || null,
        startRequestId: null,
        stopRequestId: payload.requestId,
      };
      log("recording context reconstructed from stop message sessionId=" + sessionId +
          " context webhookBaseUrl present=" + Boolean(currentRecordingContext.webhookBaseUrl));
    }
    // Do NOT clear context here — wait until Recorder.Stopped is processed.
    stopRecording(call, payload.requestId);
    return;
  }

  if (payload.action === ACTION_PAUSE) {
    pauseRecording(call, payload.requestId);
    return;
  }
  if (payload.action === ACTION_RESUME) {
    resumeRecording(call, payload.requestId);
    return;
  }
  sendCurrentStatus(call, payload.requestId);
}

function handleIncomingCall(event) {
  var call = event.call;
  var callId = getCallId(call);
  var scheme = event && event.scheme ? String(event.scheme) : "unknown";

  log("incoming call callId=" + callId + " scheme=" + scheme);
  try {
    call.answer();
  } catch (e) {
    log("call answer failed callId=" + callId + " err=" + safeToString(e));
    return;
  }

  if (!activeCallIds[callId]) {
    activeCallIds[callId] = true;
    participants += 1;
  }

  try {
    conference.add({
      call: call,
      mode: "FORWARD",
      direction: "BOTH",
      scheme: event.scheme,
    });
  } catch (e) {
    log("conference.add failed callId=" + callId + " err=" + safeToString(e));
    if (activeCallIds[callId]) {
      delete activeCallIds[callId];
      participants = Math.max(0, participants - 1);
    }
    try {
      call.hangup();
    } catch (he) {
      log("hangup after add failure failed callId=" + callId);
    }
    return;
  }

  addSafeEventListener(call, "CallEvents", "MessageReceived", function (msgEvent) {
    // Stage 5.4.11: use parseRecordingControlPayload — handles shapes A, B, C.
    var raw = (msgEvent && msgEvent.text !== undefined) ? msgEvent.text : null;
    if (raw === null || raw === undefined) return;
    // msgEvent.text may already be an object in some VoxEngine versions.
    var payload = parseRecordingControlPayload(
      (typeof raw === "string") ? raw : raw
    );
    if (!payload) return;
    onRecordingControlMessage(call, payload);
  }, "CallEvents.MessageReceived");

  addSafeEventListener(call, "CallEvents", "Disconnected", function () {
    if (activeCallIds[callId]) {
      delete activeCallIds[callId];
      participants = Math.max(0, participants - 1);
    }
    log("call disconnected callId=" + callId + " remaining=" + participants);
  }, "CallEvents.Disconnected");

  addSafeEventListener(call, "CallEvents", "Failed", function (failedEvent) {
    log(
      "call failed callId=" + callId +
        " code=" + safeToString(failedEvent && failedEvent.code) +
        " reason=" + safeToString(failedEvent && failedEvent.reason),
    );
  }, "CallEvents.Failed");
}

function onAppStarted() {
  applyWebhookEnvironmentConfig();
  log("scenario build=" + SCENARIO_BUILD_ID + " source=" + SCENARIO_SOURCE_NAME);
  log("scenario started — sessionId is resolved from recording_control.message.sessionId first; conferenceName parsing is fallback only");
  logWebhookConfigSummary();
  runHmacSelfTest();
  try {
    conference = VoxEngine.createConference({ hd_audio: true });
  } catch (e) {
    log("createConference failed err=" + safeToString(e));
    return;
  }

  addSafeEventListener(conference, "ConferenceEvents", "Started", function () {
    log("conference started");
  }, "ConferenceEvents.Started");

  addSafeEventListener(conference, "ConferenceEvents", "Stopped", function () {
    log("conference stopped");
    // Conference can stop/restart independently from recording controls.
  }, "ConferenceEvents.Stopped");
}

addSafeEventListener(VoxEngine, "AppEvents", "Started", onAppStarted, "AppEvents.Started");
addSafeEventListener(VoxEngine, "AppEvents", "CallAlerting", handleIncomingCall, "AppEvents.CallAlerting");
