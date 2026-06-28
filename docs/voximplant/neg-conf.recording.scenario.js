/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

// ============================================================
// RECORDING SCENARIO — EXPERIMENTAL, NOT THE BASELINE
// ============================================================
//
// THIS FILE IS ONLY FOR RECORDING TESTS.
// Paste into Voximplant Console ONLY when:
//   VOXIMPLANT_RECORDING_PANEL_ENABLED=true
//   VOXIMPLANT_RECORDING_ENABLED=true
//
// To revert to the stable video-only baseline after testing:
//   Paste docs/voximplant/neg-conf.video-only.baseline.js instead.
//
// ── VoxEngine safety rules ────────────────────────────────────────────────────
//
//  ✓ ConferenceEvents.Started    — safe in VoxEngine 7.50.0
//  ✓ ConferenceEvents.Stopped    — safe in VoxEngine 7.50.0
//  ✗ ConferenceEvents.Failed     — UNDEFINED in 7.50.0; NEVER add this
//
//  ✓ CallEvents.Disconnected     — confirmed safe
//  ✓ CallEvents.Failed           — confirmed safe
//  ✓ CallEvents.MessageReceived  — confirmed safe; wrapped in try/catch here
//
//  ✓ RecorderEvents.Started      — expected; wrapped in addSafeEventListener
//  ? RecorderEvents.Stopped      — expected; wrapped in addSafeEventListener
//  ? RecorderEvents.Error        — uncertain; wrapped in addSafeEventListener
//
//  ✓ call.sendMessage(text)      — confirmed; used to reply to browser
//
// ── Recording flow ────────────────────────────────────────────────────────────
//
// 1. Browser sends:  { type:"recording_control", action:"start"|"stop"|"status", requestId:"..." }
// 2. Scenario validates → calls startRecording / stopRecording / getRecordingStatus.
// 3. Scenario immediately replies with:
//    { type:"recording_status", requestId:"...", status:"starting"|..., message:"..." }
// 4. startRecording: calls VoxEngine.createRecorder({video:false, lossless|hd_audio}),
//    then conference.sendMediaTo(recorder) — audio-only, no video track.
// 5. When RecorderEvents.Started fires, scenario replies with:
//    { type:"recording_status", status:"recording", recordingUrl:"..." }
// 6. When RecorderEvents.Stopped fires, scenario replies with:
//    { type:"recording_status", status:"stopped" }
// 7. If VoxEngine.createRecorder or conference.sendMediaTo is absent or throws,
//    scenario replies with status:"error"; the video conference is NOT affected.
//
// ── recording state machine ───────────────────────────────────────────────────
//
//  idle → starting → recording → stopping → stopped
//       ↘ failed (on any uncaught recording error)
//
// ── Sender identity check ─────────────────────────────────────────────────────
// VoxEngine 7.x does not expose per-call user identity in a reliable way.
// Recording commands are accepted from any connected call in this PoC.
// TODO: add identity check before moving to production.

// ── Recording audio mode ──────────────────────────────────────────────────────
//
// Toggle this to switch the audio quality mode for recording.
//
//   "lossless" — VoxEngine saves a FLAC file.
//               Preferred for external ASR / SpeechKit transcription testing.
//               Sets: { video: false, lossless: true }
//
//   "hd_mp3"   — VoxEngine saves an MP3 file at high bitrate.
//               Alternative mode when FLAC is not supported or too large.
//               Sets: { video: false, hd_audio: true }
//
// IMPORTANT: lossless and hd_audio are mutually exclusive.
//            Do NOT set both to true — behaviour is undefined.
//
var RECORDING_AUDIO_MODE = "lossless"; // "lossless" | "hd_mp3"

require(Modules.Conference);

// Attempt to load the Recorder module so RecorderEvents becomes available.
// Wrapped in try/catch: if Modules.Recorder is absent, the conference still works.
try {
  if (typeof Modules !== "undefined" && Modules.Recorder !== undefined) {
    require(Modules.Recorder);
  } else {
    Logger.write("[neg-conf-rec] Modules.Recorder is undefined — RecorderEvents will be unavailable.");
  }
} catch (recModErr) {
  Logger.write("[neg-conf-rec] Failed to require Modules.Recorder: " +
    ((recModErr && recModErr.message) ? recModErr.message : String(recModErr)));
}

