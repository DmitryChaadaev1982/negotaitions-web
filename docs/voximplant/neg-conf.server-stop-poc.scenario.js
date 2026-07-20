/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

// ============================================================
// SERVER-STOP POC SCENARIO VARIANT (MANUAL PASTE ONLY)
// ============================================================
//
// Purpose: prove Next.js → StartConference → media_session_access_url →
// AppEvents.HttpRequest → ConferenceRecorder.stop() → RecorderEvents.Stopped
// → POC callback / existing webhook path.
//
// DO NOT auto-upload. DO NOT replace production neg-conf-main-room by default.
// Paste into a dedicated POC scenario/rule in Voximplant Console for experiments.
//
// Required paste replacements:
//   CONTROL_SECRET   ← VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET
//                      (server → scenario command HMAC)
//   CALLBACK_SECRET  ← VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET
//                      (scenario → application callback HMAC; NEVER reuse CONTROL_SECRET)
//   POC_CALLBACK_URL ← https://<host>/api/poc/voximplant/server-stop/callback
//   WEBHOOK_SECRET   ← VOXIMPLANT_RECORDING_WEBHOOK_SECRET (optional; unused by default)
//
// Platform note (Checkpoint A evidence):
//   AppEvents.HttpRequest HTTP 2xx does NOT reliably return an arbitrary JSON
//   identity body. Confirmation is via signed asynchronous POC callback.
//
// Supported HTTP actions (allow-list): ping | get_recording_state | stop_recording

require(Modules.Conference);
try {
  require(Modules.Recorder);
} catch (err) {
  Logger.write("[server-stop-poc] Modules.Recorder require failed");
}

var SCENARIO_BUILD_ID = "server-stop-poc-2026-07-20-b1";
var SCENARIO_SOURCE_NAME = "neg-conf-server-stop-poc";
/** Stable identity for async callback confirmation (must match lib/voximplant/poc/poc-safety.ts). */
var SCENARIO_KIND = "voximplant_server_stop_poc";
var PROTOCOL_VERSION = 1;

var CONTROL_SECRET = "__PASTE_VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET_HERE__";
var CALLBACK_SECRET = "__PASTE_VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET_HERE__";
var WEBHOOK_SECRET = "__PASTE_VOXIMPLANT_RECORDING_WEBHOOK_SECRET_HERE__";
var WEBHOOK_BASE_URL = "";
var POC_CALLBACK_URL = "";

var REPLAY_WINDOW_MS = 5 * 60 * 1000;
var CONFERENCE_NAME_PREFIX_POC = "neg-poc-server-stop-";
var callSessionHistoryId = null;

var conference = null;
var recorder = null;
var expectedConferenceName = null;
var participants = 0;
var activeCallIds = {};

// Recorder ownership registry (process-local; acceptable for isolated POC).
var recorderRegistry = {
  exists: false,
  recordingStarted: false,
  stopRequested: false,
  stopCompleted: false,
  lastOperationId: null,
};

var seenNonces = {};
var operationResults = {};
var pendingStopOperationId = null;

var STATE_ABSENT = "absent";
var STATE_EXISTS = "exists";
var STATE_RECORDING_STARTED = "recording_started";
var STATE_STOP_REQUESTED = "stop_requested";
var STATE_STOP_COMPLETED = "stop_completed";

function log(message) {
  Logger.write("[server-stop-poc] " + message);
}

function safeToString(value) {
  try {
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") return value;
    if (value && value.message) return String(value.message);
    return String(value);
  } catch (e) {
    return "unprintable";
  }
}

function safeNowIso() {
  try {
    return new Date().toISOString();
  } catch (e) {
    return String(Date.now());
  }
}

function isSecretConfigured(secret, placeholder) {
  if (!secret || typeof secret !== "string") return false;
  var trimmed = secret.trim();
  if (!trimmed) return false;
  if (trimmed === placeholder) return false;
  return trimmed.length >= 16;
}

// ── Pure JS SHA-256 + HMAC (same approach as main-room scenario) ─────────────

