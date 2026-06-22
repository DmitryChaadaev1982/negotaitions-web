import { NextResponse } from "next/server";

import { createLiveKitAccessToken, getLiveKitConfig } from "@/lib/livekit";
import { prisma } from "@/lib/prisma";
import { liveKitTokenRequestSchema } from "@/lib/validations/livekit";

export async function POST(request: Request) {
  const config = getLiveKitConfig();

  if (!config) {
    return NextResponse.json(
      { error: "LiveKit is not configured." },
      { status: 503 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = liveKitTokenRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 400 });
  }

  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken: parsed.data.joinToken },
    include: {
      sessionRole: {
        select: { name: true },
      },
      session: {
        select: {
          id: true,
          livekitRoomName: true,
        },
      },
    },
  });

  if (!participant) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
  }

  const token = await createLiveKitAccessToken(
    participant,
    participant.session,
    config,
    participant.sessionRole?.name ?? null,
  );

  return NextResponse.json({
    token,
    serverUrl: config.serverUrl,
    sessionId: participant.session.id,
    participantId: participant.id,
    participantType: participant.type,
    displayName: participant.displayName,
  });
}
