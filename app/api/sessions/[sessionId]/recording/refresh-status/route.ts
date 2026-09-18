import { NextResponse } from "next/server";
import { z } from "zod";

import { refreshRecordingStatus } from "@/lib/livekit-egress";
import { prisma } from "@/lib/prisma";
import {
  authorizeSessionManagementAccess,
  sessionAuthTokensFrom,
} from "@/lib/session-management-auth";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const authorization = await authorizeSessionManagementAccess(
    sessionId,
    sessionAuthTokensFrom(parsed.data),
  );
  if (!authorization.ok) {
    return authorization.response;
  }

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
  });

  if (!recording) {
    return NextResponse.json({ error: "No recording available yet." }, { status: 404 });
  }

  const updated = await refreshRecordingStatus(recording);

  return NextResponse.json({
    recording: {
      id: updated.id,
      status: updated.status,
      fileKey: updated.fileKey,
      fileName: updated.fileName,
      originalSizeBytes: updated.originalSizeBytes,
      startedAt: updated.startedAt?.toISOString() ?? null,
      endedAt: updated.endedAt?.toISOString() ?? null,
      errorMessage: updated.errorMessage,
    },
  });
}
