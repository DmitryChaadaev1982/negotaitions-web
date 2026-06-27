"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma, TrainingEventStatus } from "@/app/generated/prisma/client";
import { completeTrainingEvent } from "@/lib/complete-event";
import { getEventLobbyUrl } from "@/lib/config";
import {
  generateHostToken,
  generateParticipantToken,
} from "@/lib/event-tokens";
import { flagsFromPreference } from "@/lib/event-assignment";
import { buildEventLobbyRoomName } from "@/lib/livekit";
import {
  DEFAULT_EVENT_DURATION_SECONDS,
  minutesToSeconds,
} from "@/lib/negotiation-duration";
import {
  normalizeTimeZone,
  zonedDateTimeInputToUtcDate,
} from "@/lib/timezones";
import { prisma } from "@/lib/prisma";
import {
  createEventSchema,
  generatePublicJoinCode,
  joinEventSchema,
} from "@/lib/validations/event";
import { requireActiveUser, getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { eventVisibilityWhere } from "@/lib/visibility";
import { normalizeInviteEmail, normalizeUserEmail } from "@/lib/invite-email";

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

function isSerializableConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export type CreateEventState = {
  errors?: ActionErrors;
};

export async function createTrainingEvent(
  _prevState: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const user = await requireActiveUser("/events/new");
  const userIsAdmin = isAdmin(user);

  if (formData.has("hostDisplayName")) {
    return {
      errors: {
        form: ["obsoleteFacilitatorNameField"],
      },
    };
  }

  const rawInvitedUserIds = formData.getAll("invitedUserId").map(String).filter(Boolean);
  const rawInvitedEmails = formData.getAll("invitedEmail").map(String).filter(Boolean);

  const parsed = createEventSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    scheduledAt: formData.get("scheduledAt") || undefined,
    timeZone: formData.get("timeZone") || undefined,
    estimatedEventDurationMinutes: formData.get("estimatedEventDurationMinutes"),
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
        timeZone: fieldErrors.timeZone,
        estimatedEventDurationMinutes: fieldErrors.estimatedEventDurationMinutes,
        invitedEmail: fieldErrors.invitedEmails,
      },
    };
  }

  try {
    const { title, description, scheduledAt, timeZone, estimatedEventDurationMinutes, visibility, facilitatorUserId, invitedUserIds, invitedEmails } =
      parsed.data;
    const normalizedTimeZone = normalizeTimeZone(timeZone);
    const scheduledAtUtc = scheduledAt
      ? zonedDateTimeInputToUtcDate(scheduledAt, normalizedTimeZone)
      : null;

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
      select: { id: true },
    });

    if (!facilitatorUser) {
      return { errors: { form: ["facilitatorMustBeActive"] } };
    }

    const resolvedFacilitatorUserId = facilitatorUser.id;

    // Resolve owner (hostUserId): admin can assign any ACTIVE user; non-admin always owns themselves.
    const requestedOwnerUserId = userIsAdmin
      ? (String(formData.get("ownerUserId") ?? "").trim() || user.id)
      : user.id;

    const ownerUser = await prisma.user.findFirst({
      where: { id: requestedOwnerUserId, status: "ACTIVE" },
      select: { id: true },
    });

    if (!ownerUser) {
      return { errors: { form: ["ownerMustBeActive"] } };
    }

    // Private events require an owner.
    if (visibility === "PRIVATE" && !ownerUser.id) {
      return { errors: { form: ["ownerRequired"] } };
    }

    const resolvedHostUserId = ownerUser.id;

    const hostToken = generateHostToken();
    const hostParticipantToken = generateParticipantToken();
    const publicJoinCode = generatePublicJoinCode();
    const event = await prisma.trainingEvent.create({
      data: {
        title,
        description: description || null,
        scheduledAt: scheduledAtUtc,
        timeZone: normalizedTimeZone,
        status: TrainingEventStatus.LOBBY_OPEN,
        hostUserId: resolvedHostUserId,
        facilitatorUserId: resolvedFacilitatorUserId,
        visibility,
        publicJoinCode,
        hostToken,
        lobbyRoomName: null,
        estimatedEventDurationSeconds: minutesToSeconds(
          estimatedEventDurationMinutes ??
            DEFAULT_EVENT_DURATION_SECONDS / 60,
        ),
        participants: {
          create: {
            displayName: user.name?.trim() || user.email.split("@")[0] || "Host",
            participantToken: hostParticipantToken,
            isHost: true,
            userId: user.id,
          },
        },
      },
    });

    // Create EventInvites for invited users and external emails.
    // Exclude the resolved facilitator (not the current user) so that when admin
    // assigns a different facilitator, admin can be explicitly invited as a player.
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
      await prisma.eventInvite.upsert({
        where: { eventId_userId: { eventId: event.id, userId: invitedUserId } },
        update: {},
        create: {
          eventId: event.id,
          userId: invitedUserId,
          invitedByUserId: user.id,
        },
      });
    }

    for (const invitedEmail of invitedExternalEmails) {
      await prisma.eventInvite.upsert({
        where: {
          eventId_invitedEmailNormalized: {
            eventId: event.id,
            invitedEmailNormalized: invitedEmail,
          },
        },
        update: {},
        create: {
          eventId: event.id,
          invitedEmail: invitedEmail,
          invitedEmailNormalized: invitedEmail,
          displayLabel: invitedEmail,
          invitedByUserId: user.id,
        },
      });
    }

    const lobbyRoomName = buildEventLobbyRoomName(event.id);
    await prisma.trainingEvent.update({
      where: { id: event.id },
      data: { lobbyRoomName },
    });

    revalidatePath("/events");
    revalidatePath("/dashboard");

    const afterCreate = String(formData.get("afterCreate") ?? "list");

    if (afterCreate === "lobby") {
      redirect(
        getEventLobbyUrl(event.id, {
          hostToken,
          participantToken: hostParticipantToken,
        }),
      );
    }

    redirect("/events");
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }

    return {
      errors: {
        form: [
          error instanceof Error
            ? error.message
            : "createEventFailed",
        ],
      },
    };
  }
}

