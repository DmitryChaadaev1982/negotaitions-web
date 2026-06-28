import { loadEnvConfig } from "@next/env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { compressAudioForTranscription } from "@/lib/audio/compress";
import { prisma as appPrisma } from "@/lib/prisma";
import { downloadObjectToBuffer } from "@/lib/storage/s3";
import { transcribeAudioBufferWithYandexSpeechKit } from "@/lib/services/yandex-speechkit-transcription";
import {
  enhanceTranscriptWithYandexAi,
  type TranscriptEnhancementInputSegment,
} from "@/lib/services/yandex-transcript-enhancement";

loadEnvConfig(process.cwd());

type CliValues = {
  "session-id"?: string;
  "file"?: string;
  "segments-file"?: string;
  "output-dir"?: string;
};

type SimpleSegment = {
  index: number;
  speakerLabel: string;
  startMs: number | null;
  endMs: number | null;
  text: string;
};

function toRunTimestamp(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function normalizeSegmentsFromJson(payload: unknown): TranscriptEnhancementInputSegment[] {
  if (!Array.isArray(payload)) {
    throw new Error("Segments JSON must be an array.");
  }
  return payload.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid segment at index ${idx}.`);
    }
    const record = entry as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.originalText === "string"
          ? record.originalText
          : "";
    if (!text.trim()) {
      throw new Error(`Segment ${idx} has empty text.`);
    }
    const toMs = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.round(parsed);
      }
      return null;
    };
    return {
      index: typeof record.index === "number" ? record.index : idx,
      speakerLabel:
        typeof record.speakerLabel === "string" && record.speakerLabel.trim()
          ? record.speakerLabel.trim()
          : `Speaker ${idx + 1}`,
      startMs: toMs(record.startMs),
      endMs: toMs(record.endMs),
      originalText: text.trim(),
    };
  });
}

function renderComparisonMarkdown(params: {
  baselineModel: string;
  improvedModel: string;
  baselineSegments: number;
  improvedSegments: number;
  enhancementApplied: boolean;
  enhancementSegments: number;
  outputDir: string;
}): string {
  const lines: string[] = [];
  lines.push("# Yandex transcription quality benchmark");
  lines.push("");
  lines.push(`- Baseline model: \`${params.baselineModel}\``);
  lines.push(`- Improved model: \`${params.improvedModel}\``);
  lines.push(`- Baseline segments: ${params.baselineSegments}`);
  lines.push(`- Improved segments: ${params.improvedSegments}`);
  lines.push(`- DeepSeek enhancement applied: ${params.enhancementApplied ? "yes" : "no"}`);
  lines.push(`- Enhanced segments: ${params.enhancementSegments}`);
  lines.push(`- Artifacts: \`${params.outputDir}\``);
  lines.push("");
  lines.push("Files:");
  lines.push("- `raw-speechkit.json`");
  lines.push("- `normalized-speechkit.json`");
  lines.push("- `enhanced-deepseek.json`");
  lines.push("- `comparison.md`");
  return lines.join("\n");
}

