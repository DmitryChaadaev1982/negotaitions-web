import { NextResponse } from "next/server";

import { createSessionFromEvent } from "@/lib/create-event-session";
import { parseAssignmentDraft } from "@/lib/event-assignment";
import { resolveEventAccess } from "@/lib/event-auth";
import { buildEventState } from "@/lib/event-state";
import { prisma } from "@/lib/prisma";
import {
  createEventSessionSchema,
  updateEventHostSchema,
} from "@/lib/validations/event";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = updateEventHostSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidPayload" }, { status: 400 });
  }

  const access = await resolveEventAccess(eventId, {
    hostToken: parsed.data.hostToken,
  });

  if (!access?.isHost) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const updateData: {
    selectedCaseId?: string | null;
    assignmentDraft?: object;
  } = {};

  if (parsed.data.selectedCaseId !== undefined) {
    updateData.selectedCaseId = parsed.data.selectedCaseId;
  }

  if (parsed.data.assignmentDraft) {
    updateData.assignmentDraft = parsed.data.assignmentDraft;
  }

  const updated = await prisma.trainingEvent.update({
    where: { id: eventId },
    data: updateData,
  });

  const state = await buildEventState({
    event: updated,
    isHost: true,
    currentParticipant: access.currentParticipant,
  });

  return NextResponse.json(state);
}

export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = createEventSessionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidPayload" }, { status: 400 });
  }

  const access = await resolveEventAccess(eventId, {
    hostToken: parsed.data.hostToken,
  });

  if (!access?.isHost) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
    include: {
      selectedCase: true,
    },
  });

  if (!event) {
    return NextResponse.json({ error: "eventNotFound" }, { status: 404 });
  }

  const assignmentDraft = parseAssignmentDraft(event.assignmentDraft, {
    preparationDurationMinutes: event.selectedCase
      ? Math.round(event.selectedCase.defaultPreparationDurationSeconds / 60)
      : 5,
    negotiationDurationMinutes: event.selectedCase
      ? Math.round(event.selectedCase.defaultDurationSeconds / 60)
      : 15,
  });

  const result = await createSessionFromEvent(eventId, assignmentDraft);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const state = await buildEventState({
    event: await prisma.trainingEvent.findUniqueOrThrow({
      where: { id: eventId },
    }),
    isHost: true,
    currentParticipant: access.currentParticipant,
  });

  return NextResponse.json({
    session: {
      id: result.sessionId,
      title: result.sessionTitle,
    },
    state,
  });
}
