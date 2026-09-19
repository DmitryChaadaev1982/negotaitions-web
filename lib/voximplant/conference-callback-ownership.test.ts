import assert from "node:assert/strict";
import test from "node:test";

import {
  createConferenceStateWatcherOwner,
  isAuthoritativeConferenceStateWatcher,
  shouldApplyConferenceCallback,
  wrapConferenceEventCallback,
} from "@/lib/voximplant/conference-callback-ownership";

test("R4 helper: ownership check happens before the mutation callback runs", () => {
  const conferenceN = { id: "n" };
  const conferenceN1 = { id: "n+1" };
  const currentGeneration = 2;
  const currentConference: object = conferenceN1;
  let mutated = false;

  const onConnected = wrapConferenceEventCallback(
    {
      eventGeneration: 1,
      callbackConference: conferenceN,
      getCurrentGeneration: () => currentGeneration,
      getCurrentConference: () => currentConference,
    },
    () => {
      mutated = true;
    },
  );

  onConnected();
  assert.equal(mutated, false);
  assert.equal(
    shouldApplyConferenceCallback({
      eventGeneration: 1,
      currentGeneration: 2,
      callbackConference: conferenceN,
      currentConference: conferenceN1,
    }),
    false,
  );
});

test("R4 helper: current-generation same-object callback may run", () => {
  const conference = { id: "current" };
  let ran = false;
  const onFailed = wrapConferenceEventCallback(
    {
      eventGeneration: 3,
      callbackConference: conference,
      getCurrentGeneration: () => 3,
      getCurrentConference: () => conference,
    },
    () => {
      ran = true;
    },
  );
  onFailed();
  assert.equal(ran, true);
});

test("R4 helper: late watcher from a released Conference cannot write projection", () => {
  const owner = createConferenceStateWatcherOwner();
  const oldConference = { id: "old" };
  const newConference = { id: "new" };
  const oldEpoch = owner.claim(oldConference);
  let projection = "CONNECTED";
  const oldWatch = owner.wrap(oldConference, oldEpoch, (next: string) => {
    projection = next;
  });

  owner.release(oldConference);
  const newEpoch = owner.claim(newConference);
  const newWatch = owner.wrap(newConference, newEpoch, (next: string) => {
    projection = next;
  });

  newWatch("CREATED");
  assert.equal(projection, "CREATED");
  oldWatch("RECONNECTING");
  assert.equal(projection, "CREATED");
  assert.equal(owner.isAuthoritative(oldConference, oldEpoch), false);
  assert.equal(
    isAuthoritativeConferenceStateWatcher({
      watcherConference: oldConference,
      currentConference: newConference,
      watcherEpoch: oldEpoch,
      currentEpoch: newEpoch,
    }),
    false,
  );
});