function rotr(n, x) {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(bytes) {
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
  var H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  var l = bytes.length;
  var withOne = new Array(l + 1);
  var i;
  for (i = 0; i < l; i++) withOne[i] = bytes[i];
  withOne[l] = 0x80;
  var bitLen = l * 8;
  var totalLen = withOne.length + 8;
  var paddedLen = Math.ceil(totalLen / 64) * 64;
  var padded = new Array(paddedLen);
  for (i = 0; i < paddedLen; i++) padded[i] = 0;
  for (i = 0; i < withOne.length; i++) padded[i] = withOne[i];
  padded[paddedLen - 4] = (bitLen >>> 24) & 0xff;
  padded[paddedLen - 3] = (bitLen >>> 16) & 0xff;
  padded[paddedLen - 2] = (bitLen >>> 8) & 0xff;
  padded[paddedLen - 1] = bitLen & 0xff;

  for (var offset = 0; offset < paddedLen; offset += 64) {
    var w = new Array(64);
    for (i = 0; i < 16; i++) {
      var j = offset + i * 4;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (i = 16; i < 64; i++) {
      var s0 = (rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3)) >>> 0;
      var s1 = (rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var S1 = (rotr(6, e) ^ rotr(11, e) ^ rotr(25, e)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      var S0 = (rotr(2, a) ^ rotr(13, a) ^ rotr(22, a)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  var out = [];
  for (i = 0; i < 8; i++) {
    out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
  }
  return out;
}

function utf8ToBytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      i++;
      var code2 = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      out.push(
        0xf0 | (code2 >> 18),
        0x80 | ((code2 >> 12) & 0x3f),
        0x80 | ((code2 >> 6) & 0x3f),
        0x80 | (code2 & 0x3f),
      );
    }
  }
  return out;
}

function bytesToHex(bytes) {
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    hex += h.length === 1 ? "0" + h : h;
  }
  return hex;
}

function hmacSha256Hex(message, secret) {
  if (typeof crypto !== "undefined" && crypto && typeof crypto.createHmac === "function") {
    return crypto.createHmac("sha256", secret).update(message).digest("hex");
  }
  var blockSize = 64;
  var key = utf8ToBytes(secret);
  if (key.length > blockSize) key = sha256Bytes(key);
  while (key.length < blockSize) key.push(0);
  var oKey = [];
  var iKey = [];
  for (var i = 0; i < blockSize; i++) {
    oKey.push(key[i] ^ 0x5c);
    iKey.push(key[i] ^ 0x36);
  }
  var inner = sha256Bytes(iKey.concat(utf8ToBytes(message)));
  return bytesToHex(sha256Bytes(oKey.concat(inner)));
}

function sha256Hex(message) {
  return bytesToHex(sha256Bytes(utf8ToBytes(message)));
}

function constantTimeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getHeader(headers, name) {
  if (!headers) return null;
  var lower = name.toLowerCase();
  if (typeof headers === "object") {
    if (headers[name] !== undefined) return String(headers[name]);
    if (headers[lower] !== undefined) return String(headers[lower]);
    for (var key in headers) {
      if (!Object.prototype.hasOwnProperty.call(headers, key)) continue;
      if (String(key).toLowerCase() === lower) return String(headers[key]);
    }
  }
  return null;
}

function registryState() {
  if (recorderRegistry.stopCompleted) return STATE_STOP_COMPLETED;
  if (recorderRegistry.stopRequested) return STATE_STOP_REQUESTED;
  if (recorderRegistry.recordingStarted) return STATE_RECORDING_STARTED;
  if (recorderRegistry.exists) return STATE_EXISTS;
  return STATE_ABSENT;
}

/**
 * Transport ack only. Do not rely on clients reading this body for identity —
 * observed platform contract may return empty / non-JSON 2xx.
 */
function buildTransportAckBody(ok, action, operationId, state, errorCode) {
  return JSON.stringify({
    ok: Boolean(ok),
    action: action || null,
    operationId: operationId || null,
    state: state || null,
    errorCode: errorCode || null,
  });
}

function respondHttp(e, status, body) {
  try {
    if (e && typeof e.Response === "function") {
      e.Response(status, body, { "Content-Type": "application/json" });
      return;
    }
  } catch (err) {
    log("Response helper failed: " + safeToString(err));
  }
  try {
    if (typeof e === "object") {
      e.code = status;
      e.headers = { "Content-Type": "application/json" };
      e.text = body;
    }
  } catch (err2) {
    log("Response fallback failed: " + safeToString(err2));
  }
}

function createNonce() {
  try {
    return sha256Hex(safeNowIso() + ":" + String(Math.random())).slice(0, 32);
  } catch (e) {
    return String(Date.now()) + "a";
  }
}

function buildCallbackPayload(eventType, action, operationId, recorderState, errorCode) {
  return {
    scenarioKind: SCENARIO_KIND,
    protocolVersion: PROTOCOL_VERSION,
    eventType: eventType,
    action: action || null,
    operationId: operationId || null,
    conferenceName: expectedConferenceName || null,
    callSessionHistoryId: callSessionHistoryId,
    recorderState: recorderState || registryState(),
    errorCode: errorCode || null,
    timestamp: safeNowIso(),
    nonce: createNonce(),
  };
}

function extractCallbackResponseCode(result) {
  try {
    if (!result) return null;
    if (typeof result.code === "number") return result.code;
    if (typeof result.status === "number") return result.status;
    if (result.response && typeof result.response.code === "number") return result.response.code;
  } catch (e) {
    return null;
  }
  return null;
}

function extractCallbackResponseErrorCode(result) {
  try {
    var text = null;
    if (result && typeof result.text === "string") text = result.text;
    else if (result && typeof result.data === "string") text = result.data;
    else if (result && result.response && typeof result.response.text === "string") {
      text = result.response.text;
    }
    if (!text) return null;
    // Only parse short JSON for top-level errorCode/result — never log full body.
    if (text.length > 2000) text = text.slice(0, 2000);
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.errorCode === "string") return parsed.errorCode;
    if (typeof parsed.result === "string") return parsed.result;
    return null;
  } catch (e) {
    return null;
  }
}

function classifyCallbackHttpResult(httpStatus) {
  if (httpStatus == null || !isFinite(httpStatus) || httpStatus === 0) {
    return "CALLBACK_HTTP_TIMEOUT";
  }
  if (httpStatus >= 200 && httpStatus < 300) return "CALLBACK_HTTP_ACCEPTED";
  return "CALLBACK_HTTP_REJECTED";
}

function logCallbackHttpResult(eventType, operationId, result) {
  var httpStatus = extractCallbackResponseCode(result);
  var responseErrorCode = extractCallbackResponseErrorCode(result);
  var classification = classifyCallbackHttpResult(httpStatus);
  // Sanitized only: no URL, headers, signature, secret, or full body.
  log(
    "POC callback httpResult eventType=" +
      eventType +
      " operationId=" +
      safeToString(operationId) +
      " httpStatus=" +
      safeToString(httpStatus) +
      " responseErrorCode=" +
      safeToString(responseErrorCode) +
      " classification=" +
      classification,
  );
}

function sendSignedPocCallback(eventType, action, operationId, recorderState, errorCode) {
  if (!POC_CALLBACK_URL) {
    log("POC callback skipped: POC_CALLBACK_URL empty");
    return;
  }
  if (!isSecretConfigured(CALLBACK_SECRET, "__PASTE_VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET_HERE__")) {
    log("POC callback skipped: CALLBACK_SECRET not configured");
    return;
  }
  if (typeof Net === "undefined" || !Net.httpRequest) {
    log("POC callback skipped: Net.httpRequest unavailable");
    return;
  }

  var payload = buildCallbackPayload(eventType, action, operationId, recorderState, errorCode);
  var body = JSON.stringify(payload);
  var bodyHash = sha256Hex(body);
  var signingPayload =
    "v1\n" +
    String(payload.eventType) + "\n" +
    String(payload.action || "") + "\n" +
    String(payload.operationId || "") + "\n" +
    String(payload.conferenceName || "") + "\n" +
    String(payload.timestamp) + "\n" +
    String(payload.nonce) + "\n" +
    bodyHash;
  var signature = hmacSha256Hex(signingPayload, CALLBACK_SECRET);

  try {
    Net.httpRequest(POC_CALLBACK_URL, function (result) {
      log(
        "POC callback attempted eventType=" +
          eventType +
          " operationId=" +
          safeToString(operationId),
      );
      logCallbackHttpResult(eventType, operationId, result);
    }, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Neg-Poc-Callback-Version": "v1",
        "X-Neg-Poc-Callback-Event-Type": String(payload.eventType),
        "X-Neg-Poc-Callback-Action": String(payload.action || ""),
        "X-Neg-Poc-Callback-Operation-Id": String(payload.operationId || ""),
        "X-Neg-Poc-Callback-Conference-Name": String(payload.conferenceName || ""),
        "X-Neg-Poc-Callback-Timestamp": String(payload.timestamp),
        "X-Neg-Poc-Callback-Nonce": String(payload.nonce),
        "X-Neg-Poc-Callback-Body-Hash": bodyHash,
        "X-Neg-Poc-Callback-Signature": signature,
      },
      postData: body,
    });
  } catch (e) {
    log("POC callback failed: " + safeToString(e));
    log(
      "POC callback httpResult eventType=" +
        eventType +
        " operationId=" +
        safeToString(operationId) +
        " httpStatus=null responseErrorCode=null classification=CALLBACK_HTTP_TIMEOUT",
    );
  }
}

