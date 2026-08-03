import type { EventParticipantPresenceState } from "@/lib/event-participant-presence";

type LobbyMediaControlDevice = "mic" | "camera";

export type LobbyMediaControlPermission =
  | {
      allowed: true;
      controlKind: "self" | "remote";
    }
  | {
      allowed: false;
      reason:
        | "TARGET_NOT_IN_LOBBY"
        | "ACTOR_NOT_AUTHORIZED"
        | "UNKNOWN_TARGET_LOCATION";
    };

export function resolveLobbyMediaControlPermission(params: {
  actor: {
    participantId: string | null;
    isEventOwner: boolean;
  };
  target: {
    participantId: string;
  };
  targetPresence: {
    state: EventParticipantPresenceState | null | undefined;
  };
  device: LobbyMediaControlDevice;
}): LobbyMediaControlPermission {
  void params.device;

  if (!params.targetPresence.state) {
    return { allowed: false, reason: "UNKNOWN_TARGET_LOCATION" };
  }
  if (params.targetPresence.state !== "IN_LOBBY") {
    return { allowed: false, reason: "TARGET_NOT_IN_LOBBY" };
  }
  if (
    params.actor.participantId &&
    params.actor.participantId === params.target.participantId
  ) {
    return { allowed: true, controlKind: "self" };
  }
  if (params.actor.isEventOwner) {
    return { allowed: true, controlKind: "remote" };
  }
  return { allowed: false, reason: "ACTOR_NOT_AUTHORIZED" };
}
