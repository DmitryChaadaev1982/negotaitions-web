import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTranscriptEnhancementChunks,
  enhanceTranscriptWithYandexAi,
  validateChunkEnhancementResponse,
  type TranscriptEnhancementInputSegment,
} from "@/lib/services/yandex-transcript-enhancement";

function makeSegment(index: number, text: string): TranscriptEnhancementInputSegment {
  return {
    index,
    speakerLabel: index % 2 === 0 ? "speaker_1" : "speaker_2",
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    originalText: text,
    segmentId: `seg-${index}`,
    mappedParticipantId: index % 2 === 0 ? "p1" : "p2",
  };
}

function makeSegments(count: number, seed = "тест"): TranscriptEnhancementInputSegment[] {
  return Array.from({ length: count }, (_, idx) =>
    makeSegment(idx, `${seed} сегмент ${idx} с исходным текстом`),
  );
}

function extractTargetIndexesFromPrompt(input: string): number[] {
  const marker = "Input JSON:\n";
  const start = input.indexOf(marker);
  if (start < 0) return [];
  const payload = input.slice(start + marker.length).trim();
  const parsed = JSON.parse(payload) as {
    targetSegments?: Array<{ index?: number }>;
  };
  return (parsed.targetSegments ?? [])
    .map((segment) => segment.index)
    .filter((index): index is number => typeof index === "number");
}

function withEnv(vars: Record<string, string>, fn: () => Promise<void> | void): Promise<void> | void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
  const result = fn();
  if (result instanceof Promise) {
    return result.finally(restore);
  }
  restore();
}

test("chunking keeps order and creates one chunk for short transcript", () => {
  const segments = makeSegments(2);
  const chunks = buildTranscriptEnhancementChunks(segments, {
    maxSegmentsPerChunk: 6,
    maxCharsPerChunk: 700,
  });
  assert.equal(chunks.length, 1);
  assert.deepEqual(
    chunks[0].targets.map((segment) => segment.index),
    [0, 1],
  );
});

test("chunking audited-size transcript into bounded deterministic chunks", () => {
  const segments = makeSegments(22, "аудит");
  const chunks = buildTranscriptEnhancementChunks(segments, {
    maxSegmentsPerChunk: 6,
    maxCharsPerChunk: 700,
  });
  assert.equal(chunks.length >= 4, true);
  assert.equal(chunks.every((chunk) => chunk.targets.length <= 6), true);
  const flattened = chunks.flatMap((chunk) => chunk.targets.map((segment) => segment.index));
  assert.deepEqual(flattened, segments.map((segment) => segment.index));
  assert.equal(new Set(flattened).size, segments.length);
});

test("chunking large transcript produces more than four chunks", () => {
  const segments = makeSegments(60, "большой");
  const chunks = buildTranscriptEnhancementChunks(segments, {
    maxSegmentsPerChunk: 6,
    maxCharsPerChunk: 700,
  });
  assert.equal(chunks.length > 4, true);
});

test("validation rejects unknown, duplicate, empty, and catastrophic shrink", () => {
  const targets = [
    makeSegment(0, "Отлично, все берусь, заворачивайте."),
    makeSegment(1, "Это очень длинный исходный текст для проверки катастрофического уменьшения"),
  ];

  assert.throws(
    () =>
      validateChunkEnhancementResponse({
        targets,
        parsed: { segments: [{ index: 999, cleanedText: "x" }], globalWarnings: [] },
      }),
    /unknown segment index/i,
  );

  assert.throws(
    () =>
      validateChunkEnhancementResponse({
        targets,
        parsed: {
          segments: [
            { index: 0, cleanedText: "a" },
            { index: 0, cleanedText: "b" },
          ],
          globalWarnings: [],
        },
      }),
    /duplicate segment index/i,
  );

  assert.throws(
    () =>
      validateChunkEnhancementResponse({
        targets,
        parsed: { segments: [{ index: 0, cleanedText: "" }], globalWarnings: [] },
      }),
    /empty text/i,
  );

  assert.throws(
    () =>
      validateChunkEnhancementResponse({
        targets,
        parsed: {
          segments: [{ index: 1, cleanedText: "коротко" }],
          globalWarnings: [],
        },
      }),
    /catastrophic shrink/i,
  );
});

test("chunked merge preserves canonical order with reordered model response", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS: "1000",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_RETRIES: "1",
    },
    async () => {
      const originalFetch = global.fetch;
      global.fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const input = String(body.input ?? "");
        const unique = extractTargetIndexesFromPrompt(input);
        const reversed = [...unique].reverse();
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              segments: reversed.map((index) => ({
                index,
                cleanedText:
                  index === 0
                    ? "Отлично, всё беру. Заворачивайте."
                    : `исправленный сегмент ${index}`,
              })),
              globalWarnings: [],
            }),
            status: "completed",
          }),
          { status: 200 },
        );
      }) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi([
          makeSegment(0, "Отлично, все берусь, заворачивайте."),
          makeSegment(1, "артериальной гниле"),
          makeSegment(2, "обычный исходный текст"),
          makeSegment(3, "еще один исходный текст"),
        ]);
        assert.equal(result.meta?.overallStatus, "COMPLETED");
        assert.deepEqual(
          result.segments.map((segment) => segment.index),
          [0, 1, 2, 3],
        );
        assert.equal(result.segments[0]?.cleanedText, "Отлично, всё беру. Заворачивайте.");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("chunked mode supports partial fallback, failed fallback, and retry semantics", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS: "1000",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_RETRIES: "1",
      TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS: "120000",
    },
    async () => {
      const originalFetch = global.fetch;
      const attemptsByChunk = new Map<number, number>();
      global.fetch = (async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const input = String(body.input ?? "");
        const targetIndexes = extractTargetIndexesFromPrompt(input);
        const chunkAnchor = targetIndexes[0] ?? 0;
        const currentAttempt = (attemptsByChunk.get(chunkAnchor) ?? 0) + 1;
        attemptsByChunk.set(chunkAnchor, currentAttempt);

        if (chunkAnchor === 0 && currentAttempt === 1) {
          throw new Error("Yandex transcript enhancement timed out.");
        }
        if (chunkAnchor === 2) {
          return new Response(
            JSON.stringify({
              output_text: "{ malformed json",
              status: "completed",
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              segments: targetIndexes.map((index) => ({
                index,
                cleanedText: `исправлено ${index}`,
              })),
              globalWarnings: [],
            }),
            status: "completed",
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(4, "частичный"));
        assert.equal(result.meta?.overallStatus, "PARTIAL");
        assert.equal(result.meta?.successfulChunkCount, 1);
        assert.equal(result.meta?.failedChunkCount, 1);
        assert.equal(result.meta?.retryCount, 1);
        assert.equal(
          result.segments.some((segment) => segment.cleanedText.includes("частичный")),
          true,
        );
        assert.equal(result.meta?.perChunk.length, 2);
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("chunked mode all failed keeps original transcript and marks FAILED", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_RETRIES: "0",
    },
    async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () => {
        throw new Error("Yandex transcript enhancement timed out.");
      }) as typeof fetch;
      try {
        const source = makeSegments(4, "исходный");
        const result = await enhanceTranscriptWithYandexAi(source);
        assert.equal(result.meta?.overallStatus, "FAILED");
        assert.deepEqual(
          result.segments.map((segment) => segment.cleanedText),
          source.map((segment) => segment.originalText),
        );
        assert.equal(result.meta?.fallbackSegmentCount, source.length);
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

