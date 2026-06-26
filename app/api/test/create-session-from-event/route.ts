import { NextResponse } from "next/server";
import { z } from "zod";

import { createSessionFromEvent } from "@/lib/create-event-session";
import { isExternalServicesMockMode } from "@/lib/test-mode";

export const runtime = "nodejs";

const schema = z.object({
  eventId: z.string(),
  caseId: z.string().optional(),
  facilitatorEventParticipantId: z.string().nullable(),
  roleAssignments: z.array(
    z.object({
      caseRoleId: z.string(),
      eventParticipantId: z.string(),
    }),
  ),
  observerEventParticipantIds: z.array(z.string()),
  requesterUserId: z.string().optional(),
});

export async function POST(request: Request) {
  if (!isExternalServicesMockMode()) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload.", issues: parsed.error.issues }, { status: 400 });
  }

  const {
    eventId,
    caseId,
    facilitatorEventParticipantId,
    roleAssignments,
    observerEventParticipantIds,
    requesterUserId,
  } = parsed.data;

  const result = await createSessionFromEvent(
    eventId,
    {
      caseId,
      facilitatorEventParticipantId,
      roleAssignments,
      observerEventParticipantIds,
    },
    { requesterUserId },
  );

  return NextResponse.json(result);
}