async function loadAudioFromSession(sessionId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const recording = await appPrisma.recording.findFirst({
    where: { sessionId, status: RecordingStatus.COMPLETED },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileKey: true, fileName: true },
  });
  if (!recording?.fileKey) {
    throw new Error(`No completed recording with fileKey found for session ${sessionId}.`);
  }
  const buffer = await downloadObjectToBuffer(recording.fileKey, {
    sessionId,
    recordingId: recording.id,
  });
  return { buffer, fileName: recording.fileName ?? "recording.mp4" };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "session-id": { type: "string" },
      file: { type: "string" },
      "segments-file": { type: "string" },
      "output-dir": { type: "string" },
    },
  });
  const cli = values as CliValues;

  const runDir = path.join(
    cli["output-dir"]?.trim() || "tmp/yandex-transcription-benchmark",
    toRunTimestamp(new Date()),
  );
  await mkdir(runDir, { recursive: true });

  const segmentsFile = cli["segments-file"]?.trim();
  if (segmentsFile) {
    const raw = await readFile(segmentsFile, "utf8");
    const payload = JSON.parse(raw) as unknown;
    const inputSegments = normalizeSegmentsFromJson(payload);
    const enhanced = await enhanceTranscriptWithYandexAi(inputSegments);

    await writeFile(
      path.join(runDir, "raw-speechkit.json"),
      `${JSON.stringify({ segments: inputSegments }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(runDir, "normalized-speechkit.json"),
      `${JSON.stringify({ segments: inputSegments }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(runDir, "enhanced-deepseek.json"),
      `${JSON.stringify(enhanced, null, 2)}\n`,
      "utf8",
    );
    const comparison = renderComparisonMarkdown({
      baselineModel: "segments-input-only",
      improvedModel: "segments-input-only",
      baselineSegments: inputSegments.length,
      improvedSegments: inputSegments.length,
      enhancementApplied: true,
      enhancementSegments: enhanced.segments.length,
      outputDir: runDir,
    });
    await writeFile(path.join(runDir, "comparison.md"), `${comparison}\n`, "utf8");
    console.log(`Benchmark artifacts saved to: ${runDir}`);
    return;
  }

  const localFile = cli.file?.trim();
  const sessionId = cli["session-id"]?.trim();
  if (!localFile && !sessionId) {
    throw new Error("Provide --file, --session-id, or --segments-file.");
  }

  const audioSource = localFile
    ? { buffer: await readFile(localFile), fileName: path.basename(localFile) }
    : await loadAudioFromSession(sessionId!);
  const compressed = await compressAudioForTranscription(audioSource.buffer, audioSource.fileName);

  const baseline = await transcribeAudioBufferWithYandexSpeechKit(compressed.compressedBuffer, "ru", {
    fileName: compressed.compressedFileName,
    mimeType: compressed.compressedMimeType,
    forceSpeechKitModel: "general",
    forceTextNormalizationEnabled: true,
    forceLiteratureText: false,
    forceProfanityFilter: false,
    forcePhoneFormatting: false,
    forceSpeakerLabelingEnabled: true,
    forceEnhancementEnabled: false,
  });
  const improved = await transcribeAudioBufferWithYandexSpeechKit(compressed.compressedBuffer, "ru", {
    fileName: compressed.compressedFileName,
    mimeType: compressed.compressedMimeType,
    forceSpeechKitModel: "general:rc",
    forceTextNormalizationEnabled: true,
    forceLiteratureText: true,
    forceProfanityFilter: false,
    forcePhoneFormatting: false,
    forceSpeakerLabelingEnabled: true,
    forceEnhancementEnabled: false,
  });

  const enhancementInput: TranscriptEnhancementInputSegment[] = improved.segments.map((segment) => ({
    index: segment.orderIndex,
    speakerLabel: segment.displaySpeakerLabel ?? "Speaker",
    startMs: segment.startSeconds !== null ? Math.round(segment.startSeconds * 1000) : null,
    endMs: segment.endSeconds !== null ? Math.round(segment.endSeconds * 1000) : null,
    originalText: segment.text,
  }));
  const enhanced = await enhanceTranscriptWithYandexAi(enhancementInput);

  const normalizeSimple = (segments: TranscriptEnhancementInputSegment[]): SimpleSegment[] =>
    segments.map((segment) => ({
      index: segment.index,
      speakerLabel: segment.speakerLabel,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.originalText,
    }));

  await writeFile(
    path.join(runDir, "raw-speechkit.json"),
    `${JSON.stringify(
      {
        model: baseline.model,
        text: baseline.text,
        segments: baseline.segments,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "normalized-speechkit.json"),
    `${JSON.stringify(
      {
        model: improved.model,
        text: improved.text,
        segments: improved.segments,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(runDir, "enhanced-deepseek.json"),
    `${JSON.stringify(
      {
        inputSegments: normalizeSimple(enhancementInput),
        result: enhanced,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const comparison = renderComparisonMarkdown({
    baselineModel: baseline.model,
    improvedModel: improved.model,
    baselineSegments: baseline.segments.length,
    improvedSegments: improved.segments.length,
    enhancementApplied: true,
    enhancementSegments: enhanced.segments.length,
    outputDir: runDir,
  });
  await writeFile(path.join(runDir, "comparison.md"), `${comparison}\n`, "utf8");

  console.log(`Benchmark artifacts saved to: ${runDir}`);
}

main().catch((error) => {
  console.error("Benchmark failed:");
  console.error(error);
  process.exitCode = 1;
});