export type UpdateEventState = {
  errors?: ActionErrors;
  success?: boolean;
};

export async function updateTrainingEvent(
  _prevState: UpdateEventState,
  formData: FormData,
): Promise<UpdateEventState> {
  const user = await requireActiveUser("/events");

  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) {
    return { errors: { form: ["updateEventFailed"] } };
  }

  const rawInvitedUserIds = formData.getAll("invitedUserId").map(String).filter(Boolean);
  const rawInvitedEmails = formData.getAll("invitedEmail").map(String).filter(Boolean);

  const parsed = createEventSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    scheduledAt: formData.get("scheduledAt") || undefined,
    timeZone: formData.get("timeZone") || undefined,
    estimatedEventDurationMinutes: formData.get("estimatedEventDurationMinutes"),
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
        timeZone: fieldErrors.timeZone,
        estimatedEventDurationMinutes: fieldErrors.estimatedEventDurationMinutes,
        invitedEmail: fieldErrors.invitedEmails,
      },
    };
  }

  try {
    const event = await prisma.trainingEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        hostUserId: true,
        facilitatorUserId: true,
        deletedAt: true,
        status: true,
      },
    });

    if (!event || event.deletedAt) {
      return { errors: { form: ["updateEventFailed"] } };
    }

    const userIsAdmin = isAdmin(user);
    const isOwner = event.hostUserId === user.id || event.facilitatorUserId === user.id;

    if (!userIsAdmin && !isOwner) {
      return { errors: { form: ["updateEventFailed"] } };
    }

    const { title, description, scheduledAt, timeZone, estimatedEventDurationMinutes, visibility, facilitatorUserId, invitedUserIds, invitedEmails } =
      parsed.data;
    const normalizedTimeZone = normalizeTimeZone(timeZone);
    const scheduledAtUtc = scheduledAt
      ? zonedDateTimeInputToUtcDate(scheduledAt, normalizedTimeZone)
      : null;

    if (!userIsAdmin && facilitatorUserId && facilitatorUserId !== user.id) {
      return { errors: { form: ["facilitatorSelectionNotAllowed"] } };
    }

    const resolvedFacilitatorUserId = facilitatorUserId ?? event.facilitatorUserId ?? user.id;
    const facilitatorUser = await prisma.user.findFirst({
      where: { id: resolvedFacilitatorUserId, status: "ACTIVE" },
      select: { id: true },
    });

    if (!facilitatorUser) {
      return { errors: { form: ["facilitatorMustBeActive"] } };
    }

    // Resolve owner (hostUserId) for update: admin can transfer; non-admin keeps existing owner.
    let resolvedHostUserId = event.hostUserId;
    if (userIsAdmin) {
      const requestedOwnerUserId = String(formData.get("ownerUserId") ?? "").trim();
      if (requestedOwnerUserId && requestedOwnerUserId !== resolvedHostUserId) {
        const ownerUser = await prisma.user.findFirst({
          where: { id: requestedOwnerUserId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!ownerUser) {
          return { errors: { form: ["ownerMustBeActive"] } };
        }
        resolvedHostUserId = ownerUser.id;
      }
    }

    // Private events require an owner.
    if (visibility === "PRIVATE" && !resolvedHostUserId) {
      return { errors: { form: ["ownerRequired"] } };
    }

    await prisma.trainingEvent.update({
      where: { id: eventId },
      data: {
        title,
        description: description || null,
        scheduledAt: scheduledAtUtc,
        timeZone: normalizedTimeZone,
        facilitatorUserId: facilitatorUser.id,
        ...(userIsAdmin ? { hostUserId: resolvedHostUserId } : {}),
        visibility,
        estimatedEventDurationSeconds: minutesToSeconds(
          estimatedEventDurationMinutes ??
            DEFAULT_EVENT_DURATION_SECONDS / 60,
        ),
      },
    });

    // Sync EventInvites: add new ones (do not delete existing to preserve history).
    // Exclude the resolved facilitator so admin can be explicitly invited as a player
    // when they assign someone else as the facilitator.
    const requestedUserIds = [...new Set(invitedUserIds)].filter((id) => id !== facilitatorUser.id);
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

    const invitedRegisteredIds = new Set(activeUsersById.map((u) => u.id));
    const activeEmailToUser = new Map(
      activeUsersByEmail.map((u) => [u.email.toLowerCase(), u.id]),
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
      await prisma.eventInvite.upsert({
        where: { eventId_userId: { eventId, userId: invitedUserId } },
        update: {},
        create: {
          eventId,
          userId: invitedUserId,
          invitedByUserId: user.id,
        },
      });
    }

    for (const invitedEmail of invitedExternalEmails) {
      await prisma.eventInvite.upsert({
        where: {
          eventId_invitedEmailNormalized: {
            eventId,
            invitedEmailNormalized: invitedEmail,
          },
        },
        update: {},
        create: {
          eventId,
          invitedEmail: invitedEmail,
          invitedEmailNormalized: invitedEmail,
          displayLabel: invitedEmail,
          invitedByUserId: user.id,
        },
      });
    }

    revalidatePath("/events");
    revalidatePath(`/events/${eventId}/edit`);
    revalidatePath("/dashboard");

    return { success: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return {
      errors: {
        form: [error instanceof Error ? error.message : "updateEventFailed"],
      },
    };
  }
}

export type JoinEventState = {
  errors?: ActionErrors;
};

export async function joinTrainingEvent(
  _prevState: JoinEventState,
  formData: FormData,
): Promise<JoinEventState> {
  const parsed = joinEventSchema.safeParse({
    eventId: formData.get("eventId"),
    preference: formData.get("preference") || undefined,
    participantToken: formData.get("participantToken") || undefined,
  });

  if (!parsed.success) {
    return { errors: { form: ["loginRequired"] } };
  }

  const { eventId, preference, participantToken } = parsed.data;

  // Guest join is closed — require authenticated ACTIVE user.
  const currentUser = await getOptionalCurrentUser();
  if (!currentUser) {
    return { errors: { form: ["loginRequired"] } };
  }

  const accountJoinAllowed = isAdmin(currentUser) || currentUser.status === "ACTIVE";
  if (!accountJoinAllowed) {
    return { errors: { form: ["accountStatusRestricted"] } };
  }

  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
  });

  if (
    !event ||
    event.deletedAt ||
    event.status === TrainingEventStatus.CANCELLED ||
    event.status === TrainingEventStatus.COMPLETED
  ) {
    return { errors: { form: ["eventUnavailable"] } };
  }

  if (!isAdmin(currentUser)) {
    const canJoinEvent = await prisma.trainingEvent.findFirst({
      where: {
        id: event.id,
        ...eventVisibilityWhere(currentUser.id, normalizeUserEmail(currentUser.email)),
      },
      select: { id: true },
    });

    if (!canJoinEvent) {
      return { errors: { form: ["eventUnavailable"] } };
    }
  }

  // If a participantToken is provided (URL invite), validate and bind to account.
  if (participantToken) {
    const existing = await prisma.eventParticipant.findFirst({
      where: { eventId, participantToken },
    });

    if (existing) {
      if (existing.userId && existing.userId !== currentUser.id) {
        return { errors: { form: ["participantTokenAlreadyLinked"] } };
      }

      const existingByUser = await prisma.eventParticipant.findFirst({
        where: { eventId, userId: currentUser.id },
      });

      if (existingByUser && existingByUser.id !== existing.id) {
        await prisma.eventParticipant.update({
          where: { id: existingByUser.id },
          data: {
            ...(preference ? { preference, ...flagsFromPreference(preference) } : {}),
            lastSeenAt: new Date(),
          },
        });

        redirect(getEventLobbyUrl(eventId, { participantToken: existingByUser.participantToken }));
      }

      await prisma.eventParticipant.update({
        where: { id: existing.id },
        data: {
          ...(!existing.userId ? { userId: currentUser.id } : {}),
          lastSeenAt: new Date(),
          ...(preference ? { preference, ...flagsFromPreference(preference) } : {}),
        },
      });

      redirect(getEventLobbyUrl(eventId, { participantToken }));
    }
  }

  // Check if user is already a participant (duplicate prevention).
  const existingByUser = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: currentUser.id },
  });

  if (existingByUser) {
    await prisma.eventParticipant.update({
      where: { id: existingByUser.id },
      data: {
        ...(preference ? { preference, ...flagsFromPreference(preference) } : {}),
        lastSeenAt: new Date(),
      },
    });

    redirect(getEventLobbyUrl(eventId, { participantToken: existingByUser.participantToken }));
  }

  // Create new EventParticipant bound to authenticated user.
  const newParticipantToken = generateParticipantToken();
  const resolvedPreference = preference ?? "UNDECIDED";
  const preferenceFlags = flagsFromPreference(resolvedPreference);
  const resolvedDisplayName =
    currentUser.name?.trim() || currentUser.email.split("@")[0] || "User";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const participant = await prisma.$transaction(
        async (tx) => {
          const existingInTransaction = await tx.eventParticipant.findFirst({
            where: { eventId, userId: currentUser.id },
          });

          if (existingInTransaction) {
            await tx.eventParticipant.update({
              where: { id: existingInTransaction.id },
              data: {
                preference: resolvedPreference,
                ...preferenceFlags,
                lastSeenAt: new Date(),
              },
            });

            return existingInTransaction;
          }

          return tx.eventParticipant.create({
            data: {
              eventId,
              displayName: resolvedDisplayName,
              participantToken: newParticipantToken,
              preference: resolvedPreference,
              ...preferenceFlags,
              userId: currentUser.id,
              joinedAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      redirect(getEventLobbyUrl(eventId, { participantToken: participant.participantToken }));
    } catch (error) {
      if (isSerializableConflict(error) && attempt === 0) {
        continue;
      }

      throw error;
    }
  }

  return { errors: { form: ["createEventFailed"] } };
}

export async function completeTrainingEventFromList(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");

  if (!eventId) {
    return;
  }

  const user = await getOptionalCurrentUser();
  if (!user) {
    return;
  }

  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
    select: {
      hostToken: true,
      deletedAt: true,
      hostUserId: true,
      facilitatorUserId: true,
    },
  });

  if (!event || event.deletedAt) {
    return;
  }

  const ownerAccess =
    event.hostUserId === user.id || event.facilitatorUserId === user.id;
  if (!isAdmin(user) && !ownerAccess) {
    return;
  }

  await completeTrainingEvent(eventId, { actorUser: user });

  revalidatePath("/events");
  revalidatePath("/dashboard");
}

export async function cancelTrainingEvent(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  const hostToken = String(formData.get("hostToken") ?? "");

  if (!eventId) {
    return;
  }

  const user = await getOptionalCurrentUser();
  const userIsAdmin = user !== null && isAdmin(user);

  if (!hostToken && !user) {
    return;
  }

  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
    select: {
      hostToken: true,
      deletedAt: true,
      hostUserId: true,
      facilitatorUserId: true,
    },
  });

  if (!event || event.deletedAt) {
    return;
  }

  if (hostToken && event.hostToken !== hostToken) {
    return;
  }

  if (!hostToken) {
    const ownerAccess = Boolean(
      user &&
        (event.hostUserId === user.id || event.facilitatorUserId === user.id),
    );
    if (!userIsAdmin && !ownerAccess) {
      return;
    }
  }

  await prisma.trainingEvent.update({
    where: { id: eventId },
    data: {
      status: TrainingEventStatus.CANCELLED,
      deletedAt: new Date(),
    },
  });

  revalidatePath("/events");
  revalidatePath("/dashboard");
}
