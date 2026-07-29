/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

// ============================================================
// NEGOTIATION ROOM SCENARIO (RELEASE CANDIDATE ARTIFACT)
// ============================================================
//
// This file is a production-oriented VoxEngine scenario artifact.
// It does NOT change app runtime behavior.
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
// - return typed recording_status payloads compatible with current client shape;
// - add explicit authorization placeholder for future Stage 4 identity model.

require(Modules.Conference);

// Requirement: use Recorder module, but never let recorder availability
// break the conference path.
try {
  require(Modules.Recorder);
} catch (err) {
  Logger.write("[neg-conf-prod] Modules.Recorder require failed: " + safeToString(err));
}

// ── Scenario version marker ───────────────────────────────────────────────────
//
// Search Voximplant logs for this build id to confirm the correct scenario is running.
// __LOCAL_DEV_BUILD__ is replaced by scripts/voximplant-sync-scenario.mjs when using CI sync.
var SCENARIO_BUILD_ID   = "main-room-server-stop-2026-07-28-rc6";
var SCENARIO_SOURCE_NAME = "neg-conf-main-room";

// Audio recording mode:
// - "lossless" => { video: false, lossless: true }
// - "hd_mp3"   => { video: false, hd_audio: true }
// Never combine lossless + hd_audio.
var RECORDING_AUDIO_MODE = "lossless"; // "lossless" | "hd_mp3"

// SECURITY SWITCH:
// - true  => deny by default unless trusted identity check passes.
// - false => DEVELOPMENT_ONLY fallback may allow commands.
var STRICT_RECORDING_CONTROLLER_AUTH = true;

// DEVELOPMENT_ONLY fallback:
// - keep true only while Stage 4 trusted identity plumbing is not integrated.
// - must be removed or disabled for production hardening.
var DEVELOPMENT_ONLY_ALLOW_UNTRUSTED_CONTROLLER = false;

// ── Webhook configuration ─────────────────────────────────────────────────────
//
// WEBHOOK_BASE_URL defaults to the production HTTPS origin.
// Runtime configuration is loaded from scenario environment variables.
//
// If WEBHOOK_BASE_URL or WEBHOOK_SECRET are not configured, webhook calls are skipped with explicit logs.
// The conference and recording remain stable — only server-side status tracking is lost.

var WEBHOOK_BASE_URL = "https://negotaitions.ru";
var WEBHOOK_SECRET   = "";
var RECORDING_CONTROL_SECRET = "";

// Message-level webhookBaseUrl overrides are disabled for release builds.
var ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE = false;

// Canonical conference name prefix — must match lib/voximplant/conference-name.ts (negotiation-{sessionId}).
// sessionId is resolved first from recording_control.message.sessionId; conferenceName parsing is fallback only.
var CONFERENCE_NAME_PREFIX = "negotiation-";

// Last sessionId resolved from a trusted recording_control message.
var resolvedSessionId = null;
var providerSessionId = null;
var providerControlAccessSecureUrl = null;

// ── Server-side stop callback/control channel (Stage 3.10) ───────────────────
var SERVER_STOP_PROTOCOL_VERSION = "v1";
var SERVER_STOP_CONTROL_SECRET = "";
var SERVER_STOP_CALLBACK_SECRET = "";
var SERVER_STOP_RULE_IDENTITY = "unknown";
var SERVER_STOP_NONCE_CACHE = {};
var SERVER_STOP_NONCE_CACHE_LIMIT = 512;
var RECORDING_CONTROL_NONCE_CACHE = {};
var RECORDING_CONTROL_NONCE_CACHE_LIMIT = 1024;
var RECORDING_CONTROL_BINDING = null;
var SERVER_STOP_REGISTRATION_STATE_NOT_SENT = "NOT_SENT";
var SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT = "IN_FLIGHT";
var SERVER_STOP_REGISTRATION_STATE_ACKNOWLEDGED = "ACKNOWLEDGED";
var SERVER_STOP_REGISTRATION_STATE_FAILED_RETRYABLE = "FAILED_RETRYABLE";
var SERVER_STOP_REGISTRATION_STATE_FAILED_TERMINAL = "FAILED_TERMINAL";
var SERVER_STOP_REGISTRATION_MAX_ATTEMPTS = 4;
// Retry schedule with maxAttempts=4:
// attempt1 failure -> retry in 1s
// attempt2 failure -> retry in 2s
// attempt3 failure -> retry in 4s
// attempt4 failure -> terminal (no fifth attempt)
var SERVER_STOP_REGISTRATION_RETRY_BASE_MS = 1000;
var SERVER_STOP_REGISTRATION_RETRY_MAX_MS = 30000;
var SERVER_STOP_REGISTRATION_ATTEMPT_TIMEOUT_MS = 15000;
var SERVER_STOP_DURABLE_STATE_SCOPES = {
  SESSION_SCOPED: true,
};
var SERVER_STOP_CONTROL_CHANNEL_REGISTRATION = {
  state: SERVER_STOP_REGISTRATION_STATE_NOT_SENT,
  key: null,
  attemptCount: 0,
  inFlightAttempt: 0,
  inFlightSinceMs: null,
  inFlightWatchdogTimerId: null,
  acknowledgedAtMs: null,
  nextRetryAtMs: 0,
  lastAttemptAtMs: null,
  lastFailureCode: null,
  lastFailureRetryable: null,
  stateScope: null,
};
var RECORDING_CONTROL_ALLOWED_WEBHOOK_ORIGINS = {
  "https://local.negotaitions.ru": true,
  "https://negotaitions.ru": true,
};

var STARTING_TIMEOUT_MS = 10000;
var STOPPING_TIMEOUT_MS = 10000;
var RESUMING_TIMEOUT_MS = 7000;
var RECORDING_CONTROL_CLOCK_SKEW_SECONDS = 30;

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
var RECORDING_CONTROL_PROTOCOL_VERSION = "rc2-hmac-sha256-v1";
var RECORDING_CONTROL_SIGNED_FIELDS_ORDER = [
  "protocolVersion",
  "issuedAt",
  "expiresAt",
  "nonce",
  "action",
  "requestId",
  "sessionId",
  "conferenceName",
  "participantId",
  "controllerUserId",
  "controllerRole",
  "canControlRecording",
  "webhookBaseUrl",
];

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

function bytesToHex(bytes) {
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    hex += ("0" + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

function sha256Hex(input) {
  return bytesToHex(_pjsSha256(_pjsStrToUtf8(String(input || ""))));
}

function buildServerStopCallbackUrl(sessionId, callbackBaseUrl) {
  var base = normalizeWebhookBaseUrl(callbackBaseUrl || null);
  if (!base || !sessionId) return null;
  return (
    base +
    "/api/sessions/" +
    encodeURIComponent(sessionId) +
    "/voximplant/server-stop-callback"
  );
}

function isServerStopSecretConfigured(secret) {
  return isWebhookSecretConfigured(secret);
}

function buildServerStopSignature(protocolVersion, timestamp, nonce, bodyHash, secret) {
  var payload = [protocolVersion, timestamp, nonce, bodyHash].join("\n");
  return computeHmacSha256Hex(payload, secret);
}

function rememberServerStopNonce(nonce) {
  if (!nonce) return;
  SERVER_STOP_NONCE_CACHE[nonce] = Date.now();
  var keys = Object.keys(SERVER_STOP_NONCE_CACHE);
  if (keys.length > SERVER_STOP_NONCE_CACHE_LIMIT) {
    keys.sort(function (a, b) {
      return SERVER_STOP_NONCE_CACHE[a] - SERVER_STOP_NONCE_CACHE[b];
    });
    var trimCount = Math.max(0, keys.length - SERVER_STOP_NONCE_CACHE_LIMIT);
    for (var i = 0; i < trimCount; i++) {
      delete SERVER_STOP_NONCE_CACHE[keys[i]];
    }
  }
}

function isReplayServerStopNonce(nonce) {
  return Boolean(nonce && SERVER_STOP_NONCE_CACHE[nonce]);
}

function isSessionScopedServerStopCallbackEvent(eventType) {
  return (
    eventType === "provider_session_registered" ||
    eventType === "recording_stop_command_accepted" ||
    eventType === "recording_stopped" ||
    eventType === "recording_stop_failed"
  );
}

function resolveServerStopCallbackOrigin(eventType, sessionId, conferenceName) {
  if (!isSessionScopedServerStopCallbackEvent(eventType)) {
    var legacyOrigin = normalizeWebhookBaseUrl(WEBHOOK_BASE_URL || null);
    return {
      origin: legacyOrigin,
      source: legacyOrigin ? "legacy_static_origin" : "unavailable",
      code: legacyOrigin ? null : "CALLBACK_ORIGIN_UNAVAILABLE",
    };
  }
  if (!RECORDING_CONTROL_BINDING) {
    return {
      origin: null,
      source: "binding_missing",
      code: "RECORDING_CONTROL_BINDING_MISSING",
    };
  }
  if (
    RECORDING_CONTROL_BINDING.sessionId !== sessionId ||
    RECORDING_CONTROL_BINDING.conferenceName !== conferenceName
  ) {
    return {
      origin: null,
      source: "binding_mismatch",
      code: "RECORDING_CONTROL_BINDING_MISMATCH",
    };
  }
  var normalizedBoundOrigin = normalizeRecordingControlWebhookOrigin(
    RECORDING_CONTROL_BINDING.webhookBaseUrl || "",
  );
  if (!normalizedBoundOrigin) {
    return {
      origin: null,
      source: "binding_origin_invalid",
      code: "RECORDING_CONTROL_BINDING_ORIGIN_INVALID",
    };
  }
  return {
    origin: normalizedBoundOrigin,
    source: "session_binding",
    code: null,
  };
}

function sendServerStopCallback(
  eventType,
  sessionId,
  conferenceName,
  providerSession,
  extra,
  onResult
) {
  var originDecision = resolveServerStopCallbackOrigin(
    eventType,
    sessionId,
    conferenceName,
  );
  var callbackBaseUrl = originDecision.origin;
  var callbackUrl = buildServerStopCallbackUrl(sessionId, callbackBaseUrl);
  if (!callbackUrl) {
    log(
      "server-stop callback skipped code=" +
        (originDecision.code || "CALLBACK_URL_UNAVAILABLE") +
        " eventType=" +
        eventType +
        " sessionId=" +
        sessionId +
        " originSource=" +
        originDecision.source,
    );
    if (typeof onResult === "function") {
      try {
        onResult(null, callbackBaseUrl);
      } catch (onResultErr) {
        log("server-stop callback result handler failed: " + safeToString(onResultErr));
      }
    }
    return false;
  }
  if (
    !isServerStopSecretConfigured(SERVER_STOP_CALLBACK_SECRET)
  ) {
    log(
      "server-stop callback skipped code=CALLBACK_SECRET_UNAVAILABLE eventType=" +
        eventType +
        " sessionId=" +
        sessionId,
    );
    if (typeof onResult === "function") {
      try {
        onResult(null, callbackBaseUrl);
      } catch (onSecretResultErr) {
        log("server-stop callback result handler failed: " + safeToString(onSecretResultErr));
      }
    }
    return false;
  }
  var timestamp = Math.floor(Date.now() / 1000).toString();
  var nonce = "vox-stop-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
  var payload = {
    eventType: eventType,
    sessionId: sessionId,
    conferenceName: conferenceName,
    providerSessionId: providerSession,
  };
  if (extra) {
    for (var key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key) && extra[key] !== undefined) {
        payload[key] = extra[key];
      }
    }
  }
  var body = JSON.stringify(payload);
  var bodyHash = sha256Hex(body);
  var signature = buildServerStopSignature(
    SERVER_STOP_PROTOCOL_VERSION,
    timestamp,
    nonce,
    bodyHash,
    SERVER_STOP_CALLBACK_SECRET,
  );
  if (!signature) {
    log(
      "server-stop callback skipped code=SIGNATURE_GENERATION_FAILED eventType=" +
        eventType +
        " sessionId=" +
        sessionId,
    );
    if (typeof onResult === "function") {
      try {
        onResult(null, callbackBaseUrl);
      } catch (onSignatureResultErr) {
        log("server-stop callback result handler failed: " + safeToString(onSignatureResultErr));
      }
    }
    return false;
  }
  log(
    "server-stop callback dispatch eventType=" +
      eventType +
      " sessionId=" +
      sessionId +
      " callbackOrigin=" +
      callbackBaseUrl +
      " originSource=" +
      originDecision.source,
  );
  try {
    Net.httpRequestAsync(
      callbackUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vox-stop-protocol": SERVER_STOP_PROTOCOL_VERSION,
          "x-vox-stop-timestamp": timestamp,
          "x-vox-stop-nonce": nonce,
          "x-vox-stop-body-sha256": bodyHash,
          "x-vox-stop-signature": signature,
        },
        postData: body,
      },
      function (result) {
        var code = safeToString(result && result.code);
        var responseBodyPreview = "";
        try {
          responseBodyPreview = result && result.text ? String(result.text).slice(0, 200) : "";
        } catch (readErr) {
          responseBodyPreview = "body_read_failed";
        }
        log(
          "server-stop callback response eventType=" +
            eventType +
            " status=" +
            code +
            " sessionId=" +
            sessionId +
            " callbackOrigin=" +
            callbackBaseUrl +
            " body=" +
            responseBodyPreview,
        );
        if (typeof onResult === "function") {
          try {
            onResult(result || null, callbackBaseUrl);
          } catch (callbackResultErr) {
            log("server-stop callback result handler failed: " + safeToString(callbackResultErr));
          }
        }
      },
    );
    return true;
  } catch (dispatchErr) {
    log(
      "server-stop callback dispatch failed eventType=" +
        eventType +
        " sessionId=" +
        sessionId +
        " code=DISPATCH_EXCEPTION",
    );
    if (typeof onResult === "function") {
      try {
        onResult(null, callbackBaseUrl);
      } catch (callbackDispatchErr) {
        log("server-stop callback result handler failed: " + safeToString(callbackDispatchErr));
      }
    }
    return false;
  }
}

