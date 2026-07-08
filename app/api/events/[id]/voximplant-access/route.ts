import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import {
  claimEventLobbyConnectionLease,
  validateEventLobbyConnectionLease,
} from "@/lib/event-lobby-connection-lease";
import { isEventUnavailable, resolveEventAccess } from "@/lib/event-auth";
import { ensureUserEventParticipant } from "@/lib/ensure-event-participant";
import { getVideoProvider } from "@/lib/env";
import { ensureEventLobbyRoomName } from "@/lib/livekit";
import {
  buildVoximplantSdkUsername,
  getOrCreateVoximplantIdentityForUser,
  issueVoximplantBrowserCredentialsForUser,
  VoximplantIdentityDisabledError,
  VoximplantIdentityProvisioningPendingError,
} from "@/lib/voximplant/identity";
import {
  VoximplantManagementApiError,
  VoximplantManagementApiNotImplementedError,
} from "@/lib/voximplant/management-api";
import { getVoximplantConfig } from "@/lib/voximplant/config";
import { eventVoximplantAccessSchema } from "@/lib/validations/event";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type LobbyRole = "facilitator" | "observer";

function resolveLobbyRole(isHost: boolean): LobbyRole {
  return isHost ? "facilitator" : "observer";
}

export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;
  if (getVideoProvider() !== "voximplant") {
    return NextResponse.json(
      { error: "providerMismatch", code: "VOXIMPLANT_LOBBY_DISABLED" },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = eventVoximplantAccessSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 400 });
  }

  const user = await getOptionalCurrentUser();
  const access = await resolveEventAccess(
    eventId,
    {
      hostToken: parsed.data.hostToken,
      participantToken: parsed.data.participantToken,
    },
    user,
  );

  if (!access) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (isEventUnavailable(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  if (user && parsed.data.connectionId) {
    const lease = parsed.data.claimLease
      ? claimEventLobbyConnectionLease({
          eventId,
          userId: user.id,
          connectionId: parsed.data.connectionId,
        })
      : validateEventLobbyConnectionLease({
          eventId,
          userId: user.id,
          connectionId: parsed.data.connectionId,
        });
    if (!parsed.data.claimLease && lease.version === 0) {
      claimEventLobbyConnectionLease({
        eventId,
        userId: user.id,
        connectionId: parsed.data.connectionId,
      });
    }
    if (!lease.isCurrentConnectionActive) {
      return NextResponse.json(
        {
          error: "staleConnection",
          code: "STALE_CONNECTION",
          activeConnectionId: lease.activeConnectionId,
          leaseVersion: lease.version,
        },
        { status: 409 },
      );
    }
  }

  let currentParticipant = access.currentParticipant;
  if (!currentParticipant && user && (isAdmin(user) || user.status === "ACTIVE")) {
    currentParticipant = await ensureUserEventParticipant(eventId, user);
  }

  if (!currentParticipant) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (!user) {
    return NextResponse.json(
      {
        error:
          "Guest Voximplant event-lobby access is not supported. Please sign in and re-open the lobby.",
        code: "VOXIMPLANT_EVENT_LOBBY_GUEST_DEFERRED",
      },
      { status: 403 },
    );
  }

  let voximplantConfig;
  try {
    voximplantConfig = getVoximplantConfig({
      provider: "voximplant",
      requireForRuntime: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Voximplant configuration missing.";
    return NextResponse.json(
      { error: "Voximplant configuration is incomplete.", details: message },
      { status: 503 },
    );
  }

  const role = resolveLobbyRole(currentParticipant.isHost || access.isHost);
  const displayName = currentParticipant.displayName || user.name || "User";
  const lobbyRoomName = await ensureEventLobbyRoomName({
    id: access.event.id,
    lobbyRoomName: access.event.lobbyRoomName,
  });

  try {
    const isOneTimeKeyRequest = Boolean(parsed.data.oneTimeKey);
    const identityFlow = isOneTimeKeyRequest
      ? await issueVoximplantBrowserCredentialsForUser({
          userId: user.id,
          displayName,
          sessionId: `event-lobby:${eventId}`,
          role,
          userDomain: voximplantConfig.userDomain as string,
          oneTimeKey: parsed.data.oneTimeKey as string,
        })
      : {
          identity: await getOrCreateVoximplantIdentityForUser({
            userId: user.id,
            displayName,
            sessionId: `event-lobby:${eventId}`,
            role,
          }),
          sdkUsername: null,
          credentials: null,
        };

    const sdkUsername =
      identityFlow.sdkUsername ??
      buildVoximplantSdkUsername(
        identityFlow.identity.providerUsername,
        voximplantConfig.userDomain as string,
      );

    const payload = {
      provider: "voximplant" as const,
      eventId,
      roomNameOrConferenceName: lobbyRoomName,
      user: {
        providerUsername: identityFlow.identity.providerUsername,
        sdkUsername,
        displayName,
        role,
      },
      connection: {
        accountName: voximplantConfig.accountName as string,
        applicationName: voximplantConfig.applicationName as string,
        userDomain: voximplantConfig.userDomain as string,
      },
    };

    if (identityFlow.credentials) {
      return NextResponse.json({
        ...payload,
        credentials: identityFlow.credentials,
      });
    }

    return NextResponse.json({
      ...payload,
      credentials: {
        status: "one_time_key_required",
        method: "one_time_key",
        oneTimeKeyRequest: {
          sdkMethod: "client.requestOneTimeKey({ username })",
          ttlSeconds: 300,
        },
        tokenExchange: {
          endpoint: `/api/events/${encodeURIComponent(eventId)}/voximplant-access`,
          body: { oneTimeKey: "<key-from-sdk>" },
          responseField: "credentials.oneTimeKeyHash",
        },
        sdkUsername,
      },
    });
  } catch (error) {
    if (error instanceof VoximplantIdentityDisabledError) {
      return NextResponse.json(
        { error: "Voximplant identity is disabled for this user." },
        { status: 403 },
      );
    }

    if (error instanceof VoximplantIdentityProvisioningPendingError) {
      const providerUsername = error.identity?.providerUsername ?? null;
      const fallbackSdkUsername =
        providerUsername && voximplantConfig.userDomain
          ? buildVoximplantSdkUsername(
              providerUsername,
              voximplantConfig.userDomain,
            )
          : null;
      return NextResponse.json(
        {
          provider: "voximplant",
          eventId,
          roomNameOrConferenceName: lobbyRoomName,
          user: {
            providerUsername,
            sdkUsername: fallbackSdkUsername,
            displayName,
            role,
          },
          connection: {
            accountName: voximplantConfig.accountName,
            applicationName: voximplantConfig.applicationName,
            userDomain: voximplantConfig.userDomain,
          },
          credentials: {
            status: "implementation_pending",
            message: error.message,
          },
        },
        { status: 501 },
      );
    }

    if (
      error instanceof VoximplantManagementApiNotImplementedError ||
      error instanceof VoximplantManagementApiError
    ) {
      return NextResponse.json(
        {
          error: "Voximplant browser auth handoff is pending backend setup.",
          code: "VOXIMPLANT_MANAGEMENT_API_SETUP_REQUIRED",
          details:
            "Management API integration is unavailable or misconfigured in this environment.",
        },
        { status: 501 },
      );
    }

    return NextResponse.json(
      { error: "Failed to provision Voximplant identity." },
      { status: 502 },
    );
  }
}
