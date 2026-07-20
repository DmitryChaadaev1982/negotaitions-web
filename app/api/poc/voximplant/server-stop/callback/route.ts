import { NextResponse } from "next/server";

import { processPocCallback } from "@/lib/voximplant/poc/callback-handler";

/**
 * POC-only async callback receiver for Voximplant server-stop evidence.
 *
 * Disabled unless VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED=true.
 * Never exposed as normal product functionality. No Prisma / DB writes.
 */

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const result = processPocCallback({
    rawBody,
    headers: request.headers,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errorCode: result.errorCode },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    eventType: result.event.eventType,
    operationId: result.event.operationId,
  });
}

/** Reject non-POST with 405; keep surface minimal. */
export async function GET(): Promise<Response> {
  return NextResponse.json(
    { ok: false, errorCode: "method_not_allowed" },
    { status: 405 },
  );
}
