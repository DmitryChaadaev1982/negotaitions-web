"use server";

import { requireActiveUser } from "@/lib/auth";
import {
  getSessionSoundPreferenceForUser,
  sessionSoundPreferenceUpdateSchema,
  updateSessionSoundPreferenceForUser,
  type SessionSoundPreference,
} from "@/lib/session-sound-preference";

export async function getOwnSessionSoundPreference(): Promise<SessionSoundPreference> {
  const user = await requireActiveUser();
  return getSessionSoundPreferenceForUser(user.id);
}

export async function updateOwnSessionSoundPreference(
  sessionSoundEnabled: boolean,
): Promise<SessionSoundPreference> {
  const user = await requireActiveUser();
  const parsed = sessionSoundPreferenceUpdateSchema.safeParse({
    sessionSoundEnabled,
  });
  if (!parsed.success) {
    throw new Error("Invalid session sound preference payload.");
  }
  return updateSessionSoundPreferenceForUser(user.id, parsed.data);
}
