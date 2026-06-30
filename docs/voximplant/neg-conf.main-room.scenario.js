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

// ── Webhook configuration (Stage 5.4) ──────────────────────────────────────
//
// Set WEBHOOK_BASE_URL to the public Next.js application URL.
// Set WEBHOOK_SECRET to the value of VOXIMPLANT_RECORDING_WEBHOOK_SECRET env var
// (also accepted as VOXIMPLANT_RECORDING_WEBHOOK_SECRET in process.env below).
// Both must be set as VoxEngine application environment variables in the Voximplant console.
//
// If WEBHOOK_BASE_URL or WEBHOOK_SECRET are empty, webhook calls are skipped silently.
// The conference and recording remain stable — only server-side status tracking is lost.

var WEBHOOK_BASE_URL = VoxEngine.customData() ? "" : ""; // set via VoxEngine env: process.env.WEBHOOK_BASE_URL
var WEBHOOK_SECRET   = "";                               // set via VoxEngine env: process.env.WEBHOOK_SECRET

// Attempt to read from VoxEngine environment variables if available.
// VoxEngine scenario environment variables are exposed via VoxEngine.customData() as JSON
// or via global `process.env` depending on the Voximplant SDK version and configuration.
// Replace this block with the appropriate VoxEngine env access for your deployment.
try {
  if (typeof process !== "undefined" && process.env) {
    if (process.env.WEBHOOK_BASE_URL) WEBHOOK_BASE_URL = String(process.env.WEBHOOK_BASE_URL).trim();
    if (process.env.WEBHOOK_SECRET) WEBHOOK_SECRET = String(process.env.WEBHOOK_SECRET).trim();
    if (process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET) {
      WEBHOOK_SECRET = String(process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET).trim();
    }
  }
} catch (envReadErr) {
  Logger.write("[neg-conf-prod] env read failed: " + safeToString(envReadErr));
}

// Canonical conference name prefix — must match lib/voximplant/conference-name.ts.
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

/**
 * Compute HMAC-SHA256 hex digest of the payload string using the webhook secret.
 * VoxEngine provides the 'crypto' global in some environments. If unavailable,
 * returns null and the webhook is skipped.
 */
