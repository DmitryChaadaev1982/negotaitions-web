import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

import {
  isTrustedProxyEnabled,
  TRUSTED_CLIENT_IP_HEADER,
} from "@/lib/auth/trusted-proxy";

/**
 * Central client-IP identity helper.
 *
 * Trust assumptions:
 * - Direct local development: TRUSTED_PROXY_ENABLED is unset/false. No
 *   forwarding header is trusted; identity collapses to the unknown bucket.
 * - Production / reverse-tunnel after nginx activation: TRUSTED_PROXY_ENABLED=true
 *   and nginx overwrites X-NegotAItions-Client-IP from $remote_addr.
 * - Arbitrary X-Forwarded-For / X-Real-IP / Forwarded / CF-Connecting-IP /
 *   True-Client-IP values are never read.
 */

export const UNKNOWN_CLIENT_IP_BUCKET = "unknown";

export type ClientIpSource = "trusted-header" | "unknown";

export type TrustedClientIdentity = {
  /** HMAC-SHA-256 fingerprint. Never log the underlying IP. */
  fingerprint: string;
  source: ClientIpSource;
};

const FALLBACK_HMAC_KEY = randomBytes(32);
const IPV4_MAPPED_PREFIX = "::ffff:";

function hmacKey(secret?: string | null): string | Buffer {
  const trimmed = secret?.trim();
  return trimmed || FALLBACK_HMAC_KEY;
}

export function fingerprintClientIpValue(
  value: string,
  secret?: string | null,
): string {
  return createHmac("sha256", hmacKey(secret)).update(value).digest("hex");
}

/**
 * Normalize a single IP literal.
 * Rejects hostnames, ports, whitespace, and comma-separated lists.
 */
export function normalizeClientIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[\s,]/.test(trimmed)) return null;
  if (trimmed.includes("%")) return null;

  let candidate = trimmed;
  if (candidate.startsWith("[") && candidate.endsWith("]")) {
    candidate = candidate.slice(1, -1).trim();
  }

  // Reject host:port and [ipv6]:port forms.
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) return null;
  if (candidate.includes("]:")) return null;

  const family = isIP(candidate);
  if (family === 4) return candidate;
  if (family !== 6) return null;

  const lower = candidate.toLowerCase();
  if (lower.startsWith(IPV4_MAPPED_PREFIX)) {
    const mapped = lower.slice(IPV4_MAPPED_PREFIX.length);
    if (isIP(mapped) === 4) return mapped;
  }
  return lower;
}

function readTrustedHeader(headers: Headers): string | null {
  const raw = headers.get(TRUSTED_CLIENT_IP_HEADER);
  if (raw == null) return null;
  if (raw.includes(",")) return null;
  return normalizeClientIp(raw);
}

export function getTrustedClientIdentity(
  headers: Headers,
  options?: {
    env?: Record<string, string | undefined>;
    hmacSecret?: string | null;
  },
): TrustedClientIdentity {
  const env = options?.env ?? process.env;
  const secret = options?.hmacSecret ?? env.AUTH_SECRET;

  let trustedEnabled = false;
  try {
    trustedEnabled = isTrustedProxyEnabled(env);
  } catch {
    return {
      fingerprint: fingerprintClientIpValue(UNKNOWN_CLIENT_IP_BUCKET, secret),
      source: "unknown",
    };
  }

  if (!trustedEnabled) {
    return {
      fingerprint: fingerprintClientIpValue(UNKNOWN_CLIENT_IP_BUCKET, secret),
      source: "unknown",
    };
  }

  const normalized = readTrustedHeader(headers);
  if (!normalized) {
    return {
      fingerprint: fingerprintClientIpValue(UNKNOWN_CLIENT_IP_BUCKET, secret),
      source: "unknown",
    };
  }

  return {
    fingerprint: fingerprintClientIpValue(normalized, secret),
    source: "trusted-header",
  };
}

/** Truncated fingerprint suitable for short consent/audit columns. */
export function shortClientIpFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, 16);
}