function normalizeRecordingControlWebhookOrigin(value) {
  if (!value || typeof value !== "string") return null;
  var trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.indexOf("https://") !== 0) return null;
  if (trimmed.indexOf("@") !== -1) return null;
  if (trimmed.indexOf("?") !== -1 || trimmed.indexOf("#") !== -1) return null;
  var lower = trimmed.toLowerCase();
  if (lower.endsWith("/")) {
    lower = lower.slice(0, -1);
  }
  if (!RECORDING_CONTROL_ALLOWED_WEBHOOK_ORIGINS[lower]) return null;
  if (lower !== "https://local.negotaitions.ru" && lower !== "https://negotaitions.ru") {
    return null;
  }
  return lower;
}

function buildRecordingControlCanonicalPayload(claims) {
  var lines = [];
  for (var i = 0; i < RECORDING_CONTROL_SIGNED_FIELDS_ORDER.length; i++) {
    var key = RECORDING_CONTROL_SIGNED_FIELDS_ORDER[i];
    var value = claims[key];
    if (typeof value === "boolean") {
      lines.push(key + "=" + (value ? "true" : "false"));
    } else {
      lines.push(key + "=" + String(value));
    }
  }
  return lines.join("\n");
}

function computeRecordingControlSignature(canonicalPayload, secret) {
  return computeHmacSha256Hex(canonicalPayload, secret);
}

function hashRecordingControlMessage(canonicalPayload, signature) {
  return sha256Hex(canonicalPayload + "\n" + String(signature || ""));
}

function trimRecordingControlNonceCache(nowMs) {
  var keys = Object.keys(RECORDING_CONTROL_NONCE_CACHE);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var entry = RECORDING_CONTROL_NONCE_CACHE[key];
    if (!entry || typeof entry.expiresAtMs !== "number" || entry.expiresAtMs < nowMs) {
      delete RECORDING_CONTROL_NONCE_CACHE[key];
    }
  }
  var remainingKeys = Object.keys(RECORDING_CONTROL_NONCE_CACHE);
  if (remainingKeys.length <= RECORDING_CONTROL_NONCE_CACHE_LIMIT) {
    return;
  }
  remainingKeys.sort(function (a, b) {
    return (
      RECORDING_CONTROL_NONCE_CACHE[a].seenAtMs -
      RECORDING_CONTROL_NONCE_CACHE[b].seenAtMs
    );
  });
  var trimCount = Math.max(0, remainingKeys.length - RECORDING_CONTROL_NONCE_CACHE_LIMIT);
  for (var j = 0; j < trimCount; j++) {
    delete RECORDING_CONTROL_NONCE_CACHE[remainingKeys[j]];
  }
}

function inspectRecordingControlNonce(nonce, messageHash) {
  var nowMs = Date.now();
  trimRecordingControlNonceCache(nowMs);
  var existing = RECORDING_CONTROL_NONCE_CACHE[nonce];
  if (!existing) {
    return { status: "fresh" };
  }
  if (existing.messageHash !== messageHash) {
    return { status: "duplicate_conflict" };
  }
  if (existing.outcome === "REJECTED_PRE_EXECUTION") {
    return {
      status: "duplicate_rejected",
      reasonCode: existing.reasonCode || "RECORDING_CONTROL_NONCE_PREVIOUSLY_REJECTED",
    };
  }
  if (existing.outcome === "IN_PROGRESS") {
    return { status: "duplicate_in_flight" };
  }
  return { status: "duplicate_processed" };
}

function beginRecordingControlNonceExecution(nonce, messageHash, expiresAtSeconds) {
  var nowMs = Date.now();
  trimRecordingControlNonceCache(nowMs);
  var existing = RECORDING_CONTROL_NONCE_CACHE[nonce];
  if (existing) {
    if (existing.messageHash !== messageHash) {
      return { status: "duplicate_conflict" };
    }
    return { status: "duplicate_same", outcome: existing.outcome || "EXECUTED" };
  }
  var expiresAtMs = Number(expiresAtSeconds) * 1000;
  if (!isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    expiresAtMs = nowMs + 60000;
  }
  RECORDING_CONTROL_NONCE_CACHE[nonce] = {
    messageHash: messageHash,
    seenAtMs: nowMs,
    expiresAtMs: expiresAtMs,
    outcome: "IN_PROGRESS",
    reasonCode: null,
  };
  trimRecordingControlNonceCache(nowMs);
  return { status: "accepted" };
}

function markRecordingControlNonceOutcome(nonce, outcome, reasonCode, expiresAtSeconds) {
  if (!nonce) return;
  var nowMs = Date.now();
  var existing = RECORDING_CONTROL_NONCE_CACHE[nonce];
  var expiresAtMs = Number(expiresAtSeconds) * 1000;
  if (!isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    expiresAtMs = nowMs + 60000;
  }
  if (!existing) {
    RECORDING_CONTROL_NONCE_CACHE[nonce] = {
      messageHash: "",
      seenAtMs: nowMs,
      expiresAtMs: expiresAtMs,
      outcome: outcome,
      reasonCode: reasonCode || null,
    };
    trimRecordingControlNonceCache(nowMs);
    return;
  }
  existing.seenAtMs = nowMs;
  existing.expiresAtMs = expiresAtMs;
  existing.outcome = outcome;
  existing.reasonCode = reasonCode || null;
  trimRecordingControlNonceCache(nowMs);
}

function resolveBoundWebhookBaseUrl(sessionId, conferenceName) {
  if (!RECORDING_CONTROL_BINDING) {
    return null;
  }
  if (
    RECORDING_CONTROL_BINDING.sessionId === sessionId &&
    RECORDING_CONTROL_BINDING.conferenceName === conferenceName
  ) {
    return normalizeRecordingControlWebhookOrigin(
      RECORDING_CONTROL_BINDING.webhookBaseUrl || "",
    );
  }
  return null;
}

function resolveRecordingStatusWebhookOrigin(
  sessionId,
  conferenceName,
  preferredWebhookBaseUrl
) {
  if (RECORDING_CONTROL_BINDING) {
    if (RECORDING_CONTROL_BINDING.sessionId !== sessionId) {
      return {
        origin: null,
        source: "binding_mismatch",
        code: "RECORDING_CONTROL_BINDING_MISMATCH",
      };
    }
    if (RECORDING_CONTROL_BINDING.conferenceName !== conferenceName) {
      return {
        origin: null,
        source: "binding_mismatch",
        code: "RECORDING_CONTROL_BINDING_MISMATCH",
      };
    }
    var boundOrigin = normalizeRecordingControlWebhookOrigin(
      RECORDING_CONTROL_BINDING.webhookBaseUrl || "",
    );
    if (!boundOrigin) {
      return {
        origin: null,
        source: "binding_origin_missing",
        code: "RECORDING_CONTROL_BINDING_ORIGIN_INVALID",
      };
    }
    var hasPreferredOriginInput =
      preferredWebhookBaseUrl !== undefined && preferredWebhookBaseUrl !== null;
    if (hasPreferredOriginInput) {
      var preferredOrigin = normalizeRecordingControlWebhookOrigin(
        preferredWebhookBaseUrl || "",
      );
      if (!preferredOrigin || preferredOrigin !== boundOrigin) {
        return {
          origin: null,
          source: "binding_origin_mismatch",
          code: "BINDING_ORIGIN_MISMATCH",
        };
      }
    }
    return {
      origin: boundOrigin,
      source: "session_binding",
      code: null,
    };
  }
  var hasPreferredOriginInput =
    preferredWebhookBaseUrl !== undefined && preferredWebhookBaseUrl !== null;
  if (hasPreferredOriginInput) {
    var preferredOrigin = normalizeRecordingControlWebhookOrigin(
      preferredWebhookBaseUrl || "",
    );
    if (!preferredOrigin || preferredOrigin !== preferredWebhookBaseUrl) {
      return {
        origin: null,
        source: "preferred_origin_invalid",
        code: "RECORDING_CONTROL_WEBHOOK_ORIGIN_INVALID",
      };
    }
    return {
      origin: preferredOrigin,
      source: "signed_prebinding_origin",
      code: null,
    };
  }
  var legacyOrigin = resolveEffectiveWebhookBaseUrl();
  return {
    origin: legacyOrigin,
    source: legacyOrigin ? "legacy_static_origin" : "unavailable",
    code: legacyOrigin ? null : "WEBHOOK_ORIGIN_UNAVAILABLE",
  };
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

function buildVoximplantConferenceName(sessionId) {
  return CONFERENCE_NAME_PREFIX + sessionId;
}

function resolveProviderSessionId() {
  if (providerSessionId) return providerSessionId;
  try {
    if (typeof VoxEngine.getLocalTag === "function") {
      var tag = safeToString(VoxEngine.getLocalTag());
      if (tag) {
        providerSessionId = tag;
        return providerSessionId;
      }
    }
  } catch (e) {
    // ignore; fallback below
  }
  providerSessionId = "vox-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
  return providerSessionId;
}

function extractProviderRuleIdentityCandidate(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    var trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object") {
    var nested =
      extractProviderRuleIdentityCandidate(value.identity) ||
      extractProviderRuleIdentityCandidate(value.ruleIdentity) ||
      extractProviderRuleIdentityCandidate(value.name) ||
      extractProviderRuleIdentityCandidate(value.ruleName) ||
      extractProviderRuleIdentityCandidate(value.id) ||
      extractProviderRuleIdentityCandidate(value.ruleId);
    return nested || null;
  }
  return null;
}

