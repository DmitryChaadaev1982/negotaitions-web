import { NextResponse } from "next/server";

import { processPocCallback } from "@/lib/voximplant/poc/callback-handler";
import { isPocCallbackEnabled } from "@/lib/voximplant/poc/callback-signature";
import {
  getPocWorktreeDiagnostic,
  getPocRepositoryRoot,
  getPocStatePath,
} from "@/lib/voximplant/poc/poc-paths";

/**
 * POC-only async callback receiver for Voximplant server-stop evidence.
 *
 * Disabled unless VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED=true.
 * Never exposed as normal product functionality. No Prisma / DB writes.
 */

export const runtime = "nodejs";

function logPocCallbackEvent(params: {
  operationId: string | null;
  eventType: string | null;
  resultCode: string;
}): void {
  const diag = getPocWorktreeDiagnostic();
  console.info(
    "[poc:vox:callback]",
    JSON.stringify({
      operationId: params.operationId,
      eventType: params.eventType,
      resultCode: params.resultCode,
      worktreeFingerprint: diag.worktreeFingerprint,
      branchOrBuildId: diag.branchOrBuildId,
    }),
  );
}

function diagnosticHeaders(): Record<string, string> {
  const diag = getPocWorktreeDiagnostic();
  return {
    "X-Neg-Poc-Worktree-Fingerprint": diag.worktreeFingerprint,
    "X-Neg-Poc-Build-Id": diag.branchOrBuildId,
    "X-Neg-Poc-Callback-Enabled": diag.callbackEnabled ? "yes" : "no",
  };
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  let parsedEventType: string | null = null;
  let parsedOperationId: string | null = null;
  try {
    const json = JSON.parse(rawBody) as {
      eventType?: unknown;
      operationId?: unknown;
    };
    parsedEventType =
      typeof json.eventType === "string" ? json.eventType : null;
    parsedOperationId =
      typeof json.operationId === "string" ? json.operationId : null;
  } catch {
    // ignore — processPocCallback will classify payload errors
  }

  const result = processPocCallback({
    rawBody,
    headers: request.headers,
  });

  const headers = diagnosticHeaders();

  if (!result.ok) {
    logPocCallbackEvent({
      operationId: parsedOperationId,
      eventType: parsedEventType,
      resultCode: result.errorCode,
    });
    return NextResponse.json(
      {
        ok: false,
        errorCode: result.errorCode,
        worktreeFingerprint: headers["X-Neg-Poc-Worktree-Fingerprint"],
        branchOrBuildId: headers["X-Neg-Poc-Build-Id"],
        callbackEnabled: isPocCallbackEnabled(),
      },
      { status: result.status, headers },
    );
  }

  logPocCallbackEvent({
    operationId: result.event.operationId,
    eventType: result.event.eventType,
    resultCode: "CALLBACK_ACCEPTED",
  });

  return NextResponse.json(
    {
      ok: true,
      errorCode: "CALLBACK_ACCEPTED",
      eventType: result.event.eventType,
      operationId: result.event.operationId,
      worktreeFingerprint: headers["X-Neg-Poc-Worktree-Fingerprint"],
      branchOrBuildId: headers["X-Neg-Poc-Build-Id"],
      callbackEnabled: true,
    },
    { status: 200, headers },
  );
}

/**
 * POC diagnostic probe (flag-gated). Does not expose filesystem paths.
 * Returns worktree fingerprint / build id / callback enabled.
 */
export async function GET(): Promise<Response> {
  const diag = getPocWorktreeDiagnostic();
  const headers = diagnosticHeaders();

  if (!diag.callbackEnabled) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: "POC_CALLBACK_DISABLED",
        worktreeFingerprint: diag.worktreeFingerprint,
        branchOrBuildId: diag.branchOrBuildId,
        callbackEnabled: false,
        classificationHint: diag.classificationHint,
      },
      { status: 404, headers },
    );
  }

  // Absolute path is for local operators via server log only — not in response body.
  console.info(
    "[poc:vox:callback:diag]",
    JSON.stringify({
      worktreeFingerprint: diag.worktreeFingerprint,
      branchOrBuildId: diag.branchOrBuildId,
      callbackEnabled: true,
      classificationHint: diag.classificationHint,
      statePathResolved: getPocStatePath(),
      repositoryRootResolved: getPocRepositoryRoot(),
    }),
  );

  return NextResponse.json(
    {
      ok: true,
      errorCode: "METHOD_NOT_ALLOWED",
      note: "POST required for callbacks; GET is diagnostic only",
      worktreeFingerprint: diag.worktreeFingerprint,
      branchOrBuildId: diag.branchOrBuildId,
      callbackEnabled: true,
      classificationHint: diag.classificationHint,
    },
    { status: 405, headers },
  );
}
