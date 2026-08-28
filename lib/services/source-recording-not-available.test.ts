import assert from "node:assert/strict";
import test from "node:test";

import { StorageObjectNotFoundError } from "@/lib/storage/s3";
import {
  SOURCE_RECORDING_NOT_AVAILABLE_CODE,
  SOURCE_RECORDING_NOT_AVAILABLE_ERROR,
  SourceRecordingNotAvailableError,
  isSourceRecordingNotAvailableError,
  isStrictStorageObjectMissingError,
  mapStorageReadToSourceUnavailable,
} from "@/lib/services/source-recording-not-available";

test("SourceRecordingNotAvailableError is identifiable by type guard and code", () => {
  const error = new SourceRecordingNotAvailableError();
  assert.equal(error.code, SOURCE_RECORDING_NOT_AVAILABLE_CODE);
  assert.equal(error.message, SOURCE_RECORDING_NOT_AVAILABLE_ERROR);
  assert.equal(isSourceRecordingNotAvailableError(error), true);
  assert.equal(
    isSourceRecordingNotAvailableError({
      name: "SourceRecordingNotAvailableError",
      code: SOURCE_RECORDING_NOT_AVAILABLE_CODE,
    }),
    true,
  );
  assert.equal(isSourceRecordingNotAvailableError(new Error("timeout")), false);
});

test("strict missing-object classifier accepts 404 / NoSuchKey / NotFound only", () => {
  assert.equal(
    isStrictStorageObjectMissingError({ name: "NoSuchKey" }),
    true,
  );
  assert.equal(
    isStrictStorageObjectMissingError({ Code: "NotFound" }),
    true,
  );
  assert.equal(
    isStrictStorageObjectMissingError({ $metadata: { httpStatusCode: 404 } }),
    true,
  );
  assert.equal(
    isStrictStorageObjectMissingError(new StorageObjectNotFoundError()),
    true,
  );
});

test("strict missing-object classifier rejects timeout, ENOTFOUND, and 5xx", () => {
  assert.equal(
    isStrictStorageObjectMissingError(new Error("getaddrinfo ENOTFOUND storage.example")),
    false,
  );
  assert.equal(
    isStrictStorageObjectMissingError({
      name: "TimeoutError",
      message: "Request timed out",
    }),
    false,
  );
  assert.equal(
    isStrictStorageObjectMissingError({
      name: "NetworkingError",
      $metadata: { httpStatusCode: 503 },
    }),
    false,
  );
  assert.equal(
    isStrictStorageObjectMissingError({
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403 },
    }),
    false,
  );
});

test("mapStorageReadToSourceUnavailable maps only proven absence", () => {
  const mapped = mapStorageReadToSourceUnavailable({ name: "NoSuchKey" });
  assert.ok(mapped);
  assert.equal(mapped.code, SOURCE_RECORDING_NOT_AVAILABLE_CODE);

  assert.equal(
    mapStorageReadToSourceUnavailable(new Error("socket hang up")),
    null,
  );
  assert.equal(
    mapStorageReadToSourceUnavailable({
      name: "TimeoutError",
      message: "Source not found yet",
    }),
    null,
  );
});
