import type { SessionRosterEntry } from "@/lib/room-sidebar-types";
import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";

export type RosterVisualZone =
  | "facilitator"
  | "participant_a"
  | "participant_b"
  | "observer"
  | "unknown";

export type RosterConnectionState = "video_on" | "camera_off" | "connecting" | "not_connected";

export type VisualSlot = "participant_a" | "participant_b";
export type TileMicState = "on" | "off" | "system_muted";

const PARTICIPANT_A_KEYWORDS = ["participant a", "participant_a", "participant-a", "участник а", "buyer", "покупатель"];
const PARTICIPANT_B_KEYWORDS = ["participant b", "participant_b", "participant-b", "участник б", "seller", "продавец"];

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function inferParticipantSlot(caseRoleName: string | null): VisualSlot | null {
  const normalized = normalizeText(caseRoleName);
  if (!normalized) return null;
  if (PARTICIPANT_A_KEYWORDS.some((token) => normalized.includes(token))) return "participant_a";
  if (PARTICIPANT_B_KEYWORDS.some((token) => normalized.includes(token))) return "participant_b";
  return null;
}

function rosterPresenceState(lastSeenAt: string | null): "recent" | "missing" {
  if (!lastSeenAt) return "missing";
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return "missing";
  return Date.now() - parsed <= 30000 ? "recent" : "missing";
}

export function resolveConnectionState(params: {
  hasVideoStream: boolean;
  isLocal: boolean;
  isCameraOn: boolean;
  lastSeenAt: string | null;
}): RosterConnectionState {
  if (params.hasVideoStream) return "video_on";
  if (params.isLocal) return params.isCameraOn ? "connecting" : "camera_off";
  return rosterPresenceState(params.lastSeenAt) === "recent" ? "camera_off" : "not_connected";
}

export function shouldShowDiagnosticsSection(params: {
  unknownRosterCount: number;
  unknownEndpointCount: number;
  debugEnabled: boolean;
}): boolean {
  return (
    params.unknownRosterCount > 0 ||
    params.unknownEndpointCount > 0 ||
    params.debugEnabled
  );
}

export function resolveRemoteMicStateByPolicy(params: {
  negotiationState: NegotiationState;
  participantType: ParticipantType;
}): TileMicState {
  if (
    params.negotiationState === NegotiationState.RUNNING &&
    params.participantType !== ParticipantType.PARTICIPANT
  ) {
    return "system_muted";
  }
  return "on";
}

function participantSortKey(entry: SessionRosterEntry): string {
  return `${normalizeText(entry.caseRoleName)}:${entry.id}`;
}

export type ResolvedRosterRole = {
  zone: RosterVisualZone;
  roleLabel: string;
  diagnosticLabel: string | null;
};

export function resolveRosterVisualRoles(roster: SessionRosterEntry[]): Map<string, ResolvedRosterRole> {
  const resolved = new Map<string, ResolvedRosterRole>();

  const facilitators = roster.filter((entry) => entry.participantType === "FACILITATOR");
  for (const facilitator of facilitators) {
    resolved.set(facilitator.id, {
      zone: "facilitator",
      roleLabel: "Facilitator",
      diagnosticLabel: null,
    });
  }

  const observers = roster.filter((entry) => entry.participantType === "OBSERVER");
  for (const observer of observers) {
    resolved.set(observer.id, {
      zone: "observer",
      roleLabel: "Observer",
      diagnosticLabel: null,
    });
  }

  const participants = roster.filter((entry) => entry.participantType === "PARTICIPANT");
  const unassignedParticipants = participants.filter((entry) => !entry.sessionRoleId);
  for (const participant of unassignedParticipants) {
    resolved.set(participant.id, {
      zone: "observer",
      roleLabel: "Observer (unassigned)",
      diagnosticLabel: null,
    });
  }

  const assignedParticipants = participants.filter((entry) => Boolean(entry.sessionRoleId));
  const explicitA: SessionRosterEntry[] = [];
  const explicitB: SessionRosterEntry[] = [];
  const unknownAssigned: SessionRosterEntry[] = [];

  for (const participant of assignedParticipants) {
    const slot = inferParticipantSlot(participant.caseRoleName);
    if (slot === "participant_a") {
      explicitA.push(participant);
    } else if (slot === "participant_b") {
      explicitB.push(participant);
    } else {
      unknownAssigned.push(participant);
    }
  }

  const slotA = explicitA[0] ?? null;
  const slotB = explicitB[0] ?? null;

  if (slotA) {
    resolved.set(slotA.id, {
      zone: "participant_a",
      roleLabel: "Participant A",
      diagnosticLabel: null,
    });
  }
  if (slotB) {
    resolved.set(slotB.id, {
      zone: "participant_b",
      roleLabel: "Participant B",
      diagnosticLabel: null,
    });
  }

  const overflow = [...explicitA.slice(1), ...explicitB.slice(1)];
  for (const participant of overflow) {
    resolved.set(participant.id, {
      zone: "unknown",
      roleLabel: "Overflow participant role",
      diagnosticLabel: "Multiple participants resolved to the same role slot",
    });
  }

  const fallbackPool = [...unknownAssigned].sort((a, b) =>
    participantSortKey(a).localeCompare(participantSortKey(b)),
  );
  let fallbackIndex = 0;

  if (!slotA && fallbackPool[fallbackIndex]) {
    const participant = fallbackPool[fallbackIndex++];
    resolved.set(participant.id, {
      zone: "participant_a",
      roleLabel: "Participant A",
      diagnosticLabel: `Fallback mapping for role "${participant.caseRoleName ?? "unknown"}"`,
    });
  }
  if (!slotB && fallbackPool[fallbackIndex]) {
    const participant = fallbackPool[fallbackIndex++];
    resolved.set(participant.id, {
      zone: "participant_b",
      roleLabel: "Participant B",
      diagnosticLabel: `Fallback mapping for role "${participant.caseRoleName ?? "unknown"}"`,
    });
  }

  for (let i = fallbackIndex; i < fallbackPool.length; i += 1) {
    const participant = fallbackPool[i];
    resolved.set(participant.id, {
      zone: "unknown",
      roleLabel: "Unknown participant role",
      diagnosticLabel: `Role "${participant.caseRoleName ?? "unknown"}" is outside the two-slot layout`,
    });
  }

  for (const entry of roster) {
    if (resolved.has(entry.id)) continue;
    resolved.set(entry.id, {
      zone: "unknown",
      roleLabel: "Unknown role",
      diagnosticLabel: `Unsupported participant type: ${entry.participantType}`,
    });
  }

  return resolved;
}
