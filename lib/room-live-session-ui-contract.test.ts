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
  assert.match(source, /stateMessage\.subtitleKey \?/);
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

test("room sound control is rendered as an accessible keyboard button", () => {
  const shellSource = readFileSync("components/shared-room-shell.tsx", "utf-8");
  assert.match(shellSource, /data-testid="room-sound-control"/);
  assert.match(shellSource, /aria-label=\{soundControlAriaLabel\}/);
  assert.match(shellSource, /aria-pressed=\{soundControlPressed\}/);
  assert.match(shellSource, /controlState\.negotiationState !== "FINISHED"/);
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