function resolveServerStopRuleIdentity(event) {
  var candidates = [
    event && event.dialplanName,
    event && event.dialplanId,
    event && event.ruleIdentity,
    event && event.ruleName,
    event && event.ruleId,
    event && event.rule,
    event && event.dialplanRule,
    event && event.routingRule,
    event && event.ruleInfo,
    event && event.scriptRule,
  ];
  for (var i = 0; i < candidates.length; i++) {
    var identity = extractProviderRuleIdentityCandidate(candidates[i]);
    if (identity) {
      return identity;
    }
  }
  return "unknown";
}

function normalizeControlAccessSecureUrl(value) {
  if (!value || typeof value !== "string") return null;
  var trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.indexOf("https://") !== 0) return null;
  if (trimmed.indexOf("@") !== -1) return null;
  return trimmed;
}

function resolveServerStopControlUrl() {
  return normalizeControlAccessSecureUrl(providerControlAccessSecureUrl);
}

function createServerStopRegistrationState(registrationKey) {
  return {
    state: SERVER_STOP_REGISTRATION_STATE_NOT_SENT,
    key: registrationKey || null,
    attemptCount: 0,
    inFlightAttempt: 0,
    inFlightSinceMs: null,
    inFlightWatchdogTimerId: null,
    acknowledgedAtMs: null,
    nextRetryAtMs: 0,
    lastAttemptAtMs: null,
    lastFailureCode: null,
    lastFailureRetryable: null,
    stateScope: null,
  };
}

function isServerStopRegistrationTerminalStatusCode(statusCode) {
  return (
    statusCode === 400 ||
    statusCode === 401 ||
    statusCode === 403 ||
    statusCode === 404 ||
    statusCode === 409
  );
}

function buildServerStopRegistrationBackoffMs(attemptCount) {
  var safeAttempt = Math.max(1, Number(attemptCount) || 1);
  var computed = SERVER_STOP_REGISTRATION_RETRY_BASE_MS * Math.pow(2, safeAttempt - 1);
  return Math.min(SERVER_STOP_REGISTRATION_RETRY_MAX_MS, computed);
}

function clearServerStopRegistrationAttemptWatchdog(registration) {
  if (!registration) return;
  if (registration.inFlightWatchdogTimerId !== null) {
    try {
      clearTimeout(registration.inFlightWatchdogTimerId);
    } catch (clearErr) {
      // ignore timer clear failures
    }
  }
  registration.inFlightWatchdogTimerId = null;
}

function armServerStopRegistrationAttemptWatchdog(registrationKey, attemptNo) {
  var registration = SERVER_STOP_CONTROL_CHANNEL_REGISTRATION;
  if (!registration || registration.key !== registrationKey) {
    return;
  }
  clearServerStopRegistrationAttemptWatchdog(registration);
  registration.inFlightWatchdogTimerId = setTimeout(function () {
    applyServerStopRegistrationAttemptResult(
      registrationKey,
      attemptNo,
      { __serverStopRegistrationWatchdogTimeout: true },
    );
  }, SERVER_STOP_REGISTRATION_ATTEMPT_TIMEOUT_MS);
}

function parseServerStopRegistrationAcknowledgement(result) {
  if (!result) {
    return {
      ok: false,
      code: "NETWORK_OR_TIMEOUT",
      retryable: true,
    };
  }
  var statusCode = Number(result.code);
  if (!isFinite(statusCode)) {
    return {
      ok: false,
      code: "NETWORK_OR_TIMEOUT",
      retryable: true,
    };
  }
  if (statusCode < 200 || statusCode >= 300) {
    return {
      ok: false,
      code: "HTTP_" + statusCode,
      retryable: !isServerStopRegistrationTerminalStatusCode(statusCode),
    };
  }
  var rawText = safeToString(result.text || "");
  if (!rawText) {
    return { ok: false, code: "ACK_EMPTY", retryable: true };
  }
  var ack = null;
  try {
    ack = JSON.parse(rawText);
  } catch (parseErr) {
    return { ok: false, code: "ACK_INVALID_JSON", retryable: true };
  }
  if (!ack || typeof ack !== "object") {
    return { ok: false, code: "ACK_INVALID_SHAPE", retryable: true };
  }
  var accepted = ack.accepted === true;
  var persisted = ack.persisted === true;
  var stateScope = ack.stateScope ? String(ack.stateScope).trim() : "";
  if (
    accepted &&
    persisted &&
    stateScope &&
    SERVER_STOP_DURABLE_STATE_SCOPES[stateScope]
  ) {
    return { ok: true, stateScope: stateScope };
  }
  var explicitTerminal = ack.terminal === true;
  var explicitRetryable =
    ack.retryable === true
      ? true
      : ack.retryable === false
        ? false
        : !explicitTerminal;
  return {
    ok: false,
    code: ack.error ? String(ack.error) : ack.reason ? String(ack.reason) : "ACK_REJECTED",
    retryable: explicitRetryable,
    stateScope: stateScope || null,
  };
}

function applyServerStopRegistrationAttemptResult(registrationKey, attemptNo, callbackResult) {
  var registration = SERVER_STOP_CONTROL_CHANNEL_REGISTRATION;
  if (!registration || registration.key !== registrationKey) {
    return;
  }
  if (registration.state !== SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT) {
    return;
  }
  if (registration.inFlightAttempt !== attemptNo) {
    return;
  }
  clearServerStopRegistrationAttemptWatchdog(registration);
  var ack =
    callbackResult && callbackResult.__serverStopRegistrationWatchdogTimeout
      ? { ok: false, code: "ATTEMPT_TIMEOUT", retryable: true }
      : parseServerStopRegistrationAcknowledgement(callbackResult);
  if (ack.ok) {
    registration.state = SERVER_STOP_REGISTRATION_STATE_ACKNOWLEDGED;
    registration.acknowledgedAtMs = Date.now();
    registration.inFlightSinceMs = null;
    registration.inFlightAttempt = 0;
    registration.nextRetryAtMs = 0;
    registration.lastFailureCode = null;
    registration.lastFailureRetryable = null;
    registration.stateScope = ack.stateScope || null;
    log(
      "server-stop registration acknowledged stateScope=" +
        (registration.stateScope || "unknown") +
        " attempt=" +
        attemptNo,
    );
    return;
  }
  var boundedRetryable =
    ack.retryable && attemptNo < SERVER_STOP_REGISTRATION_MAX_ATTEMPTS;
  registration.lastFailureCode = ack.code || "ACK_REJECTED";
  registration.lastFailureRetryable = boundedRetryable;
  registration.inFlightSinceMs = null;
  registration.inFlightAttempt = 0;
  if (boundedRetryable) {
    var backoffMs = buildServerStopRegistrationBackoffMs(attemptNo);
    registration.state = SERVER_STOP_REGISTRATION_STATE_FAILED_RETRYABLE;
    registration.nextRetryAtMs = Date.now() + backoffMs;
    log(
      "server-stop registration failed state=FAILED_RETRYABLE code=" +
        registration.lastFailureCode +
        " attempt=" +
        attemptNo +
        " backoffMs=" +
        backoffMs,
    );
    return;
  }
  registration.state = SERVER_STOP_REGISTRATION_STATE_FAILED_TERMINAL;
  registration.nextRetryAtMs = 0;
  log(
    "server-stop registration failed state=FAILED_TERMINAL code=" +
      registration.lastFailureCode +
      " attempt=" +
      attemptNo,
  );
}

