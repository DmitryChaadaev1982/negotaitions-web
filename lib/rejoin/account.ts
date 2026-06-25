import type { AuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RejoinTargetType = "room" | "lobby" | "materials";

export type AccountRejoinTarget = {
  type: RejoinTargetType;
  href: string;
  title: string;
  subtitle: string;
  role: "HOST" | "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  status: string;
};

function roleFromParticipant(
  participantType: "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | null,
  isHostOwner: boolean,
): AccountRejoinTarget["role"] {
  if (isHostOwner) return "HOST";
  return participantType ?? "PARTICIPANT";
}

export async function getAccountRejoinTargets(
  user: AuthUser,
): Promise<AccountRejoinTarget[]> {
  const sessions = await prisma.session.findMany({
    where: {
      deletedAt: null,
      OR: [
        { event: { hostUserId: user.id } },
        { participants: { some: { userId: user.id } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      negotiationState: true,
      closedByEventAt: true,
      status: true,
      event: {
        select: {
          id: true,
          title: true,
          status: true,
          hostUserId: true,
        },
      },
      participants: {
        where: { userId: user.id },
        select: { type: true },
        take: 1,
      },
    },
  });

  const activeSessionTargets: AccountRejoinTarget[] = sessions
    .filter((session) => session.negotiationState !== "FINISHED" && !session.closedByEventAt)
    .map((session) => ({
      type: "room",
      href: `/room/${session.id}`,
      title: session.title,
      subtitle: session.event?.title ?? "",
      role: roleFromParticipant(
        (session.participants[0]?.type as "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | null) ?? null,
        session.event?.hostUserId === user.id,
      ),
      status: session.status,
    }));

  const activeEvent = await prisma.trainingEvent.findFirst({
    where: {
      deletedAt: null,
      status: { notIn: ["COMPLETED", "CANCELLED"] },
      OR: [{ hostUserId: user.id }, { participants: { some: { userId: user.id } } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      hostUserId: true,
      participants: {
        where: { userId: user.id },
        select: { preference: true },
        take: 1,
      },
    },
  });

  const latestFinishedSession = sessions.find(
    (session) => session.negotiationState === "FINISHED" || Boolean(session.closedByEventAt),
  );

  const targets: AccountRejoinTarget[] = [...activeSessionTargets];
  if (activeEvent) {
    targets.push({
      type: "lobby",
      href: `/events/${activeEvent.id}/lobby`,
      title: activeEvent.title,
      subtitle: activeEvent.participants[0]?.preference ?? "",
      role: activeEvent.hostUserId === user.id ? "HOST" : "PARTICIPANT",
      status: activeEvent.status,
    });
  }
  if (latestFinishedSession) {
    targets.push({
      type: "materials",
      href: `/sessions/${latestFinishedSession.id}/materials`,
      title: latestFinishedSession.title,
      subtitle: latestFinishedSession.event?.title ?? "",
      role: roleFromParticipant(
        (latestFinishedSession.participants[0]?.type as "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | null) ??
          null,
        latestFinishedSession.event?.hostUserId === user.id,
      ),
      status: latestFinishedSession.status,
    });
  }

  return targets;
}