function parseCustomDataConferenceName() {
  try {
    if (typeof VoxEngine.customData === "function") {
      var raw = VoxEngine.customData();
      if (!raw) return null;
      if (typeof raw === "string") {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.conferenceName) return String(parsed.conferenceName);
      }
    }
  } catch (e) {
    log("customData parse failed");
  }
  return null;
}

function verifyControlRequest(e, bodyText) {
  var method = (e && e.method) ? String(e.method).toUpperCase() : "GET";
  if (method !== "POST") {
    return { ok: false, errorCode: "method_not_allowed" };
  }
  if (!isSecretConfigured(CONTROL_SECRET, "__PASTE_VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET_HERE__")) {
    return { ok: false, errorCode: "control_secret_not_configured" };
  }

  var headers = (e && e.headers) ? e.headers : {};
  var version = getHeader(headers, "X-Neg-Poc-Version");
  var action = getHeader(headers, "X-Neg-Poc-Action");
  var conferenceName = getHeader(headers, "X-Neg-Poc-Conference-Name");
  var operationId = getHeader(headers, "X-Neg-Poc-Operation-Id");
  var timestamp = getHeader(headers, "X-Neg-Poc-Timestamp");
  var nonce = getHeader(headers, "X-Neg-Poc-Nonce");
  var bodyHash = getHeader(headers, "X-Neg-Poc-Body-Hash");
  var signature = getHeader(headers, "X-Neg-Poc-Signature");

  if (!action || (action !== "ping" && action !== "get_recording_state" && action !== "stop_recording")) {
    return { ok: false, errorCode: "unknown_action", action: action };
  }
  if (!operationId) return { ok: false, errorCode: "missing_operation_id", action: action };
  if (!conferenceName) return { ok: false, errorCode: "missing_conference_name", action: action };
  if (!nonce) return { ok: false, errorCode: "missing_nonce", action: action };
  if (!signature) return { ok: false, errorCode: "missing_signature", action: action };
  if (version !== "v1") return { ok: false, errorCode: "unsupported_version", action: action };

  if (expectedConferenceName && conferenceName !== expectedConferenceName) {
    return { ok: false, errorCode: "wrong_conference", action: action, operationId: operationId };
  }

  var ts = Date.parse(timestamp || "");
  if (!isFinite(ts)) return { ok: false, errorCode: "invalid_timestamp", action: action, operationId: operationId };
  if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
    return { ok: false, errorCode: "expired_timestamp", action: action, operationId: operationId };
  }
  if (seenNonces[nonce]) {
    return { ok: false, errorCode: "replayed_nonce", action: action, operationId: operationId };
  }

  var expectedBodyHash = sha256Hex(bodyText || "");
  if (!constantTimeEqualHex(expectedBodyHash, String(bodyHash || "").toLowerCase())) {
    return { ok: false, errorCode: "body_hash_mismatch", action: action, operationId: operationId };
  }

  var payload =
    "v1\n" +
    action + "\n" +
    conferenceName + "\n" +
    operationId + "\n" +
    timestamp + "\n" +
    nonce + "\n" +
    String(bodyHash || "").toLowerCase();
  var expectedSig = hmacSha256Hex(payload, CONTROL_SECRET);
  if (!constantTimeEqualHex(expectedSig, String(signature).toLowerCase())) {
    return { ok: false, errorCode: "invalid_signature", action: action, operationId: operationId };
  }

  seenNonces[nonce] = true;
  return {
    ok: true,
    action: action,
    conferenceName: conferenceName,
    operationId: operationId,
  };
}

