/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

// ============================================================
// NEGOTIATION ROOM SCENARIO (STAGE 3 ARTIFACT, NOT ACTIVE APP RUNTIME)
// ============================================================
//
// This file is a production-oriented VoxEngine scenario artifact for later
// manual paste into Voximplant Console. It does NOT change app runtime behavior.
//
// Goals:
// - keep conference stable even if recording fails;
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
    sendStatus(lastControllerCall, commandRequestId || lastRequestId, STATE_RECORDING, "Recording is active.", null);
  }, "RecorderEvents.Started");

  addSafeEventListener(recorder, "RecorderEvents", "Stopped", function (e) {
    stoppingWatchdogId = clearWatchdog(stoppingWatchdogId);
    recordingState = STATE_STOPPED;
    recordingUrl = (e && e.url) ? String(e.url) : recordingUrl;
    recordingId = (e && e.id) ? String(e.id) : recordingId;
    objectKey = objectKey || normalizeObjectKeyFromUrl(recordingUrl);
    sendStatus(lastControllerCall, commandRequestId || lastRequestId, STATE_STOPPED, "Recording stopped.", null);
    recorder = null;
  }, "RecorderEvents.Stopped");

  addSafeEventListener(recorder, "RecorderEvents", "Error", function (e) {
    clearAllWatchdogs();
    setErrorState("RECORDER_EVENT_ERROR", "Recorder error event.");
    sendStatus(lastControllerCall, commandRequestId || lastRequestId, STATE_ERROR, lastErrorMessage, lastErrorCode);
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
  log("scenario started");
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
