import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { parseArgs } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { bootstrapOperationalEnv } from "@/lib/operational-env";
import { prisma } from "@/lib/prisma";
import { getS3Client, getS3Config } from "@/lib/storage/s3";
import { RECORDING_STARTING_TIMEOUT_RECONCILED } from "@/lib/voximplant/recording-status-fencing";

bootstrapOperationalEnv();

type CliValues = {
  sessionId?: string;
  objectKey?: string;
  recordingAttemptId?: string;
  out?: string;
  "dry-run"?: boolean;
  execute?: boolean;
};

type ProbeMetadata = {
  codec: string | null;
  sampleRateHz: number | null;
  channels: number | null;
  durationSec: number | null;
};

function parseCli(): CliValues {
  const parsed = parseArgs({
    options: {
      sessionId: { type: "string" },
      objectKey: { type: "string" },
      recordingAttemptId: { type: "string" },
      out: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      execute: { type: "boolean", default: false },
    },
    strict: true,
  });
  return parsed.values as CliValues;
}

function redact(value: string | null): string | null {
  if (!value) return null;
  if (value.length < 96) return value;
  return `${value.slice(0, 48)}...${value.slice(-32)}`;
}

function guessMimeType(key: string, fromHead: string | null): string {
  if (fromHead && fromHead.trim()) {
    return fromHead.trim();
  }
  if (key.toLowerCase().endsWith(".flac")) return "audio/flac";
  if (key.toLowerCase().endsWith(".wav")) return "audio/wav";
  if (key.toLowerCase().endsWith(".mp3")) return "audio/mpeg";
  if (key.toLowerCase().endsWith(".ogg")) return "audio/ogg";
  return "application/octet-stream";
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function resolveFfprobeCommand(): string | null {
  const custom = process.env.FFPROBE_BIN?.trim();
  if (custom) {
    const check = spawnSync(custom, ["-version"], { encoding: "utf8" });
    if (!check.error && check.status === 0) return custom;
  }
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const resolved = spawnSync(lookup, ["ffprobe"], { encoding: "utf8" });
  if (resolved.error || resolved.status !== 0) return null;
  const first = resolved.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first ?? null;
}

function probeAudio(localFile: string): ProbeMetadata | null {
  const ffprobe = resolveFfprobeCommand();
  if (!ffprobe) return null;
  const result = spawnSync(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,sample_rate,channels:format=duration",
      "-of",
      "json",
      localFile,
    ],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as {
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        sample_rate?: string;
        channels?: number;
      }>;
      format?: { duration?: string };
    };
    const stream = (parsed.streams ?? []).find((item) => item.codec_type === "audio");
    return {
      codec: stream?.codec_name ?? null,
      sampleRateHz: stream?.sample_rate ? Number(stream.sample_rate) : null,
      channels: stream?.channels ?? null,
      durationSec: parsed.format?.duration ? Number(parsed.format.duration) : null,
    };
  } catch {
    return null;
  }
}

