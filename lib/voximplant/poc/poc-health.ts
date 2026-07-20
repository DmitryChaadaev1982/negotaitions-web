import {
  getPocWorktreeDiagnostic,
  type PocWorktreeDiagnostic,
} from "@/lib/voximplant/poc/poc-paths";
import {
  POC_PROTOCOL_VERSION,
  POC_SCENARIO_KIND,
} from "@/lib/voximplant/poc/poc-safety";

/** Flag-gated POC health path (not production admin health). */
export const POC_HEALTH_PATH = "/api/poc/voximplant/server-stop/health";

export const POC_HEALTH_SERVICE = POC_SCENARIO_KIND;
export const POC_HEALTH_PROTOCOL_VERSION = POC_PROTOCOL_VERSION;

export const DEFAULT_POC_PUBLIC_BASE_URL = "https://local.negotaitions.ru";

export type PocHealthFailureReason =
  | "POC_HEALTH_HTTP_ERROR"
  | "POC_HEALTH_INVALID_BODY"
  | "POC_HEALTH_CALLBACK_DISABLED"
  | "POC_HEALTH_DISABLED"
  | "POC_HEALTH_WORKTREE_MISMATCH"
  | "POC_HEALTH_BUILD_MISMATCH"
  | "POC_HEALTH_PROTOCOL_MISMATCH"
  | "POC_HEALTH_TIMEOUT";

export type PocHealthDiagnostics = {
  healthUrlPath: string;
  healthHttpStatus: number | null;
  healthService: string | null;
  healthProtocolVersion: number | null;
  healthCallbackEnabled: boolean | null;
  healthWorktreeFingerprint: string | null;
  expectedWorktreeFingerprint: string;
  healthBuildId: string | null;
  expectedBuildId: string;
  healthFailureReason: PocHealthFailureReason | null;
};

export type PocHealthProbeResult = {
  passed: boolean;
  code: "POC_HEALTH_OK" | PocHealthFailureReason;
  diagnostics: PocHealthDiagnostics;
};

export function buildDefaultPocHealthUrl(
  publicBaseUrl: string = DEFAULT_POC_PUBLIC_BASE_URL,
): string {
  const base = publicBaseUrl.replace(/\/$/, "") || DEFAULT_POC_PUBLIC_BASE_URL;
  return `${base}${POC_HEALTH_PATH}`;
}

/** Path-only sanitizer; never returns credentials or full control URLs. */
export function sanitizeHealthUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || POC_HEALTH_PATH;
  } catch {
    const match = url.match(/(\/api\/poc\/voximplant\/server-stop\/health)/i);
    return match?.[1] ?? POC_HEALTH_PATH;
  }
}

function emptyDiagnostics(
  expected: PocWorktreeDiagnostic,
  healthUrl: string,
): PocHealthDiagnostics {
  return {
    healthUrlPath: sanitizeHealthUrlPath(healthUrl),
    healthHttpStatus: null,
    healthService: null,
    healthProtocolVersion: null,
    healthCallbackEnabled: null,
    healthWorktreeFingerprint: null,
    expectedWorktreeFingerprint: expected.worktreeFingerprint,
    expectedBuildId: expected.branchOrBuildId,
    healthBuildId: null,
    healthFailureReason: null,
  };
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  return name === "AbortError" || name === "TimeoutError";
}

