/**
 * Server Actions origin allowlist.
 *
 * Next rejects a Server Action whose forwarded host does not match the browser
 * Origin unless the origin is explicitly allowed. The production build must
 * therefore trust only the reviewed production hostname; development and
 * managed-test origins are gated behind an explicit build-time switch that is
 * off by default and is never read from browser-controlled input.
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

export const ALLOW_LOCAL_SERVER_ACTION_ORIGINS_ENV =
  "NEXT_BUILD_ALLOW_LOCAL_SERVER_ACTION_ORIGINS";

export type ServerActionOriginContext = {
  nodeEnv: string | undefined;
  /** Build-time opt-in only. Must default to off. */
  allowLocalOrigins: string | undefined;
};

/**
 * Resolves the allowlist for a build context. Wildcards are never emitted and
 * the production set is returned unchanged unless the explicit build switch is
 * set to the literal string "true".
 */
export function resolveServerActionAllowedOrigins(
  context: ServerActionOriginContext,
): string[] {
  const isProductionBuild = context.nodeEnv === "production";
  const localOriginsEnabled =
    !isProductionBuild || context.allowLocalOrigins?.trim() === "true";

  return localOriginsEnabled
    ? [...PRODUCTION_SERVER_ACTION_ORIGINS, ...LOCAL_SERVER_ACTION_ORIGINS]
    : [...PRODUCTION_SERVER_ACTION_ORIGINS];
}

export function resolveServerActionAllowedOriginsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return resolveServerActionAllowedOrigins({
    nodeEnv: env.NODE_ENV,
    allowLocalOrigins: env[ALLOW_LOCAL_SERVER_ACTION_ORIGINS_ENV],
  });
}
