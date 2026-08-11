import { z } from "zod";

import { prisma } from "@/lib/prisma";

export const sessionSoundPreferenceUpdateSchema = z.object({
  sessionSoundEnabled: z.boolean(),
}).strict();

export type SessionSoundPreference = {
  sessionSoundEnabled: boolean;
};

export async function getSessionSoundPreferenceForUser(
  userId: string,
): Promise<SessionSoundPreference> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { sessionSoundEnabled: true },
  });
  return { sessionSoundEnabled: user.sessionSoundEnabled };
}

export async function updateSessionSoundPreferenceForUser(
  userId: string,
  input: SessionSoundPreference,
): Promise<SessionSoundPreference> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { sessionSoundEnabled: input.sessionSoundEnabled },
    select: { sessionSoundEnabled: true },
  });
  return { sessionSoundEnabled: updated.sessionSoundEnabled };
}
