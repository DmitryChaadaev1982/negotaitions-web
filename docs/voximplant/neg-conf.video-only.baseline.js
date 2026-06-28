/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */

// ============================================================
// STABLE VIDEO-ONLY BASELINE — DO NOT MODIFY THIS FILE
// ============================================================
//
// This is the exact scenario that produces a working 3-user video conference.
// It was tagged as:   checkpoint/voximplant-video-only-stable
//
// To restore the baseline after a recording regression:
//   1. Open Voximplant Console → Applications → negotaitions-video-poc → Scenarios → neg-conf
//   2. Replace the ENTIRE content with this file.
//   3. Save.
//   4. Confirm routing rule negotaitions-conference-rule still points to neg-conf.
//
// To restore via git:
//   git show checkpoint/voximplant-video-only-stable:docs/voximplant/neg-conf.scenario.js
//
// Goal: minimal multi-party VIDEO-ONLY conference for Web SDK clients.
//
// Recording is intentionally absent from this file.
// Do not add recording, CallEvents.MessageReceived, or any experimental
// event listeners here.
//
// Safe ConferenceEvents for VoxEngine 7.50.0:
//   ConferenceEvents.Started  ✓
//   ConferenceEvents.Stopped  ✓
//
// DO NOT add:
//   ConferenceEvents.Failed  — undefined in 7.50.0, crashes scenario, causes 502
//   Any other ConferenceEvents.* not listed above

require(Modules.Conference);

let conference = null;
let participants = 0;
const scenarioStartedAt = Date.now();
const activeCallIds = {};

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
    "[neg-conf] uptime_ms=" + (Date.now() - scenarioStartedAt) + " participants=" + participants + " " + message,
  );
}

VoxEngine.addEventListener(AppEvents.Started, function () {
  logWithContext("Scenario started");

  conference = VoxEngine.createConference({ hd_audio: true });

  conference.addEventListener(ConferenceEvents.Started, function () {
    logWithContext("Conference started");
  });

  conference.addEventListener(ConferenceEvents.Stopped, function () {
    // Do not terminate the scenario: transient transport disconnects can happen
    // while other participants are still reconnecting.
    logWithContext("Conference stopped");
  });

  // ConferenceEvents.Failed does NOT exist in VoxEngine 7.50.0.
  // Registering an undefined event crashes the scenario with
  // "conferenceEvent is undefined" and causes WebSDK 502.
  // Do not add ConferenceEvents.Failed or any other unverified ConferenceEvents here.
});

VoxEngine.addEventListener(AppEvents.CallAlerting, function (event) {
  const call = event.call;
  const callId = getCallId(call);
  const destination = safeValue(event && event.destination, "unknown");
  const scheme = safeValue(event && event.scheme, "unknown");

  logWithContext(
    "Incoming call. callId=" + callId + " destination=" + destination + " scheme=" + scheme,
  );

  call.answer();

  if (!activeCallIds[callId]) {
    activeCallIds[callId] = true;
    participants += 1;
  }

  // Wrap conference.add() in try/catch: an exception here would propagate to
  // the CallAlerting handler and can cause the VoxEngine session to fail, which
  // results in 502 Bad Gateway on the client side.
  var endpoint = null;
  try {
    endpoint = conference.add({
      call: call,
      mode: "FORWARD",
      direction: "BOTH",
      scheme: event.scheme,
    });

    logWithContext("Participant joined. callId=" + callId + " endpointId=" + safeEndpointId(endpoint));
  } catch (addError) {
    logWithContext(
      "Failed to add call to conference. callId=" + callId +
      " error=" + safeValue(addError && addError.message, String(addError)),
    );
    // Decrement participant count since we could not add this call
    if (activeCallIds[callId]) {
      delete activeCallIds[callId];
      participants = Math.max(0, participants - 1);
    }
    // Disconnect the call safely so the client gets a clean failure instead of hanging
    try {
      call.hangup();
    } catch (hangupError) {
      logWithContext("Failed to hangup call after add error. callId=" + callId);
    }
    return;
  }

  call.addEventListener(CallEvents.Disconnected, function (disconnectEvent) {
    logWithContext(
      "Call disconnected. code=" +
        safeValue(disconnectEvent && disconnectEvent.code, "unknown") +
        " reason=" +
        safeValue(disconnectEvent && disconnectEvent.reason, "unknown") +
        " callId=" +
        callId,
    );

    if (activeCallIds[callId]) {
      delete activeCallIds[callId];
      participants = Math.max(0, participants - 1);
    }

    logWithContext("Participant disconnected. callId=" + callId + " remaining=" + participants);
  });

  call.addEventListener(CallEvents.Failed, function (failedEvent) {
    logWithContext(
      "Call failed. code=" +
        safeValue(failedEvent && failedEvent.code, "unknown") +
        " reason=" +
        safeValue(failedEvent && failedEvent.reason, "unknown") +
        " callId=" +
        callId,
    );
  });
});
