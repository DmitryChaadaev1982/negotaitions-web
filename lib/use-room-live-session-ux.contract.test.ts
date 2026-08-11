import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("room live-session hook loads and persists sound preference", () => {
  const source = readFileSync("lib/use-room-live-session-ux.tsx", "utf-8");
  assert.match(source, /fetch\("\/api\/account\/session-sound-preference"/);
  assert.match(source, /method:\s*"PATCH"/);
  assert.match(source, /sessionSoundEnabled/);
});

test("trusted user gestures can unlock audio context when preference is ON", () => {
  const source = readFileSync("lib/use-room-live-session-ux.tsx", "utf-8");
  assert.match(source, /window\.addEventListener\("pointerdown", onTrustedInteraction/);
  assert.match(source, /window\.addEventListener\("keydown", onTrustedInteraction/);
  assert.match(source, /void ensureAudioContextRunning\(\);/);
});

test("room live-session hook reuses the shared room audio context", () => {
  const source = readFileSync("lib/use-room-live-session-ux.tsx", "utf-8");
  assert.match(source, /ensureSemanticRoomAudioContextRunning/);
  assert.match(source, /getSemanticRoomAudioContext/);
  assert.match(source, /subscribeSemanticRoomAudioContextRunning/);
  assert.doesNotMatch(source, /useRef<AudioContext \| null>/);
});

test("room mount attempts audio resume when notifications are enabled", () => {
  const source = readFileSync("lib/use-room-live-session-ux.tsx", "utf-8");
  assert.match(
    source,
    /if \(!soundPreferenceEnabled \|\| audioContextRunning\) \{[\s\S]*return;[\s\S]*\}[\s\S]*void ensureAudioContextRunning\(\);/,
  );
  assert.match(source, /soundRuntimeReady: audioContextRunning/);
});

test("audio cues require both persisted preference and running context", () => {
  const source = readFileSync("lib/use-room-live-session-ux.tsx", "utf-8");
  assert.match(source, /allowAudio:\s*soundPreferenceEnabled && audioContextRunning/);
  assert.match(source, /if \(!context \|\| context\.state !== "running"\)/);
});

test("notification button visual state follows persisted preference", () => {
  const source = readFileSync("lib/use-room-live-session-ux.tsx", "utf-8");
  assert.match(
    source,
    /const soundControlState: SoundControlState = soundPreferenceEnabled[\s\S]*\? "ENABLED"[\s\S]*: "OFF"/,
  );
  assert.doesNotMatch(
    source,
    /const soundControlState: SoundControlState =[\s\S]*audioContextRunning[\s\S]*\? "ENABLED"[\s\S]*: "BLOCKED"/,
  );
});

test("enabled notification button unlocks audio before toggling off", () => {
  const source = readFileSync("lib/use-room-live-session-ux.tsx", "utf-8");
  assert.match(
    source,
    /if \(!audioContextRunning\) \{[\s\S]*await ensureAudioContextRunning\(\);[\s\S]*return;[\s\S]*\}[\s\S]*await persistSoundPreference\(false\);/,
  );
});
