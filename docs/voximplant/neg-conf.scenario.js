/* eslint-disable @typescript-eslint/no-require-imports */

// VoxEngine scenario template for:
// Applications -> negotaitions-video-poc -> Scenarios -> neg-conf
//
// Goal: minimal multi-party conference join for Web SDK clients.
//
// Notes:
// - This template keeps logic intentionally minimal for first smoke validation.
// - Conference name can be provided from the client as the destination.
// - Recording logic is left as TODO until recording API behavior is validated
//   in your Voximplant account and storage policy.

require(Modules.Conference);

let conference = null;
let participants = 0;

VoxEngine.addEventListener(AppEvents.Started, function () {
  conference = VoxEngine.createConference({ hd_audio: true });

  conference.addEventListener(ConferenceEvents.Started, function () {
    Logger.write("Conference started");

    // TODO(recording):
    // Validate the recommended recording approach for your account
    // (scenario-side vs management/API-triggered), then enable it here.
    // Keep this smoke template minimal until API certainty is confirmed.
  });

  conference.addEventListener(ConferenceEvents.Stopped, function () {
    Logger.write("Conference stopped");
    VoxEngine.terminate();
  });
});

VoxEngine.addEventListener(AppEvents.CallAlerting, function (event) {
  const call = event.call;

  call.answer();
  participants += 1;

  const endpoint = conference.add({
    call: call,
    mode: "FORWARD",
    direction: "BOTH",
    scheme: event.scheme,
  });

  Logger.write("Participant joined, endpoint: " + endpoint.id());

  call.addEventListener(CallEvents.Disconnected, function () {
    participants = Math.max(0, participants - 1);
    Logger.write("Participant left, remaining: " + participants);
    if (participants === 0) {
      conference.stop();
    }
  });
});