async function main() {
  const args = parseCli();
  const sessionId = args.sessionId?.trim();
  const objectKey = args.objectKey?.trim();
  const recordingAttemptId = args.recordingAttemptId?.trim();
  const dryRun = Boolean(args["dry-run"]);
  const execute = Boolean(args.execute);

  if (!sessionId) throw new Error("Missing --sessionId argument.");
  if (!objectKey) throw new Error("Missing --objectKey argument.");
  if (!recordingAttemptId) {
    throw new Error("Missing --recordingAttemptId argument.");
  }
  if (!dryRun && !execute) {
    throw new Error("Specify one mode: --dry-run or --execute.");
  }
  if (dryRun && execute) {
    throw new Error("Use either --dry-run or --execute, not both.");
  }

  const s3Config = getS3Config();
  if (!s3Config) throw new Error("S3 is not configured.");

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: {
      id: true,
      sessionId: true,
      provider: true,
      recordingAttemptId: true,
      status: true,
      recordingType: true,
      fileKey: true,
      fileUrl: true,
      mimeType: true,
      originalSizeBytes: true,
      errorMessage: true,
      startedAt: true,
      endedAt: true,
      updatedAt: true,
    },
  });

  if (!recording) {
    throw new Error(`Recording row not found for session ${sessionId}.`);
  }
  if (
    !recording.recordingAttemptId ||
    recording.recordingAttemptId !== recordingAttemptId
  ) {
    throw new Error(
      "Recording attempt mismatch. Legacy NULL rows are not recoverable.",
    );
  }
  if (
    recording.status !== RecordingStatus.FAILED ||
    recording.errorMessage !== RECORDING_STARTING_TIMEOUT_RECONCILED
  ) {
    throw new Error("Recording is not eligible for fenced timeout recovery.");
  }

  const client = getS3Client();
  let head:
    | {
        exists: true;
        contentLength: number | null;
        contentType: string | null;
        lastModified: string | null;
      }
    | {
        exists: false;
        errorCode: string;
        errorMessage: string;
      };

  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: s3Config.bucket, Key: objectKey }),
    );
    head = {
      exists: true,
      contentLength: response.ContentLength ?? null,
      contentType: response.ContentType ?? null,
      lastModified: response.LastModified?.toISOString() ?? null,
    };
  } catch (error) {
    const record = (error ?? {}) as Record<string, unknown>;
    head = {
      exists: false,
      errorCode: String(record.name ?? record.Code ?? "HEAD_FAILED"),
      errorMessage: String(record.message ?? "headObject failed"),
    };
  }

  let probe: ProbeMetadata | null = null;
  if (head.exists) {
    try {
      const getResp = await client.send(
        new GetObjectCommand({ Bucket: s3Config.bucket, Key: objectKey }),
      );
      const buffer = await streamToBuffer(getResp.Body);
      if (buffer.length > 0) {
        const tmpPath = path.join(
          os.tmpdir(),
          `recover-vox-${sessionId}-${Date.now()}.audio`,
        );
        await writeFile(tmpPath, buffer);
        probe = probeAudio(tmpPath);
        await rm(tmpPath, { force: true });
      }
    } catch {
      probe = null;
    }
  }

  const plannedUpdate = {
    fileKey: objectKey,
    fileUrl: null as string | null,
    mimeType: guessMimeType(objectKey, head.exists ? head.contentType : null),
    originalSizeBytes:
      head.exists && typeof head.contentLength === "number" && head.contentLength > 0
        ? head.contentLength
        : recording.originalSizeBytes,
    status: RecordingStatus.COMPLETED,
    errorMessage: null as string | null,
  };

  const report: Record<string, unknown> = {
    mode: dryRun ? "dry-run" : "execute",
    sessionId,
    recordingId: recording.id,
    recordingAttemptId,
    dbCurrent: {
      provider: recording.provider,
      status: recording.status,
      recordingType: recording.recordingType,
      fileKeyRedacted: redact(recording.fileKey),
      fileKeyMatchesProvided: recording.fileKey === objectKey,
      mimeType: recording.mimeType,
      originalSizeBytes: recording.originalSizeBytes,
      errorMessage: recording.errorMessage,
    },
    objectInput: {
      objectKeyRedacted: redact(objectKey),
      head,
      ffprobe: probe,
    },
    proposedUpdate: {
      ...plannedUpdate,
      fileKeyRedacted: redact(plannedUpdate.fileKey),
    },
    willTriggerTranscription: false,
    notes: [
      "Recording row repair only; transcript rows are not created here.",
      "Run existing transcription action after successful execute.",
    ],
  };

  if (!head.exists) {
    report.result = "blocked";
    report.reason = "Object does not exist, DB update skipped.";
  } else if (execute) {
    const mutation = await prisma.recording.updateMany({
      where: {
        id: recording.id,
        recordingAttemptId,
        status: RecordingStatus.FAILED,
        errorMessage: RECORDING_STARTING_TIMEOUT_RECONCILED,
      },
      data: plannedUpdate,
    });
    if (mutation.count !== 1) {
      throw new Error(
        "Recovery CAS rejected because the current recording attempt changed.",
      );
    }
    const updated = await prisma.recording.findUniqueOrThrow({
      where: { id: recording.id },
      select: {
        id: true,
        status: true,
        provider: true,
        recordingType: true,
        fileKey: true,
        mimeType: true,
        originalSizeBytes: true,
        errorMessage: true,
        startedAt: true,
        endedAt: true,
        updatedAt: true,
      },
    });

    const transcriptCount = await prisma.transcript.count({
      where: { sessionId },
    });
    const segmentCount = await prisma.transcriptSegment.count({
      where: {
        transcript: { sessionId },
      },
    });

    report.result = "updated";
    report.recordingAfterUpdate = {
      ...updated,
      fileKeyRedacted: redact(updated.fileKey),
    };
    report.transcriptionState = {
      transcriptCount,
      transcriptSegmentCount: segmentCount,
      readyForTranscriptionTrigger: true,
    };
  } else {
    report.result = "planned";
  }

  const output = JSON.stringify(report, null, 2);
  if (args.out?.trim()) {
    const outPath = path.resolve(args.out.trim());
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, output, "utf8");
  }

  console.log(output);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
