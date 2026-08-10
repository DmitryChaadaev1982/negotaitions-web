import assert from "node:assert/strict";
import test from "node:test";

import {
  YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET,
} from "@/lib/ai/analysis-input-budget";
import {
  packAnalysisPrompt,
  type BuildAnalysisPromptContext,
} from "@/lib/ai/session-analysis-prompt";

function makeContext(
  segmentCount: number,
  textLength: number,
): BuildAnalysisPromptContext {
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const prefix =
      index % 2 === 0
        ? `Покупатель ${index}: цена и условия 🤝 `
        : `Продавец ${index}: объём и сроки — `;
    return {
      orderIndex: index,
      speakerLabel: index % 2 === 0 ? "speaker_1" : "speaker_2",
      mappedParticipantName: index % 2 === 0 ? "Покупатель" : "Продавец",
      startSeconds: index * 3,
      endSeconds: index * 3 + 2,
      text: `${prefix}${"я".repeat(Math.max(0, textLength - prefix.length))}`,
    };
  });
  const narrative = segments.map((segment) => segment.text).join("\n");
  return {
    session: {
      id: "session-large",
      title: "Synthetic large negotiation",
      roomLabel: "Room 1",
      status: "COMPLETED",
      caseTitle: "Large case",
      caseLanguage: "RU",
      publicInstructions: "Договоритесь по цене, объёму и срокам.",
      businessContext: "Проверка полного охвата большой переговорной сессии.",
      preparationDurationSeconds: 300,
      durationSeconds: Math.max(600, segmentCount * 3),
      sequenceNumber: 1,
    },
    event: {
      id: "event-1",
      title: "Synthetic event",
      status: "COMPLETED",
    },
    roles: [
      {
        id: "role-buyer",
        name: "Покупатель",
        privateInstructions: "",
        objectives: "Снизить цену.",
        constraints: "Ограниченный бюджет.",
        hiddenInfo: "Гибкий срок.",
        fallbackPosition: "Отказаться от сделки.",
      },
      {
        id: "role-seller",
        name: "Продавец",
        privateInstructions: "",
        objectives: "Сохранить маржу.",
        constraints: "Ограниченный запас.",
        hiddenInfo: "Можно уступить по сроку.",
        fallbackPosition: "Продать другому.",
      },
    ],
    participants: [
      {
        id: "p1",
        displayName: "Покупатель",
        type: "PARTICIPANT",
        roleName: "Покупатель",
        notes: "",
      },
      {
        id: "p2",
        displayName: "Продавец",
        type: "PARTICIPANT",
        roleName: "Продавец",
        notes: "",
      },
    ],
    transcript: {
      id: "transcript-large",
      text: narrative,
      diarizedText: narrative,
      language: "ru",
      transcriptionModel: "synthetic",
      hasSpeakerDiarization: true,
      segments,
    },
  };
}

function parseCompactTimeline(prompt: string) {
  const marker = "## Transcript Segments (Timeline)\n";
  const markerIndex = prompt.indexOf(marker);
  assert.notEqual(markerIndex, -1);
  const payload = prompt.slice(markerIndex + marker.length).trim();
  return JSON.parse(payload) as {
    segments: Array<{
      orderIndex: number;
      speaker: string;
      startSeconds: number | null;
      endSeconds: number | null;
      text: string;
    }>;
  };
}

test("normal analysis prompt keeps the existing direct whole-session representation", () => {
  const packed = packAnalysisPrompt(makeContext(12, 80));
  assert.equal(packed.mode, "direct");
  assert.equal(packed.exceedsPromptBudget, false);
  assert.equal(packed.duplicateNarrativeCharactersOmitted, 0);
  assert.equal(packed.duplicateNarrativeVerified, true);
  assert.match(packed.prompt, /\(Speaker-attributed transcript\)/);
  assert.match(packed.prompt, /## Transcript Segments \(Timeline\)/);
});

test("large analysis prompt removes only duplicate narrative and preserves every segment", () => {
  const context = makeContext(1_000, 220);
  const first = packAnalysisPrompt(context);
  const second = packAnalysisPrompt(context);

  assert.equal(first.mode, "lossless_compact");
  assert.equal(first.exceedsPromptBudget, false);
  assert.equal(first.prompt, second.prompt);
  assert.equal(
    first.estimatedPromptTokens <=
      YANDEX_DEEPSEEK_ANALYSIS_PROMPT_TOKEN_BUDGET,
    true,
  );
  assert.equal(first.sourceSegmentCount, context.transcript?.segments.length);
  assert.equal(first.duplicateNarrativeVerified, true);
  assert.equal(first.duplicateNarrativeCharactersOmitted > 0, true);

  const timeline = parseCompactTimeline(first.prompt);
  assert.deepEqual(
    timeline.segments.map((segment) => ({
      orderIndex: segment.orderIndex,
      speaker: segment.speaker,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
    })),
    context.transcript?.segments.map((segment, position) => ({
      orderIndex: segment.orderIndex ?? position,
      speaker:
        segment.mappedParticipantName ?? segment.speakerLabel ?? "Speaker",
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
    })),
  );
});

test("analysis prompt over the supported bound remains complete and is marked for explicit rejection", () => {
  const context = makeContext(1_600, 300);
  const packed = packAnalysisPrompt(context);
  assert.equal(packed.mode, "lossless_compact");
  assert.equal(packed.exceedsPromptBudget, true);

  const timeline = parseCompactTimeline(packed.prompt);
  assert.equal(timeline.segments.length, context.transcript?.segments.length);
  assert.deepEqual(
    timeline.segments.map((segment) => segment.text),
    context.transcript?.segments.map((segment) => segment.text),
  );
});

test("large plain transcript without segments is never silently truncated", () => {
  const context = makeContext(0, 0);
  context.transcript = {
    id: "plain-large",
    text: "переговоры ".repeat(50_000),
    diarizedText: null,
    language: "ru",
    transcriptionModel: "synthetic",
    hasSpeakerDiarization: false,
    segments: [],
  };
  const packed = packAnalysisPrompt(context);
  assert.equal(packed.mode, "direct");
  assert.equal(packed.exceedsPromptBudget, true);
  assert.equal(packed.prompt.includes(context.transcript.text.trim()), true);
});

test("large mismatched narrative is not treated as a removable duplicate", () => {
  const context = makeContext(1_000, 220);
  assert.ok(context.transcript);
  context.transcript.text += " отдельный фрагмент вне сегментов";
  const packed = packAnalysisPrompt(context);
  assert.equal(packed.mode, "direct");
  assert.equal(packed.duplicateNarrativeVerified, false);
  assert.equal(packed.duplicateNarrativeCharactersOmitted, 0);
  assert.equal(packed.exceedsPromptBudget, true);
  assert.equal(
    packed.prompt.includes("отдельный фрагмент вне сегментов"),
    true,
  );
});
