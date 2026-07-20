import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import { readPocState } from "@/lib/voximplant/poc/poc-state";

function readEnvBoolean(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue = false,
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

/**
 * Feature flag for server-started conference WebSDK join experiments.
 * Default false — ordinary sessions remain unchanged.
 */
export function isServerStartedConferencePocEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return readEnvBoolean(env, "VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC", false);
}

/**
 * A Session is POC-eligible only when explicitly linked in local POC state
 * or when its id uses the reserved local POC prefix.
 */
export function isExplicitPocSession(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): boolean {
  if (!sessionId) return false;
  if (sessionId.startsWith("poc-server-stop-")) return true;

  const linked = env.VOXIMPLANT_SERVER_STOP_POC_SESSION_ID?.trim();
  if (linked && linked === sessionId) return true;

  const state = readPocState(cwd);
  if (state?.linkedSessionId && state.linkedSessionId === sessionId) {
    return true;
  }
  return false;
}

/**
 * When the POC flag is enabled and the Session is explicitly marked,
 * return the pre-started conference name from local POC state.
 * Otherwise return null (caller uses production naming).
 */
export function tryResolvePocConferenceName(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | null {
  if (!isServerStartedConferencePocEnabled(env)) return null;
  if (!isExplicitPocSession(sessionId, env, cwd)) return null;

  const override = env.VOXIMPLANT_SERVER_STOP_POC_CONFERENCE_NAME?.trim();
  if (override) return override;

  const state = readPocState(cwd);
  if (state?.conferenceName) return state.conferenceName;

  return null;
}

/**
 * Access-route conference name resolver.
 * Preserves negotiation-{sessionId} for all non-POC Sessions.
 */
export function resolveVoximplantConferenceNameForAccess(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return (
    tryResolvePocConferenceName(sessionId, env, cwd) ??
    buildVoximplantConferenceName(sessionId)
  );
}
