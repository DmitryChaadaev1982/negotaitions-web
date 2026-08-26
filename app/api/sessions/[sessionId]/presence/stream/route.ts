import { canManageSession, getCurrentUserSessionAccess } from "@/lib/access-control";
import { apiRequireActiveUser } from "@/lib/auth/api-guards";
import { PRESENCE_STREAM_INTERVAL_MS } from "@/lib/presence";
import { loadSessionCurrentPresenceSnapshots } from "@/lib/session-current-presence-read";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type PresenceStreamDependencies = {
  requireActiveUser: typeof apiRequireActiveUser;
  getSessionAccess: typeof getCurrentUserSessionAccess;
  loadPresence: typeof loadSessionCurrentPresenceSnapshots;
};

const defaultDependencies: PresenceStreamDependencies = {
  requireActiveUser: apiRequireActiveUser,
  getSessionAccess: getCurrentUserSessionAccess,
  loadPresence: loadSessionCurrentPresenceSnapshots,
};

function sessionNotFoundResponse() {
  return new Response("Session not found.", { status: 404 });
}

export function createPresenceStreamGet(
  dependencies: PresenceStreamDependencies = defaultDependencies,
) {
  return async function GET(request: Request, context: RouteContext) {
    const { sessionId } = await context.params;
    const { user, response: authError } = await dependencies.requireActiveUser();
    if (authError || !user) {
      return authError ?? sessionNotFoundResponse();
    }

    const access = await dependencies.getSessionAccess(sessionId, user, {});
    if (!access || !canManageSession(access)) {
      return sessionNotFoundResponse();
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;

        const sendPresence = async () => {
          if (closed) {
            return;
          }

          const participants =
            (await dependencies.loadPresence(sessionId)) ?? [];

          const payload = {
            participants,
          };

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        };

        await sendPresence();

        const intervalId = setInterval(() => {
          void sendPresence();
        }, PRESENCE_STREAM_INTERVAL_MS);

        const closeStream = () => {
          if (closed) {
            return;
          }
          closed = true;
          clearInterval(intervalId);
          controller.close();
        };

        if (request.signal.aborted) {
          closeStream();
          return;
        }

        request.signal.addEventListener("abort", closeStream, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  };
}

export const GET = createPresenceStreamGet();
