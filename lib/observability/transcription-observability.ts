import type { NormalizedSegment } from "@/lib/transcription/speaker-labels";

/**
 * Stage-1 transcription observability helpers.
 *
 * Goal: make future phrase-loss / quality debugging possible by capturing a
 * sanitized, bounded snapshot of the provider response, a set of transcript
 * quality counters/warnings, and a stable structured run log.
 *
 * Safety: never persist secrets, tokens, signed URLs, or raw audio (base64).
 * The raw SpeechKit `getRecognition` response contains only recognized text /
 * words / timestamps / confidence — no credentials — but we still strip any
 * base64 `content` field and cap the serialized size defensively.
 */

/** Max serialized bytes of a raw provider snapshot stored in processingMetadata. */
const RAW_SNAPSHOT_MAX_BYTES = 256 * 1024;

const SNAPSHOT_STRIP_KEYS = new Set([
  "content",
  "audio",
  "audiocontent",
  "audio_content",
  "authorization",
  "api-key",
  "apikey",
  "x-api-key",
  "token",
  "iamtoken",
  "iam_token",
  "secret",
  // Audio locations may be presigned S3 URLs — never persist them.
  "uri",
  "url",
  "audiouri",
  "audio_uri",
  "audiourl",
  "audio_url",
  "presignedurl",
  "signedurl",
]);

/** Redact strings that look like presigned/signed URLs or auth-bearing links. */
function looksLikeSignedUrl(value: string): boolean {
  if (value.length > 2048) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  return /(x-amz-|[?&](signature|sig|awsaccesskeyid|x-amz-credential|token)=)/i.test(
    value,
  );
}

/** Recursively strip large/secret fields (base64 audio, auth, signed URLs). */
function stripSnapshotValue(value: unknown, depth: number): unknown {
  if (depth > 12) return "[TRUNCATED_DEPTH]";
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => stripSnapshotValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SNAPSHOT_STRIP_KEYS.has(key.toLowerCase())) {
        out[key] = "[STRIPPED]";
        continue;
      }
      out[key] = stripSnapshotValue(val, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    if (looksLikeSignedUrl(value)) {
      return "[STRIPPED_URL]";
    }
    if (value.length > 4000) {
      return `${value.slice(0, 4000)}…[+${value.length - 4000} chars]`;
    }
  }
  return value;
}

export type SanitizedRawSnapshot = {
  snapshot: unknown;
  sizeBytes: number;
  truncated: boolean;
  capturedAt: string;
};

/**
 * Produce a sanitized, size-bounded raw provider snapshot suitable for storage
 * in `Transcript.processingMetadata`. Returns null when nothing was captured.
 */
export function sanitizeRawProviderSnapshot(
  raw: unknown,
): SanitizedRawSnapshot | null {
  if (raw === null || raw === undefined) return null;
  const stripped = stripSnapshotValue(raw, 0);
  let serialized = "";
  try {
    serialized = JSON.stringify(stripped);
  } catch {
    return null;
  }
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  if (sizeBytes <= RAW_SNAPSHOT_MAX_BYTES) {
    return {
      snapshot: stripped,
      sizeBytes,
      truncated: false,
      capturedAt: new Date().toISOString(),
    };
  }
  return {
    snapshot: {
      note: "raw_provider_snapshot_truncated",
      preview: serialized.slice(0, RAW_SNAPSHOT_MAX_BYTES),
    },
    sizeBytes,
    truncated: true,
    capturedAt: new Date().toISOString(),
  };
}

export type TranscriptQualityWarning =
  | "low_sample_rate"
  | "mono_source"
  | "no_raw_provider_snapshot"
  | "no_speaker_activity"
  | "low_confidence"
  | "suspiciously_short_transcript";

export type TranscriptQualityReport = {
  totalSegments: number;
  emptySegments: number;
  averageConfidence: number | null;
  lowConfidenceSegments: number | null;
  speakerCount: number;
  transcriptChars: number;
  transcriptWords: number;
  durationSeconds: number | null;
  charsPerMinute: number | null;
  wordsPerMinute: number | null;
  warnings: TranscriptQualityWarning[];
  computedAt: string;
};

const NEAR_EMPTY_CHAR_THRESHOLD = 2;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const LOW_AVG_CONFIDENCE_THRESHOLD = 0.6;
const SHORT_TRANSCRIPT_CHAR_THRESHOLD = 40;
const LOW_SAMPLE_RATE_HZ = 16000;

export type ComputeQualityInput = {
  segments: NormalizedSegment[];
  text: string;
  durationSeconds: number | null;
  /** Actual source sample rate if known (from ffprobe/metadata); else null. */
  sourceSampleRate: number | null;
  /** Actual source channel count if known; else null. */
  sourceChannels: number | null;
  hasRawProviderSnapshot: boolean;
  hasSpeakerActivity: boolean;
};

