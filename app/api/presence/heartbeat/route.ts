import { NextResponse } from "next/server";
import { z } from "zod";

import { updateParticipantPresence } from "@/lib/participant-presence";

const heartbeatSchema = z.object({
  joinToken: z.string().min(1),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = heartbeatSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 400 });
  }

  await updateParticipantPresence(parsed.data.joinToken);

  return NextResponse.json({ ok: true });
}
