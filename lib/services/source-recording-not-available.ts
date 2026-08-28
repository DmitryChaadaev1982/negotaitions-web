export const SOURCE_RECORDING_NOT_AVAILABLE_CODE =
  "SOURCE_RECORDING_NOT_AVAILABLE";

export const SOURCE_RECORDING_NOT_AVAILABLE_ERROR =
  "The original recording file is unavailable, so retranscription cannot be started. The saved transcript and AI analysis remain available.";

export const UNSAFE_RECORDING_FILE_KEY_MESSAGE =
  "Запись сохранена у провайдера, но файл ещё не загружен в хранилище";

export class SourceRecordingNotAvailableError extends Error {
  readonly code = SOURCE_RECORDING_NOT_AVAILABLE_CODE;

  constructor(message = SOURCE_RECORDING_NOT_AVAILABLE_ERROR) {
    super(message);
    this.name = "SourceRecordingNotAvailableError";
  }
}

export class UnsafeRecordingFileKeyError extends Error {
  readonly code = "UNSAFE_RECORDING_FILE_KEY";

  constructor(message = UNSAFE_RECORDING_FILE_KEY_MESSAGE) {
    super(message);
    this.name = "UnsafeRecordingFileKeyError";
  }
}

export function isSourceRecordingNotAvailableError(
  error: unknown,
): error is SourceRecordingNotAvailableError {
  if (error instanceof SourceRecordingNotAvailableError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as { name?: unknown; code?: unknown };
  return (
    record.name === "SourceRecordingNotAvailableError" ||
    record.code === SOURCE_RECORDING_NOT_AVAILABLE_CODE
  );
}

export function isUnsafeRecordingFileKeyError(
  error: unknown,
): error is UnsafeRecordingFileKeyError {
  if (error instanceof UnsafeRecordingFileKeyError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as { name?: unknown; code?: unknown };
  return (
    record.name === "UnsafeRecordingFileKeyError" ||
    record.code === "UNSAFE_RECORDING_FILE_KEY"
  );
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const status = record.status ?? record.statusCode;
  if (typeof status === "number") {
    return status;
  }
  const metadata = record.$metadata as { httpStatusCode?: number } | undefined;
  if (typeof metadata?.httpStatusCode === "number") {
    return metadata.httpStatusCode;
  }
  return undefined;
}

/**
 * Strict missing-object classifier. Only HTTP 404 / NoSuchKey / NotFound.
 * Does not treat ENOTFOUND, timeouts, or generic "not found" text as absence.
 */
export function isStrictStorageObjectMissingError(error: unknown): boolean {
  if (isSourceRecordingNotAvailableError(error)) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  if (
    record.name === "StorageObjectNotFoundError" ||
    record.name === "SourceRecordingNotAvailableError"
  ) {
    return true;
  }
  if (getHttpStatus(error) === 404) {
    return true;
  }
  const code = String(record.Code ?? record.code ?? record.name ?? "");
  return code === "NotFound" || code === "NoSuchKey" || code === "404";
}

export function mapStorageReadToSourceUnavailable(
  error: unknown,
): SourceRecordingNotAvailableError | null {
  if (isSourceRecordingNotAvailableError(error)) {
    return error;
  }
  if (isStrictStorageObjectMissingError(error)) {
    return new SourceRecordingNotAvailableError();
  }
  return null;
}

export function sourceRecordingNotAvailableBody(): {
  error: string;
  code: typeof SOURCE_RECORDING_NOT_AVAILABLE_CODE;
} {
  return {
    error: SOURCE_RECORDING_NOT_AVAILABLE_ERROR,
    code: SOURCE_RECORDING_NOT_AVAILABLE_CODE,
  };
}
