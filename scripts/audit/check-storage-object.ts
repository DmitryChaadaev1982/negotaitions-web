import { loadEnvConfig } from "@next/env";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { getS3Client, getS3Config } from "@/lib/storage/s3";

loadEnvConfig(process.cwd());

type CliValues = {
  sessionId?: string;
  key?: string;
  out?: string;
};

function parseCli(): CliValues {
  const parsed = parseArgs({
    options: {
      sessionId: { type: "string" },
      key: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  return parsed.values as CliValues;
}

function sanitizeStorageError(error: unknown): {
  code: string;
  message: string;
  statusCode: number | null;
} {
  const record = (error ?? {}) as Record<string, unknown>;
  const code = String(record.name ?? record.Code ?? record.code ?? "UNKNOWN_ERROR");
  const message = String(record.message ?? "Storage operation failed.");
  const meta = record.$metadata as { httpStatusCode?: number } | undefined;
  return {
    code,
    message,
    statusCode: meta?.httpStatusCode ?? null,
  };
}

async function main() {
  const args = parseCli();
  const key = args.key?.trim();
  if (!key) {
    throw new Error("Missing --key argument.");
  }

  const s3Config = getS3Config();
  if (!s3Config) {
    throw new Error("S3 is not configured.");
  }

  const recording =
    args.sessionId?.trim()
      ? await prisma.recording.findUnique({
          where: { sessionId: args.sessionId.trim() },
          select: {
            id: true,
            sessionId: true,
            provider: true,
            status: true,
            fileKey: true,
          },
        })
      : null;

  const report = {
    sessionId: args.sessionId ?? null,
    requestedKey: key,
    recording: recording ?? null,
    object: {
      exists: false,
      contentLength: null as number | null,
      contentType: null as string | null,
      lastModified: null as string | null,
      error: null as ReturnType<typeof sanitizeStorageError> | null,
    },
  };

  try {
    const client = getS3Client();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: s3Config.bucket,
        Key: key,
      }),
    );
    report.object.exists = true;
    report.object.contentLength = head.ContentLength ?? null;
    report.object.contentType = head.ContentType ?? null;
    report.object.lastModified = head.LastModified?.toISOString() ?? null;
  } catch (error) {
    report.object.error = sanitizeStorageError(error);
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
