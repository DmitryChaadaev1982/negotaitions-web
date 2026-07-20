import { NextResponse } from "next/server";

import {
  POC_HEALTH_PROTOCOL_VERSION,
  POC_HEALTH_SERVICE,
} from "@/lib/voximplant/poc/poc-health";
import { getPocWorktreeDiagnostic } from "@/lib/voximplant/poc/poc-paths";

/**
 * POC-only deterministic health probe for the server-stop orchestrator.
 *
 * Disabled unless VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED=true.
 * Not production admin health. No Prisma / DB / provider calls.
 */

export const runtime = "nodejs";

function diagnosticHeaders(): Record<string, string> {
  const diag = getPocWorktreeDiagnostic();
  return {
    "X-Neg-Poc-Worktree-Fingerprint": diag.worktreeFingerprint,
    "X-Neg-Poc-Build-Id": diag.branchOrBuildId,
    "X-Neg-Poc-Callback-Enabled": diag.callbackEnabled ? "yes" : "no",
  };
}

export async function GET(): Promise<Response> {
  const diag = getPocWorktreeDiagnostic();
  const headers = diagnosticHeaders();

  if (!diag.callbackEnabled) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: "POC_HEALTH_DISABLED",
        service: POC_HEALTH_SERVICE,
        protocolVersion: POC_HEALTH_PROTOCOL_VERSION,
        callbackEnabled: false,
        branchOrBuildId: diag.branchOrBuildId,
        worktreeFingerprint: diag.worktreeFingerprint,
      },
      { status: 404, headers },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      service: POC_HEALTH_SERVICE,
      protocolVersion: POC_HEALTH_PROTOCOL_VERSION,
      callbackEnabled: true,
      branchOrBuildId: diag.branchOrBuildId,
      worktreeFingerprint: diag.worktreeFingerprint,
    },
    { status: 200, headers },
  );
}
