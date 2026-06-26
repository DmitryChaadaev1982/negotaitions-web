import { notFound, redirect } from "next/navigation";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type JoinPageProps = {
  params: Promise<{ joinToken: string }>;
};

export default async function JoinPage({ params }: JoinPageProps) {
  const { joinToken } = await params;

  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    select: {
      id: true,
      sessionId: true,
      userId: true,
      eventParticipant: {
        select: {
          id: true,
          userId: true,
        },
      },
      session: {
        select: { deletedAt: true },
      },
    },
  });

  if (!participant || participant.session.deletedAt) {
    notFound();
  }

  const currentUser = await getOptionalCurrentUser();

  if (!currentUser) {
    const returnUrl = encodeURIComponent(`/join/${joinToken}`);
    redirect(`/login?returnUrl=${returnUrl}`);
  }

  if (!isAdmin(currentUser) && currentUser.status !== "ACTIVE") {
    notFound();
  }

  const sessionOwnedByAnotherUser =
    participant.userId && participant.userId !== currentUser.id;
  const eventOwnedByAnotherUser =
    participant.eventParticipant?.userId &&
    participant.eventParticipant.userId !== currentUser.id;
  if (sessionOwnedByAnotherUser || eventOwnedByAnotherUser) {
    notFound();
  }

  const existingUserParticipant = await prisma.sessionParticipant.findFirst({
    where: { sessionId: participant.sessionId, userId: currentUser.id },
    select: { id: true },
  });

  if (!existingUserParticipant) {
    await prisma.$transaction(async (tx) => {
      await tx.sessionParticipant.updateMany({
        where: { id: participant.id, userId: null },
        data: { userId: currentUser.id },
      });

      if (participant.eventParticipant?.id) {
        await tx.eventParticipant.updateMany({
          where: { id: participant.eventParticipant.id, userId: null },
          data: { userId: currentUser.id },
        });
      }
    });
  }

  redirect(`/sessions/${participant.sessionId}/materials`);
}
