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
import { prisma } from "@/lib/prisma";
import {
  createEventSchema,
  generatePublicJoinCode,
  joinEventSchema,
} from "@/lib/validations/event";
import { requireActiveUser, getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { eventVisibilityWhere } from "@/lib/visibility";

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

  const rawInvitedUserIds = formData.getAll("invitedUserId").map(String).filter(Boolean);

  const parsed = createEventSchema.safeParse({
    title: formData.get("title"),
    hostDisplayName: formData.get("hostDisplayName"),
    description: formData.get("description") || undefined,
    scheduledAt: formData.get("scheduledAt") || undefined,
    estimatedEventDurationMinutes: formData.get("estimatedEventDurationMinutes"),
    visibility: formData.get("visibility") || "PRIVATE",
    facilitatorUserId: formData.get("facilitatorUserId") || undefined,
    invitedUserIds: rawInvitedUserIds,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        title: fieldErrors.title,
        hostDisplayName: fieldErrors.hostDisplayName,
        estimatedEventDurationMinutes: fieldErrors.estimatedEventDurationMinutes,
      },
    };
  }

  try {
    const { title, hostDisplayName, description, scheduledAt, estimatedEventDurationMinutes, visibility, facilitatorUserId, invitedUserIds } =
      parsed.data;

    const hostDisplayNameResolved =
      hostDisplayName?.trim() ||
      user.name?.trim() ||
      user.email.split("@")[0] ||
      "Host";

    // Resolve facilitatorUserId: if provided and valid ACTIVE user, use it; else default to creator
    let resolvedFacilitatorUserId: string | null = null;
    if (facilitatorUserId && facilitatorUserId !== user.id) {
      const facilitatorUser = await prisma.user.findFirst({
        where: { id: facilitatorUserId, status: "ACTIVE" },
        select: { id: true },
      });
      resolvedFacilitatorUserId = facilitatorUser?.id ?? null;
    } else if (facilitatorUserId === user.id) {
      resolvedFacilitatorUserId = user.id;
    }

    const hostToken = generateHostToken();
    const hostParticipantToken = generateParticipantToken();
    const publicJoinCode = generatePublicJoinCode();
    const event = await prisma.trainingEvent.create({
      data: {
        title,
        description: description || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: TrainingEventStatus.LOBBY_OPEN,
        hostUserId: user.id,
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
            displayName: hostDisplayNameResolved,
            participantToken: hostParticipantToken,
            isHost: true,
            userId: user.id,
          },
        },
      },
    });

    // Create EventInvites for invited users (deduped, skip self)
    if (invitedUserIds.length > 0) {
      const uniqueInvited = [...new Set(invitedUserIds)].filter((id) => id !== user.id);
      if (uniqueInvited.length > 0) {
        const validUsers = await prisma.user.findMany({
          where: { id: { in: uniqueInvited }, status: "ACTIVE" },
          select: { id: true },
        });
        for (const invitedUser of validUsers) {
          await prisma.eventInvite.upsert({
            where: { eventId_userId: { eventId: event.id, userId: invitedUser.id } },
            update: {},
            create: {
              eventId: event.id,
              userId: invitedUser.id,
              invitedByUserId: user.id,
            },
          });
        }
      }
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
        ...eventVisibilityWhere(currentUser.id),
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