function registerServerStopControlChannel(boundClaims) {
  if (!boundClaims) {
    return { ok: false, code: "BINDING_UNAVAILABLE" };
  }
  var sessionId = boundClaims.sessionId;
  var conferenceName = boundClaims.conferenceName;
  var controlUrl = resolveServerStopControlUrl();
  if (!controlUrl) {
    log(
      "server-stop registration unavailable reason=ACCESS_SECURE_URL_UNAVAILABLE sessionId=" +
        sessionId,
    );
    return { ok: false, code: "ACCESS_SECURE_URL_UNAVAILABLE" };
  }
  var providerSession = resolveProviderSessionId();
  var registrationKey = [
    sessionId,
    conferenceName,
    providerSession,
    controlUrl,
    boundClaims.webhookBaseUrl,
  ].join("|");
  if (
    SERVER_STOP_CONTROL_CHANNEL_REGISTRATION &&
    SERVER_STOP_CONTROL_CHANNEL_REGISTRATION.key &&
    SERVER_STOP_CONTROL_CHANNEL_REGISTRATION.key !== registrationKey
  ) {
    return { ok: false, code: "REGISTRATION_CONFLICT" };
  }
  if (
    !SERVER_STOP_CONTROL_CHANNEL_REGISTRATION ||
    SERVER_STOP_CONTROL_CHANNEL_REGISTRATION.key !== registrationKey
  ) {
    SERVER_STOP_CONTROL_CHANNEL_REGISTRATION =
      createServerStopRegistrationState(registrationKey);
  }
  var registration = SERVER_STOP_CONTROL_CHANNEL_REGISTRATION;
  var nowMs = Date.now();
  if (registration.state === SERVER_STOP_REGISTRATION_STATE_ACKNOWLEDGED) {
    return {
      ok: true,
      duplicate: true,
      state: SERVER_STOP_REGISTRATION_STATE_ACKNOWLEDGED,
      stateScope: registration.stateScope || null,
    };
  }
  if (registration.state === SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT) {
    return {
      ok: true,
      pending: true,
      state: SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT,
      attempt: registration.inFlightAttempt,
    };
  }
  if (registration.state === SERVER_STOP_REGISTRATION_STATE_FAILED_TERMINAL) {
    return {
      ok: false,
      code: registration.lastFailureCode || "REGISTRATION_FAILED_TERMINAL",
      state: SERVER_STOP_REGISTRATION_STATE_FAILED_TERMINAL,
    };
  }
  if (
    registration.state === SERVER_STOP_REGISTRATION_STATE_FAILED_RETRYABLE &&
    registration.nextRetryAtMs &&
    nowMs < registration.nextRetryAtMs
  ) {
    return {
      ok: true,
      pending: true,
      state: SERVER_STOP_REGISTRATION_STATE_FAILED_RETRYABLE,
      nextRetryAtMs: registration.nextRetryAtMs,
    };
  }
  if (registration.attemptCount >= SERVER_STOP_REGISTRATION_MAX_ATTEMPTS) {
    registration.state = SERVER_STOP_REGISTRATION_STATE_FAILED_TERMINAL;
    registration.lastFailureCode = "REGISTRATION_ATTEMPTS_EXHAUSTED";
    registration.lastFailureRetryable = false;
    registration.nextRetryAtMs = 0;
    return {
      ok: false,
      code: "REGISTRATION_ATTEMPTS_EXHAUSTED",
      state: SERVER_STOP_REGISTRATION_STATE_FAILED_TERMINAL,
    };
  }

  var attemptNo = registration.attemptCount + 1;
  registration.state = SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT;
  registration.attemptCount = attemptNo;
  registration.inFlightAttempt = attemptNo;
  registration.inFlightSinceMs = nowMs;
  registration.inFlightWatchdogTimerId = null;
  registration.lastAttemptAtMs = nowMs;
  registration.nextRetryAtMs = 0;
  registration.lastFailureCode = null;
  registration.lastFailureRetryable = null;
  registration.stateScope = null;
  armServerStopRegistrationAttemptWatchdog(registrationKey, attemptNo);
  var callbackDispatched = sendServerStopCallback(
    "provider_session_registered",
    sessionId,
    conferenceName,
    providerSession,
    {
      accessSecureUrl: controlUrl,
      controlUrl: controlUrl,
      scenarioBuild: SCENARIO_BUILD_ID,
      scenarioSource: SCENARIO_SOURCE_NAME,
      ruleIdentity: SERVER_STOP_RULE_IDENTITY,
    },
    function (callbackResult) {
      applyServerStopRegistrationAttemptResult(
        registrationKey,
        attemptNo,
        callbackResult,
      );
    },
  );
  if (!callbackDispatched) {
    applyServerStopRegistrationAttemptResult(registrationKey, attemptNo, null);
  }
  return {
    ok: true,
    pending: true,
    duplicate: false,
    state: SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT,
    attempt: attemptNo,
  };
}

/**
 * Normalize and validate a webhook base URL without relying on new URL().
 * Returns the cleaned URL string on success, or null if invalid.
 * Requirements: non-empty string, https:// prefix, no loopback/single-label/.local hosts,
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
  // Reject single-label hosts, loopback, and .local TLD
  var afterScheme = lower.slice("https://".length);
  var hostPart = afterScheme.split("/")[0];
  if (!hostPart || hostPart.indexOf(".") === -1) return null;
  if (/^127\./.test(hostPart) || hostPart === "0.0.0.0") return null;
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
  if (trimmed.length < 16) return false;
  return true;
}

/**
 * Read a trimmed scenario environment variable value.
 */
function readScenarioEnvValue(key) {
  if (!key) return null;
  if (typeof process === "undefined" || !process.env) return null;
  var raw = process.env[key];
  if (raw === undefined || raw === null) return null;
  var trimmed = String(raw).trim();
  return trimmed ? trimmed : null;
}

/**
 * Returns true when VoxEngine native secret storage is available.
 */
function isVoxEngineSecretStorageAvailable() {
  try {
    return Boolean(
      typeof VoxEngine !== "undefined" &&
      VoxEngine &&
      typeof VoxEngine.getSecretValue === "function",
    );
  } catch (e) {
    return false;
  }
}

/**
 * Read a trimmed non-empty secret from VoxEngine Secret Storage.
 * Never logs secret values and fails closed on provider exceptions.
 */
function readSecretFromVoxEngineStorage(secretName) {
  if (!secretName) return null;
  if (!isVoxEngineSecretStorageAvailable()) return null;
  try {
    var raw = VoxEngine.getSecretValue(secretName);
    if (raw === undefined || raw === null) return null;
    var trimmed = String(raw).trim();
    return trimmed ? trimmed : null;
  } catch (e) {
    return null;
  }
}

/**
 * Read secret with explicit precedence:
 * 1) VoxEngine Secret Storage primaryKey
 * 2) VoxEngine Secret Storage compatibilityAliasKey (if provided)
 * 3) process.env fallback (only when VoxEngine Secret Storage is unavailable)
 * Returns the value and non-secret source metadata.
 */
function readSecretFromScenarioEnv(primaryKey, compatibilityAliasKey) {
  var primaryValue = readSecretFromVoxEngineStorage(primaryKey);
  if (primaryValue) return { value: primaryValue, source: "vox_secret_primary" };
  if (compatibilityAliasKey) {
    var aliasValue = readSecretFromVoxEngineStorage(compatibilityAliasKey);
    if (aliasValue) return { value: aliasValue, source: "vox_secret_alias" };
  }

  // Explicit non-provider fallback for local tests / CI only.
  if (!isVoxEngineSecretStorageAvailable()) {
    var envPrimaryValue = readScenarioEnvValue(primaryKey);
    if (envPrimaryValue) return { value: envPrimaryValue, source: "process_env_fallback" };
    if (compatibilityAliasKey) {
      var envAliasValue = readScenarioEnvValue(compatibilityAliasKey);
      if (envAliasValue) return { value: envAliasValue, source: "process_env_fallback" };
    }
  }

  return { value: null, source: "missing" };
}

/**
 * Apply trusted environment config for recording webhook settings.
 */
function applyWebhookEnvironmentConfig() {
  try {
    var envBaseRaw = readScenarioEnvValue("WEBHOOK_BASE_URL");
    if (envBaseRaw) {
      var envBase = normalizeWebhookBaseUrl(envBaseRaw);
      if (envBase) WEBHOOK_BASE_URL = envBase;
    }

    var webhookSecretConfig = readSecretFromScenarioEnv(
      "VOXIMPLANT_RECORDING_WEBHOOK_SECRET",
      "WEBHOOK_SECRET",
    );
    if (webhookSecretConfig.value && isWebhookSecretConfigured(webhookSecretConfig.value)) {
      WEBHOOK_SECRET = webhookSecretConfig.value;
    } else {
      WEBHOOK_SECRET = "";
    }

    log(
      "webhook secret source=" + webhookSecretConfig.source +
        " configured=" + isWebhookSecretConfigured(WEBHOOK_SECRET) +
        " length=" + (WEBHOOK_SECRET ? String(WEBHOOK_SECRET).length : 0),
    );
  } catch (envReadErr) {
    Logger.write("[neg-conf-prod] env read failed: " + safeToString(envReadErr));
  }
}

/**
 * Apply trusted environment config for signed recording control.
 * Primary key is RECORDING_CONTROL_SECRET with VOXIMPLANT_* compatibility alias.
 */
function applyRecordingControlEnvironmentConfig() {
  try {
    var recordingControlSecretConfig = readSecretFromScenarioEnv(
      "RECORDING_CONTROL_SECRET",
      "VOXIMPLANT_RECORDING_CONTROL_SECRET",
    );
    if (
      recordingControlSecretConfig.value &&
      isWebhookSecretConfigured(recordingControlSecretConfig.value)
    ) {
      RECORDING_CONTROL_SECRET = recordingControlSecretConfig.value;
    } else {
      RECORDING_CONTROL_SECRET = "";
    }
    log(
      "recording-control secret source=" +
        recordingControlSecretConfig.source +
        " configured=" +
        isWebhookSecretConfigured(RECORDING_CONTROL_SECRET) +
        " length=" +
        (RECORDING_CONTROL_SECRET ? String(RECORDING_CONTROL_SECRET).length : 0),
    );
  } catch (envReadErr) {
    Logger.write(
      "[neg-conf-prod] recording-control env read failed: " + safeToString(envReadErr),
    );
  }
}

/**
 * Apply trusted environment config for server-side stop secrets.
 * Primary names are scenario keys; VOXIMPLANT_* names are compatibility aliases.
 */
function applyServerStopEnvironmentConfig() {
  try {
    var controlSecretConfig = readSecretFromScenarioEnv(
      "SERVER_STOP_CONTROL_SECRET",
      "VOXIMPLANT_SERVER_STOP_CONTROL_SECRET",
    );
    var callbackSecretConfig = readSecretFromScenarioEnv(
      "SERVER_STOP_CALLBACK_SECRET",
      "VOXIMPLANT_SERVER_STOP_CALLBACK_SECRET",
    );

    SERVER_STOP_CONTROL_SECRET =
      (controlSecretConfig.value && isServerStopSecretConfigured(controlSecretConfig.value))
        ? controlSecretConfig.value
        : "";
    SERVER_STOP_CALLBACK_SECRET =
      (callbackSecretConfig.value && isServerStopSecretConfigured(callbackSecretConfig.value))
        ? callbackSecretConfig.value
        : "";

    log(
      "server-stop control source=" +
        controlSecretConfig.source +
        " configured=" +
        isServerStopSecretConfigured(SERVER_STOP_CONTROL_SECRET) +
        " length=" +
        (SERVER_STOP_CONTROL_SECRET ? String(SERVER_STOP_CONTROL_SECRET).length : 0),
    );
    log(
      "server-stop callback source=" +
        callbackSecretConfig.source +
        " configured=" +
        isServerStopSecretConfigured(SERVER_STOP_CALLBACK_SECRET) +
        " length=" +
        (SERVER_STOP_CALLBACK_SECRET ? String(SERVER_STOP_CALLBACK_SECRET).length : 0),
    );
  } catch (envReadErr) {
    Logger.write("[neg-conf-prod] server-stop env read failed: " + safeToString(envReadErr));
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
      " RECORDING_CONTROL_SECRET_configured=" + isWebhookSecretConfigured(RECORDING_CONTROL_SECRET) +
      " allowMessageWebhookBaseUrl=" + Boolean(ALLOW_WEBHOOK_BASE_URL_FROM_MESSAGE) +
      " conferenceNamePrefix=" + CONFERENCE_NAME_PREFIX +
      " hmacProvider=" + _hmacProvider);
}

/**
 * Resolve effective webhook base URL from trusted scenario configuration only.
 * Message-level values are intentionally ignored.
 */
function resolveEffectiveWebhookBaseUrl() {
  return normalizeWebhookBaseUrl(WEBHOOK_BASE_URL || null);
}

