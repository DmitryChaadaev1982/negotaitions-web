/**
 * Server Actions origin allowlist.
 *
 * Next rejects a Server Action whose forwarded host does not match the browser
 * Origin unless the origin is explicitly allowed. The production build must
 * therefore trust only the reviewed production hostname; development and
 * managed-test origins are development-only. Production always emits exactly
 * the reviewed production hostname.
 */

export const PRODUCTION_SERVER_ACTION_ORIGINS = Object.freeze([
  "negotaitions.ru",
]);

/**
 * Exact local entries required by managed Playwright (port 3100 for Next, port
 * 3000 for the production-equivalent proxy harness) and the reverse tunnel.
 */
export const LOCAL_SERVER_ACTION_ORIGINS = Object.freeze([
  "local.negotaitions.ru",
  "localhost:3000",
  "localhost:3100",
  "127.0.0.1:3000",
  "127.0.0.1:3100",
]);

export type ServerActionOriginContext = {
  nodeEnv: string | undefined;
};

/**
 * Resolves the allowlist for a build context. Wildcards are never emitted and
 * production ignores every environment override.
 */
export function resolveServerActionAllowedOrigins(
  context: ServerActionOriginContext,
): string[] {
  const isProductionBuild = context.nodeEnv === "production";

  return isProductionBuild
    ? [...PRODUCTION_SERVER_ACTION_ORIGINS]
    : [...PRODUCTION_SERVER_ACTION_ORIGINS, ...LOCAL_SERVER_ACTION_ORIGINS];
}

export function resolveServerActionAllowedOriginsFromEnv(
  envOrNodeEnv: NodeJS.ProcessEnv | string | undefined,
): string[] {
  const nodeEnv =
    typeof envOrNodeEnv === "string"
      ? envOrNodeEnv
      : envOrNodeEnv?.NODE_ENV;
  return resolveServerActionAllowedOrigins({
    nodeEnv,
  });
}
