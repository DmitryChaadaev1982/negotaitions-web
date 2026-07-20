import { createHash, randomBytes } from "node:crypto";

import {
  buildPocCallbackPayload,
  buildSignedCallbackRequest,
  getPocCallbackSecret,
  isPocCallbackEnabled,
} from "@/lib/voximplant/poc/callback-signature";
import {
  classifyWorktreeMatch,
  fingerprintSecretPrefix,
  getPocWorktreeDiagnostic,
} from "@/lib/voximplant/poc/poc-paths";
import {
  clearSyntheticSelfTestCallbacks,
  findMatchingCallbackEvent,
  readPocState,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

export type CallbackSelfTestResult = {
  passed: boolean;
  code: "CALLBACK_SELF_TEST_PASSED" | string;
  details: Record<string, unknown>;
};

export async function runCallbackSelfTest(params: {
  callbackUrl: string;
  healthUrl: string;
  stateRoot?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  skipHttp?: boolean;
}): Promise<CallbackSelfTestResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const diag = getPocWorktreeDiagnostic();

  if (diag.classificationHint !== "EXACT_POC_WORKTREE") {
    return {
      passed: false,
      code: "POC_WORKTREE_MISMATCH",
      details: { classificationHint: diag.classificationHint },
    };
  }

  if (!isPocCallbackEnabled()) {
    return {
      passed: false,
      code: "POC_CALLBACK_DISABLED",
      details: {},
    };
  }

  let secret = "";
  try {
    secret = getPocCallbackSecret();
  } catch {
    return {
      passed: false,
      code: "CALLBACK_SECRET_MISSING",
      details: {},
    };
  }

  const state = readPocState(params.stateRoot);
  if (!state) {
    return {
      passed: false,
      code: "POC_STATE_MISSING",
      details: {},
    };
  }

  if (params.skipHttp) {
    return {
      passed: true,
      code: "CALLBACK_SELF_TEST_PASSED",
      details: { skippedHttp: true },
    };
  }

  // Health check (local.negotaitions.ru or override).
  try {
    const healthController = new AbortController();
    const healthTimer = setTimeout(
      () => healthController.abort(),
      Math.min(params.timeoutMs, 8_000),
    );
    const healthResp = await fetchImpl(params.healthUrl, {
      method: "GET",
      signal: healthController.signal,
      cache: "no-store",
    });
    clearTimeout(healthTimer);
    if (!healthResp.ok) {
      return {
        passed: false,
        code: "LOCAL_HEALTH_FAILED",
        details: { httpStatus: healthResp.status },
      };
    }
  } catch (error) {
    return {
      passed: false,
      code: "LOCAL_HEALTH_FAILED",
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const operationId = `poc-callback-selftest-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const payload = buildPocCallbackPayload({
    eventType: "command_accepted",
    action: "ping",
    operationId,
    conferenceName: state.conferenceName,
    callSessionHistoryId: state.callSessionHistoryId,
    recorderState: "absent",
  });
  const signed = buildSignedCallbackRequest({ payload, secret });

  let httpStatus = 0;
  let routeFingerprint: string | null = null;
  let signatureAccepted = false;
  let errorCode: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    const response = await fetchImpl(params.callbackUrl, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    httpStatus = response.status;
    routeFingerprint =
      response.headers.get("X-Neg-Poc-Worktree-Fingerprint") || null;
    const json = (await response.json().catch(() => null)) as {
      ok?: boolean;
      errorCode?: string;
      worktreeFingerprint?: string;
    } | null;
    errorCode = json?.errorCode ?? null;
    if (!routeFingerprint && json?.worktreeFingerprint) {
      routeFingerprint = json.worktreeFingerprint;
    }
    signatureAccepted =
      response.ok &&
      (errorCode === "CALLBACK_ACCEPTED" || errorCode == null) &&
      json?.ok === true;
  } catch (error) {
    return {
      passed: false,
      code: "CALLBACK_SELF_TEST_HTTP_FAILED",
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const worktreeClass = classifyWorktreeMatch({
    observedFingerprint: routeFingerprint,
    expectedFingerprint: diag.worktreeFingerprint,
  });
  if (worktreeClass !== "EXACT_POC_WORKTREE") {
    return {
      passed: false,
      code: "CALLBACK_ROUTE_WRONG_WORKTREE",
      details: { worktreeClass, routeFingerprint },
    };
  }

  const after = readPocState(params.stateRoot);
  const matched = after
    ? findMatchingCallbackEvent(after, {
        operationId,
        eventType: "command_accepted",
        action: "ping",
      })
    : null;

  if (!signatureAccepted || !matched) {
    return {
      passed: false,
      code: "CALLBACK_SELF_TEST_PERSIST_FAILED",
      details: {
        httpStatus,
        errorCode,
        signatureAccepted,
        persisted: Boolean(matched),
        bodySha256Prefix: createHash("sha256")
          .update(signed.body)
          .digest("hex")
          .slice(0, 12),
        callbackSecretSha256Prefix: fingerprintSecretPrefix(secret),
      },
    };
  }

  // Clear only synthetic self-test evidence.
  writePocState(clearSyntheticSelfTestCallbacks(after!), params.stateRoot);

  return {
    passed: true,
    code: "CALLBACK_SELF_TEST_PASSED",
    details: {
      httpStatus,
      operationId,
      worktreeFingerprint: diag.worktreeFingerprint,
    },
  };
}
