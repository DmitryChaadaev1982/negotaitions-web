"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ParticipantType,
  SessionStatus,
} from "@/app/generated/prisma/client";
import { canManageSession, getCurrentUserSessionAccess } from "@/lib/access-control";
import { canEditSessionDurations } from "@/lib/negotiation-control";
import { requireActiveUser } from "@/lib/auth";
import { isAssignableCaseRole } from "@/lib/case-roles";
import { generateJoinToken } from "@/lib/join-token";
import { minutesToSeconds } from "@/lib/negotiation-duration";
import { updateParticipantPresence } from "@/lib/participant-presence";
import { prisma } from "@/lib/prisma";
import { resolvePrepStatus } from "@/lib/session-display-status";
import { mapCaseRolesToSessionRoleCreate } from "@/lib/session-role";
import { activeCaseWhere, activeSessionWhere } from "@/lib/soft-delete";
import {
  addParticipantSchema,
  createSessionSchema,
  saveParticipantNotesSchema,
  updateSessionDurationSchema,
} from "@/lib/validations/session";

type ActionErrors = {
  [key: string]: string[] | undefined;
  form?: string[];
};

function isRedirectError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "digest" in error &&
    String((error as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

async function getFacilitatorSession(
  sessionId: string,
  user: Awaited<ReturnType<typeof requireActiveUser>>,
) {
  const access = await getCurrentUserSessionAccess(sessionId, user, {});
  if (!access || !canManageSession(access)) {
    throw new Error("Session not found.");
  }
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
    },
    include: {
      sessionRoles: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  if (session.deletedAt) {
    throw new Error("Session has been deleted.");
  }

  return session;
}

async function syncSessionPrepStatus(sessionId: string) {
  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    select: { type: true },
  });

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: resolvePrepStatus(participants) },
  });
}

export type CreateSessionState = {
  errors?: ActionErrors;
};

