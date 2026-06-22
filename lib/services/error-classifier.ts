import {
  ExternalService,
  ExternalServiceErrorCode,
  ExternalServiceEventSeverity,
} from "@/app/generated/prisma/client";

export type ClassifiedError = {
  service: ExternalService;
  severity: ExternalServiceEventSeverity;
  errorCode: ExternalServiceErrorCode;
  title: string;
  message: string;
  rawError: unknown;
};

function normalizeErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const status = record.status ?? record.statusCode ?? record.$metadata;
    const message =
      record.message ??
      record.error ??
      record.code ??
      (typeof record.body === "string" ? record.body : undefined);

    return [status, message].filter(Boolean).join(" ");
  }

  return String(error);
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

function containsAny(text: string, patterns: string[]) {
  const lower = text.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

function classifyLiveKitError(error: unknown, context?: string): ClassifiedError {
  const text = normalizeErrorText(error);
  const status = getHttpStatus(error);

  let errorCode: ExternalServiceErrorCode = ExternalServiceErrorCode.UNKNOWN;
  const severity = ExternalServiceEventSeverity.ERROR;
  let title = "LiveKit Egress error";
  let message = text || "An unexpected LiveKit error occurred.";

  if (containsAny(text, ["quota", "limit", "allowance"])) {
    errorCode = ExternalServiceErrorCode.QUOTA_EXCEEDED;
    message = "LiveKit Egress quota may have been reached. Check your LiveKit Cloud plan.";
    title = "LiveKit Egress quota exceeded";
  } else if (containsAny(text, ["billing", "payment", "invoice"])) {
    errorCode = ExternalServiceErrorCode.BILLING_LIMIT;
    message = "LiveKit billing or payment limit may have been reached.";
    title = "LiveKit billing limit";
  } else if (status === 401) {
    errorCode = ExternalServiceErrorCode.AUTH_ERROR;
    message = "LiveKit authentication failed. Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET.";
    title = "LiveKit authentication error";
  } else if (status === 403) {
    errorCode = ExternalServiceErrorCode.PERMISSION_DENIED;
    message = "LiveKit permission denied for this operation.";
    title = "LiveKit permission denied";
  } else if (context === "start") {
    errorCode = ExternalServiceErrorCode.RECORDING_START_FAILED;
    message = text || "Failed to start LiveKit audio recording.";
    title = "Recording start failed";
  } else if (context === "stop") {
    errorCode = ExternalServiceErrorCode.RECORDING_STOP_FAILED;
    message = text || "Failed to stop LiveKit recording.";
    title = "Recording stop failed";
  } else if (context === "status") {
    errorCode = ExternalServiceErrorCode.RECORDING_STATUS_FAILED;
    message = text || "Failed to refresh LiveKit recording status.";
    title = "Recording status check failed";
  }

  return {
    service: ExternalService.LIVEKIT,
    severity,
    errorCode,
    title,
    message,
    rawError: sanitizeRawError(error),
  };
}

function classifyOpenAIError(error: unknown, context?: string): ClassifiedError {
  const text = normalizeErrorText(error);
  const status = getHttpStatus(error);

  let errorCode: ExternalServiceErrorCode = ExternalServiceErrorCode.TRANSCRIPTION_FAILED;
  const severity = ExternalServiceEventSeverity.ERROR;
  let title = "OpenAI transcription error";
  let message = text || "OpenAI transcription failed.";

  if (containsAny(text, ["api key", "api_key", "authorization"]) || status === 401) {
    errorCode = ExternalServiceErrorCode.AUTH_ERROR;
    message = "OpenAI API key is missing or invalid.";
    title = "OpenAI authentication error";
  } else if (
    status === 429 &&
    containsAny(text, ["quota", "billing", "insufficient"])
  ) {
    errorCode = containsAny(text, ["billing", "payment"])
      ? ExternalServiceErrorCode.BILLING_LIMIT
      : ExternalServiceErrorCode.QUOTA_EXCEEDED;
    message = "OpenAI quota or billing limit may have been reached.";
    title = "OpenAI quota or billing limit";
  } else if (status === 429) {
    errorCode = ExternalServiceErrorCode.RATE_LIMIT;
    message = "OpenAI rate limit reached. Try again later.";
    title = "OpenAI rate limit";
  } else if (context === "file_too_large" || containsAny(text, ["too large", "maximum"])) {
    errorCode = ExternalServiceErrorCode.TRANSCRIPTION_FILE_TOO_LARGE;
    message =
      "Recording is still too large for transcription after compression. Please use a shorter session or enable chunking.";
    title = "Transcription file too large";
  } else if (containsAny(text, ["openai_api_key", "config"])) {
    errorCode = ExternalServiceErrorCode.CONFIG_MISSING;
    message = "OpenAI API key is not configured.";
    title = "OpenAI configuration missing";
  }

  return {
    service: ExternalService.OPENAI,
    severity,
    errorCode,
    title,
    message,
    rawError: sanitizeRawError(error),
  };
}

function classifyStorageError(error: unknown, context?: "upload" | "download" | "head"): ClassifiedError {
  const text = normalizeErrorText(error);
  const status = getHttpStatus(error);
  const code =
    typeof error === "object" && error !== null
      ? String((error as Record<string, unknown>).Code ?? (error as Record<string, unknown>).name ?? "")
      : "";

  let errorCode: ExternalServiceErrorCode = ExternalServiceErrorCode.UNKNOWN;
  const severity = ExternalServiceEventSeverity.ERROR;
  let title = "Yandex Object Storage error";
  let message = text || "Object storage operation failed.";

  if (
    containsAny(text, ["credentials", "access key", "secret"]) &&
    containsAny(text, ["missing", "not set", "undefined"])
  ) {
    errorCode = ExternalServiceErrorCode.CONFIG_MISSING;
    message = "S3 storage is not configured.";
    title = "Storage configuration missing";
  } else if (status === 403 || code === "AccessDenied") {
    errorCode = ExternalServiceErrorCode.PERMISSION_DENIED;
    message = "Yandex Object Storage access denied.";
    title = "Storage access denied";
  } else if (status === 404 || code === "NoSuchKey" || code === "NotFound") {
    errorCode = ExternalServiceErrorCode.STORAGE_OBJECT_NOT_FOUND;
    message = "Yandex Object Storage object not found.";
    title = "Storage object not found";
  } else if (context === "upload") {
    errorCode = ExternalServiceErrorCode.STORAGE_UPLOAD_FAILED;
    message = text || "Failed to upload to Yandex Object Storage.";
    title = "Storage upload failed";
  } else if (context === "download") {
    errorCode = ExternalServiceErrorCode.STORAGE_DOWNLOAD_FAILED;
    message = text || "Failed to download from Yandex Object Storage.";
    title = "Storage download failed";
  } else if (containsAny(text, ["endpoint", "region", "ENOTFOUND", "ECONNREFUSED"])) {
    errorCode = containsAny(text, ["endpoint", "region"])
      ? ExternalServiceErrorCode.CONFIG_MISSING
      : ExternalServiceErrorCode.NETWORK_ERROR;
    message = text || "Storage network or configuration error.";
    title = "Storage configuration or network error";
  }

  return {
    service: ExternalService.YANDEX_OBJECT_STORAGE,
    severity,
    errorCode,
    title,
    message,
    rawError: sanitizeRawError(error),
  };
}

function classifyFfmpegError(error: unknown): ClassifiedError {
  const text = normalizeErrorText(error);

  const isMissing =
    containsAny(text, ["ffmpeg", "enoent", "not found"]) &&
    containsAny(text, ["spawn", "enoent", "missing", "cannot find"]);

  return {
    service: ExternalService.FFMPEG,
    severity: ExternalServiceEventSeverity.ERROR,
    errorCode: isMissing
      ? ExternalServiceErrorCode.FFMPEG_MISSING
      : ExternalServiceErrorCode.COMPRESSION_FAILED,
    title: isMissing ? "ffmpeg not available" : "Audio compression failed",
    message: isMissing
      ? "ffmpeg is not available on the server."
      : text || "Audio compression failed.",
    rawError: sanitizeRawError(error),
  };
}

function classifyAppError(error: unknown): ClassifiedError {
  const text = normalizeErrorText(error);

  return {
    service: ExternalService.APP,
    severity: ExternalServiceEventSeverity.ERROR,
    errorCode: ExternalServiceErrorCode.CONFIG_MISSING,
    title: "Application configuration error",
    message: text || "Application configuration error.",
    rawError: sanitizeRawError(error),
  };
}

function sanitizeRawError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    };
  }

  if (typeof error === "object" && error !== null) {
    const record = { ...(error as Record<string, unknown>) };
    for (const key of ["accessKey", "secret", "access_key", "secretAccessKey", "authorization"]) {
      if (key in record) {
        record[key] = "[REDACTED]";
      }
    }
    return record;
  }

  return String(error);
}

export function classifyExternalServiceError(
  service: ExternalService,
  error: unknown,
  context?: string,
): ClassifiedError {
  switch (service) {
    case ExternalService.LIVEKIT:
      return classifyLiveKitError(error, context);
    case ExternalService.OPENAI:
      return classifyOpenAIError(error, context);
    case ExternalService.YANDEX_OBJECT_STORAGE:
      return classifyStorageError(
        error,
        context as "upload" | "download" | "head" | undefined,
      );
    case ExternalService.FFMPEG:
      return classifyFfmpegError(error);
    case ExternalService.APP:
      return classifyAppError(error);
    default:
      return {
        service,
        severity: ExternalServiceEventSeverity.ERROR,
        errorCode: ExternalServiceErrorCode.UNKNOWN,
        title: "External service error",
        message: normalizeErrorText(error) || "An unexpected error occurred.",
        rawError: sanitizeRawError(error),
      };
  }
}
