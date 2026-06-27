"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ParticipantType,
  SessionStatus,
} from "@/app/generated/prisma/client";
import { canManageSession, getCurrentUserSessionAccess } from "@/lib/access-control";
import { caseVisibilityWhereForUser } from "@/lib/case-access";
import { canEditSessionDurations } from "@/lib/negotiation-control";
import { requireActiveUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { isAssignableCaseRole } from "@/lib/case-roles";
import { generateJoinToken } from "@/lib/join-token";
import { minutesToSeconds } from "@/lib/negotiation-duration";
import { updateParticipantPresence } from "@/lib/participant-presence";
import { prisma } from "@/lib/prisma";
import { resolvePrepStatus } from "@/lib/session-display-status";
import { mapCaseRolesToSessionRoleCreate } from "@/lib/session-role";
import { activeCaseWhere, activeSessionWhere } from "@/lib/soft-delete";
import { normalizeInviteEmail, normalizeUserEmail } from "@/lib/invite-email";
import {
  addAccountParticipantSchema,
  addParticipantSchema,
  assignParticipantRoleSchema,
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
  const userIsAdmin = isAdmin(user);

  const rawInvitedUserIds = formData.getAll("invitedUserId").map(String).filter(Boolean);
  const rawInvitedEmails = formData.getAll("invitedEmail").map(String).filter(Boolean);

  const parsed = createSessionSchema.safeParse({
    title: formData.get("title"),
    caseId: formData.get("caseId"),
    preparationDurationMinutes: formData.get("preparationDurationMinutes"),
    negotiationDurationMinutes: formData.get("negotiationDurationMinutes"),
    visibility: formData.get("visibility") || "PRIVATE",
    facilitatorUserId: formData.get("facilitatorUserId") || undefined,
    invitedUserIds: rawInvitedUserIds,
    invitedEmails: rawInvitedEmails,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        title: fieldErrors.title,
        caseId: fieldErrors.caseId,
        negotiationDurationMinutes: fieldErrors.negotiationDurationMinutes,
        preparationDurationMinutes: fieldErrors.preparationDurationMinutes,
        invitedEmail: fieldErrors.invitedEmails,
      },
    };
  }

  try {
    const { title, caseId, negotiationDurationMinutes, preparationDurationMinutes, visibility, facilitatorUserId, invitedUserIds, invitedEmails } =
      parsed.data;

    // Enforce facilitator assignment rules server-side.
    if (!userIsAdmin && facilitatorUserId && facilitatorUserId !== user.id) {
      return {
        errors: {
          form: ["facilitatorSelectionNotAllowed"],
        },
      };
    }

    const requestedFacilitatorUserId = facilitatorUserId ?? user.id;
    const facilitatorUser = await prisma.user.findFirst({
      where: { id: requestedFacilitatorUserId, status: "ACTIVE" },
      select: { id: true, name: true, email: true },
    });

    if (!facilitatorUser) {
      return { errors: { form: ["facilitatorMustBeActive"] } };
    }

    const resolvedFacilitatorUserId = facilitatorUser.id;

    // Private sessions require an owner (facilitator).
    if (visibility === "PRIVATE" && !resolvedFacilitatorUserId) {
      return { errors: { form: ["ownerRequired"] } };
    }

    // Admin can see all cases; non-admin is restricted to own/public cases.
    const caseAccessWhere = userIsAdmin
      ? { id: caseId, ...activeCaseWhere }
      : { id: caseId, ...activeCaseWhere, ...caseVisibilityWhereForUser(user.id) };

    const negotiationCase = await prisma.negotiationCase.findFirst({
      where: caseAccessWhere,
      include: {
        roles: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!negotiationCase) {
      const deletedCase = await prisma.negotiationCase.findFirst({
        where: userIsAdmin
          ? { id: caseId, deletedAt: { not: null } }
          : { id: caseId, deletedAt: { not: null }, ...caseVisibilityWhereForUser(user.id) },
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
        facilitatorId: resolvedFacilitatorUserId,
        status: SessionStatus.DRAFT,
        visibility,
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
            userId: resolvedFacilitatorUserId,
            displayName: facilitatorUser.name?.trim() || facilitatorUser.email.split("@")[0] || "Facilitator",
            type: ParticipantType.FACILITATOR,
            joinToken: generateJoinToken(),
          },
        },
      },
    });

    // Create SessionInvites for invited users and external emails.
    // Exclude the resolved facilitator so that when admin assigns a different
    // facilitator, admin can be explicitly invited as a player.
    const requestedUserIds = [...new Set(invitedUserIds)].filter((id) => id !== resolvedFacilitatorUserId);
    const normalizedInputEmails = [...new Set(invitedEmails.map((email) => normalizeInviteEmail(email)).filter((email): email is string => Boolean(email)))];
    const currentUserEmailNormalized = normalizeUserEmail(user.email);

    const activeUsersById = requestedUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: requestedUserIds }, status: "ACTIVE" },
          select: { id: true, email: true },
        })
      : [];
    const activeUsersByEmail = normalizedInputEmails.length
      ? await prisma.user.findMany({
          where: {
            status: "ACTIVE",
            OR: normalizedInputEmails.map((email) => ({
              email: { equals: email, mode: "insensitive" as const },
            })),
          },
          select: { id: true, email: true },
        })
      : [];

    const invitedRegisteredIds = new Set(activeUsersById.map((invitedUser) => invitedUser.id));
    const activeEmailToUser = new Map(
      activeUsersByEmail.map((invitedUser) => [invitedUser.email.toLowerCase(), invitedUser.id]),
    );
    const invitedExternalEmails = new Set<string>();

    for (const email of normalizedInputEmails) {
      const matchedUserId = activeEmailToUser.get(email);
      if (matchedUserId) {
        invitedRegisteredIds.add(matchedUserId);
      } else if (email !== currentUserEmailNormalized) {
        invitedExternalEmails.add(email);
      }
    }

    for (const invitedUserId of invitedRegisteredIds) {
      await prisma.sessionInvite.upsert({
        where: { sessionId_userId: { sessionId: session.id, userId: invitedUserId } },
        update: {},
        create: {
          sessionId: session.id,
          userId: invitedUserId,
          invitedByUserId: user.id,
        },
      });
    }

    for (const invitedEmail of invitedExternalEmails) {
      await prisma.sessionInvite.upsert({
        where: {
          sessionId_invitedEmailNormalized: {
            sessionId: session.id,
            invitedEmailNormalized: invitedEmail,
          },
        },
        update: {},
        create: {
          sessionId: session.id,
          invitedEmail: invitedEmail,
          invitedEmailNormalized: invitedEmail,
          displayLabel: invitedEmail,
          invitedByUserId: user.id,
        },
      });
    }

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