/**
 * Send a recording status webhook to the server.
 * Non-blocking: errors are logged but do not affect the conference or recording.
 *
 * @param {string} sessionId - The application session ID
 * @param {object} statusPayload - The recording_status message payload
 * @param {object} [extraFields] - Optional extra fields: startedAt, stoppedAt
 * @param {string} [preferredWebhookBaseUrl] - Optional bound callback origin.
 */
function sendRecordingWebhook(sessionId, statusPayload, extraFields, preferredWebhookBaseUrl) {
  var conferenceHint =
    (currentRecordingContext && currentRecordingContext.conferenceName) ||
    lastConferenceName ||
    null;
  // RC2 sessions fail closed to the signed RECORDING_CONTROL_BINDING origin.
  // Static WEBHOOK_BASE_URL fallback is reserved for legacy non-RC2 paths only.
  var originDecision = resolveRecordingStatusWebhookOrigin(
    sessionId,
    conferenceHint,
    preferredWebhookBaseUrl,
  );
  var effectiveBaseUrl = originDecision.origin;
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
      " callbackOriginSource=" + originDecision.source +
      " effectiveWebhookBaseUrl present=" + Boolean(effectiveBaseUrl) +
      " WEBHOOK_BASE_URL_set=" + Boolean(WEBHOOK_BASE_URL) +
      " WEBHOOK_SECRET_configured=" + secretConfigured +
      " objectKeyPresent=" + objectKeyPresent +
      " recordingUrlPresent=" + recordingUrlPresent);

  if (!effectiveBaseUrl) {
    log(
      "webhook skipped: missing effectiveWebhookBaseUrl code=" +
        (originDecision.code || "WEBHOOK_ORIGIN_UNAVAILABLE"),
    );
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
      " callbackOrigin=" + effectiveBaseUrl +
      " callbackOriginSource=" + originDecision.source +
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

function getCurrentContextSessionId() {
  if (currentRecordingContext && currentRecordingContext.sessionId) {
    return currentRecordingContext.sessionId;
  }
  if (RECORDING_CONTROL_BINDING && RECORDING_CONTROL_BINDING.sessionId) {
    return RECORDING_CONTROL_BINDING.sessionId;
  }
  return resolvedSessionId;
}

function getCurrentContextWebhookBaseUrl() {
  if (currentRecordingContext && currentRecordingContext.webhookBaseUrl) {
    return currentRecordingContext.webhookBaseUrl;
  }
  if (RECORDING_CONTROL_BINDING && RECORDING_CONTROL_BINDING.webhookBaseUrl) {
    return RECORDING_CONTROL_BINDING.webhookBaseUrl;
  }
  return null;
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

function isSignedRecordingControlAction(action) {
  return (
    action === ACTION_START ||
    action === ACTION_PAUSE ||
    action === ACTION_RESUME ||
    action === ACTION_STOP ||
    action === ACTION_STATUS
  );
}

function parsePositiveIntegerClaim(value) {
  var parsed = Number(value);
  if (!isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
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
    return inner;
  } catch (e) {
    return null;
  }
}

function validateRecordingControlSchema(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { ok: false, code: "SCHEMA_INVALID" };
  }
  if (rawPayload.type !== "recording_control") {
    return { ok: false, code: "SCHEMA_INVALID" };
  }
  if (rawPayload.protocolVersion !== RECORDING_CONTROL_PROTOCOL_VERSION) {
    return { ok: false, code: "PROTOCOL_MISMATCH" };
  }
  if (!rawPayload.claims || typeof rawPayload.claims !== "object") {
    return { ok: false, code: "SCHEMA_INVALID" };
  }
  var claims = rawPayload.claims;
  var requestId = claims.requestId ? String(claims.requestId).trim() : "";
  var sessionId = claims.sessionId ? String(claims.sessionId).trim() : "";
  var conferenceName = claims.conferenceName ? String(claims.conferenceName).trim() : "";
  var participantId = claims.participantId ? String(claims.participantId).trim() : "";
  var controllerUserId = claims.controllerUserId
    ? String(claims.controllerUserId).trim()
    : "";
  var controllerRole = claims.controllerRole ? String(claims.controllerRole).trim() : "";
  var nonce = claims.nonce ? String(claims.nonce).trim() : "";
  var action = claims.action ? String(claims.action).trim() : "";
  var signature = rawPayload.signature ? String(rawPayload.signature).trim() : "";
  var issuedAt = parsePositiveIntegerClaim(claims.issuedAt);
  var expiresAt = parsePositiveIntegerClaim(claims.expiresAt);
  var webhookBaseUrl = normalizeRecordingControlWebhookOrigin(
    claims.webhookBaseUrl ? String(claims.webhookBaseUrl) : "",
  );
  var canControlRecording = claims.canControlRecording === true;

  if (!signature || !requestId || !sessionId || !conferenceName || !participantId) {
    return { ok: false, code: "SCHEMA_INVALID", requestId: requestId || null };
  }
  if (!controllerUserId || !controllerRole || !nonce) {
    return { ok: false, code: "SCHEMA_INVALID", requestId: requestId || null };
  }
  if (!isSignedRecordingControlAction(action)) {
    return { ok: false, code: "ACTION_INVALID", requestId: requestId };
  }
  if (!issuedAt || !expiresAt || expiresAt <= issuedAt) {
    return { ok: false, code: "CLAIMS_EXPIRED", requestId: requestId };
  }
  if (!webhookBaseUrl) {
    return { ok: false, code: "WEBHOOK_ORIGIN_INVALID", requestId: requestId };
  }
  if (claims.protocolVersion !== RECORDING_CONTROL_PROTOCOL_VERSION) {
    return { ok: false, code: "PROTOCOL_MISMATCH", requestId: requestId };
  }
  return {
    ok: true,
    payload: {
      type: "recording_control",
      protocolVersion: RECORDING_CONTROL_PROTOCOL_VERSION,
      signature: signature.toLowerCase(),
      claims: {
        protocolVersion: RECORDING_CONTROL_PROTOCOL_VERSION,
        issuedAt: issuedAt,
        expiresAt: expiresAt,
        nonce: nonce,
        action: action,
        requestId: requestId,
        sessionId: sessionId,
        conferenceName: conferenceName,
        participantId: participantId,
        controllerUserId: controllerUserId,
        controllerRole: controllerRole,
        canControlRecording: canControlRecording,
        webhookBaseUrl: webhookBaseUrl,
      },
    },
  };
}

function verifyRecordingControlSignature(payload) {
  var canonicalPayload = buildRecordingControlCanonicalPayload(payload.claims);
  var expectedSignature = computeRecordingControlSignature(
    canonicalPayload,
    RECORDING_CONTROL_SECRET,
  );
  if (!expectedSignature) {
    return { ok: false, code: "SIGNATURE_INVALID" };
  }
  if (expectedSignature !== payload.signature) {
    return { ok: false, code: "SIGNATURE_INVALID" };
  }
  return {
    ok: true,
    canonicalPayload: canonicalPayload,
    messageHash: hashRecordingControlMessage(canonicalPayload, payload.signature),
  };
}

function isAuthorizedRecordingController(payload, call) {
  if (payload.claims.canControlRecording) {
    return { allowed: true, reason: "signed_claim" };
  }
  if (STRICT_RECORDING_CONTROLLER_AUTH) {
    return { allowed: false, reason: "STRICT_AUTH_CLAIM_DENIED" };
  }
  if (DEVELOPMENT_ONLY_ALLOW_UNTRUSTED_CONTROLLER) {
    var diagnosticIdentity = extractTrustedIdentity(call);
    if (diagnosticIdentity.username || diagnosticIdentity.customData) {
      return { allowed: true, reason: "development_untrusted_fallback" };
    }
  }
  return { allowed: false, reason: "UNAUTHORIZED_RECORDING_CONTROLLER" };
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
    sendRecordingWebhook(
      getCurrentContextSessionId(),
      statusPayload,
      { startedAt: safeNowIso() },
      getCurrentContextWebhookBaseUrl(),
    );
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
    var stoppedConferenceName =
      ctxConfName ||
      (stoppedSessionId ? buildVoximplantConferenceName(stoppedSessionId) : null);

    // Part C: log the exact callback origin selected for this webhook dispatch.
    var recordingWebhookDecision = resolveRecordingStatusWebhookOrigin(
      stoppedSessionId,
      stoppedConferenceName,
      ctxWebhookUrl,
    );
    var webhookTargetUrl = (stoppedSessionId && recordingWebhookDecision.origin)
      ? recordingWebhookDecision.origin + "/api/sessions/" + stoppedSessionId + "/voximplant/recording-status"
      : null;
    log(
      "webhook URL=" +
        (webhookTargetUrl || "null (will be skipped)") +
        " callbackOriginSource=" +
        recordingWebhookDecision.source,
    );

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
    sendRecordingWebhook(stoppedSessionId, statusPayload, { stoppedAt: safeNowIso() }, ctxWebhookUrl);
    if (stoppedSessionId && stoppedConferenceName) {
      sendServerStopCallback(
        "recording_stopped",
        stoppedSessionId,
        stoppedConferenceName,
        resolveProviderSessionId(),
        {
          operationId: effectiveStopRequestId,
          terminalStatus: "recording_stopped",
        },
      );
    }

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
    sendRecordingWebhook(
      getCurrentContextSessionId(),
      statusPayload,
      null,
      getCurrentContextWebhookBaseUrl(),
    );
    if (resolvedSessionId) {
      sendServerStopCallback(
        "recording_stop_failed",
        resolvedSessionId,
        buildVoximplantConferenceName(resolvedSessionId),
        resolveProviderSessionId(),
        {
          operationId: commandRequestId || lastRequestId || null,
          failureCode: safeErrorCode,
          failureMessage: safeErrorMsg,
        },
      );
    }
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
    reportRuntimeStartFailure(requestId, lastErrorCode, lastErrorMessage);
    return;
  }
  if (typeof VoxEngine.createRecorder !== "function") {
    setErrorState("RECORDER_API_UNAVAILABLE", "VoxEngine.createRecorder is unavailable.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    reportRuntimeStartFailure(requestId, lastErrorCode, lastErrorMessage);
    return;
  }
  if (typeof conference.sendMediaTo !== "function") {
    setErrorState("CONFERENCE_MEDIA_ROUTING_UNAVAILABLE", "conference.sendMediaTo is unavailable.");
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    reportRuntimeStartFailure(requestId, lastErrorCode, lastErrorMessage);
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
  sendRecordingWebhook(
    getCurrentContextSessionId(),
    buildStatusPayload(requestId, STATE_STARTING, "Recording start requested.", null),
    { startedAt: safeNowIso() },
    getCurrentContextWebhookBaseUrl(),
  );

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
      reportRuntimeStartFailure(requestId, lastErrorCode, lastErrorMessage);
      return;
    }

    attachRecorderEventHandlers(requestId);
    conference.sendMediaTo(recorder);

    startingWatchdogId = setTimeout(function () {
      startingWatchdogId = null;
      if (recordingState === STATE_STARTING) {
        setErrorState("STARTING_TIMEOUT", "Recorder did not enter recording state in time.");
        sendStatus(lastControllerCall, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
        reportRuntimeStartFailure(requestId, lastErrorCode, lastErrorMessage);
        recorder = null;
      }
    }, STARTING_TIMEOUT_MS);
  } catch (e) {
    setErrorState("START_RECORDING_EXCEPTION", safeToString(e));
    sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    reportRuntimeStartFailure(requestId, lastErrorCode, lastErrorMessage);
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

function requestRecorderStopForScenarioShutdown(reason) {
  var safeReason = safeToString(reason) || "scenario_shutdown";
  if (!recorder) {
    log("scenario shutdown stop skipped reason=" + safeReason + " recorderPresent=false");
    return;
  }
  if (recordingState === STATE_IDLE || recordingState === STATE_STOPPED) {
    log("scenario shutdown stop skipped reason=" + safeReason + " state=" + recordingState);
    return;
  }
  if (recordingState === STATE_STOPPING) {
    log("scenario shutdown stop already in progress reason=" + safeReason);
    return;
  }

  var fallbackRequestId = "scenario-shutdown-stop-" + Date.now();
  var shutdownRequestId =
    (currentRecordingContext && currentRecordingContext.stopRequestId) ||
    lastRequestId ||
    fallbackRequestId;

  if (currentRecordingContext && !currentRecordingContext.stopRequestId) {
    currentRecordingContext.stopRequestId = shutdownRequestId;
  }

  log("scenario shutdown stop requested reason=" + safeReason + " state=" + recordingState);
  stopRecording(lastControllerCall, shutdownRequestId);
}

function stopRecording(call, requestId) {
  var effectiveRequestId =
    requestId ||
    (currentRecordingContext && currentRecordingContext.stopRequestId) ||
    lastRequestId ||
    ("internal-stop-" + Date.now());

  if (recordingState === STATE_STOPPING) {
    sendStatus(call, effectiveRequestId, STATE_STOPPING, "Recording stop is already in progress.", null);
    return;
  }

  if (recordingState === STATE_IDLE || recordingState === STATE_STOPPED) {
    sendStatus(call, effectiveRequestId, "not_recording", "Recording is not active.", null);
    return;
  }

  if (
    recordingState !== STATE_RECORDING &&
    recordingState !== STATE_PAUSED &&
    recordingState !== STATE_STARTING &&
    recordingState !== STATE_ERROR
  ) {
    sendStatus(call, effectiveRequestId, recordingState, "Stop is not valid from current state.", null);
    return;
  }
  if (!recorder) {
    recordingState = STATE_STOPPED;
    sendStatus(call, effectiveRequestId, STATE_STOPPED, "Recorder not present; treated as stopped.", null);
    return;
  }

  recordingState = STATE_STOPPING;
  lastControllerCall = call;
  lastRequestId = effectiveRequestId;
  if (currentRecordingContext) {
    currentRecordingContext.stopRequestId = effectiveRequestId;
  }
  startingWatchdogId = clearWatchdog(startingWatchdogId);
  resumingWatchdogId = clearWatchdog(resumingWatchdogId);
  sendStatus(call, effectiveRequestId, STATE_STOPPING, "Recording stop requested.", null);
  log("webhook POST intent status=stopping sessionId=" + (resolvedSessionId || "null"));
  sendRecordingWebhook(
    getCurrentContextSessionId(),
    buildStatusPayload(effectiveRequestId, STATE_STOPPING, "Recording stop requested.", null),
    null,
    getCurrentContextWebhookBaseUrl(),
  );

  try {
    if (typeof recorder.stop === "function") {
      recorder.stop();
    } else if (typeof recorder.stopRecord === "function") {
      recorder.stopRecord();
    } else {
      setErrorState("RECORDER_STOP_UNAVAILABLE", "Recorder stop method unavailable.");
      sendStatus(call, effectiveRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
      log("webhook POST intent status=error reason=RECORDER_STOP_UNAVAILABLE sessionId=" + (resolvedSessionId || "null"));
      sendRecordingWebhook(
        getCurrentContextSessionId(),
        buildStatusPayload(effectiveRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode),
        null,
        getCurrentContextWebhookBaseUrl(),
      );
      if (resolvedSessionId) {
        sendServerStopCallback(
          "recording_stop_failed",
          resolvedSessionId,
          buildVoximplantConferenceName(resolvedSessionId),
          resolveProviderSessionId(),
          {
            operationId: effectiveRequestId,
            failureCode: "RECORDER_STOP_UNAVAILABLE",
            failureMessage: lastErrorMessage,
          },
        );
      }
      return;
    }

    stoppingWatchdogId = setTimeout(function () {
      stoppingWatchdogId = null;
      if (recordingState === STATE_STOPPING) {
        setErrorState("STOPPING_TIMEOUT", "Recorder did not stop in time.");
        sendStatus(lastControllerCall, effectiveRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
        if (resolvedSessionId) {
          sendServerStopCallback(
            "recording_stop_failed",
            resolvedSessionId,
            buildVoximplantConferenceName(resolvedSessionId),
            resolveProviderSessionId(),
            {
              operationId: effectiveRequestId,
              failureCode: "STOPPING_TIMEOUT",
              failureMessage: lastErrorMessage,
            },
          );
        }
        recorder = null;
      }
    }, STOPPING_TIMEOUT_MS);
  } catch (e) {
    setErrorState("STOP_EXCEPTION", safeToString(e));
    sendStatus(call, effectiveRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    log("webhook POST intent status=error reason=STOP_EXCEPTION sessionId=" + (resolvedSessionId || "null"));
    sendRecordingWebhook(
      getCurrentContextSessionId(),
      buildStatusPayload(effectiveRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode),
      null,
      getCurrentContextWebhookBaseUrl(),
    );
    if (resolvedSessionId) {
      sendServerStopCallback(
        "recording_stop_failed",
        resolvedSessionId,
        buildVoximplantConferenceName(resolvedSessionId),
        resolveProviderSessionId(),
        {
          operationId: effectiveRequestId,
          failureCode: "STOP_EXCEPTION",
          failureMessage: lastErrorMessage,
        },
      );
    }
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

function reportSignedStartFailure(claims, errorCode, message, diagnostics) {
  if (!claims || claims.action !== ACTION_START) {
    return;
  }
  var normalizedOrigin = normalizeRecordingControlWebhookOrigin(
    claims.webhookBaseUrl || "",
  );
  if (!normalizedOrigin || normalizedOrigin !== claims.webhookBaseUrl) {
    return;
  }
  var statusPayload = buildStatusPayload(
    claims.requestId || null,
    STATE_ERROR,
    message,
    errorCode,
  );
  var clockFragment =
    diagnostics && typeof diagnostics.clockDeltaSeconds === "number"
      ? " clockDeltaSeconds=" + diagnostics.clockDeltaSeconds
      : "";
  log(
    "recording_control start_failure_callback code=" +
      (errorCode || "UNKNOWN") +
      " requestId=" +
      (claims.requestId || "none") +
      " sessionId=" +
      (claims.sessionId || "none") +
      clockFragment,
  );
  sendRecordingWebhook(
    claims.sessionId || null,
    statusPayload,
    null,
    normalizedOrigin,
  );
}

function evaluateRecordingControlTimeWindow(claims, nowSeconds) {
  var allowedSkewSeconds = RECORDING_CONTROL_CLOCK_SKEW_SECONDS;
  var issuedAt = Number(claims.issuedAt);
  var expiresAt = Number(claims.expiresAt);
  var earliestAcceptedSecond = issuedAt - allowedSkewSeconds;
  var latestAcceptedSecond = expiresAt + allowedSkewSeconds;
  var clockDeltaSeconds = nowSeconds - issuedAt;

  if (nowSeconds < earliestAcceptedSecond) {
    return {
      ok: false,
      code: "RECORDING_CONTROL_NOT_YET_VALID",
      message: "Signed recording control command is not yet valid.",
      clockDeltaSeconds: clockDeltaSeconds,
      issuedAt: issuedAt,
      expiresAt: expiresAt,
      nowSeconds: nowSeconds,
      allowedSkewSeconds: allowedSkewSeconds,
    };
  }
  if (nowSeconds > latestAcceptedSecond) {
    return {
      ok: false,
      code: "RECORDING_CONTROL_EXPIRED",
      message: "Signed recording control command has expired.",
      clockDeltaSeconds: clockDeltaSeconds,
      issuedAt: issuedAt,
      expiresAt: expiresAt,
      nowSeconds: nowSeconds,
      allowedSkewSeconds: allowedSkewSeconds,
    };
  }
  return {
    ok: true,
    clockDeltaSeconds: clockDeltaSeconds,
    issuedAt: issuedAt,
    expiresAt: expiresAt,
    nowSeconds: nowSeconds,
    allowedSkewSeconds: allowedSkewSeconds,
  };
}

function reportRuntimeStartFailure(requestId, errorCode, message) {
  var sessionId = getCurrentContextSessionId();
  var webhookBaseUrl = getCurrentContextWebhookBaseUrl();
  if (!sessionId || !webhookBaseUrl) {
    log(
      "webhook skipped: runtime start failure callback unresolved session/origin code=" +
        (errorCode || "UNKNOWN"),
    );
    return;
  }
  var payload = buildStatusPayload(
    requestId || null,
    STATE_ERROR,
    message,
    errorCode,
  );
  log(
    "webhook POST intent status=error reason=" +
      (errorCode || "UNKNOWN") +
      " sessionId=" +
      sessionId,
  );
  sendRecordingWebhook(sessionId, payload, null, webhookBaseUrl);
}

function onRecordingControlMessage(call, rawPayload) {
  // 1. parse message
  var parsedPayload = parseRecordingControlPayload(rawPayload);
  if (!parsedPayload) {
    return;
  }

  // 2. validate schema
  var schemaValidation = validateRecordingControlSchema(parsedPayload);
  var fallbackRequestId =
    schemaValidation && schemaValidation.requestId ? schemaValidation.requestId : null;
  if (!schemaValidation.ok) {
    sendStatus(
      call,
      fallbackRequestId,
      STATE_ERROR,
      "Signed recording control schema is invalid.",
      schemaValidation.code || "SCHEMA_INVALID",
    );
    return;
  }
  var payload = schemaValidation.payload;
  var claims = payload.claims;
  var requestId = claims.requestId;

  // 3. validate secret availability
  if (!isWebhookSecretConfigured(RECORDING_CONTROL_SECRET)) {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Recording control signature verification is unavailable.",
      "RECORDING_CONTROL_SECRET_UNAVAILABLE",
    );
    return;
  }

  // 4. verify HMAC
  var signatureVerification = verifyRecordingControlSignature(payload);
  if (!signatureVerification.ok) {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Recording control signature is invalid.",
      signatureVerification.code,
    );
    return;
  }

  // 5. validate issuedAt/expiresAt
  var nowSeconds = Math.floor(Date.now() / 1000);
  var timeWindow = evaluateRecordingControlTimeWindow(claims, nowSeconds);
  if (!timeWindow.ok) {
    log(
      "recording_control timestamp_rejected code=" +
        timeWindow.code +
        " requestId=" +
        requestId +
        " clockDeltaSeconds=" +
        timeWindow.clockDeltaSeconds +
        " issuedAt=" +
        timeWindow.issuedAt +
        " expiresAt=" +
        timeWindow.expiresAt +
        " nowSeconds=" +
        timeWindow.nowSeconds +
        " allowedSkewSeconds=" +
        timeWindow.allowedSkewSeconds,
    );
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      timeWindow.message,
      timeWindow.code,
    );
    reportSignedStartFailure(claims, timeWindow.code, timeWindow.message, timeWindow);
    return;
  }
  var nonceReplayExpiresAt =
    claims.expiresAt + RECORDING_CONTROL_CLOCK_SKEW_SECONDS;

  // 6. validate exact allowlisted webhook origin
  var normalizedOrigin = normalizeRecordingControlWebhookOrigin(claims.webhookBaseUrl);
  if (!normalizedOrigin || normalizedOrigin !== claims.webhookBaseUrl) {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Signed recording control callback origin is invalid.",
      "RECORDING_CONTROL_WEBHOOK_ORIGIN_INVALID",
    );
    return;
  }

  // 7. validate action/requestId/sessionId/conferenceName/participant claims
  var expectedConferenceName = buildVoximplantConferenceName(claims.sessionId);
  if (claims.conferenceName !== expectedConferenceName) {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Signed conference name does not match session binding.",
      "RECORDING_CONTROL_CONFERENCE_MISMATCH",
    );
    reportSignedStartFailure(
      claims,
      "RECORDING_CONTROL_CONFERENCE_MISMATCH",
      "Signed conference name does not match session binding.",
      null,
    );
    return;
  }
  var resolvedSessionFromClaims = resolveSessionId({
    sessionId: claims.sessionId,
    conferenceName: claims.conferenceName,
  });
  if (!resolvedSessionFromClaims || resolvedSessionFromClaims !== claims.sessionId) {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Signed session correlation is invalid.",
      "RECORDING_CONTROL_SESSION_MISMATCH",
    );
    reportSignedStartFailure(
      claims,
      "RECORDING_CONTROL_SESSION_MISMATCH",
      "Signed session correlation is invalid.",
      null,
    );
    return;
  }
  if (!claims.participantId || !claims.controllerUserId || !claims.controllerRole) {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Signed participant/controller identity is invalid.",
      "RECORDING_CONTROL_IDENTITY_INVALID",
    );
    reportSignedStartFailure(
      claims,
      "RECORDING_CONTROL_IDENTITY_INVALID",
      "Signed participant/controller identity is invalid.",
      null,
    );
    return;
  }

  // 8. validate canControlRecording=true
  var auth = isAuthorizedRecordingController(payload, call);
  if (!auth.allowed) {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Recording control is not authorized.",
      "UNAUTHORIZED_RECORDING_CONTROLLER",
    );
    log(
      "recording control denied callId=" + getCallId(call) + " reason=" + auth.reason,
    );
    reportSignedStartFailure(
      claims,
      "UNAUTHORIZED_RECORDING_CONTROLLER",
      "Recording control is not authorized.",
      null,
    );
    return;
  }

  // 9. bind provider-session identity and callback origin
  var currentProviderSessionId = resolveProviderSessionId();
  if (!RECORDING_CONTROL_BINDING) {
    RECORDING_CONTROL_BINDING = {
      sessionId: claims.sessionId,
      conferenceName: claims.conferenceName,
      webhookBaseUrl: normalizedOrigin,
      providerSessionId: currentProviderSessionId,
      participantId: claims.participantId,
      controllerUserId: claims.controllerUserId,
      controllerRole: claims.controllerRole,
    };
  } else {
    if (
      RECORDING_CONTROL_BINDING.sessionId !== claims.sessionId ||
      RECORDING_CONTROL_BINDING.conferenceName !== claims.conferenceName ||
      RECORDING_CONTROL_BINDING.webhookBaseUrl !== normalizedOrigin ||
      RECORDING_CONTROL_BINDING.providerSessionId !== currentProviderSessionId
    ) {
      sendStatus(
        call,
        requestId,
        STATE_ERROR,
        "Recording control binding mismatch for provider session.",
        "RECORDING_CONTROL_BINDING_CONFLICT",
      );
      reportSignedStartFailure(
        claims,
        "RECORDING_CONTROL_BINDING_CONFLICT",
        "Recording control binding mismatch for provider session.",
        null,
      );
      return;
    }
  }
  resolvedSessionId = claims.sessionId;
  lastConferenceName = claims.conferenceName;

  // 10. validate nonce/replay/idempotency outcome before reserving execution
  var nonceInspection = inspectRecordingControlNonce(
    claims.nonce,
    signatureVerification.messageHash,
  );
  if (nonceInspection.status === "duplicate_conflict") {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Signed recording control nonce replay conflict.",
      "RECORDING_CONTROL_NONCE_CONFLICT",
    );
    reportSignedStartFailure(
      claims,
      "RECORDING_CONTROL_NONCE_CONFLICT",
      "Signed recording control nonce replay conflict.",
      null,
    );
    return;
  }
  if (nonceInspection.status === "duplicate_rejected") {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Signed recording control command was already rejected before execution.",
      nonceInspection.reasonCode || "RECORDING_CONTROL_NONCE_PREVIOUSLY_REJECTED",
    );
    reportSignedStartFailure(
      claims,
      nonceInspection.reasonCode || "RECORDING_CONTROL_NONCE_PREVIOUSLY_REJECTED",
      "Signed recording control command was already rejected before execution.",
      null,
    );
    return;
  }
  if (nonceInspection.status === "duplicate_in_flight") {
    sendStatus(
      call,
      requestId,
      recordingState,
      "Signed recording control command is already being processed.",
      "RECORDING_CONTROL_NONCE_IN_FLIGHT",
    );
    return;
  }
  if (nonceInspection.status === "duplicate_processed") {
    log(
      "recording_control duplicate idempotent requestId=" +
        requestId +
        " nonce=" +
        claims.nonce,
    );
    sendCurrentStatus(call, requestId);
    return;
  }

  // 11. reserve nonce for command execution after immutable checks.
  var nonceReservation = beginRecordingControlNonceExecution(
    claims.nonce,
    signatureVerification.messageHash,
    nonceReplayExpiresAt,
  );
  if (nonceReservation.status === "duplicate_conflict") {
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Signed recording control nonce replay conflict.",
      "RECORDING_CONTROL_NONCE_CONFLICT",
    );
    reportSignedStartFailure(
      claims,
      "RECORDING_CONTROL_NONCE_CONFLICT",
      "Signed recording control nonce replay conflict.",
      null,
    );
    return;
  }
  if (nonceReservation.status === "duplicate_same") {
    if (nonceReservation.outcome === "REJECTED_PRE_EXECUTION") {
      sendStatus(
        call,
        requestId,
        STATE_ERROR,
        "Signed recording control command was already rejected before execution.",
        "RECORDING_CONTROL_NONCE_PREVIOUSLY_REJECTED",
      );
      reportSignedStartFailure(
        claims,
        "RECORDING_CONTROL_NONCE_PREVIOUSLY_REJECTED",
        "Signed recording control command was already rejected before execution.",
        null,
      );
      return;
    }
    sendCurrentStatus(call, requestId);
    return;
  }

  // 12. register server-stop control channel once (async acknowledgement required)
  var registration = registerServerStopControlChannel(RECORDING_CONTROL_BINDING);
  if (!registration.ok && registration.code === "REGISTRATION_CONFLICT") {
    markRecordingControlNonceOutcome(
      claims.nonce,
      "REJECTED_PRE_EXECUTION",
      "SERVER_STOP_REGISTRATION_CONFLICT",
      nonceReplayExpiresAt,
    );
    sendStatus(
      call,
      requestId,
      STATE_ERROR,
      "Server-stop control channel registration conflict.",
      "SERVER_STOP_REGISTRATION_CONFLICT",
    );
    reportSignedStartFailure(
      claims,
      "SERVER_STOP_REGISTRATION_CONFLICT",
      "Server-stop control channel registration conflict.",
      null,
    );
    return;
  }
  if (!registration.ok) {
    log(
      "server-stop registration not acknowledged code=" +
        (registration.code || "REGISTRATION_UNAVAILABLE") +
        " requestId=" +
        requestId +
        " action=" +
        claims.action +
        " fallback=browser_relay",
    );
  }
  if (
    registration.state === SERVER_STOP_REGISTRATION_STATE_IN_FLIGHT ||
    registration.state === SERVER_STOP_REGISTRATION_STATE_FAILED_RETRYABLE ||
    registration.state === SERVER_STOP_REGISTRATION_STATE_NOT_SENT ||
    registration.state === SERVER_STOP_REGISTRATION_STATE_FAILED_TERMINAL
  ) {
    log(
      "server-stop registration pending state=" +
        registration.state +
        " requestId=" +
        requestId +
        " action=" +
        claims.action +
        " fallback=browser_relay_until_acknowledged",
    );
  }

  log(
    "recording_control verified action=" +
      claims.action +
      " requestId=" +
      requestId +
      " sessionId=" +
      claims.sessionId +
      " conferenceName=" +
      claims.conferenceName +
      " webhookBaseUrl=" +
      claims.webhookBaseUrl +
      " authReason=" +
      auth.reason,
  );

  // 13. execute recording action
  markRecordingControlNonceOutcome(
    claims.nonce,
    "EXECUTED",
    null,
    nonceReplayExpiresAt,
  );
  if (claims.action === ACTION_START) {
    currentRecordingContext = {
      sessionId: claims.sessionId,
      conferenceName: claims.conferenceName,
      webhookBaseUrl: normalizedOrigin,
      participantId: claims.participantId,
      startRequestId: requestId,
      stopRequestId: null,
    };
    log(
      "recording context created sessionId=" +
        claims.sessionId +
        " webhookBaseUrl=" +
        normalizedOrigin,
    );
    startRecording(call, requestId);
    return;
  }

  if (claims.action === ACTION_STOP) {
    if (currentRecordingContext) {
      currentRecordingContext.stopRequestId = requestId;
      currentRecordingContext.webhookBaseUrl = normalizedOrigin;
      currentRecordingContext.conferenceName = claims.conferenceName;
      currentRecordingContext.sessionId = claims.sessionId;
      currentRecordingContext.participantId = claims.participantId;
      log(
        "recording context updated stopRequestId=" +
          requestId +
          " webhookBaseUrl=" +
          normalizedOrigin,
      );
    } else {
      currentRecordingContext = {
        sessionId: claims.sessionId,
        conferenceName: claims.conferenceName,
        webhookBaseUrl: normalizedOrigin,
        participantId: claims.participantId,
        startRequestId: null,
        stopRequestId: requestId,
      };
      log(
        "recording context reconstructed sessionId=" +
          claims.sessionId +
          " webhookBaseUrl=" +
          normalizedOrigin,
      );
    }
    stopRecording(call, requestId);
    return;
  }

  if (claims.action === ACTION_PAUSE) {
    pauseRecording(call, requestId);
    return;
  }
  if (claims.action === ACTION_RESUME) {
    resumeRecording(call, requestId);
    return;
  }
  sendCurrentStatus(call, requestId);
}

