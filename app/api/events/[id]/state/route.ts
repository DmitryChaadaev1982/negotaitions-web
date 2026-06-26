import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isEventDeletedOrCancelled, resolveEventAccess } from "@/lib/event-auth";
import { buildEventState } from "@/lib/event-state";
import { eventAccessQuerySchema } from "@/lib/validations/event";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;
  const { searchParams } = new URL(request.url);

  const parsed = eventAccessQuerySchema.safeParse({
    hostToken: searchParams.get("hostToken") ?? undefined,
    participantToken: searchParams.get("participantToken") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 400 });
  }

  const user = await getOptionalCurrentUser();
  const access = await resolveEventAccess(eventId, parsed.data, user);

  if (!access) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (isEventDeletedOrCancelled(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  const state = await buildEventState({
    ...access,
    accountMode: Boolean(user),
    userId: user?.id ?? null,
  });

  return NextResponse.json(state);
}
