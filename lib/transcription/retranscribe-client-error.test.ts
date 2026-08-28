import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";
import type { TranslationKey } from "@/lib/i18n/translate";
import { SOURCE_RECORDING_NOT_AVAILABLE_CODE } from "@/lib/services/source-recording-not-available";
import { resolveRetranscribeFailureMessage } from "@/lib/transcription/retranscribe-client-error";

const ROOT = process.cwd();

test("S324A-RT-08 UI maps SOURCE_RECORDING_NOT_AVAILABLE to a non-destructive message", () => {
  const t = (key: TranslationKey) => {
    if (key === "recording.sourceRecordingNotAvailable") {
      return en.recording.sourceRecordingNotAvailable;
    }
    return key;
  };

  const message = resolveRetranscribeFailureMessage(
    {
      error: "opaque",
      code: SOURCE_RECORDING_NOT_AVAILABLE_CODE,
    },
    t,
    "fallback",
  );

  assert.equal(message, en.recording.sourceRecordingNotAvailable);
  assert.match(message, /unavailable/i);
  assert.match(message, /cannot be started/i);
  assert.match(message, /remain available/i);
  assert.doesNotMatch(message, /deleted|removed from the session|retention|expir/i);
  assert.doesNotMatch(
    ru.recording.sourceRecordingNotAvailable,
    /срок хранения|истёк|истек/i,
  );

  assert.match(ru.recording.sourceRecordingNotAvailable, /недоступен/);
  assert.match(ru.recording.sourceRecordingNotAvailable, /невозможна/);
  assert.match(ru.recording.sourceRecordingNotAvailable, /остаются доступными/);
  assert.match(ru.sessionMaterials.sourceRecordingNotAvailable, /остаются доступными/);
  assert.equal(
    en.sessionMaterials.sourceRecordingNotAvailable,
    en.recording.sourceRecordingNotAvailable,
  );
});

test("S324A-RT-08 both retranscription surfaces consume the error code without clearing transcript state", () => {
  const panel = readFileSync(
    join(ROOT, "components/session-post-processing-panel.tsx"),
    "utf8",
  );
  const section = readFileSync(
    join(ROOT, "components/recording-transcription-section.tsx"),
    "utf8",
  );

  assert.match(panel, /resolveRetranscribeFailureMessage/);
  assert.match(section, /resolveRetranscribeFailureMessage/);
  assert.match(panel, /code\?: string/);
  assert.match(section, /code\?: string/);

  assert.match(panel, /setRerunError\(null\)/);
  assert.doesNotMatch(panel, /setTranscriptText\(""\)/);
  assert.match(section, /setError\(null\)/);
  assert.doesNotMatch(
    section,
    /catch \(rerunError\) \{[\s\S]*setTranscriptText\(""\)/,
  );
  assert.match(
    section,
    /setError\(\s*rerunError instanceof Error/,
  );
});