function readHeaderValue(headers, headerName) {
  if (!headers) return null;
  var target = String(headerName || "").toLowerCase();
  for (var key in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, key)) continue;
    if (String(key).toLowerCase() === target) {
      return safeToString(headers[key]);
    }
  }
  return null;
}

function decodeQueryComponentSafe(value) {
  var text = safeToString(value || "");
  if (!text) return "";
  text = text.replace(/\+/g, "%20");
  try {
    return decodeURIComponent(text);
  } catch (e) {
    return text;
  }
}

function readQueryValueFromPath(pathValue, keyName) {
  var rawPath = safeToString(pathValue || "");
  if (!rawPath) return null;
  var queryIndex = rawPath.indexOf("?");
  if (queryIndex < 0) return null;
  var query = rawPath.slice(queryIndex + 1);
  if (!query) return null;
  var target = String(keyName || "").toLowerCase();
  var pairs = query.split("&");
  for (var i = 0; i < pairs.length; i++) {
    var pair = safeToString(pairs[i] || "");
    if (!pair) continue;
    var eqIdx = pair.indexOf("=");
    var rawKey = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair;
    var decodedKey = decodeQueryComponentSafe(rawKey).toLowerCase();
    if (decodedKey !== target) continue;
    var rawValue = eqIdx >= 0 ? pair.slice(eqIdx + 1) : "";
    var decodedValue = decodeQueryComponentSafe(rawValue);
    return decodedValue || null;
  }
  return null;
}

