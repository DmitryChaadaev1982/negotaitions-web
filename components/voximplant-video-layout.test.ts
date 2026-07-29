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
