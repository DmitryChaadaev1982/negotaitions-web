import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildRemoteSpeakingInput } from "@/components/voximplant-video-layout";

test("remote speaking prefers audio stream over video-only stream", () => {
  const videoOnly = {
    id: "video-only",
    getAudioTracks: () => [],
  } as unknown as MediaStream;
  const audioStream = {
    id: "audio",
    getAudioTracks: () => [{} as MediaStreamTrack],
  } as unknown as MediaStream;
  const result = buildRemoteSpeakingInput([
    {
      id: "participant-1",
      displayName: "Participant 1",
      stream: videoOnly,
      audioStream,
    },
  ]);
  assert.equal(result[0]?.stream, audioStream);
});

test("remote connected signal is gated by logical room presence", () => {
  const source = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  assert.match(source, /isLogicallyPresent === false/);
  assert.match(
    source,
    /connectedSignal:\s*isLocal\s*\?\s*joined\s*:\s*Boolean\(matchedRemote\)\s*&&\s*!isLogicallyAbsent/,
  );
});

test("remote speaking input can carry reconnect generation and mic state", () => {
  const audioStream = {
    id: "audio-current",
    getAudioTracks: () => [{ enabled: true } as MediaStreamTrack],
  } as unknown as MediaStream;
  const result = buildRemoteSpeakingInput([
    {
      id: "facilitator-endpoint-current",
      displayName: "Facilitator",
      stream: null,
      audioStream,
      microphoneEnabled: true,
      generation: "participant:connection:endpoint:stream",
    },
  ]);
  assert.equal(result[0]?.stream, audioStream);
  assert.equal(result[0]?.microphoneEnabled, true);
  assert.equal(result[0]?.generation, "participant:connection:endpoint:stream");
});

test("repeated reconnect deduplicates remote tile by stable username", () => {
  const source = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  assert.match(source, /remoteByVoxUsername/);
  assert.match(source, /collapsedDuplicates/);
  assert.match(source, /normalized Vox username/);
});

test("muted border takes precedence over active-speaker border", () => {
  const source = readFileSync("components/voximplant-participant-tile.tsx", "utf-8");
  assert.match(source, /Visual precedence: stale\/disconnected, muted, speaking, connected\/default/);
  assert.match(source, /muted: "border-rose-700\/70"/);
  assert.match(source, /speaking: "border-green-400/);
  assert.match(source, /resolveTileBorderState\(/);
});
