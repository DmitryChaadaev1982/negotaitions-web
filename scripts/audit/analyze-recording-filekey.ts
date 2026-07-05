import { loadEnvConfig } from "@next/env";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { normalizeRecordingFileKey } from "@/lib/storage/recording-file-key";
import { getS3Client, getS3Config } from "@/lib/storage/s3";

loadEnvConfig(process.cwd());

type CliValues = {
  sessionId?: string;
  out?: string;
};

function parseCli(): CliValues {
  const parsed = parseArgs({
    options: {
      sessionId: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  return parsed.values as CliValues;
}

function redactKey(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 96) return value;
  return `${value.slice(0, 48)}...${value.slice(-32)}`;
}

async function checkObject(key: string | null) {
  if (!key) {
    return { key: null, exists: false, reason: "empty_key" } as const;
  }
  const config = getS3Config();
  if (!config) {
    return { key, exists: false, reason: "s3_not_configured" } as const;
  }
  try {
    const client = getS3Client();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
    return {
      key,
      exists: true,
      contentLength: head.ContentLength ?? null,
      contentType: head.ContentType ?? null,
      lastModified: head.LastModified?.toISOString() ?? null,
    } as const;
  } catch (error) {
    const record = (error ?? {}) as Record<string, unknown>;
    return {
      key,
      exists: false,
      reason: String(record.name ?? record.Code ?? "head_failed"),
    } as const;
  }
}

async function main() {
  const args = parseCli();
  const sessionId = args.sessionId?.trim();
  if (!sessionId) {
    throw new Error("Missing --sessionId argument.");
  }

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: {
      id: true,
      sessionId: true,
      provider: true,
      status: true,
      fileKey: true,
      fileName: true,
      startedAt: true,
      endedAt: true,
      errorMessage: true,
    },
  });

  if (!recording) {
    throw new Error(`Recording not found for session ${sessionId}.`);
  }

  const normalization = recording.fileKey
    ? normalizeRecordingFileKey(recording.fileKey)
    : null;

  const currentObject = await checkObject(recording.fileKey);
  const normalizedObject = await checkObject(normalization?.normalizedKey ?? null);

  const report = {
    sessionId,
    recordingId: recording.id,
    provider: recording.provider,
    status: recording.status,
    fileKeyRedacted: redactKey(recording.fileKey),
    fileKeyLength: recording.fileKey?.length ?? 0,
    normalization: normalization
      ? {
          normalizedKeyRedacted: redactKey(normalization.normalizedKey),
          hadDuplicatePrefix: normalization.hadDuplicatePrefix,
          containsRawUrl: normalization.containsRawUrl,
          containsEncodedUrl: normalization.containsEncodedUrl,
          decodedUrlHost: normalization.decodedUrlHost,
          likelyRecoverableVoxSource:
            normalization.containsEncodedUrl &&
            Boolean(normalization.decodedUrlHost?.includes("voximplant.com")),
        }
      : null,
    objectChecks: {
      currentFileKey: {
        ...currentObject,
        key: redactKey(currentObject.key),
      },
      normalizedFileKey: {
        ...normalizedObject,
        key: redactKey(normalizedObject.key),
      },
    },
  };

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
