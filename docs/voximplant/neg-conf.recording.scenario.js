/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

// ============================================================
// RECORDING SCENARIO — EXPERIMENTAL, NOT THE BASELINE
// ============================================================
//
// THIS FILE IS ONLY FOR RECORDING TESTS.
// Paste this into Voximplant Console ONLY when:
//   VOXIMPLANT_RECORDING_PANEL_ENABLED=true
//   VOXIMPLANT_RECORDING_ENABLED=true
//
// To revert to the stable video-only baseline:
//   Paste docs/voximplant/neg-conf.video-only.baseline.js instead.
//
// Safe ConferenceEvents used in this file (VoxEngine 7.50.0):
//   ConferenceEvents.Started  ✓
//   ConferenceEvents.Stopped  ✓
//
// DO NOT add ConferenceEvents.Failed — it is undefined in 7.50.0 and will
// crash the scenario with "conferenceEvent is undefined", causing 502.
//
// Recording API notes:
//   conference.record(options) — the Conference module's built-in recording method.
//   TODO: Confirm this API exists in your VoxEngine version before enabling autostart.
//   If it throws, the catch block logs the error and the conference continues.
//
// CallEvents.MessageReceived notes:
//   Added per-call for facilitator recording control commands.
//   Guarded with try/catch. If undefined or unsupported, video continues.
//   Accepted message format: { "type": "recording_control", "action": "start"|"stop"|"status" }
//   Unknown messages are silently ignored.
//
// RecorderEvents notes:
//   RecorderEvents.Started — logs the recording URL (used for storage verification).
//   RecorderEvents.Stopped — logs that recording has ended.
//   RecorderEvents.Error   — uncertain; guarded separately with try/catch.
//   TODO: Verify RecorderEvents.Error exists in your VoxEngine version.
//
// Storage:
//   Recording destination is configured in Voximplant Console
//   (Application → Recording storage → S3-compatible or Voximplant cloud).
//   This scenario does not configure storage itself.
//   After recording stops, check Yandex Object Storage bucket or Voximplant
//   Call History → Recordings for the file.
//
// Recording autostart:
//   Set RECORDING_AUTOSTART = true below to start recording automatically when
//   RECORDING_MIN_PARTICIPANTS_FOR_AUTOSTART or more participants are active.
//   Default: false (manual facilitator-controlled start via recording panel).

require(Modules.Conference);

// ── Recording configuration ───────────────────────────────────────────────────
// Set to true to start recording automatically when enough participants join.
// Default is false: manual facilitator control via the recording panel.
var RECORDING_AUTOSTART = false;
var RECORDING_MIN_PARTICIPANTS_FOR_AUTOSTART = 2;

