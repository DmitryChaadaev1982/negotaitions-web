import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";
import {
  PRESENCE_STREAM_INTERVAL_MS,
  toParticipantPresenceSnapshot,
} from "@/lib/presence";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const facilitator = await getDemoFacilitator();

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      facilitatorId: facilitator.id,
    },
    select: { id: true },
  });

  if (!session) {
    return new Response("Session not found.", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const sendPresence = async () => {
        if (closed) {
          return;
        }

        const participants = await prisma.sessionParticipant.findMany({
          where: { sessionId },
          select: {
            id: true,
            joinedAt: true,
            lastSeenAt: true,
          },
          orderBy: { createdAt: "asc" },
        });

        const payload = {
          participants: participants.map(toParticipantPresenceSnapshot),
        };

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      await sendPresence();

      const intervalId = setInterval(() => {
        void sendPresence();
      }, PRESENCE_STREAM_INTERVAL_MS);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(intervalId);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
