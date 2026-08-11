import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

test("timer panel keeps the approved fixed footprint classes", () => {
  const source = readFileSync("components/room-timer-panel.tsx", "utf-8");
  assert.match(source, /w-full rounded-xl px-3 py-2/);
  assert.match(source, /sm:rounded-2xl sm:px-4 sm:py-3/);
  assert.match(source, /font-mono text-xl font-semibold tabular-nums sm:text-2xl/);
  assert.match(source, /visibleTimerCount <= 1/);
  assert.match(source, /"flex justify-center gap-2"/);
  assert.match(source, /stateMessage\.subtitleKey \?/);
  assert.match(source, /mt-2 text-sm font-medium text-white\/90 sm:text-base/);
  assert.match(source, /data-testid="room-status-badge-image"/);
  assert.match(source, /className="h-24 w-24 object-contain"/);
  assert.doesNotMatch(source, /stateMessage\.icon/);
  assert.doesNotMatch(source, /presentationState === "DEBRIEF"[\s\S]*return null/);
});

test("timer panel has reduced-motion-safe emphasis and no live second announcements", () => {
  const timerSource = readFileSync("components/room-timer-panel.tsx", "utf-8");
  const shellSource = readFileSync("components/shared-room-shell.tsx", "utf-8");

  assert.match(
    timerSource,
    /motion-safe:scale-105[\s\S]*motion-safe:transition-transform[\s\S]*motion-reduce:scale-100/,
  );
  assert.doesNotMatch(timerSource, /aria-live/);
  assert.match(
    shellSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-atomic="true"/,
  );
});

test("room notifications control is rendered as an accessible keyboard button", () => {
  const shellSource = readFileSync("components/shared-room-shell.tsx", "utf-8");
  assert.match(shellSource, /data-testid="room-notifications-control"/);
  assert.match(shellSource, /aria-label=\{notificationsControlAriaLabel\}/);
  assert.match(shellSource, /aria-pressed=\{notificationsControlPressed\}/);
  assert.match(shellSource, /<NotificationsControlIcon state=\{liveSessionUx\.soundControlState\} \/>/);
  assert.match(shellSource, /gap-1\.5 rounded-md border px-2\.5 py-1 text-xs/);
  assert.match(shellSource, /data-audio-runtime=/);
  assert.doesNotMatch(shellSource, /border-amber-500\/60/);
});

test("room notifications control is injected after media toggles", () => {
  const liveKitControlBarSource = readFileSync(
    "components/restricted-control-bar.tsx",
    "utf-8",
  );
  const voxControlBarSource = readFileSync(
    "components/voximplant-media-controls.tsx",
    "utf-8",
  );
  const liveKitRoomSource = readFileSync("components/video-room-page.tsx", "utf-8");
  const voxRoomSource = readFileSync(
    "components/voximplant-negotiation-room-page.tsx",
    "utf-8",
  );

  assert.match(liveKitControlBarSource, /Track\.Source\.Camera[\s\S]*\{trailingMediaControl \?/);
  assert.match(voxControlBarSource, /\{cameraLabel\}[\s\S]*\{trailingMediaControl\}/);
  assert.match(liveKitRoomSource, /trailingMediaControl=\{notificationsControl\}/);
  assert.match(voxRoomSource, /trailingMediaControl=\{notificationsControl\}/);
});

test("room navigation links prime audio context on trusted gestures", () => {
  const source = readFileSync("components/semantic-action.tsx", "utf-8");
  assert.match(source, /ensureSemanticRoomAudioContextRunning/);
  assert.match(source, /onPointerDown=\{handlePointerDown\}/);
  assert.match(source, /onKeyDown=\{handleKeyDown\}/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /\(\^\|\\\/\)room\\\//);

  const joinSource = readFileSync("components/join-page-view.tsx", "utf-8");
  assert.match(
    joinSource,
    /data-testid="join-video-room-button"[\s\S]*onPointerDown=\{\(\) => void ensureSemanticRoomAudioContextRunning\(\)\}/,
  );
});

test("RU and EN timer titles/subtitles stay concise", () => {
  const titleKeys = [
    "waitingForPreparation",
    "preparationRunning",
    "preparationPaused",
    "preparationComplete",
    "negotiationInProgress",
    "negotiationPaused",
    "oneMinuteRemaining",
    "finalTenSeconds",
    "timeIsUp",
    "negotiationsComplete",
  ] as const;
  const subtitleKeys = [
    "facilitatorWillStartShortly",
    "checkParticipantsAndConnection",
    "waitingForFacilitator",
    "waitingForFacilitatorStart",
    "debriefIsNext",
    "discussMeetingResults",
  ] as const;

  for (const key of titleKeys) {
    assert.ok(
      en.room[key].length <= 32,
      `EN title ${key} is too long for compact timer card`,
    );
    assert.ok(
      ru.room[key].length <= 32,
      `RU title ${key} is too long for compact timer card`,
    );
  }
  for (const key of subtitleKeys) {
    assert.ok(
      en.room[key].length <= 40,
      `EN subtitle ${key} is too long for compact timer card`,
    );
    assert.ok(
      ru.room[key].length <= 40,
      `RU subtitle ${key} is too long for compact timer card`,
    );
  }
});
