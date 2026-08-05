/**
 * Trusted reverse-proxy configuration.
 *
 * When enabled, the application accepts only the dedicated
 * `X-NegotAItions-Client-IP` header that nginx overwrites from `$remote_addr`.
 * Browser-controlled forwarding headers are never trusted.
 *
 * Invalid configuration fails closed (throws) rather than silently trusting
 * untrusted headers.
 */

export const TRUSTED_CLIENT_IP_HEADER = "x-negotaitions-client-ip";

export function isTrustedProxyEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.TRUSTED_PROXY_ENABLED?.trim().toLowerCase();
  if (!raw) return false;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  throw new Error(
    'Invalid TRUSTED_PROXY_ENABLED. Allowed: true, false, 1, 0, yes, no, on, off.',
  );
}