type HealthJson = {
  ok?: unknown;
  service?: unknown;
  protocolVersion?: unknown;
  callbackEnabled?: unknown;
  branchOrBuildId?: unknown;
  worktreeFingerprint?: unknown;
  errorCode?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Probe the dedicated POC health endpoint.
 * Succeeds only when status/body/worktree/build/protocol all match.
 */
export async function probePocHealth(params: {
  healthUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  expected?: PocWorktreeDiagnostic;
}): Promise<PocHealthProbeResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const expected = params.expected ?? getPocWorktreeDiagnostic();
  const diagnostics = emptyDiagnostics(expected, params.healthUrl);

  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(1, Math.min(params.timeoutMs, 8_000)),
    );
    let response: Response;
    try {
      response = await fetchImpl(params.healthUrl, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
        redirect: "manual",
      });
    } finally {
      clearTimeout(timer);
    }

    diagnostics.healthHttpStatus = response.status;

    let json: HealthJson | null = null;
    try {
      json = (await response.json()) as HealthJson;
    } catch {
      json = null;
    }

    if (json) {
      diagnostics.healthService = asString(json.service);
      diagnostics.healthProtocolVersion = asNumber(json.protocolVersion);
      diagnostics.healthCallbackEnabled = asBoolean(json.callbackEnabled);
      diagnostics.healthWorktreeFingerprint = asString(json.worktreeFingerprint);
      diagnostics.healthBuildId = asString(json.branchOrBuildId);
    }

    const errorCode = asString(json?.errorCode);

    if (response.status !== 200) {
      if (
        errorCode === "POC_HEALTH_DISABLED" ||
        diagnostics.healthCallbackEnabled === false
      ) {
        diagnostics.healthFailureReason = "POC_HEALTH_CALLBACK_DISABLED";
        return {
          passed: false,
          code: "POC_HEALTH_CALLBACK_DISABLED",
          diagnostics,
        };
      }
      diagnostics.healthFailureReason = "POC_HEALTH_HTTP_ERROR";
      return {
        passed: false,
        code: "POC_HEALTH_HTTP_ERROR",
        diagnostics,
      };
    }

    if (
      !json ||
      json.ok !== true ||
      diagnostics.healthService == null ||
      diagnostics.healthProtocolVersion == null ||
      diagnostics.healthCallbackEnabled == null ||
      diagnostics.healthWorktreeFingerprint == null ||
      diagnostics.healthBuildId == null
    ) {
      diagnostics.healthFailureReason = "POC_HEALTH_INVALID_BODY";
      return {
        passed: false,
        code: "POC_HEALTH_INVALID_BODY",
        diagnostics,
      };
    }

    if (diagnostics.healthService !== POC_HEALTH_SERVICE) {
      diagnostics.healthFailureReason = "POC_HEALTH_INVALID_BODY";
      return {
        passed: false,
        code: "POC_HEALTH_INVALID_BODY",
        diagnostics,
      };
    }

    if (diagnostics.healthProtocolVersion !== POC_HEALTH_PROTOCOL_VERSION) {
      diagnostics.healthFailureReason = "POC_HEALTH_PROTOCOL_MISMATCH";
      return {
        passed: false,
        code: "POC_HEALTH_PROTOCOL_MISMATCH",
        diagnostics,
      };
    }

    if (diagnostics.healthCallbackEnabled !== true) {
      diagnostics.healthFailureReason = "POC_HEALTH_CALLBACK_DISABLED";
      return {
        passed: false,
        code: "POC_HEALTH_CALLBACK_DISABLED",
        diagnostics,
      };
    }

    if (
      diagnostics.healthWorktreeFingerprint !==
      expected.worktreeFingerprint
    ) {
      diagnostics.healthFailureReason = "POC_HEALTH_WORKTREE_MISMATCH";
      return {
        passed: false,
        code: "POC_HEALTH_WORKTREE_MISMATCH",
        diagnostics,
      };
    }

    if (diagnostics.healthBuildId !== expected.branchOrBuildId) {
      diagnostics.healthFailureReason = "POC_HEALTH_BUILD_MISMATCH";
      return {
        passed: false,
        code: "POC_HEALTH_BUILD_MISMATCH",
        diagnostics,
      };
    }

    return {
      passed: true,
      code: "POC_HEALTH_OK",
      diagnostics,
    };
  } catch (error) {
    if (isAbortError(error)) {
      diagnostics.healthFailureReason = "POC_HEALTH_TIMEOUT";
      return {
        passed: false,
        code: "POC_HEALTH_TIMEOUT",
        diagnostics,
      };
    }
    diagnostics.healthFailureReason = "POC_HEALTH_HTTP_ERROR";
    return {
      passed: false,
      code: "POC_HEALTH_HTTP_ERROR",
      diagnostics,
    };
  }
}

export function formatLocalHealthFailure(
  healthFailureReason: string | null | undefined,
): string {
  if (!healthFailureReason) return "LOCAL_HEALTH_FAILED";
  return `LOCAL_HEALTH_FAILED: ${healthFailureReason}`;
}
