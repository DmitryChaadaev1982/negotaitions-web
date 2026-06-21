"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ParticipantType,
  NegotiationState,
  SessionStatus,
} from "@/app/generated/prisma/client";
import { getDemoFacilitator } from "@/lib/demo-user";
import { isAssignableCaseRole } from "@/lib/case-roles";
import { generateJoinToken } from "@/lib/join-token";
import { minutesToSeconds } from "@/lib/negotiation-duration";
import { updateParticipantPresence } from "@/lib/participant-presence";
import { prisma } from "@/lib/prisma";
import {
  addParticipantSchema,
  createSessionSchema,
  saveParticipantNotesSchema,
  updateSessionDurationSchema,
  updateSessionStatusSchema,
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

async function getFacilitatorSession(sessionId: string) {
  const facilitator = await getDemoFacilitator();

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      facilitatorId: facilitator.id,
    },
    include: {
      negotiationCase: {
        include: {
          roles: {
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  return session;
}

export type CreateSessionState = {
  errors?: ActionErrors;
};

export async function createSession(
  _prevState: CreateSessionState,
  formData: FormData,
): Promise<CreateSessionState> {
  const parsed = createSessionSchema.safeParse({
    title: formData.get("title"),
    caseId: formData.get("caseId"),
    negotiationDurationMinutes: formData.get("negotiationDurationMinutes"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        title: fieldErrors.title,
        caseId: fieldErrors.caseId,
        negotiationDurationMinutes: fieldErrors.negotiationDurationMinutes,
      },
    };
  }

  try {
    const facilitator = await getDemoFacilitator();
    const { title, caseId, negotiationDurationMinutes } = parsed.data;

    const negotiationCase = await prisma.negotiationCase.findFirst({
      where: {
        id: caseId,
        facilitatorId: facilitator.id,
      },
      select: {
        id: true,
        defaultDurationSeconds: true,
      },
    });

    if (!negotiationCase) {
      return {
        errors: {
          caseId: ["Selected case was not found."],
        },
      };
    }

    const session = await prisma.session.create({
      data: {
        title,
        negotiationCaseId: caseId,
        facilitatorId: facilitator.id,
        status: SessionStatus.DRAFT,
        durationSeconds: minutesToSeconds(negotiationDurationMinutes),
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
            : "Unable to create session. Please try again.",
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
  const parsed = addParticipantSchema.safeParse({
    sessionId: formData.get("sessionId"),
    displayName: formData.get("displayName"),
    type: formData.get("type"),
    caseRoleId: formData.get("caseRoleId") || undefined,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        displayName: fieldErrors.displayName,
        type: fieldErrors.type,
        caseRoleId: fieldErrors.caseRoleId,
      },
    };
  }

  try {
    const { sessionId, displayName, type, caseRoleId } = parsed.data;
    const session = await getFacilitatorSession(sessionId);

    if (type === ParticipantType.PARTICIPANT) {
      const assignedRole = session.negotiationCase.roles.find(
        (role) => role.id === caseRoleId,
      );

      if (!assignedRole) {
        return {
          errors: {
            caseRoleId: ["Selected role does not belong to this case."],
          },
        };
      }

      if (!isAssignableCaseRole(assignedRole.name)) {
        return {
          errors: {
            caseRoleId: ["This role cannot be assigned to a participant."],
          },
        };
      }

      const existingAssignment = await prisma.sessionParticipant.findFirst({
        where: {
          sessionId,
          type: ParticipantType.PARTICIPANT,
          caseRoleId,
        },
      });

      if (existingAssignment) {
        return {
          errors: {
            caseRoleId: ["This role is already assigned to another participant."],
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
        caseRoleId: type === ParticipantType.PARTICIPANT ? caseRoleId : null,
        joinToken: generateJoinToken(),
      },
    });

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
  const participantId = String(formData.get("participantId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");

  if (!participantId || !sessionId) {
    return;
  }

  try {
    await getFacilitatorSession(sessionId);

    await prisma.sessionParticipant.deleteMany({
      where: {
        id: participantId,
        sessionId,
      },
    });

    revalidatePath(`/sessions/${sessionId}`);
  } catch {
    // Silently fail for invalid requests.
  }
}

export async function updateSessionDuration(formData: FormData) {
  const parsed = updateSessionDurationSchema.safeParse({
    sessionId: formData.get("sessionId"),
    durationMinutes: formData.get("durationMinutes"),
  });

  if (!parsed.success) {
    return;
  }

  const { sessionId, durationMinutes } = parsed.data;

  try {
    const session = await getFacilitatorSession(sessionId);

    if (session.negotiationState !== NegotiationState.LOBBY) {
      return;
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        durationSeconds: minutesToSeconds(durationMinutes),
      },
    });

    revalidatePath(`/sessions/${sessionId}`);
  } catch {
    // Silently fail for invalid requests.
  }
}

export async function updateSessionStatus(formData: FormData) {
  const parsed = updateSessionStatusSchema.safeParse({
    sessionId: formData.get("sessionId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return;
  }

  const { sessionId, status } = parsed.data;

  try {
    await getFacilitatorSession(sessionId);

    const updateData: {
      status: SessionStatus;
      startedAt?: Date;
      endedAt?: Date;
    } = {
      status: status as SessionStatus,
    };

    if (status === SessionStatus.IN_PROGRESS) {
      const existing = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { startedAt: true },
      });

      if (!existing?.startedAt) {
        updateData.startedAt = new Date();
      }
    }

    if (status === SessionStatus.COMPLETED) {
      updateData.endedAt = new Date();
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: updateData,
    });

    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath("/sessions");
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
    select: { id: true },
  });

  if (!participant) {
    return {
      errors: {
        form: ["Invalid join link."],
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
