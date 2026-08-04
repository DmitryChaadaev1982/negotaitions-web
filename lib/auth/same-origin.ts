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
  const forwardedOrigin = headerOrigin(request);
  if (forwardedOrigin) candidates.add(forwardedOrigin);
  return candidates.has(origin);
}

