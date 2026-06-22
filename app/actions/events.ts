"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { TrainingEventStatus } from "@/app/generated/prisma/client";
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

export type CreateEventState = {
  errors?: ActionErrors;
};

export async function createTrainingEvent(
  _prevState: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const parsed = createEventSchema.safeParse({
    title: formData.get("title"),
    hostDisplayName: formData.get("hostDisplayName"),
    description: formData.get("description") || undefined,
    scheduledAt: formData.get("scheduledAt") || undefined,
    estimatedEventDurationMinutes: formData.get("estimatedEventDurationMinutes"),
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
    const {
      title,
      hostDisplayName,
      description,
      scheduledAt,
      estimatedEventDurationMinutes,
    } = parsed.data;

    const hostToken = generateHostToken();
    const hostParticipantToken = generateParticipantToken();
    const publicJoinCode = generatePublicJoinCode();
    const event = await prisma.trainingEvent.create({
      data: {
        title,
        description: description || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: TrainingEventStatus.LOBBY_OPEN,
        publicJoinCode,
        hostToken,
        lobbyRoomName: null,
        estimatedEventDurationSeconds: minutesToSeconds(
          estimatedEventDurationMinutes ??
            DEFAULT_EVENT_DURATION_SECONDS / 60,
        ),
        participants: {
          create: {
            displayName: hostDisplayName,
            participantToken: hostParticipantToken,
            isHost: true,
            joinedAt: new Date(),
            lastSeenAt: new Date(),
          },
        },
      },
    });

    const lobbyRoomName = buildEventLobbyRoomName(event.id);
    await prisma.trainingEvent.update({
      where: { id: event.id },
      data: { lobbyRoomName },
    });

    revalidatePath("/events");
    revalidatePath("/dashboard");
    redirect(
      getEventLobbyUrl(event.id, {
        hostToken,
        participantToken: hostParticipantToken,
      }),
    );
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
    displayName: formData.get("displayName") || undefined,
    email: formData.get("email") || undefined,
    preference: formData.get("preference") || undefined,
    participantToken: formData.get("participantToken") || undefined,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        displayName: fieldErrors.displayName,
        preference: fieldErrors.preference,
      },
    };
  }

  const { eventId, displayName, email, preference, participantToken } =
    parsed.data;

  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
  });

  if (
    !event ||
    event.deletedAt ||
    event.status === TrainingEventStatus.CANCELLED ||
    event.status === TrainingEventStatus.COMPLETED
  ) {
    return {
      errors: {
        form: ["eventUnavailable"],
      },
    };
  }

  if (participantToken) {
    const existing = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        participantToken,
      },
    });

    if (existing) {
      await prisma.eventParticipant.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          ...(preference
            ? {
                preference,
                ...flagsFromPreference(preference),
              }
            : {}),
          ...(email ? { email } : {}),
        },
      });

      redirect(getEventLobbyUrl(eventId, { participantToken }));
    }
  }

  if (!displayName || !preference) {
    return {
      errors: {
        displayName: displayName ? undefined : ["displayNameRequired"],
        preference: preference ? undefined : ["preferenceRequired"],
      },
    };
  }

  const newParticipantToken = generateParticipantToken();
  const preferenceFlags = flagsFromPreference(preference);

  await prisma.eventParticipant.create({
    data: {
      eventId,
      displayName,
      email: email || null,
      participantToken: newParticipantToken,
      preference,
      ...preferenceFlags,
      joinedAt: new Date(),
      lastSeenAt: new Date(),
    },
  });

  redirect(getEventLobbyUrl(eventId, { participantToken: newParticipantToken }));
}

export async function cancelTrainingEvent(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");

  if (!eventId) {
    return;
  }

  await prisma.trainingEvent.updateMany({
    where: {
      id: eventId,
      deletedAt: null,
    },
    data: {
      status: TrainingEventStatus.CANCELLED,
      deletedAt: new Date(),
    },
  });

  revalidatePath("/events");
  revalidatePath("/dashboard");
}