var pendingStartRequestId = null;

/**
 * Browser-originated recording start (same shape as main-room recording_control).
 * Idempotent one-recorder guard — does not alter server-stop HTTP control protocol.
 */
function startRecordingFromBrowser(requestId) {
  if (recorder && recorderRegistry.recordingStarted) {
    log("recording_control start ignored — recorder already active requestId=" + safeToString(requestId));
    sendSignedPocCallback(
      "recording_started",
      "start",
      requestId || pendingStartRequestId,
      STATE_RECORDING_STARTED,
      "already_started",
    );
    return { ok: true, errorCode: "already_started" };
  }
  if (!conference) {
    log("recording_control start failed — conference missing");
    return { ok: false, errorCode: "conference_not_ready" };
  }
  if (typeof VoxEngine.createRecorder !== "function") {
    log("recording_control start failed — createRecorder unavailable");
    return { ok: false, errorCode: "recorder_api_unavailable" };
  }
  if (typeof conference.sendMediaTo !== "function") {
    log("recording_control start failed — sendMediaTo unavailable");
    return { ok: false, errorCode: "conference_media_routing_unavailable" };
  }

  pendingStartRequestId = requestId || null;
  try {
    recorder = VoxEngine.createRecorder({
      video: false,
      lossless: true,
      name: "server-stop-poc-audio",
      recordNamePrefix: "server-stop-poc/audio/",
    });
    if (!recorder) {
      log("recording_control start failed — recorder not created");
      sendSignedPocCallback(
        "command_rejected",
        "start",
        requestId,
        registryState(),
        "recorder_create_failed",
      );
      return { ok: false, errorCode: "recorder_create_failed" };
    }
    recorderRegistry.exists = true;
    attachRecorderHandlers();
    conference.sendMediaTo(recorder);
    log("recording_control start — ConferenceRecorder created requestId=" + safeToString(requestId));
    return { ok: true, errorCode: null };
  } catch (e) {
    log("recording_control start exception: " + safeToString(e));
    sendSignedPocCallback(
      "command_rejected",
      "start",
      requestId,
      registryState(),
      "start_recording_exception",
    );
    return { ok: false, errorCode: "start_recording_exception" };
  }
}

