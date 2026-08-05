import { isTrustedProxyEnabled } from "@/lib/auth/trusted-proxy";

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function headerOrigin(request: Request): string | null {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(request.headers.get("host"));
  if (!host || /[\s/@\\]/.test(host)) return null;

  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const requestProtocol = new URL(request.url).protocol.replace(":", "");
  const protocol = forwardedProto ?? requestProtocol;
  if (protocol !== "http" && protocol !== "https") return null;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Same-origin check for mutating auth/admin endpoints.
 *
 * Direct request.url origin is always a candidate.
 * X-Forwarded-Host / X-Forwarded-Proto are used only when TRUSTED_PROXY_ENABLED
 * is true (nginx must overwrite those headers).
 */
export function isSameOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;

  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return false;
  }

  const candidates = new Set<string>([new URL(request.url).origin]);

  let trustedProxy = false;
  try {
    trustedProxy = isTrustedProxyEnabled();
  } catch {
    trustedProxy = false;
  }

  if (trustedProxy) {
    const forwardedOrigin = headerOrigin(request);
    if (forwardedOrigin) candidates.add(forwardedOrigin);
  } else {
    // Still accept Host-derived origin when Host itself is present on the
    // request URL construction path used by Next behind a proxy that sets Host.
    const host = firstHeaderValue(request.headers.get("host"));
    if (host && !/[\s/@\\]/.test(host)) {
      const requestProtocol = new URL(request.url).protocol.replace(":", "");
      try {
        candidates.add(new URL(`${requestProtocol}://${host}`).origin);
      } catch {
        // ignore malformed host
      }
    }
  }

  return candidates.has(origin);
}