function computeHmacSha256Hex(payload, secret) {
  try {
    if (typeof crypto === "undefined" || !crypto.createHmac) return null;
    var hmac = crypto.createHmac("sha256", secret);
    hmac.update(payload);
    return hmac.digest("hex");
  } catch (e) {
    log("HMAC computation failed: " + safeToString(e));
    return null;
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
 * Send a recording status webhook to the server.
 * Non-blocking: errors are logged but do not affect the conference or recording.
 *
 * @param {string} sessionId - The application session ID
 * @param {object} statusPayload - The recording_status message payload
 * @param {object} [extraFields] - Optional extra fields: startedAt, stoppedAt
 */
function sendRecordingWebhook(sessionId, statusPayload, extraFields) {
  if (!WEBHOOK_BASE_URL || !WEBHOOK_SECRET) {
    log("webhook skipped: WEBHOOK_BASE_URL or WEBHOOK_SECRET not configured");
    return;
  }
  if (!sessionId) {
    log("webhook skipped: sessionId could not be resolved from recording_control message");
    return;
  }

  var url = WEBHOOK_BASE_URL.replace(/\/$/, "") + "/api/sessions/" + encodeURIComponent(sessionId) + "/voximplant/recording-status";

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

  try {
    Net.httpRequestAsync(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Voximplant-Signature": "hmac-sha256=" + hmacHex,
      },
      postData: body,
    }, function (result) {
      if (result && result.code >= 200 && result.code < 300) {
        log("webhook sent status=" + webhookPayload.status + " http=" + result.code);
      } else {
        log("webhook non-2xx status=" + webhookPayload.status + " http=" + safeToString(result && result.code));
      }
    });
  } catch (httpErr) {
    log("webhook send failed: " + safeToString(httpErr));
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

function parseControlPayload(msgText) {
  try {
    var parsed = JSON.parse(msgText);
    if (!parsed || parsed.type !== "recording_control") {
      return null;
    }
    var action = parsed.action ? String(parsed.action) : "";
    var requestId = parsed.requestId ? String(parsed.requestId) : "";
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
      sessionId: parsed.sessionId ? String(parsed.sessionId) : undefined,
      conferenceName: parsed.conferenceName ? String(parsed.conferenceName) : undefined,
      participantId: parsed.participantId ? String(parsed.participantId) : undefined,
      role: parsed.role ? String(parsed.role) : undefined,
    };
  } catch (e) {
    return null;
  }
}

function attachRecorderEventHandlers(commandRequestId) {
  addSafeEventListener(recorder, "RecorderEvents", "Started", function (e) {
    startingWatchdogId = clearWatchdog(startingWatchdogId);
    if (recordingState !== STATE_STARTING) {
      return;
    }
    recordingState = STATE_RECORDING;
    recordingUrl = (e && e.url) ? String(e.url) : recordingUrl;
    recordingId = (e && e.id) ? String(e.id) : recordingId;
    objectKey = normalizeObjectKeyFromUrl(recordingUrl);
    var statusPayload = buildStatusPayload(commandRequestId || lastRequestId, STATE_RECORDING, "Recording is active.", null);
    sendStatus(lastControllerCall, commandRequestId || lastRequestId, STATE_RECORDING, "Recording is active.", null);
    // Stage 5.4: notify server via webhook.
    sendRecordingWebhook(resolvedSessionId, statusPayload, { startedAt: safeNowIso() });
  }, "RecorderEvents.Started");

  addSafeEventListener(recorder, "RecorderEvents", "Stopped", function (e) {
    stoppingWatchdogId = clearWatchdog(stoppingWatchdogId);
    recordingState = STATE_STOPPED;
    recordingUrl = (e && e.url) ? String(e.url) : recordingUrl;
    recordingId = (e && e.id) ? String(e.id) : recordingId;
    objectKey = objectKey || normalizeObjectKeyFromUrl(recordingUrl);
    var statusPayload = buildStatusPayload(commandRequestId || lastRequestId, STATE_STOPPED, "Recording stopped.", null);
    sendStatus(lastControllerCall, commandRequestId || lastRequestId, STATE_STOPPED, "Recording stopped.", null);
    recorder = null;
    // Stage 5.4: notify server via webhook — include objectKey so server can set fileKey.
    sendRecordingWebhook(resolvedSessionId, statusPayload, { stoppedAt: safeNowIso() });
  }, "RecorderEvents.Stopped");

  addSafeEventListener(recorder, "RecorderEvents", "Error", function (e) {
    clearAllWatchdogs();
    setErrorState("RECORDER_EVENT_ERROR", "Recorder error event.");
    var statusPayload = buildStatusPayload(commandRequestId || lastRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    sendStatus(lastControllerCall, commandRequestId || lastRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
    recorder = null;
    // Stage 5.4: notify server about recording error.
    sendRecordingWebhook(resolvedSessionId, statusPayload, null);
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
  // Stage 5.4: notify server that recording is starting.
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
  // Stage 5.4: notify server that recording is stopping.
  sendRecordingWebhook(resolvedSessionId, buildStatusPayload(requestId, STATE_STOPPING, "Recording stop requested.", null), null);

  try {
    if (typeof recorder.stop === "function") {
      recorder.stop();
    } else if (typeof recorder.stopRecord === "function") {
      recorder.stopRecord();
    } else {
      setErrorState("RECORDER_STOP_UNAVAILABLE", "Recorder stop method unavailable.");
      sendStatus(call, requestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
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
      " auth=" + auth.reason,
  );

  if (payload.action === ACTION_START) {
    startRecording(call, payload.requestId);
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
  if (payload.action === ACTION_STOP) {
    stopRecording(call, payload.requestId);
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
    var msgText = msgEvent && msgEvent.text ? String(msgEvent.text) : "";
    if (!msgText) return;
    var payload = parseControlPayload(msgText);
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
  log("scenario started — sessionId is resolved from recording_control messages, not applicationName");
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
