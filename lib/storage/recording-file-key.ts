const KNOWN_PREFIXES = ["negotiation-room/audio/", "voximplant/audio/"];

export type RecordingFileKeyNormalizationResult = {
  normalizedKey: string;
  hadDuplicatePrefix: boolean;
  containsRawUrl: boolean;
  containsEncodedUrl: boolean;
  decodedUrlHost: string | null;
};

function sanitizeKey(rawKey: string): string {
  return rawKey.trim().replace(/^\/+/, "");
}

function stripBucketPrefix(key: string): string {
  const bucket = process.env.S3_BUCKET?.trim();
  if (bucket && key.startsWith(`${bucket}/`)) {
    return key.slice(bucket.length + 1);
  }
  return key;
}

function collapseDuplicatePrefix(key: string): {
  key: string;
  hadDuplicatePrefix: boolean;
} {
  let normalized = key;
  let hadDuplicatePrefix = false;

  for (const prefix of KNOWN_PREFIXES) {
    const doubled = `${prefix}${prefix}`;
    while (normalized.startsWith(doubled)) {
      normalized = `${prefix}${normalized.slice(doubled.length)}`;
      hadDuplicatePrefix = true;
    }
  }

  return { key: normalized, hadDuplicatePrefix };
}

function containsRawUrl(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes("https://") || lower.includes("http://");
}

function decodeBase64Url(segment: string): string | null {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function extractDecodedProviderUrl(
  key: string,
): { decodedHost: string | null; containsEncodedUrl: boolean } {
  const segments = key.split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment.length < 24 || !/^[A-Za-z0-9\-_=.]+$/.test(segment)) {
      continue;
    }
    const decoded = decodeBase64Url(segment);
    if (!decoded) {
      continue;
    }
    const lower = decoded.toLowerCase();
    if (!lower.includes("http://") && !lower.includes("https://")) {
      continue;
    }
    const hostMatch = decoded.match(/^https?:\/\/([^/?#]+)/i);
    return {
      containsEncodedUrl: true,
      decodedHost: hostMatch?.[1] ?? null,
    };
  }
  return { containsEncodedUrl: false, decodedHost: null };
}

export function normalizeRecordingFileKey(
  rawKey: string,
): RecordingFileKeyNormalizationResult {
  const sanitized = sanitizeKey(rawKey);
  const strippedBucket = stripBucketPrefix(sanitized);
  const duplicateResult = collapseDuplicatePrefix(strippedBucket);
  const encodedUrl = extractDecodedProviderUrl(duplicateResult.key);

  return {
    normalizedKey: duplicateResult.key,
    hadDuplicatePrefix: duplicateResult.hadDuplicatePrefix,
    containsRawUrl: containsRawUrl(duplicateResult.key),
    containsEncodedUrl: encodedUrl.containsEncodedUrl,
    decodedUrlHost: encodedUrl.decodedHost,
  };
}
