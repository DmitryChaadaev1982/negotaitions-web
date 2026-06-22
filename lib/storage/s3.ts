import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { ExternalService } from "@/app/generated/prisma/client";
import { handleExternalServiceFailure } from "@/lib/services/external-service-events";
import {
  trackStorageDownloadedBytes,
  trackStorageUploadedBytes,
} from "@/lib/services/usage-counters";

export type S3Config = {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

let cachedClient: S3Client | null = null;
let cachedConfig: S3Config | null = null;

export function getS3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const endpoint = process.env.S3_ENDPOINT?.trim() || "https://storage.yandexcloud.net";
  const region = process.env.S3_REGION?.trim() || "ru-central1";
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";

  if (!bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
  };
}

export function isS3Configured() {
  return getS3Config() !== null;
}

export function getS3Client(): S3Client {
  const config = getS3Config();
  if (!config) {
    throw new Error("S3 storage is not configured.");
  }

  if (cachedClient && cachedConfig === config) {
    return cachedClient;
  }

  cachedClient = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedConfig = config;

  return cachedClient;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === "object" && body !== null && "transformToByteArray" in body) {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function uploadBufferToS3(
  fileKey: string,
  buffer: Buffer,
  contentType: string,
  options?: { sessionId?: string; recordingId?: string },
) {
  const config = getS3Config();
  if (!config) {
    const classified = await handleExternalServiceFailure(
      ExternalService.YANDEX_OBJECT_STORAGE,
      new Error("S3 credentials missing"),
      { context: "upload", ...options },
    );
    throw new Error(classified.message);
  }

  try {
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: fileKey,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    await trackStorageUploadedBytes(buffer.length, fileKey);
    return { fileKey, sizeBytes: buffer.length };
  } catch (error) {
    const classified = await handleExternalServiceFailure(
      ExternalService.YANDEX_OBJECT_STORAGE,
      error,
      { context: "upload", ...options },
    );
    throw new Error(classified.message);
  }
}

export async function downloadObjectToBuffer(
  fileKey: string,
  options?: { sessionId?: string; recordingId?: string },
) {
  const config = getS3Config();
  if (!config) {
    const classified = await handleExternalServiceFailure(
      ExternalService.YANDEX_OBJECT_STORAGE,
      new Error("S3 credentials missing"),
      { context: "download", ...options },
    );
    throw new Error(classified.message);
  }

  try {
    const client = getS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: fileKey,
      }),
    );

    const buffer = await streamToBuffer(response.Body);
    await trackStorageDownloadedBytes(buffer.length, fileKey);
    return buffer;
  } catch (error) {
    const classified = await handleExternalServiceFailure(
      ExternalService.YANDEX_OBJECT_STORAGE,
      error,
      { context: "download", ...options },
    );
    throw new Error(classified.message);
  }
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const status = record.status ?? record.statusCode;
    if (typeof status === "number") {
      return status;
    }

    const metadata = record.$metadata as { httpStatusCode?: number } | undefined;
    if (metadata?.httpStatusCode) {
      return metadata.httpStatusCode;
    }
  }

  return undefined;
}

function isStorageObjectNotFoundError(error: unknown) {
  const status = getHttpStatus(error);
  if (status === 404) {
    return true;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const code = String(record.name ?? record.Code ?? record.code ?? "");
    if (code === "NotFound" || code === "NoSuchKey" || code === "404") {
      return true;
    }
  }

  const text = error instanceof Error ? error.message : String(error);
  return /not found|nosuchkey/i.test(text);
}

export async function headObject(fileKey: string) {
  const config = getS3Config();
  if (!config) {
    const classified = await handleExternalServiceFailure(
      ExternalService.YANDEX_OBJECT_STORAGE,
      new Error("S3 credentials missing"),
      { context: "head" },
    );
    throw new Error(classified.message);
  }

  try {
    const client = getS3Client();
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: fileKey,
      }),
    );

    return {
      exists: true,
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType ?? "application/octet-stream",
    };
  } catch (error) {
    if (isStorageObjectNotFoundError(error)) {
      return {
        exists: false,
        contentLength: 0,
        contentType: "application/octet-stream",
      };
    }

    const classified = await handleExternalServiceFailure(
      ExternalService.YANDEX_OBJECT_STORAGE,
      error,
      { context: "head" },
    );
    throw new Error(classified.message);
  }
}

export async function deleteObjectIfPossible(fileKey: string) {
  const config = getS3Config();
  if (!config) {
    return false;
  }

  try {
    const client = getS3Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: fileKey,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function checkStorageHealth() {
  const config = getS3Config();
  if (!config) {
    return {
      ok: false,
      message: "S3 storage is not configured.",
    };
  }

  const testKey = `diagnostics/${Date.now()}-test.txt`;
  const testContent = Buffer.from("NegotAItions storage health check", "utf-8");

  try {
    await uploadBufferToS3(testKey, testContent, "text/plain");
    const downloaded = await downloadObjectToBuffer(testKey);
    const matches = downloaded.toString("utf-8") === testContent.toString("utf-8");

    await deleteObjectIfPossible(testKey);

    return {
      ok: matches,
      message: matches
        ? "Yandex Object Storage read/write check passed."
        : "Downloaded test object content did not match.",
      testKey,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Storage health check failed.",
    };
  }
}

export function buildRecordingFileKey(sessionId: string, timestamp: number) {
  return `recordings/${sessionId}/${timestamp}-audio.mp4`;
}

export function buildCompressedFileKey(
  sessionId: string,
  timestamp: number,
  extension: "webm" | "mp3",
) {
  return `recordings/${sessionId}/compressed/${timestamp}-transcription.${extension}`;
}