function parseRecordingControlPayload(raw) {
  try {
    var text = raw;
    if (raw && typeof raw === "object") {
      if (typeof raw.text === "string") text = raw.text;
      else if (typeof raw.data === "string") text = raw.data;
      else if (raw.message && typeof raw.message === "string") text = raw.message;
      else text = null;
    }
    if (!text || typeof text !== "string") return null;
    var parsed = JSON.parse(text);
    // Nested { name, payload } envelope from some SDK versions.
    if (parsed && parsed.payload && typeof parsed.payload === "string") {
      parsed = JSON.parse(parsed.payload);
    } else if (parsed && parsed.payload && typeof parsed.payload === "object") {
      parsed = parsed.payload;
    }
    if (!parsed || parsed.type !== "recording_control") return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function handleRecordingControlMessage(msgEvent) {
  var payload = parseRecordingControlPayload(msgEvent);
  if (!payload) return;
  log(
    "recording_control received action=" +
      safeToString(payload.action) +
      " requestId=" +
      safeToString(payload.requestId),
  );
  if (payload.action === "start") {
    startRecordingFromBrowser(payload.requestId || null);
    return;
  }
  // Stop remains server-control only for this POC (HTTP stop_recording).
  log("recording_control non-start action ignored action=" + safeToString(payload.action));
}

function attachRecorderHandlers() {
  if (!recorder) return;

  try {
    recorder.addEventListener(RecorderEvents.Started, function () {
      recorderRegistry.exists = true;
      recorderRegistry.recordingStarted = true;
      log("RecorderEvents.Started");
      // Provider-level start evidence (no recording URL in callback).
      sendSignedPocCallback(
        "recording_started",
        "start",
        pendingStartRequestId || recorderRegistry.lastOperationId,
        STATE_RECORDING_STARTED,
        null,
      );
    });
  } catch (e) {
    log("attach Started failed: " + safeToString(e));
  }

  try {
    recorder.addEventListener(RecorderEvents.Stopped, function (ev) {
      recorderRegistry.stopCompleted = true;
      recorderRegistry.stopRequested = false;
      var operationId = pendingStopOperationId || recorderRegistry.lastOperationId;
      log("RecorderEvents.Stopped operationId=" + safeToString(operationId));
      if (operationId) {
        operationResults[operationId] = {
          ok: true,
          action: "stop_recording",
          operationId: operationId,
          state: STATE_STOP_COMPLETED,
          errorCode: null,
        };
      }
      sendTerminalEvidence(operationId, ev);
    });
  } catch (e2) {
    log("attach Stopped failed: " + safeToString(e2));
  }
}

function sendTerminalEvidence(operationId, ev) {
  // Provider-terminal evidence via signed async callback (CALLBACK_SECRET).
  // Never include control URLs, secrets, participant info, or full provider request data.
  try {
    if (ev && ev.url) {
      log("RecorderEvents.Stopped has recording URL present=true");
    }
  } catch (e) {
    // ignore
  }
  sendSignedPocCallback(
    "recording_stopped",
    "stop_recording",
    operationId,
    STATE_STOP_COMPLETED,
    null,
  );

  // Optional: reuse production webhook shape when configured — disabled by default.
  if (
    WEBHOOK_BASE_URL &&
    isSecretConfigured(WEBHOOK_SECRET, "__PASTE_VOXIMPLANT_RECORDING_WEBHOOK_SECRET_HERE__") &&
    typeof Net !== "undefined" &&
    Net.httpRequest
  ) {
    log("production webhook reuse skipped in POC unless manually enabled in paste notes");
  }
}

function handleStopRecording(operationId) {
  if (operationResults[operationId]) {
    var prior = operationResults[operationId];
    return {
      ok: prior.ok,
      action: "stop_recording",
      operationId: operationId,
      state: prior.state,
      errorCode: prior.errorCode,
    };
  }

  if (recorderRegistry.stopCompleted) {
    var already = {
      ok: true,
      action: "stop_recording",
      operationId: operationId,
      state: "already_stopped",
      errorCode: "already_stopped",
    };
    operationResults[operationId] = already;
    return already;
  }

  if (recorderRegistry.stopRequested) {
    return {
      ok: true,
      action: "stop_recording",
      operationId: recorderRegistry.lastOperationId || operationId,
      state: STATE_STOP_REQUESTED,
      errorCode: null,
    };
  }

  if (!recorder || !recorderRegistry.recordingStarted) {
    // Attempt to start a demo recorder only when conference media exists.
    // Still fail closed if nothing to stop.
    return {
      ok: false,
      action: "stop_recording",
      operationId: operationId,
      state: registryState(),
      errorCode: "recording_not_active",
    };
  }

  try {
    pendingStopOperationId = operationId;
    recorderRegistry.lastOperationId = operationId;
    recorderRegistry.stopRequested = true;
    recorder.stop();
    var accepted = {
      ok: true,
      action: "stop_recording",
      operationId: operationId,
      state: STATE_STOP_REQUESTED,
      errorCode: null,
    };
    operationResults[operationId] = accepted;
    log("recorder.stop() invoked operationId=" + operationId);
    return accepted;
  } catch (e) {
    return {
      ok: false,
      action: "stop_recording",
      operationId: operationId,
      state: registryState(),
      errorCode: "stop_exception",
    };
  }
}

function handleHttpRequest(e) {
  var bodyText = "";
  try {
    if (e && e.text !== undefined && e.text !== null) bodyText = String(e.text);
    else if (e && e.content !== undefined && e.content !== null) bodyText = String(e.content);
  } catch (err) {
    bodyText = "";
  }

  var verified = verifyControlRequest(e, bodyText);
  if (!verified.ok) {
    log("HttpRequest rejected errorCode=" + verified.errorCode);
    respondHttp(
      e,
      401,
      buildTransportAckBody(false, verified.action || null, verified.operationId || null, registryState(), verified.errorCode),
    );
    // Authenticated parse failed — still emit rejected callback when we have enough fields.
    if (verified.operationId) {
      sendSignedPocCallback(
        "command_rejected",
        verified.action || null,
        verified.operationId,
        registryState(),
        verified.errorCode,
      );
    }
    return;
  }

  log("HttpRequest accepted action=" + verified.action + " operationId=" + verified.operationId);

  // Transport ack first (body may be dropped by platform). Identity/command
  // confirmation is the signed async callback below.
  if (verified.action === "ping") {
    respondHttp(
      e,
      200,
      buildTransportAckBody(true, "ping", verified.operationId, registryState(), null),
    );
    sendSignedPocCallback("command_accepted", "ping", verified.operationId, registryState(), null);
    return;
  }

  if (verified.action === "get_recording_state") {
    respondHttp(
      e,
      200,
      buildTransportAckBody(true, "get_recording_state", verified.operationId, registryState(), null),
    );
    sendSignedPocCallback(
      "command_accepted",
      "get_recording_state",
      verified.operationId,
      registryState(),
      null,
    );
    return;
  }

  if (verified.action === "stop_recording") {
    var stopResult = handleStopRecording(verified.operationId);
    respondHttp(
      e,
      stopResult.ok ? 200 : 409,
      buildTransportAckBody(
        stopResult.ok,
        stopResult.action,
        stopResult.operationId,
        stopResult.state,
        stopResult.errorCode,
      ),
    );
    if (stopResult.ok) {
      sendSignedPocCallback(
        "command_accepted",
        "stop_recording",
        stopResult.operationId,
        stopResult.state,
        stopResult.errorCode,
      );
    } else {
      sendSignedPocCallback(
        "command_rejected",
        "stop_recording",
        stopResult.operationId,
        stopResult.state,
        stopResult.errorCode,
      );
    }
    return;
  }

  respondHttp(
    e,
    400,
    buildTransportAckBody(false, verified.action, verified.operationId, registryState(), "unknown_action"),
  );
  sendSignedPocCallback(
    "command_rejected",
    verified.action,
    verified.operationId,
    registryState(),
    "unknown_action",
  );
}

function handleIncomingCall(event) {
  var call = event.call;
  var callId = "unknown";
  try {
    callId = call.id();
  } catch (e) {
    callId = "unknown";
  }
  log("incoming call callId=" + callId);
  try {
    call.answer();
  } catch (e2) {
    log("answer failed");
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
  } catch (e3) {
    log("conference.add failed: " + safeToString(e3));
  }

  // Browser-originated recording_control via CallEvents.MessageReceived.
  try {
    call.addEventListener(CallEvents.MessageReceived, function (msgEvent) {
      handleRecordingControlMessage(msgEvent);
    });
    log("CallEvents.MessageReceived handler registered callId=" + callId);
  } catch (e4) {
    log("MessageReceived listener failed: " + safeToString(e4));
  }
}

function onAppStarted(e) {
  expectedConferenceName = parseCustomDataConferenceName();
  // Never log raw Application.Started — it contains accessURL / accessSecureURL.
  log(
    "scenario build=" + SCENARIO_BUILD_ID +
      " source=" + SCENARIO_SOURCE_NAME +
      " conferenceName=" + safeToString(expectedConferenceName) +
      " controlSecretConfigured=" +
      isSecretConfigured(CONTROL_SECRET, "__PASTE_VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET_HERE__") +
      " callbackSecretConfigured=" +
      isSecretConfigured(CALLBACK_SECRET, "__PASTE_VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET_HERE__") +
      " callbackUrlConfigured=" +
      Boolean(POC_CALLBACK_URL) +
      " callbackSecretSha256Prefix=" +
      (isSecretConfigured(CALLBACK_SECRET, "__PASTE_VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET_HERE__")
        ? sha256Hex(CALLBACK_SECRET).slice(0, 12)
        : "none"),
  );

  try {
    conference = VoxEngine.createConference({ hd_audio: true });
    log("createConference ok");
  } catch (err) {
    log("createConference failed: " + safeToString(err));
  }

  try {
    VoxEngine.addEventListener(AppEvents.HttpRequest, handleHttpRequest);
    log("AppEvents.HttpRequest handler registered");
  } catch (err2) {
    log("HttpRequest listener failed: " + safeToString(err2));
  }
}

VoxEngine.addEventListener(AppEvents.Started, onAppStarted);
VoxEngine.addEventListener(AppEvents.CallAlerting, handleIncomingCall);