export type AddAccountParticipantState = {
  errors?: ActionErrors;
  success?: boolean;
};

/**
 * Account-based participant add for standalone Sessions.
 * Accepts a registered userId or an external email.
 * Registered users get a SessionParticipant row with userId.
 * External emails get a SessionInvite row (no role assignment until entry).
 */
export async function addAccountParticipant(
  _prevState: AddAccountParticipantState,
  formData: FormData,
): Promise<AddAccountParticipantState> {
  const user = await requireActiveUser();

  const parsed = addAccountParticipantSchema.safeParse({
    sessionId: formData.get("sessionId"),
    type: formData.get("type"),
    sessionRoleId: formData.get("sessionRoleId") || undefined,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        sessionRoleId: fieldErrors.sessionRoleId,
        form: fieldErrors.type ?? fieldErrors.sessionId,
      },
    };
  }

  const { sessionId, type, sessionRoleId } = parsed.data;
  const selectedUserIds = formData.getAll("invitedUserId").map(String).filter(Boolean);
  const selectedEmails = formData.getAll("invitedEmail").map(String).filter(Boolean);

  if (selectedUserIds.length === 0 && selectedEmails.length === 0) {
    return { errors: { form: ["selectUserOrEmail"] } };
  }

  try {
    const session = await getFacilitatorSession(sessionId, user);

    if (type === ParticipantType.PARTICIPANT && sessionRoleId) {
      const assignedRole = session.sessionRoles.find((role) => role.id === sessionRoleId);
      if (!assignedRole) {
        return { errors: { sessionRoleId: ["Selected role does not belong to this session."] } };
      }
      if (!isAssignableCaseRole(assignedRole.name)) {
        return { errors: { sessionRoleId: ["This role cannot be assigned to a participant."] } };
      }
      const existingAssignment = await prisma.sessionParticipant.findFirst({
        where: { sessionId, type: ParticipantType.PARTICIPANT, sessionRoleId },
      });
      if (existingAssignment) {
        return { errors: { sessionRoleId: ["This role is already assigned to another participant."] } };
      }
    }

    let addedCount = 0;

    for (const selectedUserId of selectedUserIds) {
      const selectedUser = await prisma.user.findFirst({
        where: { id: selectedUserId, status: "ACTIVE" },
        select: { id: true, name: true, email: true },
      });
      if (!selectedUser) continue;

      const existingParticipant = await prisma.sessionParticipant.findFirst({
        where: { sessionId, userId: selectedUserId },
      });
      if (existingParticipant) continue;

      await prisma.sessionParticipant.create({
        data: {
          sessionId,
          userId: selectedUserId,
          displayName: selectedUser.name?.trim() || selectedUser.email.split("@")[0] || selectedUser.email,
          type: type as ParticipantType,
          sessionRoleId: type === ParticipantType.PARTICIPANT ? (sessionRoleId ?? null) : null,
          joinToken: generateJoinToken(),
        },
      });
      addedCount++;
    }

    for (const rawEmail of selectedEmails) {
      const normalizedEmail = normalizeInviteEmail(rawEmail);
      if (!normalizedEmail) continue;

      const existingUser = await prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" }, status: "ACTIVE" },
        select: { id: true, name: true, email: true },
      });

      if (existingUser) {
        const existingParticipant = await prisma.sessionParticipant.findFirst({
          where: { sessionId, userId: existingUser.id },
        });
        if (!existingParticipant) {
          await prisma.sessionParticipant.create({
            data: {
              sessionId,
              userId: existingUser.id,
              displayName: existingUser.name?.trim() || existingUser.email.split("@")[0] || existingUser.email,
              type: type as ParticipantType,
              sessionRoleId: type === ParticipantType.PARTICIPANT ? (sessionRoleId ?? null) : null,
              joinToken: generateJoinToken(),
            },
          });
          addedCount++;
        }
      } else {
        const existingInvite = await prisma.sessionInvite.findFirst({
          where: {
            sessionId,
            invitedEmailNormalized: normalizedEmail,
          },
        });
        if (!existingInvite) {
          await prisma.sessionInvite.create({
            data: {
              sessionId,
              invitedEmail: normalizedEmail,
              invitedEmailNormalized: normalizedEmail,
              displayLabel: normalizedEmail,
              invitedByUserId: user.id,
            },
          });
          addedCount++;
        }
      }
    }

    if (addedCount === 0) {
      return { errors: { form: ["noNewParticipantsAdded"] } };
    }

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
      type: true,
      sessionRoleId: true,
      session: { select: { deletedAt: true } },
    },
  });

  if (!participant) {
    return { errors: { form: ["invalidRequest"] } };
  }

  if (participant.session.deletedAt) {
    return { errors: { form: ["Session has been deleted."] } };
  }

  // Phase 6.11B: PARTICIPANT must have an assigned role before writing notes.
  if (participant.type === ParticipantType.PARTICIPANT && !participant.sessionRoleId) {
    return { errors: { form: ["preparationLockedNoRole"] } };
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

export type AssignParticipantRoleState = {
  errors?: ActionErrors;
  success?: boolean;
};

/**
 * Phase 6.11B: Assigns or reassigns roles to already-joined participants.
 * Only the session facilitator/owner or admin can call this action.
 * Participants cannot assign roles. No joinToken required.
 *
 * Input: sessionId + array of
 * { sessionParticipantId, sessionParticipantType, sessionRoleId | null }
 * - sessionRoleId null = unassign role
 * - Validates: session exists, caller has manage rights, all participant IDs
 *   belong to this session, roles belong to this session, no duplicate unique
 *   role assignments, no facilitator/player conflict.
 */
export async function assignParticipantRole(
  _prevState: AssignParticipantRoleState,
  formData: FormData,
): Promise<AssignParticipantRoleState> {
  const user = await requireActiveUser();

  const rawAssignments: Array<{
    sessionParticipantId: string;
    sessionRoleId: string | null;
    sessionParticipantType: "PARTICIPANT" | "OBSERVER";
  }> = [];
  const participantIds = formData.getAll("sessionParticipantId").map(String).filter(Boolean);
  const roleIds = formData.getAll("sessionRoleId").map(String);
  const participantTypes = formData
    .getAll("sessionParticipantType")
    .map((value) => String(value).trim().toUpperCase());

  for (let i = 0; i < participantIds.length; i++) {
    rawAssignments.push({
      sessionParticipantId: participantIds[i],
      sessionRoleId: roleIds[i]?.trim() || null,
      sessionParticipantType:
        participantTypes[i] === "OBSERVER" ? "OBSERVER" : "PARTICIPANT",
    });
  }

  const sessionId = String(formData.get("sessionId") ?? "").trim();

  const parsed = assignParticipantRoleSchema.safeParse({
    sessionId,
    assignments: rawAssignments,
  });

  if (!parsed.success) {
    return { errors: { form: ["roleAssignmentInvalidParticipant"] } };
  }

  try {
    const session = await getFacilitatorSession(parsed.data.sessionId, user);

    // Validate that all participant IDs belong to this session.
    const sessionParticipantIds = parsed.data.assignments.map((a) => a.sessionParticipantId);
    const dbParticipants = await prisma.sessionParticipant.findMany({
      where: { sessionId: session.id, id: { in: sessionParticipantIds } },
      select: { id: true, type: true, sessionRoleId: true },
    });

    if (dbParticipants.length !== sessionParticipantIds.length) {
      return { errors: { form: ["roleAssignmentInvalidParticipant"] } };
    }

    // Build role → name map for validation.
    const sessionRoleMap = new Map(session.sessionRoles.map((r) => [r.id, r]));

    // Validate all requested role IDs belong to this session and are assignable.
    for (const assignment of parsed.data.assignments) {
      if (
        assignment.sessionParticipantType === ParticipantType.OBSERVER &&
        assignment.sessionRoleId !== null
      ) {
        return { errors: { form: ["roleAssignmentConflict"] } };
      }
      if (assignment.sessionRoleId === null) continue;
      const role = sessionRoleMap.get(assignment.sessionRoleId);
      if (!role) {
        return { errors: { sessionRoleId: ["Selected role does not belong to this session."] } };
      }
      if (!isAssignableCaseRole(role.name)) {
        return { errors: { sessionRoleId: ["This role cannot be assigned to a participant."] } };
      }
    }

    // Check for facilitator/player conflicts (facilitator cannot be a player).
    const facilitatorParticipant = dbParticipants.find((p) => p.type === ParticipantType.FACILITATOR);
    if (facilitatorParticipant) {
      const facilitatorAssignment = parsed.data.assignments.find(
        (a) => a.sessionParticipantId === facilitatorParticipant.id,
      );
      if (facilitatorAssignment) {
        return { errors: { form: ["roleAssignmentFacilitatorConflict"] } };
      }
    }

    // Check for duplicate unique role assignments among the new assignments.
    const newRoleAssignmentIds = parsed.data.assignments
      .filter(
        (a) =>
          a.sessionParticipantType === ParticipantType.PARTICIPANT &&
          a.sessionRoleId !== null,
      )
      .map((a) => a.sessionRoleId!);
    const uniqueRoleIds = new Set(newRoleAssignmentIds);
    if (uniqueRoleIds.size < newRoleAssignmentIds.length) {
      return { errors: { form: ["roleAssignmentConflict"] } };
    }

    // Also check against EXISTING participants not in this batch.
    const existingOtherParticipants = await prisma.sessionParticipant.findMany({
      where: {
        sessionId: session.id,
        id: { notIn: sessionParticipantIds },
        type: ParticipantType.PARTICIPANT,
        sessionRoleId: { not: null },
      },
      select: { sessionRoleId: true },
    });
    for (const existing of existingOtherParticipants) {
      if (existing.sessionRoleId && uniqueRoleIds.has(existing.sessionRoleId)) {
        return { errors: { form: ["roleAssignmentConflict"] } };
      }
    }

    await prisma.$transaction(
      parsed.data.assignments.map((assignment) =>
        prisma.sessionParticipant.update({
          where: { id: assignment.sessionParticipantId },
          data: {
            type: assignment.sessionParticipantType,
            sessionRoleId:
              assignment.sessionParticipantType === ParticipantType.PARTICIPANT
                ? assignment.sessionRoleId
                : null,
          },
        }),
      ),
    );

    await syncSessionPrepStatus(session.id);
    revalidatePath(`/sessions/${session.id}`);
    revalidatePath(`/sessions/${session.id}/materials`);
    return { success: true };
  } catch (error) {
    return {
      errors: {
        form: [
          error instanceof Error ? error.message : "roleAssignmentFailed",
        ],
      },
    };
  }
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