export async function createSession(
  _prevState: CreateSessionState,
  formData: FormData,
): Promise<CreateSessionState> {
  const user = await requireActiveUser("/sessions/new");

  const parsed = createSessionSchema.safeParse({
    title: formData.get("title"),
    caseId: formData.get("caseId"),
    preparationDurationMinutes: formData.get("preparationDurationMinutes"),
    negotiationDurationMinutes: formData.get("negotiationDurationMinutes"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        title: fieldErrors.title,
        caseId: fieldErrors.caseId,
        negotiationDurationMinutes: fieldErrors.negotiationDurationMinutes,
        preparationDurationMinutes: fieldErrors.preparationDurationMinutes,
      },
    };
  }

  try {
    const { title, caseId, negotiationDurationMinutes, preparationDurationMinutes } =
      parsed.data;

    const negotiationCase = await prisma.negotiationCase.findFirst({
      where: {
        id: caseId,
        facilitatorId: user.id,
        ...activeCaseWhere,
      },
      include: {
        roles: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!negotiationCase) {
      const deletedCase = await prisma.negotiationCase.findFirst({
        where: {
          id: caseId,
          facilitatorId: user.id,
          deletedAt: { not: null },
        },
        select: { id: true },
      });

      return {
        errors: {
          caseId: [deletedCase ? "caseDeleted" : "caseNotFound"],
        },
      };
    }

    const session = await prisma.session.create({
      data: {
        title,
        negotiationCaseId: caseId,
        facilitatorId: user.id,
        status: SessionStatus.DRAFT,
        preparationDurationSeconds: minutesToSeconds(preparationDurationMinutes),
        durationSeconds: minutesToSeconds(negotiationDurationMinutes),
        snapshotCaseTitle: negotiationCase.title,
        snapshotBusinessContext: negotiationCase.businessContext,
        snapshotPublicInstructions: negotiationCase.publicInstructions,
        snapshotCaseLanguage: negotiationCase.caseLanguage,
        sessionRoles: {
          create: mapCaseRolesToSessionRoleCreate(negotiationCase.roles),
        },
        participants: {
          create: {
            userId: user.id,
            displayName: user.name?.trim() || user.email.split("@")[0] || "Facilitator",
            type: ParticipantType.FACILITATOR,
            joinToken: generateJoinToken(),
          },
        },
      },
    });

    revalidatePath("/sessions");
    revalidatePath("/dashboard");
    redirect(`/sessions/${session.id}`);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    return {
      errors: {
        form: [
          error instanceof Error
            ? error.message
            : "createSessionFailed",
        ],
      },
    };
  }
}

export type AddParticipantState = {
  errors?: ActionErrors;
  success?: boolean;
};

export async function addParticipant(
  _prevState: AddParticipantState,
  formData: FormData,
): Promise<AddParticipantState> {
  const user = await requireActiveUser();

  const parsed = addParticipantSchema.safeParse({
    sessionId: formData.get("sessionId"),
    displayName: formData.get("displayName"),
    type: formData.get("type"),
    sessionRoleId: formData.get("sessionRoleId") || undefined,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        displayName: fieldErrors.displayName,
        type: fieldErrors.type,
        sessionRoleId: fieldErrors.sessionRoleId,
      },
    };
  }

  try {
    const { sessionId, displayName, type, sessionRoleId } = parsed.data;
    const session = await getFacilitatorSession(sessionId, user);

    if (type === ParticipantType.PARTICIPANT) {
      const assignedRole = session.sessionRoles.find(
        (role) => role.id === sessionRoleId,
      );

      if (!assignedRole) {
        return {
          errors: {
            sessionRoleId: ["Selected role does not belong to this session."],
          },
        };
      }

      if (!isAssignableCaseRole(assignedRole.name)) {
        return {
          errors: {
            sessionRoleId: ["This role cannot be assigned to a participant."],
          },
        };
      }

      const existingAssignment = await prisma.sessionParticipant.findFirst({
        where: {
          sessionId,
          type: ParticipantType.PARTICIPANT,
          sessionRoleId,
        },
      });

      if (existingAssignment) {
        return {
          errors: {
            sessionRoleId: [
              "This role is already assigned to another participant.",
            ],
          },
        };
      }
    }

    if (type === ParticipantType.FACILITATOR) {
      const existingFacilitator = await prisma.sessionParticipant.findFirst({
        where: {
          sessionId,
          type: ParticipantType.FACILITATOR,
        },
      });

      if (existingFacilitator) {
        return {
          errors: {
            type: ["Only one facilitator can be added per session."],
          },
        };
      }
    }

    await prisma.sessionParticipant.create({
      data: {
        sessionId,
        displayName,
        type: type as ParticipantType,
        sessionRoleId:
          type === ParticipantType.PARTICIPANT ? sessionRoleId : null,
        joinToken: generateJoinToken(),
      },
    });

    await syncSessionPrepStatus(sessionId);

    revalidatePath(`/sessions/${sessionId}`);
    return { success: true };
  } catch (error) {
    return {
      errors: {
        form: [
          error instanceof Error
            ? error.message
            : "Unable to add participant. Please try again.",
        ],
      },
    };
  }
}

export async function removeParticipant(formData: FormData) {
  const user = await requireActiveUser();
  const participantId = String(formData.get("participantId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");

  if (!participantId || !sessionId) {
    return;
  }

  try {
    await getFacilitatorSession(sessionId, user);

    await prisma.sessionParticipant.deleteMany({
      where: {
        id: participantId,
        sessionId,
      },
    });

    await syncSessionPrepStatus(sessionId);

    revalidatePath(`/sessions/${sessionId}`);
  } catch {
    // Silently fail for invalid requests.
  }
}

export async function updateSessionDuration(formData: FormData) {
  const user = await requireActiveUser();

  const parsed = updateSessionDurationSchema.safeParse({
    sessionId: formData.get("sessionId"),
    durationMinutes: formData.get("durationMinutes") || undefined,
    preparationDurationMinutes:
      formData.get("preparationDurationMinutes") || undefined,
  });

  if (!parsed.success) {
    return;
  }

  const { sessionId, durationMinutes, preparationDurationMinutes } = parsed.data;

  try {
    const session = await getFacilitatorSession(sessionId, user);

    if (!canEditSessionDurations(session.negotiationState)) {
      return;
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        ...(durationMinutes !== undefined
          ? { durationSeconds: minutesToSeconds(durationMinutes) }
          : {}),
        ...(preparationDurationMinutes !== undefined
          ? {
              preparationDurationSeconds: minutesToSeconds(
                preparationDurationMinutes,
              ),
            }
          : {}),
      },
    });

    revalidatePath(`/sessions/${sessionId}`);
  } catch {
    // Silently fail for invalid requests.
  }
}

