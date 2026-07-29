import assert from "node:assert/strict";
import test from "node:test";

import {
  createWebSdkLogFilterAdapter,
  isBenignWebSdkRaceLog,
} from "@/lib/voximplant/websdk-log-filter";

function makeLog(fullMessage: string) {
  return {
    fullMessage,
    message: [fullMessage],
    extraData: { level: "Error", scope: "ConferenceManager" },
  };
}

test("mids + handleReInvite is benign", () => {
  assert.equal(
    isBenignWebSdkRaceLog(
      makeLog("Cannot read properties of undefined (reading 'mids') at handleReInvite"),
    ),
    true,
  );
});

test("mids without Vox context is not benign", () => {
  assert.equal(
    isBenignWebSdkRaceLog(
      makeLog("Cannot read properties of undefined (reading 'mids') at Application"),
    ),
    false,
  );
});

test("transient signalling + mute payload is benign", () => {
  assert.equal(
    isBenignWebSdkRaceLog(
      makeLog(
        'Transport is not ready. Message sending will be delayed until signalling ready. {"name":"mute"}',
      ),
    ),
    true,
  );
});

test("transient signalling with another message type is not benign", () => {
  assert.equal(
    isBenignWebSdkRaceLog(
      makeLog(
        'Transport is not ready. Message sending will be delayed until signalling ready. {"name":"unmute"}',
      ),
    ),
    false,
  );
});

test("setEndpointVad missing endpoint is benign", () => {
  assert.equal(
    isBenignWebSdkRaceLog(
      makeLog("EndpointManagerImpl.setEndpointVad: Can't find endpoint 42 to change vad value"),
    ),
    true,
  );
});

test("TransportTimeoutError 408 remains visible", () => {
  assert.equal(
    isBenignWebSdkRaceLog(makeLog("TransportTimeoutError: code 408")),
    false,
  );
});

test("gateway connection failure remains visible", () => {
  assert.equal(
    isBenignWebSdkRaceLog(makeLog("Failed to connect to gateway")),
    false,
  );
});

test("IceRestart rejected remains visible", () => {
  assert.equal(
    isBenignWebSdkRaceLog(makeLog("IceRestartAction failed: Reinvite rejected")),
    false,
  );
});

test("unknown TypeError remains visible", () => {
  assert.equal(
    isBenignWebSdkRaceLog(makeLog("TypeError: Cannot read properties of undefined")),
    false,
  );
});

test("duplicate benign messages are downgraded once per runtime", () => {
  const warns: string[] = [];
  const errors: string[] = [];
  const adapter = createWebSdkLogFilterAdapter({
    emitWarn: (message) => warns.push(message),
    emitError: (...args) => errors.push(args.join(" ")),
  });
  const benign = makeLog(
    "Cannot read properties of undefined (reading 'mids') message subscriber handleReInvite",
  );

  adapter.onLog(benign);
  adapter.onLog(benign);

  assert.equal(warns.length, 1);
  assert.equal(errors.length, 0);
});

test("new runtime resets benign dedupe", () => {
  const warns: string[] = [];
  const adapter = createWebSdkLogFilterAdapter({
    emitWarn: (message) => warns.push(message),
  });
  const benign = makeLog(
    "EndpointManagerImpl.setEndpointVad: Can't find endpoint id to change vad value",
  );

  adapter.onLog(benign);
  adapter.reset();
  adapter.onLog(benign);

  assert.equal(warns.length, 2);
});

test("unmatched errors still call original error logger", () => {
  const errors: string[] = [];
  const adapter = createWebSdkLogFilterAdapter({
    emitError: (...args) => errors.push(args.join(" ")),
  });

  adapter.onLog(makeLog("Failed to connect to gateway"));

  assert.equal(errors.length, 1);
});
