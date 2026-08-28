import {
  mapStorageReadToSourceUnavailable,
  SourceRecordingNotAvailableError,
  UnsafeRecordingFileKeyError,
} from "@/lib/services/source-recording-not-available";
import { normalizeRecordingFileKey } from "@/lib/storage/recording-file-key";
import { getObjectBuffer } from "@/lib/storage/s3";

export type PreloadedRecordingSource = {
  fileKey: string;
  buffer: Buffer;
};

export type RecordingSourceDownload = (fileKey: string) => Promise<Buffer>;

export async function preloadRecordingSource(input: {
  fileKey: string | null | undefined;
  download?: RecordingSourceDownload;
}): Promise<PreloadedRecordingSource> {
  if (!input.fileKey?.trim()) {
    throw new SourceRecordingNotAvailableError();
  }

  const normalization = normalizeRecordingFileKey(input.fileKey);
  if (normalization.containsRawUrl || normalization.containsEncodedUrl) {
    throw new UnsafeRecordingFileKeyError();
  }

  const download = input.download ?? getObjectBuffer;
  try {
    const buffer = await download(normalization.normalizedKey);
    return {
      fileKey: normalization.normalizedKey,
      buffer,
    };
  } catch (error) {
    const unavailable = mapStorageReadToSourceUnavailable(error);
    if (unavailable) {
      throw unavailable;
    }
    throw error;
  }
}

export async function resolveTranscriptionRecordingSource(input: {
  recordingFileKey: string;
  preloaded?: PreloadedRecordingSource | null;
  load?: typeof preloadRecordingSource;
}): Promise<{ source: PreloadedRecordingSource; reusedPreloaded: boolean }> {
  if (input.preloaded) {
    return { source: input.preloaded, reusedPreloaded: true };
  }
  const load = input.load ?? preloadRecordingSource;
  return {
    source: await load({ fileKey: input.recordingFileKey }),
    reusedPreloaded: false,
  };
}
