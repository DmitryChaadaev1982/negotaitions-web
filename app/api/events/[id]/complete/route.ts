import { NextResponse } from "next/server";

import { completeTrainingEvent } from "@/lib/complete-event";
import { getOptionalCurrentUser } from "@/lib/auth";
import { completeEventSchema } from "@/lib/validations/event";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = completeEventSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidPayload" }, { status: 400 });
  }

  const user = await getOptionalCurrentUser();
  const result = await completeTrainingEvent(
    eventId,
    user
      ? { actorUser: user, hostToken: parsed.data.hostToken }
      : { hostToken: parsed.data.hostToken ?? "" },
    parsed.data.reason,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.result);
}