/** Compute transcript quality counters + warning flags (pure, testable). */
export function computeTranscriptQualityReport(
  input: ComputeQualityInput,
): TranscriptQualityReport {
  const { segments, text } = input;
  const totalSegments = segments.length;

  let emptySegments = 0;
  const confidences: number[] = [];
  let lowConfidenceSegments = 0;
  const speakers = new Set<string>();

  for (const segment of segments) {
    if (segment.text.trim().length <= NEAR_EMPTY_CHAR_THRESHOLD) {
      emptySegments += 1;
    }
    if (segment.speakerLabel) {
      speakers.add(segment.speakerLabel);
    }
    if (typeof segment.confidence === "number" && Number.isFinite(segment.confidence)) {
      confidences.push(segment.confidence);
      if (segment.confidence < LOW_CONFIDENCE_THRESHOLD) {
        lowConfidenceSegments += 1;
      }
    }
  }

  const averageConfidence =
    confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : null;

  const transcriptChars = text.trim().length;
  const transcriptWords = text.trim().length
    ? text.trim().split(/\s+/).filter(Boolean).length
    : 0;

  const durationSeconds =
    input.durationSeconds && input.durationSeconds > 0
      ? input.durationSeconds
      : null;
  const minutes = durationSeconds ? durationSeconds / 60 : null;
  const charsPerMinute = minutes ? Math.round(transcriptChars / minutes) : null;
  const wordsPerMinute = minutes ? Math.round(transcriptWords / minutes) : null;

  const warnings: TranscriptQualityWarning[] = [];
  if (input.sourceSampleRate !== null && input.sourceSampleRate <= LOW_SAMPLE_RATE_HZ) {
    warnings.push("low_sample_rate");
  }
  if (input.sourceChannels !== null && input.sourceChannels <= 1) {
    warnings.push("mono_source");
  }
  if (!input.hasRawProviderSnapshot) {
    warnings.push("no_raw_provider_snapshot");
  }
  if (!input.hasSpeakerActivity) {
    warnings.push("no_speaker_activity");
  }
  if (
    (averageConfidence !== null && averageConfidence < LOW_AVG_CONFIDENCE_THRESHOLD) ||
    (confidences.length > 0 && lowConfidenceSegments / confidences.length > 0.3)
  ) {
    warnings.push("low_confidence");
  }
  if (transcriptChars < SHORT_TRANSCRIPT_CHAR_THRESHOLD) {
    warnings.push("suspiciously_short_transcript");
  }

  return {
    totalSegments,
    emptySegments,
    averageConfidence,
    lowConfidenceSegments: confidences.length > 0 ? lowConfidenceSegments : null,
    speakerCount: speakers.size,
    transcriptChars,
    transcriptWords,
    durationSeconds,
    charsPerMinute,
    wordsPerMinute,
    warnings,
    computedAt: new Date().toISOString(),
  };
}

export type PreprocessingDecisionLog = {
  originalSizeBytes: number;
  thresholdBytes: number;
  mimeType: string | null;
  container: string | null;
  compatibleContainer: boolean;
  skipped: boolean;
  reason: string;
  outputCodec: string | null;
  outputFormat: string | null;
};

export type TranscriptionRunLog = {
  event: "transcription_run";
  sessionId: string;
  recordingId: string | null;
  transcriptId: string;
  provider: string;
  sourceFile: {
    fileName: string | null;
    mimeType: string | null;
    originalSizeBytes: number | null;
    compressedSizeBytes: number | null;
    codecUsed: string | null;
    sourceContainer?: string | null;
    sourceCodec?: string | null;
    sourceSampleRate?: number | null;
    sourceChannels?: number | null;
    sourceProbeAvailable?: boolean;
  };
  preprocessing: PreprocessingDecisionLog | null;
  speechkitRequestMode: string | null;
  diarizationEnabled: boolean | null;
  diarizationStatus: string | null;
  rawResultCount: number | null;
  normalizedSegmentCount: number;
  transcriptChars: number;
  speakerLabelCount: number;
  mappingStatus: string | null;
  aiAnalysisReady: boolean | null;
  rawProviderSnapshotStored: boolean;
  qualityWarnings: string[];
};

/**
 * Emit a single structured, stable, secret-free log line for a transcription run.
 * Uses a `[transcription-run]` prefix so it is greppable in server logs.
 */
export function logTranscriptionRun(log: TranscriptionRunLog): void {
  try {
    console.info(`[transcription-run] ${JSON.stringify(log)}`);
  } catch {
    console.info(
      `[transcription-run] sessionId=${log.sessionId} transcriptId=${log.transcriptId} ` +
        `provider=${log.provider} segments=${log.normalizedSegmentCount} chars=${log.transcriptChars}`,
    );
  }
}
