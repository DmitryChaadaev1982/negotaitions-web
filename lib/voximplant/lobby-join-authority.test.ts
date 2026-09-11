import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_LOBBY_JOIN_AUTHORITY,
  lobbyJoinAuthorityBecameTrue,
  reduceLobbyJoinAuthority,
  releaseLobbyRemoteAudioElements,
  shouldExposeLobbyMediaUi,
  shouldStartRemoteAudioPlayback,
} from "@/lib/voximplant/lobby-join-authority";

test("L1 Connected before join does not expose authoritative joined state", () => {
  const next = reduceLobbyJoinAuthority(INITIAL_LOBBY_JOIN_AUTHORITY, "sdk_connected");
  assert.equal(next.sdkConnectedObserved, true);
  assert.equal(next.joined, false);
  assert.equal(next.conferenceConnected, false);
  assert.equal(shouldExposeLobbyMediaUi(next), false);
  assert.equal(shouldStartRemoteAudioPlayback(next.conferenceConnected), false);
  assert.equal(
    lobbyJoinAuthorityBecameTrue(INITIAL_LOBBY_JOIN_AUTHORITY, next),
    false,
  );
});

test("L2 join before Connected converges joined and conference-connected immediately", () => {
  const next = reduceLobbyJoinAuthority(
    INITIAL_LOBBY_JOIN_AUTHORITY,
    "conference_join_resolved",
  );
  assert.equal(next.joined, true);
  assert.equal(next.conferenceConnected, true);
  assert.equal(next.sdkConnectedObserved, false);
  assert.equal(shouldExposeLobbyMediaUi(next), true);
  assert.equal(
    lobbyJoinAuthorityBecameTrue(INITIAL_LOBBY_JOIN_AUTHORITY, next),
    true,
  );

  const afterConnected = reduceLobbyJoinAuthority(next, "sdk_connected");
  assert.equal(afterConnected.joined, true);
  assert.equal(afterConnected.conferenceConnected, true);
  assert.equal(afterConnected.sdkConnectedObserved, true);
  assert.equal(lobbyJoinAuthorityBecameTrue(next, afterConnected), false);
});

test("L3 join without a later Connected still converges media authority", () => {
  const next = reduceLobbyJoinAuthority(
    INITIAL_LOBBY_JOIN_AUTHORITY,
    "conference_join_resolved",
  );
  assert.equal(shouldExposeLobbyMediaUi(next), true);
  assert.equal(shouldStartRemoteAudioPlayback(next.conferenceConnected), true);
});

test("L4/L5 early media stays gated until join, then becomes usable", () => {
  const beforeJoin = reduceLobbyJoinAuthority(INITIAL_LOBBY_JOIN_AUTHORITY, "sdk_connected");
  assert.equal(shouldStartRemoteAudioPlayback(beforeJoin.conferenceConnected), false);
  assert.equal(shouldExposeLobbyMediaUi(beforeJoin), false);

  const afterJoin = reduceLobbyJoinAuthority(beforeJoin, "conference_join_resolved");
  assert.equal(lobbyJoinAuthorityBecameTrue(beforeJoin, afterJoin), true);
  assert.equal(shouldStartRemoteAudioPlayback(afterJoin.conferenceConnected), true);
  assert.equal(shouldExposeLobbyMediaUi(afterJoin), true);
});

test("L6 joined and conference-connected flip on the same join edge", () => {
  const next = reduceLobbyJoinAuthority(
    INITIAL_LOBBY_JOIN_AUTHORITY,
    "conference_join_resolved",
  );
  assert.equal(next.joined, next.conferenceConnected);
  assert.equal(next.joined, true);
});

test("L7 stale/unmount cleanup releases this runtime's audio elements", () => {
  const paused: string[] = [];
  const audio = {
    pause() {
      paused.push("pause");
    },
    srcObject: {} as MediaStream,
  };
  releaseLobbyRemoteAudioElements([audio]);
  assert.deepEqual(paused, ["pause"]);
  assert.equal(audio.srcObject, null);

  const cleared = reduceLobbyJoinAuthority(
    reduceLobbyJoinAuthority(INITIAL_LOBBY_JOIN_AUTHORITY, "conference_join_resolved"),
    "cleanup",
  );
  assert.equal(shouldExposeLobbyMediaUi(cleared), false);
  assert.equal(shouldStartRemoteAudioPlayback(cleared.conferenceConnected), false);
});

test("L8 cleanup mutates only the provided local audio collection", () => {
  const other = {
    pause() {
      throw new Error("winner audio must not be touched");
    },
    srcObject: {} as MediaStream,
  };
  const local = {
    pause() {},
    srcObject: {} as MediaStream,
  };
  releaseLobbyRemoteAudioElements([local]);
  assert.equal(local.srcObject, null);
  assert.ok(other.srcObject);
});

test("L9 genuine join failure does not leave joined controls/media state", () => {
  const afterSignal = reduceLobbyJoinAuthority(INITIAL_LOBBY_JOIN_AUTHORITY, "sdk_connected");
  const failed = reduceLobbyJoinAuthority(afterSignal, "join_failed");
  assert.equal(failed.joined, false);
  assert.equal(failed.conferenceConnected, false);
  assert.equal(failed.sdkConnectedObserved, false);
  assert.equal(shouldExposeLobbyMediaUi(failed), false);
});

test("L10 successful join remains joined after an idempotent second join edge", () => {
  const first = reduceLobbyJoinAuthority(
    INITIAL_LOBBY_JOIN_AUTHORITY,
    "conference_join_resolved",
  );
  const second = reduceLobbyJoinAuthority(first, "conference_join_resolved");
  assert.equal(shouldExposeLobbyMediaUi(second), true);
  assert.equal(lobbyJoinAuthorityBecameTrue(first, second), false);
});
