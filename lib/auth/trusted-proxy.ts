import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";

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
  env?: Record<string, string | undefined>,
): boolean {
  return parseServerRuntimeSetting(
    "TRUSTED_PROXY_ENABLED",
    env,
  ) as boolean;
}
