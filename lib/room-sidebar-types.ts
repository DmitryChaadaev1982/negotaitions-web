import type { CaseLanguage, ParticipantType } from "@/app/generated/prisma/enums";
import type { RoleBriefing } from "@/components/role-briefing-card";

export type PublicContext = {
  description: string;
  publicInstructions: string;
  caseLanguage: CaseLanguage;
};

export type SessionRosterEntry = {
  id: string;
  displayName: string;
  participantType: ParticipantType;
  caseRoleName: string | null;
  joinedAt: string | null;
  lastSeenAt: string | null;
  /** Phase 6.11B: DB sessionRoleId — null = unassigned. Only set for PARTICIPANT type. */
  sessionRoleId?: string | null;
};

export type RoomSidebarData = {
  sessionId: string;
  sessionTitle: string;
  visibility: "PUBLIC" | "PRIVATE";
  event: {
    id: string;
    title: string;
    status: string;
    lobbyUrl: string;
  } | null;
  participantType: ParticipantType;
  displayName: string;
  notes: string;
  durationSeconds: number;
  publicContext: PublicContext;
  caseRole: RoleBriefing | null;
  /**
   * Phase 6.11B: Whether the current PARTICIPANT has an assigned role.
   * False = joined but unassigned; materials and prep notes are locked.
   * Always true for FACILITATOR and OBSERVER types.
   */
  hasAssignedRole: boolean;
  facilitatorBriefings: Array<{
    displayName: string;
    role: RoleBriefing;
  }>;
  roster: SessionRosterEntry[];
  /**
   * Phase 6.11B: Assignable roles from the session case snapshot.
   * Only populated for FACILITATOR participants — used by the room role management panel.
   * Empty array for non-facilitators.
   */
  sessionRolesForFacilitator: Array<{ id: string; name: string }>;
};