export type SaveParticipantNotesState = {
  errors?: ActionErrors;
  success?: boolean;
  notes?: string;
};

export async function saveParticipantNotes(
  _prevState: SaveParticipantNotesState,
  formData: FormData,
): Promise<SaveParticipantNotesState> {
  const parsed = saveParticipantNotesSchema.safeParse({
    joinToken: formData.get("joinToken"),
    notes: formData.get("notes") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        notes: fieldErrors.notes,
      },
    };
  }

  const { joinToken, notes } = parsed.data;

  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    select: {
      id: true,
      session: {
        select: {
          deletedAt: true,
        },
      },
    },
  });

  if (!participant) {
    return {
      errors: {
        form: ["Invalid join link."],
      },
    };
  }

  if (participant.session.deletedAt) {
    return {
      errors: {
        form: ["Session has been deleted."],
      },
    };
  }

  await prisma.sessionParticipant.update({
    where: { joinToken },
    data: { notes },
  });

  await recordParticipantPresence(joinToken);
  revalidatePath(`/join/${joinToken}`);
  return { success: true, notes };
}

/**
 * Account-authenticated notes save for the /sessions/[id]/materials route.
 *
 * Uses participantId (a non-secret DB record id) instead of joinToken so that
 * joinToken never appears in HTML props or form hidden fields for account users.
 */
export async function saveAccountParticipantNotes(
  _prevState: SaveParticipantNotesState,
  formData: FormData,
): Promise<SaveParticipantNotesState> {
  const user = await requireActiveUser();

  const participantId = String(formData.get("participantId") ?? "").trim();
  const notes = String(formData.get("notes") ?? "");

  if (!participantId) {
    return { errors: { form: ["invalidRequest"] } };
  }

  const isAdminUser = (await import("@/lib/auth/admin")).isAdmin(user);

  const participant = await prisma.sessionParticipant.findFirst({
    where: isAdminUser
      ? { id: participantId }
      : { id: participantId, userId: user.id },
    select: {
      id: true,
      sessionId: true,
      session: { select: { deletedAt: true } },
    },
  });

  if (!participant) {
    return { errors: { form: ["invalidRequest"] } };
  }

  if (participant.session.deletedAt) {
    return { errors: { form: ["Session has been deleted."] } };
  }

  await prisma.sessionParticipant.update({
    where: { id: participantId },
    data: { notes },
  });

  revalidatePath(`/sessions/${participant.sessionId}/materials`);
  return { success: true, notes };
}

export async function recordParticipantPresence(joinToken: string) {
  const sessionId = await updateParticipantPresence(joinToken);

  if (sessionId) {
    revalidatePath(`/sessions/${sessionId}`);
  }
}

/** @deprecated Use recordParticipantPresence */
export async function markParticipantJoined(joinToken: string) {
  await recordParticipantPresence(joinToken);
}

export async function deleteSession(sessionId: string) {
  const user = await requireActiveUser();

  const access = await getCurrentUserSessionAccess(sessionId, user, {});
  if (!access || !canManageSession(access)) {
    return;
  }
  const session = await prisma.session.findFirst({ where: { id: sessionId, ...activeSessionWhere } });

  if (!session) {
    return;
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/sessions");
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/dashboard");
  redirect("/sessions");
}
