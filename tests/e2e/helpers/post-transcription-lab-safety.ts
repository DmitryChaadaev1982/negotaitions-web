import {
  assertIsolatedE2eDatabase,
  parsePostgresConnectionTuple,
} from "./e2e-database";

const LOCAL_HOST_ALIASES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const PRODUCTION_APP_HOSTS = new Set([
  "negotaitions.ru",
  "www.negotaitions.ru",
  "app.negotaitions.ru",
]);
const ALLOWED_APP_SUBDOMAIN_PREFIXES = /^(local|staging|test|dev|e2e)\./i;
const MOCK_OR_TEST_MODE = /^(mock|test|disabled)$/i;

export type LabSafetyEnv = {
  NODE_ENV?: string;
  POST_TRANSCRIPTION_LAB?: string;
  E2E_DATABASE_URL?: string;
  DATABASE_URL?: string;
  APP_URL?: string;
  BASE_URL?: string;
  PLAYWRIGHT_BASE_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  EXTERNAL_SERVICES_MODE?: string;
  RECORDING_MODE?: string;
  TRANSCRIPTION_MODE?: string;
  AI_ANALYSIS_PROVIDER?: string;
  TRANSCRIPTION_PROVIDER?: string;
  VIDEO_PROVIDER?: string;
  VOXIMPLANT_SERVER_STOP_MODE?: string;
};

export class PostTranscriptionLabSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostTranscriptionLabSafetyError";
  }
}

function readEnv(env: LabSafetyEnv, key: keyof LabSafetyEnv): string {
  return env[key]?.trim() ?? "";
}

function hostnameFromUrl(raw: string): string | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return parsed.hostname.trim().toLowerCase();
  } catch {
    return null;
  }
}

export function isProductionApplicationHost(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }
  const host = hostname.replace(/\.$/, "").toLowerCase();
  if (LOCAL_HOST_ALIASES.has(host)) {
    return false;
  }
  if (PRODUCTION_APP_HOSTS.has(host)) {
    return true;
  }
  if (host.endsWith(".negotaitions.ru") && !ALLOWED_APP_SUBDOMAIN_PREFIXES.test(host)) {
    return true;
  }
  return false;
}

function collectApplicationHosts(env: LabSafetyEnv): string[] {
  return [
    readEnv(env, "APP_URL"),
    readEnv(env, "BASE_URL"),
    readEnv(env, "PLAYWRIGHT_BASE_URL"),
    readEnv(env, "NEXT_PUBLIC_APP_URL"),
  ]
    .map(hostnameFromUrl)
    .filter((host): host is string => Boolean(host));
}

function assertMockMode(label: string, value: string, required = true): void {
  if (!value) {
    if (required) {
      throw new PostTranscriptionLabSafetyError(
        `Post-processing Facilitator Lab refuses to run without ${label} in mock/test mode.`,
      );
    }
    return;
  }
  if (!MOCK_OR_TEST_MODE.test(value)) {
    throw new PostTranscriptionLabSafetyError(
      `Post-processing Facilitator Lab refuses ${label}="${value}". External providers must stay in mock/test mode.`,
    );
  }
}

/**
 * Fail-closed admission for the Post-processing Facilitator Lab.
 * Warning-only protection is not sufficient.
 */
export function assertPostTranscriptionLabSafety(
  env: LabSafetyEnv = process.env,
): void {
  const nodeEnv = readEnv(env, "NODE_ENV").toLowerCase();
  if (nodeEnv === "production") {
    throw new PostTranscriptionLabSafetyError(
      "Post-processing Facilitator Lab refuses NODE_ENV=production.",
    );
  }

  if (readEnv(env, "POST_TRANSCRIPTION_LAB") !== "1") {
    throw new PostTranscriptionLabSafetyError(
      "Post-processing Facilitator Lab requires POST_TRANSCRIPTION_LAB=1.",
    );
  }

  const e2eUrl = readEnv(env, "E2E_DATABASE_URL");
  if (!e2eUrl) {
    throw new PostTranscriptionLabSafetyError(
      "Post-processing Facilitator Lab requires E2E_DATABASE_URL.",
    );
  }

  // Reuse the proven E2E database guard: production/Yandex host rejection,
  // production-like name rejection, and e2e/test/testing marker.
  const previousE2e = process.env.E2E_DATABASE_URL;
  const previousDatabase = process.env.DATABASE_URL;
  process.env.E2E_DATABASE_URL = e2eUrl;
  if (readEnv(env, "DATABASE_URL")) {
    process.env.DATABASE_URL = readEnv(env, "DATABASE_URL");
  }
  try {
    assertIsolatedE2eDatabase();
    parsePostgresConnectionTuple(e2eUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PostTranscriptionLabSafetyError(
      `Post-processing Facilitator Lab refused the E2E database target: ${message}`,
    );
  } finally {
    if (previousE2e === undefined) {
      delete process.env.E2E_DATABASE_URL;
    } else {
      process.env.E2E_DATABASE_URL = previousE2e;
    }
    if (previousDatabase === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabase;
    }
  }

  const productionHost = collectApplicationHosts(env).find((host) =>
    isProductionApplicationHost(host),
  );
  if (productionHost) {
    throw new PostTranscriptionLabSafetyError(
      `Post-processing Facilitator Lab refuses production application host ${productionHost}.`,
    );
  }

  assertMockMode("EXTERNAL_SERVICES_MODE", readEnv(env, "EXTERNAL_SERVICES_MODE"));
  assertMockMode("RECORDING_MODE", readEnv(env, "RECORDING_MODE"));
  assertMockMode("TRANSCRIPTION_MODE", readEnv(env, "TRANSCRIPTION_MODE"));

  const voxStop = readEnv(env, "VOXIMPLANT_SERVER_STOP_MODE").toLowerCase();
  if (voxStop && !["disabled", "mock", "test"].includes(voxStop)) {
    throw new PostTranscriptionLabSafetyError(
      `Post-processing Facilitator Lab refuses VOXIMPLANT_SERVER_STOP_MODE="${voxStop}".`,
    );
  }
}

export function buildPostTranscriptionLabEnvironment(
  overrides: Record<string, string> = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.AUTO_TRANSCRIBE_AFTER_RECORDING = "false";
  Object.assign(env, overrides);
  env.POST_TRANSCRIPTION_LAB = "1";
  env.EXTERNAL_SERVICES_MODE = "mock";
  env.RECORDING_MODE = "mock";
  env.TRANSCRIPTION_MODE = "mock";
  env.VOXIMPLANT_SERVER_STOP_MODE = "disabled";
  return env;
}
