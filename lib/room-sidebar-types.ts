import type { ParticipantType } from "@/app/generated/prisma/enums";
import type { RoleBriefing } from "@/components/role-briefing-card";

export type SessionRosterEntry = {
  id: string;
  displayName: string;
  participantType: ParticipantType;
  caseRoleName: string | null;
};

export type RoomSidebarData = {
  sessionTitle: string;
  participantType: ParticipantType;
  displayName: string;
  notes: string;
  durationSeconds: number;
  caseRole: RoleBriefing | null;
  facilitatorBriefings: Array<{
    displayName: string;
    role: RoleBriefing;
  }>;
  roster: SessionRosterEntry[];
};
