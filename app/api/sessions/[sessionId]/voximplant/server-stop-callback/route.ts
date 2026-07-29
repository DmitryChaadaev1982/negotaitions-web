import { NextResponse } from "next/server";
import { z } from "zod";

import {
  handleServerStopCallbackEvent,
  ServerStopCallbackHandlerError,
  type ServerStopCallbackEvent,
} from "@/lib/voximplant/server-stop-callback-handler";
import {
  verifyServerStopCallbackSignature,
} from "@/lib/voximplant/server-stop-callback-signature";
import { getVoximplantServerStopConfig } from "@/lib/voximplant/server-stop-config";
import {
  reserveVoximplantCallbackNonce,
  ServerStopReplayConflictError,
} from "@/lib/voximplant/server-stop-replay";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const callbackEventSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("provider_session_registered"),
    sessionId: z.string().trim().min(1),
    conferenceName: z.string().trim().min(1),
    providerSessionId: z.string().trim().min(1),
    accessSecureUrl: z.string().trim().min(1).optional().nullable(),
    controlUrl: z.string().trim().min(1).optional().nullable(),
    scenarioBuild: z.string().trim().optional().nullable(),
    scenarioSource: z.string().trim().optional().nullable(),
    ruleIdentity: z.string().trim().optional().nullable(),
  }),
  z.object({
    eventType: z.literal("recording_stop_command_accepted"),
    sessionId: z.string().trim().min(1),
    conferenceName: z.string().trim().min(1),
    providerSessionId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
  }),
  z.object({
    eventType: z.literal("recording_stopped"),
    sessionId: z.string().trim().min(1),
    conferenceName: z.string().trim().min(1),
    providerSessionId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    terminalStatus: z.string().trim().optional().nullable(),
  }),
  z.object({
    eventType: z.literal("recording_stop_failed"),
    sessionId: z.string().trim().min(1),
    conferenceName: z.string().trim().min(1),
    providerSessionId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    failureCode: z.string().trim().optional().nullable(),
    failureMessage: z.string().trim().optional().nullable(),
    terminal: z.boolean().optional().nullable(),
  }),
]);

function mapSignatureFailureStatus(
  reason:
    | "MALFORMED_HEADERS"
    | "UNSUPPORTED_PROTOCOL"
    | "TIMESTAMP_EXPIRED"
    | "BODY_HASH_MISMATCH"
    | "SIGNATURE_INVALID",
) {
  if (reason === "TIMESTAMP_EXPIRED") {
    return 401;
  }
  if (
    reason === "BODY_HASH_MISMATCH" ||
    reason === "SIGNATURE_INVALID" ||
    reason === "UNSUPPORTED_PROTOCOL"
  ) {
    return 401;
  }
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  let config;
  try {
    config = getVoximplantServerStopConfig();
  } catch {
    return NextResponse.json(
      { error: "Server stop callback is not configured." },
      { status: 503 },
    );
  }
  if (!config.enabled || !config.callbackSecret) {
    return NextResponse.json(
      { error: "Server stop callback is not configured." },
      { status: 503 },
    );
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  const signatureResult = verifyServerStopCallbackSignature({
    headers: request.headers,
    rawBody,
    secret: config.callbackSecret,
    replayWindowSeconds: config.callbackReplayWindowSeconds,
  });
  if (!signatureResult.ok) {
    return NextResponse.json(
      { error: "Invalid callback signature." },
      { status: mapSignatureFailureStatus(signatureResult.reason) },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Malformed callback payload." }, { status: 400 });
  }

  const parsedPayload = callbackEventSchema.safeParse(parsedJson);
  if (!parsedPayload.success) {
    return NextResponse.json(
      { error: parsedPayload.error.issues[0]?.message ?? "Malformed callback payload." },
      { status: 400 },
    );
  }

  const payload = parsedPayload.data as ServerStopCallbackEvent;

  try {
    const nonceReserve = await reserveVoximplantCallbackNonce({
      nonce: signatureResult.verified.nonce,
      eventType: payload.eventType,
      sessionId: payload.sessionId,
      operationId: "operationId" in payload ? payload.operationId : null,
      providerSessionId: payload.providerSessionId,
      replayWindowSeconds: config.callbackReplayWindowSeconds,
      now: new Date(signatureResult.verified.timestampSeconds * 1000),
    });

    if (nonceReserve.status === "duplicate") {
      return NextResponse.json(
        { ok: true, duplicate: true, eventType: payload.eventType },
        { status: 200 },
      );
    }

    const handled = await handleServerStopCallbackEvent({
      routeSessionId: sessionId,
      payload,
      callbackTimestamp: new Date(signatureResult.verified.timestampSeconds * 1000),
    });

    return NextResponse.json(handled.body, { status: handled.status });
  } catch (error) {
    if (error instanceof ServerStopReplayConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ServerStopCallbackHandlerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