function sendHttpResponse(event, statusCode, bodyText) {
  var payloadText = safeToString(bodyText || "");
  try {
    if (event && event.response && typeof event.response.writeHead === "function") {
      event.response.writeHead(statusCode, { "Content-Type": "application/json" });
      if (typeof event.response.end === "function") {
        event.response.end(payloadText);
      }
      return payloadText;
    }
  } catch (e) {
    log("server-stop http response failed: " + safeToString(e));
  }
  // Some VoxEngine runtimes use callback return value as body.
  return payloadText;
}

function handleServerStopHttpRequest(event) {
  var req = event && event.request ? event.request : null;
  var method = safeToString((event && event.method) || (req && req.method)).toUpperCase();
  var path = safeToString((event && event.path) || (req && req.path));
  var requestUrl = safeToString((event && event.url) || (req && req.url) || path);
  if (method !== "POST") {
    return sendHttpResponse(event, 404, JSON.stringify({ ok: false, error: "not_found" }));
  }

  var rawBody = safeToString(
    (event && (event.content || event.body || event.postData || event.text)) ||
      (req && (req.body || req.postData || req.text || "")),
  );
  var headers = (event && event.headers) || ((req && req.headers) ? req.headers : {});
  if (!isServerStopSecretConfigured(SERVER_STOP_CONTROL_SECRET)) {
    return sendHttpResponse(event, 503, JSON.stringify({ ok: false, error: "config_unavailable" }));
  }

  var protocol =
    readHeaderValue(headers, "x-vox-stop-protocol") ||
    readQueryValueFromPath(path, "x-vox-stop-protocol") ||
    readQueryValueFromPath(requestUrl, "x-vox-stop-protocol");
  var timestamp =
    readHeaderValue(headers, "x-vox-stop-timestamp") ||
    readQueryValueFromPath(path, "x-vox-stop-timestamp") ||
    readQueryValueFromPath(requestUrl, "x-vox-stop-timestamp");
  var nonce =
    readHeaderValue(headers, "x-vox-stop-nonce") ||
    readQueryValueFromPath(path, "x-vox-stop-nonce") ||
    readQueryValueFromPath(requestUrl, "x-vox-stop-nonce");
  var bodyHash =
    readHeaderValue(headers, "x-vox-stop-body-sha256") ||
    readQueryValueFromPath(path, "x-vox-stop-body-sha256") ||
    readQueryValueFromPath(requestUrl, "x-vox-stop-body-sha256");
  var signature =
    readHeaderValue(headers, "x-vox-stop-signature") ||
    readQueryValueFromPath(path, "x-vox-stop-signature") ||
    readQueryValueFromPath(requestUrl, "x-vox-stop-signature");

  if (!protocol || !timestamp || !nonce || !bodyHash || !signature) {
    return sendHttpResponse(event, 400, JSON.stringify({ ok: false, error: "malformed_headers" }));
  }
  if (protocol !== SERVER_STOP_PROTOCOL_VERSION) {
    return sendHttpResponse(event, 401, JSON.stringify({ ok: false, error: "protocol_mismatch" }));
  }

  var nowSec = Math.floor(Date.now() / 1000);
  var ts = Number(timestamp);
  if (!isFinite(ts) || Math.abs(nowSec - ts) > 300) {
    return sendHttpResponse(event, 401, JSON.stringify({ ok: false, error: "timestamp_expired" }));
  }
  if (isReplayServerStopNonce(nonce)) {
    return sendHttpResponse(event, 200, JSON.stringify({ ok: true, accepted: true, duplicate: true }));
  }

  var computedHash = sha256Hex(rawBody);
  if (computedHash !== String(bodyHash).toLowerCase()) {
    return sendHttpResponse(event, 401, JSON.stringify({ ok: false, error: "body_hash_mismatch" }));
  }
  var expectedSignature = buildServerStopSignature(
    protocol,
    timestamp,
    nonce,
    String(bodyHash).toLowerCase(),
    SERVER_STOP_CONTROL_SECRET,
  );
  if (!expectedSignature || expectedSignature !== String(signature).toLowerCase()) {
    return sendHttpResponse(event, 401, JSON.stringify({ ok: false, error: "signature_invalid" }));
  }
  rememberServerStopNonce(nonce);

  var payload = null;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return sendHttpResponse(event, 400, JSON.stringify({ ok: false, error: "invalid_json" }));
  }

  var operationId = payload && payload.operationId ? String(payload.operationId) : null;
  var sessionId = payload && payload.sessionId ? String(payload.sessionId) : null;
  var conferenceName = payload && payload.conferenceName ? String(payload.conferenceName) : null;
  var incomingProviderSessionId =
    payload && payload.providerSessionId ? String(payload.providerSessionId) : null;
  var action = payload && payload.action ? String(payload.action) : null;

  if (
    action !== "stop_recording" ||
    !operationId ||
    !sessionId ||
    !conferenceName ||
    !incomingProviderSessionId
  ) {
    return sendHttpResponse(event, 400, JSON.stringify({ ok: false, error: "invalid_command_payload" }));
  }

  var expectedConferenceName = buildVoximplantConferenceName(sessionId);
  if (conferenceName !== expectedConferenceName) {
    return sendHttpResponse(event, 409, JSON.stringify({ ok: false, error: "conference_mismatch" }));
  }
  if (incomingProviderSessionId !== resolveProviderSessionId()) {
    return sendHttpResponse(event, 409, JSON.stringify({ ok: false, error: "provider_session_mismatch" }));
  }
  if (!RECORDING_CONTROL_BINDING) {
    return sendHttpResponse(event, 409, JSON.stringify({ ok: false, error: "recording_control_binding_missing" }));
  }
  if (
    RECORDING_CONTROL_BINDING.sessionId !== sessionId ||
    RECORDING_CONTROL_BINDING.conferenceName !== conferenceName ||
    RECORDING_CONTROL_BINDING.providerSessionId !== incomingProviderSessionId
  ) {
    return sendHttpResponse(event, 409, JSON.stringify({ ok: false, error: "recording_control_binding_mismatch" }));
  }

  currentRecordingContext = currentRecordingContext || {};
  currentRecordingContext.sessionId = sessionId;
  currentRecordingContext.conferenceName = conferenceName;
  currentRecordingContext.webhookBaseUrl = RECORDING_CONTROL_BINDING.webhookBaseUrl;
  currentRecordingContext.stopRequestId = operationId;

  sendServerStopCallback(
    "recording_stop_command_accepted",
    sessionId,
    conferenceName,
    resolveProviderSessionId(),
    { operationId: operationId },
  );

  if (recordingState === STATE_IDLE || recordingState === STATE_STOPPED) {
    sendServerStopCallback(
      "recording_stopped",
      sessionId,
      conferenceName,
      resolveProviderSessionId(),
      { operationId: operationId, terminalStatus: "already_stopped" },
    );
    return sendHttpResponse(event, 200, JSON.stringify({ ok: true, accepted: true, alreadyStopped: true }));
  }

  try {
    stopRecording(lastControllerCall, operationId);
    return sendHttpResponse(event, 202, JSON.stringify({ ok: true, accepted: true, path: path || "" }));
  } catch (stopErr) {
    sendServerStopCallback(
      "recording_stop_failed",
      sessionId,
      conferenceName,
      resolveProviderSessionId(),
      {
        operationId: operationId,
        failureCode: "STOP_EXCEPTION",
        failureMessage: safeToString(stopErr),
      },
    );
    return sendHttpResponse(event, 500, JSON.stringify({ ok: false, error: "stop_exception" }));
  }
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
    var raw = (msgEvent && msgEvent.text !== undefined) ? msgEvent.text : null;
    if (raw === null || raw === undefined) return;
    onRecordingControlMessage(call, raw);
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

