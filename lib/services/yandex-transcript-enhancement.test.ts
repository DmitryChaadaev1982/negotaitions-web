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

test("chunked mode keeps partial fallback semantics with bounded retries", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS: "1000",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "2",
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
        assert.equal(result.meta?.retryCount >= 2, true);
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

test("initial response empty then polling output succeeds", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
    },
    async () => {
      const originalFetch = global.fetch;
      global.fetch = (async (url: string, init?: RequestInit) => {
        if (url.endsWith("/responses") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              id: "resp-1",
              status: "in_progress",
              output_text: "",
            }),
            { status: 200 },
          );
        }
        if (url.includes("/responses/resp-1") && init?.method === "GET") {
          return new Response(
            JSON.stringify({
              id: "resp-1",
              status: "completed",
              output_text: JSON.stringify({
                segments: [
                  { index: 0, cleanedText: "исправлено 0" },
                  { index: 1, cleanedText: "исправлено 1" },
                ],
                globalWarnings: [],
              }),
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      }) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(2, "polling"));
        assert.equal(result.meta?.overallStatus, "COMPLETED");
        const attempt = result.meta?.perChunk[0]?.attempts?.[0];
        assert.equal(attempt?.responseIdPresent, true);
        assert.equal((attempt?.pollingAttemptCount ?? 0) > 0, true);
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("primary strict retry succeeds after initial empty output", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
    },
    async () => {
      const originalFetch = global.fetch;
      let call = 0;
      global.fetch = (async (_url: string, _init?: RequestInit) => {
        call += 1;
        if (call === 1) {
          return new Response(JSON.stringify({ status: "completed" }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            status: "completed",
            output_text: JSON.stringify({
              segments: [
                { index: 0, cleanedText: "исправлено 0" },
                { index: 1, cleanedText: "исправлено 1" },
              ],
              globalWarnings: [],
            }),
          }),
          { status: 200 },
        );
      }) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(2, "strict"));
        assert.equal(result.meta?.overallStatus, "COMPLETED");
        assert.equal(result.meta?.perChunk[0]?.attemptCount, 2);
        assert.equal(result.meta?.perChunk[0]?.attempts?.[0]?.emptyOutputStage, "initial_response");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("fallback model succeeds after primary empty attempts", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL: "deepseek-v4-flash",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
      TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL: "yandexgpt-lite/latest",
    },
    async () => {
      const originalFetch = global.fetch;
      let call = 0;
      global.fetch = (async (_url: string, init?: RequestInit) => {
        call += 1;
        if (call <= 2) {
          return new Response(JSON.stringify({ status: "completed", output_text: "" }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            status: "completed",
            output_text: JSON.stringify({
              segments: [
                { index: 0, cleanedText: "fallback модель исправила сегмент 0 безопасно" },
                { index: 1, cleanedText: "fallback модель исправила сегмент 1 безопасно" },
              ],
              globalWarnings: [],
            }),
          }),
          { status: 200 },
        );
      }) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(2, "fallback-ok"));
        assert.equal(result.meta?.overallStatus, "COMPLETED");
        assert.equal(result.meta?.fallbackTriggered, true);
        assert.equal(result.meta?.perChunk[0]?.modelUsed, "yandexgpt-lite/latest");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("primary and fallback empty outputs end in FAILED_FALLBACK and preserve original", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL: "deepseek-v4-flash",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
      TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL: "yandexgpt-lite/latest",
    },
    async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () =>
        new Response(JSON.stringify({ status: "completed", output_text: "" }), {
          status: 200,
        })) as typeof fetch;
      try {
        const source = makeSegments(2, "original-safe");
        const result = await enhanceTranscriptWithYandexAi(source);
        assert.equal(result.meta?.overallStatus, "FAILED");
        assert.equal(result.meta?.perChunk[0]?.status, "FAILED_FALLBACK");
        assert.deepEqual(
          result.segments.map((segment) => segment.cleanedText),
          source.map((segment) => segment.originalText),
        );
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("telemetry marks parsing stage for malformed output", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
    },
    async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () =>
        new Response(JSON.stringify({ status: "completed", output_text: "{bad json" }), {
          status: 200,
        })) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(2, "parsing"));
        const stage = result.meta?.perChunk[0]?.attempts?.[0]?.emptyOutputStage;
        assert.equal(stage, "parsing");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("telemetry marks extraction stage when output field is present but empty", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
    },
    async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [{ text: "   " }],
          }),
          { status: 200 },
        )) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(2, "extract"));
        const stage = result.meta?.perChunk[0]?.attempts?.[0]?.emptyOutputStage;
        assert.equal(stage, "extraction");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("telemetry marks validation stage when payload validates JSON but fails semantic guards", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
    },
    async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output_text: JSON.stringify({
              segments: [{ index: 999, cleanedText: "bad index" }],
              globalWarnings: [],
            }),
          }),
          { status: 200 },
        )) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(2, "validation"));
        const stage = result.meta?.perChunk[0]?.attempts?.[0]?.emptyOutputStage;
        assert.equal(stage, "validation");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("retry plan stays bounded to three attempts per chunk", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL: "deepseek-v4-flash",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
      TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL: "yandexgpt-lite/latest",
    },
    async () => {
      const originalFetch = global.fetch;
      let calls = 0;
      global.fetch = (async () => {
        calls += 1;
        return new Response(JSON.stringify({ status: "completed", output_text: "" }), {
          status: 200,
        });
      }) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(2, "bounded"));
        assert.equal(result.meta?.perChunk[0]?.attemptCount, 3);
        assert.equal(calls, 3);
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

test("telemetry stores no raw provider payload or secrets", async () => {
  await withEnv(
    {
      YANDEX_API_KEY: "test-key",
      YANDEX_FOLDER_ID: "test-folder",
      TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
      TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: "2",
      TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: "1",
    },
    async () => {
      const originalFetch = global.fetch;
      global.fetch = (async () =>
        new Response(JSON.stringify({ status: "completed", output_text: "" }), {
          status: 200,
        })) as typeof fetch;
      try {
        const result = await enhanceTranscriptWithYandexAi(makeSegments(2, "secrets"));
        const serialized = JSON.stringify(result.meta?.perChunk ?? []);
        assert.equal(serialized.includes("Api-Key"), false);
        assert.equal(serialized.includes("test-key"), false);
        assert.equal(serialized.includes("rawProviderSnapshot"), false);
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});