// ── State ─────────────────────────────────────────────────────────────────────
var conference = null;
var participants = 0;
var recorder = null;
var recordingActive = false;
var recordingUrl = null;
var scenarioStartedAt = Date.now();
var activeCallIds = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeValue(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function getCallId(call) {
  try {
    return call.id();
  } catch (e) {
    return "unknown-call-id";
  }
}

function safeEndpointId(endpoint) {
  if (!endpoint) return "unknown-endpoint";
  try {
    return String(endpoint.id());
  } catch (e) {
    return "endpoint-id-unavailable";
  }
}

function logWithContext(message) {
  Logger.write(
    "[neg-conf-rec] uptime_ms=" + (Date.now() - scenarioStartedAt) +
    " participants=" + participants +
    " recording=" + (recordingActive ? "active" : "inactive") +
    " " + message,
  );
}

// ── Recording helpers ─────────────────────────────────────────────────────────

function startRecording() {
  if (recordingActive) {
    logWithContext("Recording already active — skipping duplicate start.");
    return;
  }
  if (!conference) {
    logWithContext("Cannot start recording: conference not initialized.");
    return;
  }

  // TODO: Confirm conference.record(options) exists in your VoxEngine version
  //       before relying on it. If it does not exist, VoxEngine will throw a
  //       TypeError caught below. The conference will NOT be affected.
  try {
    var recOptions = {
      hd_audio: true,
      video: true,
      // singleFile: true means all participants are mixed into one file.
      // TODO: Confirm singleFile is supported in your VoxEngine version.
      singleFile: true,
    };

    recorder = conference.record(recOptions);

    if (!recorder) {
      logWithContext("WARNING: conference.record() returned null/undefined. " +
        "Recording is not supported by this VoxEngine version or the API has changed. " +
        "Video conference continues unaffected.");
      return;
    }

    // RecorderEvents.Started — fired when recording file is open and capture begins.
    // The event object contains e.url with the recording file path/URL.
    recorder.addEventListener(RecorderEvents.Started, function (e) {
      recordingActive = true;
      recordingUrl = (e && e.url) ? e.url : null;
      logWithContext("Recording started. url=" + (recordingUrl || "not-provided-by-event"));
    });

    // RecorderEvents.Stopped — fired when recording is cleanly stopped.
    recorder.addEventListener(RecorderEvents.Stopped, function () {
      recordingActive = false;
      logWithContext("Recording stopped. url=" + (recordingUrl || "see-call-history"));
      recorder = null;
    });

    // RecorderEvents.Error — uncertain whether this event exists.
    // Wrapped in a nested try/catch so that a missing RecorderEvents.Error constant
    // does not abort the recorder setup or the conference.
    // TODO: Verify RecorderEvents.Error exists in VoxEngine 7.50.0.
    try {
      if (typeof RecorderEvents !== "undefined" && RecorderEvents.Error !== undefined) {
        recorder.addEventListener(RecorderEvents.Error, function (e) {
          recordingActive = false;
          logWithContext("Recording error (video conference unaffected). error=" +
            safeValue(e && e.error, "unknown-recorder-error"));
          recorder = null;
        });
      } else {
        logWithContext("RecorderEvents.Error is not defined — skipping error listener. " +
          "Check VoxEngine logs manually for recording errors.");
      }
    } catch (recErrListenerError) {
      logWithContext("Could not register RecorderEvents.Error listener: " +
        safeValue(recErrListenerError && recErrListenerError.message, String(recErrListenerError)));
    }

    logWithContext("Recording start requested. Waiting for RecorderEvents.Started.");
  } catch (recStartError) {
    // Recording failed — log and continue. The video conference is unaffected.
    logWithContext("Recording start failed (video conference is unaffected). error=" +
      safeValue(recStartError && recStartError.message, String(recStartError)));
    recorder = null;
  }
}

function stopRecording() {
  if (!recordingActive) {
    logWithContext("Recording is not active — nothing to stop.");
    return;
  }
  if (!recorder) {
    logWithContext("Recorder object is null — recording may have already stopped.");
    recordingActive = false;
    return;
  }

  // TODO: Confirm recorder.stop() is the correct method name.
  // Alternative: recorder.stopRecord() depending on VoxEngine version.
  try {
    recorder.stop();
    logWithContext("Recording stop requested.");
  } catch (recStopError) {
    // Stopping failed — log and continue. The conference is unaffected.
    logWithContext("Recording stop failed (conference unaffected). error=" +
      safeValue(recStopError && recStopError.message, String(recStopError)));
    // Reset state so that a new recording attempt can be made
    recordingActive = false;
    recorder = null;
  }
}

function handleRecordingControlMessage(action, fromCallId) {
  logWithContext("Recording control command received. action=" + action + " from=" + fromCallId);
  if (action === "start") {
    startRecording();
  } else if (action === "stop") {
    stopRecording();
  } else if (action === "status") {
    logWithContext("Recording status query. active=" + recordingActive +
      " url=" + (recordingUrl || "none"));
  } else {
    logWithContext("Unknown recording action ignored. action=" + action);
  }
}

// ── Scenario start ────────────────────────────────────────────────────────────

VoxEngine.addEventListener(AppEvents.Started, function () {
  logWithContext("Recording scenario started.");

  conference = VoxEngine.createConference({ hd_audio: true });

  conference.addEventListener(ConferenceEvents.Started, function () {
    logWithContext("Conference started.");
  });

  conference.addEventListener(ConferenceEvents.Stopped, function () {
    // Do not terminate the scenario on a transient stop — other participants
    // may still reconnect. Video conference continues.
    logWithContext("Conference stopped.");
  });

  // ConferenceEvents.Failed does NOT exist in VoxEngine 7.50.0.
  // DO NOT add it — doing so will crash the scenario and cause 502.
});

// ── Call alerting ─────────────────────────────────────────────────────────────

VoxEngine.addEventListener(AppEvents.CallAlerting, function (event) {
  var call = event.call;
  var callId = getCallId(call);
  var destination = safeValue(event && event.destination, "unknown");
  var scheme = safeValue(event && event.scheme, "unknown");

  logWithContext(
    "Incoming call. callId=" + callId +
    " destination=" + destination +
    " scheme=" + scheme,
  );

  call.answer();

  if (!activeCallIds[callId]) {
    activeCallIds[callId] = true;
    participants += 1;
  }

  // ── Add call to conference ─────────────────────────────────────────────────
  // conference.add() must succeed before any recording is started.
  // Do NOT start recording before this point.
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
    logWithContext(
      "Failed to add call to conference. callId=" + callId +
      " error=" + safeValue(addError && addError.message, String(addError)),
    );
    if (activeCallIds[callId]) {
      delete activeCallIds[callId];
      participants = Math.max(0, participants - 1);
    }
    try {
      call.hangup();
    } catch (hangupError) {
      logWithContext("Failed to hangup call after add error. callId=" + callId);
    }
    return;
  }

  // ── Autostart recording after enough participants join ─────────────────────
  // Only fires if RECORDING_AUTOSTART is true and recording has not started yet.
  if (RECORDING_AUTOSTART && !recordingActive && participants >= RECORDING_MIN_PARTICIPANTS_FOR_AUTOSTART) {
    logWithContext("Autostart threshold reached. participants=" + participants + " — starting recording.");
    startRecording();
  }

  // ── CallEvents.MessageReceived — facilitator recording control ─────────────
  // This handler accepts safe JSON recording control commands from the
  // facilitator's browser session.
  //
  // TODO: Verify CallEvents.MessageReceived does not break the conference flow in
  //       your VoxEngine version. If problems arise, remove this block. The video
  //       conference will continue without recording control messages.
  //
  // Accepted format: { "type": "recording_control", "action": "start"|"stop"|"status" }
  // All other messages are silently ignored.
  // Secrets and credentials must NEVER be sent via this channel.
  try {
    if (typeof CallEvents !== "undefined" && CallEvents.MessageReceived !== undefined) {
      call.addEventListener(CallEvents.MessageReceived, function (msgEvent) {
        try {
          var msgText = (msgEvent && msgEvent.text) ? String(msgEvent.text) : "";
          if (!msgText) return;

          var parsed = JSON.parse(msgText);
          if (parsed && parsed.type === "recording_control") {
            var action = String(parsed.action || "");
            if (action === "start" || action === "stop" || action === "status") {
              handleRecordingControlMessage(action, callId);
            } else {
              logWithContext("Ignored unknown recording_control action=" + action);
            }
          }
          // Messages with unknown type are silently ignored
        } catch (parseError) {
          // Non-JSON messages or parse errors are not recording commands — ignore silently
        }
      });
    } else {
      logWithContext("CallEvents.MessageReceived is not defined — " +
        "facilitator recording control via messages is unavailable. " +
        "Use autostart or manual recording.");
    }
  } catch (msgListenerError) {
    // Could not register message listener — video conference continues unaffected
    logWithContext("Could not register CallEvents.MessageReceived: " +
      safeValue(msgListenerError && msgListenerError.message, String(msgListenerError)));
  }

  // ── Disconnected ──────────────────────────────────────────────────────────
  call.addEventListener(CallEvents.Disconnected, function (disconnectEvent) {
    logWithContext(
      "Call disconnected. code=" +
        safeValue(disconnectEvent && disconnectEvent.code, "unknown") +
        " reason=" +
        safeValue(disconnectEvent && disconnectEvent.reason, "unknown") +
        " callId=" + callId,
    );

    if (activeCallIds[callId]) {
      delete activeCallIds[callId];
      participants = Math.max(0, participants - 1);
    }

    logWithContext("Participant disconnected. callId=" + callId + " remaining=" + participants);

    // Do NOT stop recording when a participant disconnects — other participants
    // may still be in the conference. Recording continues until explicitly stopped
    // or the conference ends.
  });

  call.addEventListener(CallEvents.Failed, function (failedEvent) {
    logWithContext(
      "Call failed. code=" +
        safeValue(failedEvent && failedEvent.code, "unknown") +
        " reason=" +
        safeValue(failedEvent && failedEvent.reason, "unknown") +
        " callId=" + callId,
    );
  });
});