// Check RecorderEvents availability once, using typeof to avoid ReferenceError.
// Direct access to an undeclared global throws ReferenceError in strict VoxEngine contexts.
var hasRecorderEvents = false;
try {
  hasRecorderEvents = (typeof RecorderEvents !== "undefined") && RecorderEvents !== null;
} catch (e) {
  hasRecorderEvents = false;
}

// ── State ─────────────────────────────────────────────────────────────────────
var conference = null;
var participants = 0;
var recorder = null;
var recordingState = "idle"; // idle | starting | recording | stopping | stopped | failed
var recordingUrl = null;
var lastCommandCall = null; // Call object that sent the most recent control command
var scenarioStartedAt = Date.now();
var activeCallIds = {};
// Watchdog timer IDs — cleared when the expected RecorderEvent fires
var startingWatchdogId = null;
var stoppingWatchdogId = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeValue(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function getCallId(call) {
  try { return call.id(); } catch (e) { return "unknown-call-id"; }
}

function safeEndpointId(endpoint) {
  if (!endpoint) return "unknown-endpoint";
  try { return String(endpoint.id()); } catch (e) { return "endpoint-id-unavailable"; }
}

function logWithContext(message) {
  Logger.write(
    "[neg-conf-rec] uptime_ms=" + (Date.now() - scenarioStartedAt) +
    " participants=" + participants +
    " recState=" + recordingState +
    " " + message,
  );
}

// Guard helper: only registers the listener if eventConstant is a real value.
// Prevents the "conferenceEvent is undefined" / "callEvent is undefined" crashes.
function addSafeEventListener(target, eventConstant, handler, label) {
  if (!target || !eventConstant) {
    logWithContext("addSafeEventListener: skip undefined event constant [" + (label || "?") + "]");
    return false;
  }
  try {
    target.addEventListener(eventConstant, handler);
    logWithContext("addSafeEventListener: registered [" + (label || "?") + "]");
    return true;
  } catch (e) {
    logWithContext("addSafeEventListener: failed to register [" + (label || "?") + "]: " +
      safeValue(e && e.message, String(e)));
    return false;
  }
}

// Safe accessor for RecorderEvents constants.
// Passing RecorderEvents.X directly would crash with ReferenceError if RecorderEvents
// is not defined. This helper resolves the constant from the namespace only if safe.
// Returns null if RecorderEvents is unavailable or the named property is absent.
function safeRecorderEvent(name) {
  if (!hasRecorderEvents) {
    logWithContext("safeRecorderEvent: RecorderEvents unavailable — skip [" + name + "]");
    return null;
  }
  try {
    var constant = RecorderEvents[name];
    if (constant === undefined || constant === null) {
      logWithContext("safeRecorderEvent: RecorderEvents." + name + " is undefined");
      return null;
    }
    return constant;
  } catch (e) {
    logWithContext("safeRecorderEvent: error reading RecorderEvents." + name + ": " +
      safeValue(e && e.message, String(e)));
    return null;
  }
}

// Send a JSON recording_status reply back to the browser over the given call.
function sendStatusReply(call, requestId, status, message, url, recId) {
  if (!call) {
    logWithContext("sendStatusReply: no call to reply to (status=" + status + ")");
    return;
  }
  try {
    var payload = {
      type: "recording_status",
      requestId: requestId || null,
      status: status,
      message: safeValue(message, ""),
      recordingUrl: url || null,
      recordingId: recId || null,
    };
    call.sendMessage(JSON.stringify(payload));
    logWithContext("Reply sent. status=" + status + " requestId=" + (requestId || "none"));
  } catch (replyErr) {
    logWithContext("sendStatusReply failed: " +
      safeValue(replyErr && replyErr.message, String(replyErr)));
  }
}

// ── Recording commands ────────────────────────────────────────────────────────

function startRecording(call, requestId) {
  if (recordingState === "recording" || recordingState === "starting") {
    sendStatusReply(call, requestId, recordingState,
      "Recording already in progress (state=" + recordingState + ").",
      recordingUrl, null);
    return;
  }
  if (!conference) {
    sendStatusReply(call, requestId, "error", "Conference not initialized.");
    return;
  }

  // Guard: VoxEngine.createRecorder must exist (requires Modules.Recorder)
  if (typeof VoxEngine.createRecorder !== "function") {
    sendStatusReply(call, requestId, "error",
      "VoxEngine.createRecorder() is not available in this VoxEngine version. " +
      "Recording API is unavailable. Video conference is unaffected.");
    logWithContext("VoxEngine.createRecorder not a function — recording unavailable.");
    return;
  }

  // Guard: conference.sendMediaTo must exist to pipe audio/video into the recorder
  if (typeof conference.sendMediaTo !== "function") {
    sendStatusReply(call, requestId, "error",
      "conference.sendMediaTo() is not available; conference recording API unavailable.");
    logWithContext("conference.sendMediaTo not a function — recording unavailable.");
    return;
  }

  recordingState = "starting";
  lastCommandCall = call;
  sendStatusReply(call, requestId, "starting", "Recording start requested.");

  try {
    // Build recorder options for audio-only recording.
    // lossless=true saves FLAC and is preferred for external ASR testing.
    // hd_audio=true is an alternative MP3 mode and must not be combined with lossless.
    var recorderOptions = {
      video: false,
      name: "negotaitions-audio-only",
      recordNamePrefix: "voximplant/audio/",
    };
    if (RECORDING_AUDIO_MODE === "lossless") {
      recorderOptions.lossless = true;
    } else {
      recorderOptions.hd_audio = true;
    }
    logWithContext("createRecorder options: mode=" + RECORDING_AUDIO_MODE +
      " video=false lossless=" + (RECORDING_AUDIO_MODE === "lossless") +
      " hd_audio=" + (RECORDING_AUDIO_MODE !== "lossless"));

    recorder = VoxEngine.createRecorder(recorderOptions);

    if (!recorder) {
      recordingState = "failed";
      sendStatusReply(call, requestId, "error",
        "VoxEngine.createRecorder() returned null/undefined. " +
        "Storage may not be configured in Voximplant Console.");
      logWithContext("VoxEngine.createRecorder() returned null");
      return;
    }

    logWithContext("VoxEngine.createRecorder() created recorder");

    // RecorderEvents.Started — fires when recording file is open
    addSafeEventListener(recorder, safeRecorderEvent("Started"), function (e) {
      if (startingWatchdogId !== null) {
        clearTimeout(startingWatchdogId);
        startingWatchdogId = null;
      }
      recordingState = "recording";
      recordingUrl = (e && e.url) ? e.url : null;
      logWithContext("Recording started. url=" + (recordingUrl || "not-provided"));
      sendStatusReply(lastCommandCall, requestId, "recording",
        "Recording is active.", recordingUrl, null);
    }, "RecorderEvents.Started");

    // RecorderEvents.Stopped — fires when recording finishes cleanly
    addSafeEventListener(recorder, safeRecorderEvent("Stopped"), function () {
      if (stoppingWatchdogId !== null) {
        clearTimeout(stoppingWatchdogId);
        stoppingWatchdogId = null;
      }
      recordingState = "stopped";
      logWithContext("Recording stopped. url=" + (recordingUrl || "see-call-history"));
      sendStatusReply(lastCommandCall, null, "stopped",
        "Recording stopped." + (recordingUrl ? " url=" + recordingUrl : " Check Call History."),
        recordingUrl, null);
      recorder = null;
    }, "RecorderEvents.Stopped");

    // RecorderEvents.Error — uncertain; guarded by safeRecorderEvent + addSafeEventListener
    addSafeEventListener(recorder, safeRecorderEvent("Error"), function (e) {
      if (startingWatchdogId !== null) { clearTimeout(startingWatchdogId); startingWatchdogId = null; }
      if (stoppingWatchdogId !== null) { clearTimeout(stoppingWatchdogId); stoppingWatchdogId = null; }
      recordingState = "failed";
      var errMsg = "Recording error: " + safeValue(e && e.error, "unknown");
      logWithContext(errMsg + " (conference unaffected)");
      sendStatusReply(lastCommandCall, null, "error", errMsg, null, null);
      recorder = null;
    }, "RecorderEvents.Error");

    // Pipe conference media into the recorder
    conference.sendMediaTo(recorder);
    logWithContext("VoxEngine.createRecorder() created recorder; conference.sendMediaTo(recorder) called.");

    // Watchdog: if RecorderEvents.Started doesn't fire within 10s, report error.
    // Guards against createRecorder failing silently (e.g. storage not configured).
    startingWatchdogId = setTimeout(function () {
      startingWatchdogId = null;
      if (recordingState === "starting") {
        recordingState = "failed";
        var wdMsg =
          "Recording start watchdog (10s): RecorderEvents.Started did not fire. " +
          "Possible causes: (1) storage not configured in Voximplant Console, " +
          "(2) VoxEngine.createRecorder() / conference.sendMediaTo() API unsupported, " +
          "(3) Recorder module not loaded. Check VoxEngine logs.";
        logWithContext(wdMsg);
        sendStatusReply(lastCommandCall, requestId, "error", wdMsg, null, null);
        recorder = null;
      }
    }, 10000);
  } catch (recErr) {
    recordingState = "failed";
    var errMsg = "startRecording exception: " +
      safeValue(recErr && recErr.message, String(recErr));
    logWithContext(errMsg + " (conference unaffected)");
    sendStatusReply(call, requestId, "error", errMsg, null, null);
    recorder = null;
  }
}

function stopRecording(call, requestId) {
  if (recordingState !== "recording" && recordingState !== "starting") {
    sendStatusReply(call, requestId, "not_recording",
      "Recording is not active (state=" + recordingState + ").");
    return;
  }
  if (!recorder) {
    // Recorder object is gone but state says recording — reset
    recordingState = "stopped";
    sendStatusReply(call, requestId, "stopped",
      "Recorder object is null. Recording may have already ended.");
    return;
  }

  recordingState = "stopping";
  lastCommandCall = call;
  // Cancel any pending starting watchdog before switching to stopping
  if (startingWatchdogId !== null) {
    clearTimeout(startingWatchdogId);
    startingWatchdogId = null;
  }
  sendStatusReply(call, requestId, "stopping", "Recording stop requested.");

  // Try recorder.stop() first; fall back to recorder.stopRecord() for older API
  try {
    if (typeof recorder.stop === "function") {
      recorder.stop();
    } else if (typeof recorder.stopRecord === "function") {
      recorder.stopRecord();
    } else {
      recordingState = "failed";
      sendStatusReply(call, requestId, "error",
        "Recorder stop method not found. Tried: stop(), stopRecord(). Check VoxEngine version.");
      return;
    }
    logWithContext("Recorder stop method called.");

    // Watchdog: if RecorderEvents.Stopped doesn't fire within 10s, report error.
    stoppingWatchdogId = setTimeout(function () {
      stoppingWatchdogId = null;
      if (recordingState === "stopping") {
        recordingState = "failed";
        var wdMsg =
          "Recording stop watchdog (10s): RecorderEvents.Stopped did not fire. " +
          "Recorder may be stuck. Check VoxEngine logs for recording errors.";
        logWithContext(wdMsg);
        sendStatusReply(lastCommandCall, requestId, "error", wdMsg, null, null);
        recorder = null;
      }
    }, 10000);
  } catch (stopErr) {
    recordingState = "failed";
    var errMsg = "stopRecording exception: " +
      safeValue(stopErr && stopErr.message, String(stopErr));
    logWithContext(errMsg + " (conference unaffected)");
    sendStatusReply(call, requestId, "error", errMsg, null, null);
    recorder = null;
  }
}

function getRecordingStatus(call, requestId) {
  sendStatusReply(call, requestId, recordingState,
    "Recording state: " + recordingState +
    (recordingUrl ? ". url=" + recordingUrl : ""),
    recordingUrl, null);
}

// ── Scenario start ────────────────────────────────────────────────────────────

VoxEngine.addEventListener(AppEvents.Started, function () {
  logWithContext("Recording scenario started.");

  conference = VoxEngine.createConference({ hd_audio: true });

  addSafeEventListener(conference, ConferenceEvents.Started, function () {
    logWithContext("Conference started.");
  }, "ConferenceEvents.Started");

  addSafeEventListener(conference, ConferenceEvents.Stopped, function () {
    logWithContext("Conference stopped.");
    // Do NOT stop recording here — participants may still reconnect.
  }, "ConferenceEvents.Stopped");

  // ConferenceEvents.Failed does NOT exist in VoxEngine 7.50.0.
  // Using addSafeEventListener would still attempt to register it if the constant
  // is undefined — so we explicitly never reference it.
  // DO NOT add ConferenceEvents.Failed here or anywhere in this file.
});

// ── Call alerting ─────────────────────────────────────────────────────────────

VoxEngine.addEventListener(AppEvents.CallAlerting, function (event) {
  var call = event.call;
  var callId = getCallId(call);
  var destination = safeValue(event && event.destination, "unknown");
  var scheme = safeValue(event && event.scheme, "unknown");

  logWithContext("Incoming call. callId=" + callId +
    " destination=" + destination + " scheme=" + scheme);

  call.answer();

  if (!activeCallIds[callId]) {
    activeCallIds[callId] = true;
    participants += 1;
  }

  // ── Add call to conference ─────────────────────────────────────────────────
  // Recording MUST NOT start before this succeeds.
  var endpoint = null;
  try {
    endpoint = conference.add({
      call: call,
      mode: "FORWARD",
      direction: "BOTH",
      scheme: event.scheme,
    });
    logWithContext("Participant joined. callId=" + callId +
      " endpointId=" + safeEndpointId(endpoint));
  } catch (addError) {
    logWithContext("Failed to add call to conference. callId=" + callId +
      " error=" + safeValue(addError && addError.message, String(addError)));
    if (activeCallIds[callId]) {
      delete activeCallIds[callId];
      participants = Math.max(0, participants - 1);
    }
    try { call.hangup(); } catch (he) {
      logWithContext("Failed to hangup call after add error. callId=" + callId);
    }
    return;
  }

  // ── CallEvents.MessageReceived — facilitator recording control ─────────────
  //
  // Accepted JSON format:
  //   { "type": "recording_control", "action": "start"|"stop"|"status", "requestId": "..." }
  //
  // NOTE: Identity of the sender is NOT verified in this PoC.
  //       Any connected call can send a recording command.
  //       TODO: add facilitator identity check before production use.
  //
  // CallEvents.MessageReceived is a confirmed VoxEngine event (documented in
  // Voximplant SDK reference). Wrapped in addSafeEventListener + inner try/catch.
  addSafeEventListener(call, CallEvents.MessageReceived, function (msgEvent) {
    try {
      var msgText = (msgEvent && msgEvent.text) ? String(msgEvent.text) : "";
      if (!msgText) return;

      var parsed = JSON.parse(msgText);
      if (!parsed || parsed.type !== "recording_control") return;

      var action = String(parsed.action || "");
      var requestId = String(parsed.requestId || "");

      logWithContext("recording_control received. action=" + action +
        " requestId=" + (requestId || "none") + " from=" + callId);

      if (action === "start") {
        startRecording(call, requestId);
      } else if (action === "stop") {
        stopRecording(call, requestId);
      } else if (action === "status") {
        getRecordingStatus(call, requestId);
      } else {
        logWithContext("Unknown recording action ignored: " + action);
      }
    } catch (parseErr) {
      // Non-JSON or unrecognized messages are silently ignored
    }
  }, "CallEvents.MessageReceived");

  // ── Disconnected ──────────────────────────────────────────────────────────
  addSafeEventListener(call, CallEvents.Disconnected, function (disconnectEvent) {
    logWithContext("Call disconnected. code=" +
      safeValue(disconnectEvent && disconnectEvent.code, "unknown") +
      " reason=" + safeValue(disconnectEvent && disconnectEvent.reason, "unknown") +
      " callId=" + callId);

    if (activeCallIds[callId]) {
      delete activeCallIds[callId];
      participants = Math.max(0, participants - 1);
    }
    logWithContext("Participant disconnected. callId=" + callId + " remaining=" + participants);

    // Do NOT stop recording when a participant disconnects.
    // The recording continues until explicitly stopped.
  }, "CallEvents.Disconnected");

  addSafeEventListener(call, CallEvents.Failed, function (failedEvent) {
    logWithContext("Call failed. code=" +
      safeValue(failedEvent && failedEvent.code, "unknown") +
      " reason=" + safeValue(failedEvent && failedEvent.reason, "unknown") +
      " callId=" + callId);
  }, "CallEvents.Failed");
});
