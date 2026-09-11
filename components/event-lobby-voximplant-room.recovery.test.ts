import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("event lobby shares conservative snapshot reconcile and clears remotes on disconnect", () => {
  const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(source, /reconcileRemoteParticipantsFromSnapshot/);
  assert.match(source, /remotesAfterProviderDisconnect/);
  assert.match(source, /lobbyConferenceConnectedRef/);
  assert.doesNotMatch(source, /createBoundedProviderRejoin/);
  assert.doesNotMatch(source, /setJoinEpoch/);
});

test("authoritative lobby join is conference.join resolution, not SDK Connected", () => {
  const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(source, /markLobbyConferenceJoined/);
  assert.match(source, /await conference\.join\(\)/);
  assert.match(source, /applyJoinAuthority\("conference_join_resolved"\)/);
  assert.match(source, /applyJoinAuthority\("sdk_connected"\)/);

  const onConnected = source.match(
    /const onConnected = \(\) => \{[\s\S]*?\n        \};/,
  );
  assert.ok(onConnected, "onConnected handler must exist");
  assert.doesNotMatch(onConnected[0], /setJoined\(true\)/);
  assert.doesNotMatch(onConnected[0], /conference_join_resolved/);
  assert.match(onConnected[0], /sdk_connected/);
});

test("remote audio playback and known-endpoint replay share join authority", () => {
  const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(source, /shouldStartRemoteAudioPlayback\(lobbyConferenceConnectedRef\.current\)/);
  assert.match(source, /const applyKnownEndpointMedia = \(endpoint: VoxEndpoint\) => \{/);
  assert.match(source, /applyKnownEndpointMedia\(endpoint\)/);
  assert.match(source, /releaseLobbyRemoteAudioElements\(runtime\.remoteAudioElements\.values\(\)\)/);
});

test("same-user provider endpoints are not materialized as remote tiles", () => {
  const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(source, /isCurrentLobbySelfEndpoint/);
  assert.match(source, /excludeCurrentLobbySelfRemotes/);
  assert.match(source, /if \(isSelfLobbyEndpoint\(endpoint\)\) return;/);
  assert.match(source, /applyKnownEndpointMedia\(endpoint\)/);
  assert.match(source, /localSdkUsernameRef\.current = initialPayload\.user\.sdkUsername;/);
  assert.match(source, /localSdkUsernameRef\.current = readyPayload\.user\.sdkUsername;/);
  assert.doesNotMatch(
    source,
    /displayName\s*===\s*|endpoint\.displayName\s*===\s*readyPayload\.user\.displayName/,
  );

  const visibleRemotes = source.match(
    /const visibleRemoteParticipants = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[localParticipant, remoteParticipants\]\);/,
  );
  assert.ok(visibleRemotes, "visibleRemoteParticipants memo must exist");
  assert.match(visibleRemotes[0], /localParticipant\?\.endpointUsername/);
  assert.doesNotMatch(visibleRemotes[0], /localSdkUsernameRef\.current/);
});

test("joined room fills the video pane in normal flow without absolute positioning", () => {
  const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(
    source,
    /className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-\[#0f172a\]"/,
  );
  assert.doesNotMatch(
    source,
    /data-testid="event-lobby-voximplant-room"[\s\S]{0,220}absolute inset-0/,
  );
  assert.doesNotMatch(source, /className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-\[#0f172a\]"/);
  assert.doesNotMatch(source, /className="flex h-full min-h-0 flex-col overflow-hidden bg-\[#0f172a\]"/);
  assert.match(source, /event-lobby-vox-local-tile/);
  assert.match(source, /data-testid="event-lobby-vox-controls"/);
});

test("lobby video grid shrinks in-flow without an internal scroller", () => {
  const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(
    source,
    /grid h-full min-h-0 min-w-0 grid-cols-1 content-start justify-items-stretch gap-3 overflow-hidden/,
  );
  assert.doesNotMatch(source, /justify-items-center gap-3 overflow-auto/);
  assert.match(source, /className="w-full min-w-0 max-w-\[420px\]"/);
  assert.doesNotMatch(source, /event-lobby-vox-room-diag/);
  assert.doesNotMatch(source, /lobby-browser-diag/);
  assert.doesNotMatch(source, /onFirstRender/);
  assert.doesNotMatch(source, /onInnerDiagChange/);
});
