import { NextResponse } from "next/server";

import { ParticipantType } from "@/app/generated/prisma/client";
import { canAccessSession, getCurrentUserSessionAccess } from "@/lib/access-control";
import { apiRequireActiveUser } from "@/lib/auth/api-guards";
import { ensureAccountRoomParticipant } from "@/lib/room-participant-resolver";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateVoximplantIdentityForUser,
  VoximplantIdentityDisabledError,
  VoximplantIdentityProvisioningPendingError,
} from "@/lib/voximplant/identity";
import type { VoximplantRoomRole } from "@/lib/voximplant/scenario-messages";
import { getVoximplantConfig } from "@/lib/voximplant/config";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function resolveParticipantRole(
  participantType: ParticipantType,
  sessionRoleName: string | null,
): VoximplantRoomRole {
  if (participantType === ParticipantType.FACILITATOR) {
    return "facilitator";
  }
  if (participantType === ParticipantType.OBSERVER) {
    return "observer";
  }
  if (participantType !== ParticipantType.PARTICIPANT) {
    return "unknown";
  }

  const name = sessionRoleName?.trim().toLowerCase() ?? "";
  if (
    name.includes("participant a") ||
    name.includes("participant_a") ||
    name.includes("participant-a") ||
    name.includes("участник а")
  ) {
    return "participant_a";
  }
  if (
    name.includes("participant b") ||
    name.includes("participant_b") ||
    name.includes("participant-b") ||
    name.includes("участник б")
  ) {
    return "participant_b";
  }

  return "unknown";
}

function buildBrowserSafePayload(params: {
  sessionId: string;
  providerUsername: string;
  displayName: string;
  role: VoximplantRoomRole;
  accountName: string;
  applicationName: string;
  userDomain: string;
  recording: {
    enabled: boolean;
    audioOnly: boolean;
    audioMode: "lossless" | "hd_mp3";
    pauseEnabled: boolean;
  };
}) {
  return {
    provider: "voximplant" as const,
    sessionId: params.sessionId,
    roomNameOrConferenceName: `negotiation-${params.sessionId}`,
    user: {
      providerUsername: params.providerUsername,
      displayName: params.displayName,
      role: params.role,
    },
    connection: {
      accountName: params.accountName,
      applicationName: params.applicationName,
      userDomain: params.userDomain,
    },
    recording: params.recording,
  };
}

export async function POST(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  const { user, response } = await apiRequireActiveUser();
  if (response || !user) {
    return response;
  }

  const access = await getCurrentUserSessionAccess(sessionId, user, {});
  if (!access || !canAccessSession(access)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const participant = await ensureAccountRoomParticipant(sessionId, user);
  if (!participant || participant.userId !== user.id) {
    return NextResponse.json(
      {
        error: "Guest Voximplant access is not supported yet. Use authenticated account access.",
        code: "VOXIMPLANT_GUEST_DEFERRED",
      },
      { status: 403 },
    );
  }

  const participantWithRole = await prisma.sessionParticipant.findUnique({
    where: { id: participant.id },
    select: {
      id: true,
      displayName: true,
      type: true,
      sessionRole: { select: { name: true } },
    },
  });

  if (!participantWithRole) {
    return NextResponse.json({ error: "Participant not found." }, { status: 404 });
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

  const role = resolveParticipantRole(
    participantWithRole.type,
    participantWithRole.sessionRole?.name ?? null,
  );

  try {
    const identity = await getOrCreateVoximplantIdentityForUser({
      userId: user.id,
      displayName: participantWithRole.displayName ?? user.name ?? null,
      sessionId,
      role,
    });

    const browserSafe = buildBrowserSafePayload({
      sessionId,
      providerUsername: identity.providerUsername,
      displayName: participantWithRole.displayName ?? user.name ?? "User",
      role,
      accountName: voximplantConfig.accountName as string,
      applicationName: voximplantConfig.applicationName as string,
      userDomain: voximplantConfig.userDomain as string,
      recording: voximplantConfig.recording,
    });

    return NextResponse.json(
      {
        ...browserSafe,
        credentials: {
          status: "implementation_pending",
          message:
            "Browser credential/token handoff is not implemented yet for production-safe Voximplant access.",
        },
      },
      { status: 501 },
    );
  } catch (error) {
    if (error instanceof VoximplantIdentityDisabledError) {
      return NextResponse.json(
        { error: "Voximplant identity is disabled for this user." },
        { status: 403 },
      );
    }

    if (error instanceof VoximplantIdentityProvisioningPendingError) {
      const providerUsername = error.identity?.providerUsername ?? null;

      return NextResponse.json(
        {
          provider: "voximplant",
          sessionId,
          user: {
            providerUsername,
            displayName: participantWithRole.displayName ?? user.name ?? "User",
            role,
          },
          connection: {
            accountName: voximplantConfig.accountName,
            applicationName: voximplantConfig.applicationName,
            userDomain: voximplantConfig.userDomain,
          },
          recording: voximplantConfig.recording,
          credentials: {
            status: "implementation_pending",
            message: error.message,
          },
        },
        { status: 501 },
      );
    }

    return NextResponse.json(
      {
        error: "Failed to provision Voximplant identity.",
      },
      { status: 502 },
    );
  }
}
