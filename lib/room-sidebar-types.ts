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
};

export type RoomSidebarData = {
  sessionTitle: string;
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
  facilitatorBriefings: Array<{
    displayName: string;
    role: RoleBriefing;
  }>;
  roster: SessionRosterEntry[];
};