function onAppStarted(event) {
  applyWebhookEnvironmentConfig();
  applyRecordingControlEnvironmentConfig();
  applyServerStopEnvironmentConfig();
  SERVER_STOP_RULE_IDENTITY = resolveServerStopRuleIdentity(event);
  providerControlAccessSecureUrl =
    normalizeControlAccessSecureUrl(event && event.accessSecureURL) || null;
  log("scenario build=" + SCENARIO_BUILD_ID + " source=" + SCENARIO_SOURCE_NAME);
  log("server-stop ruleIdentity=" + SERVER_STOP_RULE_IDENTITY);
  log("scenario started — sessionId is resolved from recording_control.message.sessionId first; conferenceName parsing is fallback only");
  log(
    "server-stop control url source=" +
      (providerControlAccessSecureUrl ? "app_access_secure_url" : "access_secure_url_unavailable"),
  );
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
    requestRecorderStopForScenarioShutdown("ConferenceEvents.Stopped");
  }, "ConferenceEvents.Stopped");

  addSafeEventListener(VoxEngine, "AppEvents", "HttpRequest", handleServerStopHttpRequest, "AppEvents.HttpRequest");

  addSafeEventListener(VoxEngine, "AppEvents", "Terminating", function () {
    log("app terminating");
    requestRecorderStopForScenarioShutdown("AppEvents.Terminating");
  }, "AppEvents.Terminating");
}

addSafeEventListener(VoxEngine, "AppEvents", "Started", onAppStarted, "AppEvents.Started");
addSafeEventListener(VoxEngine, "AppEvents", "CallAlerting", handleIncomingCall, "AppEvents.CallAlerting");
