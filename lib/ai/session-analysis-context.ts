import { prisma } from "@/lib/prisma";

export type SessionAnalysisParticipant = {
  id: string;
  displayName: string;
  type: string;
  roleName: string | null;
  notes: string;
};

export type SessionAnalysisRole = {
  id: string;
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
};

export type SessionAnalysisTranscript = {
  id: string;
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  segments: Array<{
    speakerLabel: string | null;
    mappedParticipantName: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    text: string;
  }>;
};

export type SessionAnalysisContext = {
  session: {
    id: string;
    title: string;
    roomLabel: string | null;
    status: string;
    caseTitle: string;
    caseLanguage: string;
    publicInstructions: string;
    businessContext: string;
    preparationDurationSeconds: number;
    durationSeconds: number;
    startedAt: string | null;
    endedAt: string | null;
    negotiationStartedAt: string | null;
    negotiationEndedAt: string | null;
    sequenceNumber: number | null;
  };
  event: {
    id: string;
    title: string;
    status: string;
  } | null;
  roles: SessionAnalysisRole[];
  participants: SessionAnalysisParticipant[];
  transcript: SessionAnalysisTranscript | null;
};

export async function buildSessionAnalysisContext(
  sessionId: string,
): Promise<SessionAnalysisContext | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: {
      event: {
        select: { id: true, title: true, status: true },
      },
      sessionRoles: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          privateInstructions: true,
          objectives: true,
          constraints: true,
          hiddenInfo: true,
          fallbackPosition: true,
        },
      },
      participants: {
        select: {
          id: true,
          displayName: true,
          type: true,
          notes: true,
          sessionRole: {
            select: { name: true },
          },
        },
      },
      transcript: {
        include: {
          segments: {
            orderBy: { orderIndex: "asc" },
            include: {
              mappedParticipant: {
                select: { displayName: true },
              },
            },
          },
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  const participants: SessionAnalysisParticipant[] = session.participants.map(
    (p) => ({
      id: p.id,
      displayName: p.displayName,
      type: p.type,
      roleName: p.sessionRole?.name ?? null,
      notes: p.notes,
    }),
  );

  const roles: SessionAnalysisRole[] = session.sessionRoles.map((r) => ({
    id: r.id,
    name: r.name,
    privateInstructions: r.privateInstructions,
    objectives: r.objectives,
    constraints: r.constraints,
    hiddenInfo: r.hiddenInfo,
    fallbackPosition: r.fallbackPosition,
  }));

  let transcript: SessionAnalysisTranscript | null = null;
  if (session.transcript) {
    const t = session.transcript;
    transcript = {
      id: t.id,
      text: t.text,
      diarizedText: t.diarizedText,
      language: t.language,
      transcriptionModel: t.transcriptionModel,
      hasSpeakerDiarization: t.hasSpeakerDiarization,
      segments: t.segments.map((seg) => ({
        speakerLabel: seg.speakerLabel,
        mappedParticipantName: seg.mappedParticipant?.displayName ?? null,
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds,
        text: seg.text,
      })),
    };
  }

  return {
    session: {
      id: session.id,
      title: session.title,
      roomLabel: session.roomLabel,
      status: session.status,
      caseTitle: session.snapshotCaseTitle,
      caseLanguage: session.snapshotCaseLanguage,
      publicInstructions: session.snapshotPublicInstructions,
      businessContext: session.snapshotBusinessContext,
      preparationDurationSeconds: session.preparationDurationSeconds,
      durationSeconds: session.durationSeconds,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      negotiationStartedAt: session.negotiationStartedAt?.toISOString() ?? null,
      negotiationEndedAt: session.negotiationEndedAt?.toISOString() ?? null,
      sequenceNumber: session.sequenceNumber,
    },
    event: session.event
      ? {
          id: session.event.id,
          title: session.event.title,
          status: session.event.status,
        }
      : null,
    roles,
    participants,
    transcript,
  };
}

export function buildAnalysisPrompt(context: SessionAnalysisContext): string {
  const lines: string[] = [];

  lines.push("# NegotAItions — Negotiation Session Analysis Request");
  lines.push("");
  lines.push(
    "You are an expert negotiation coach. Analyze the following negotiation session and provide a detailed structured assessment.",
  );
  lines.push("");
  lines.push("## Instructions");
  lines.push(
    "- Base your analysis ONLY on the transcript, notes, and session data provided.",
  );
  lines.push(
    "- If evidence is insufficient, explicitly state so and give conservative scores.",
  );
  lines.push(
    "- If speaker attribution is missing, set confidenceLevel to LOW or MEDIUM.",
  );
  lines.push(
    "- Do not invent facts, timestamps, or quotes not present in the transcript.",
  );
  lines.push("- Scores must be integers 0–100.");
  lines.push(
    `- Output language: ${context.session.caseLanguage === "RU" ? "Russian" : "English"}.`,
  );
  lines.push("");

  lines.push("## Session Metadata");
  lines.push(`- Title: ${context.session.title}`);
  lines.push(`- Case: ${context.session.caseTitle}`);
  if (context.event) {
    lines.push(`- Event: ${context.event.title}`);
  }
  if (context.session.sequenceNumber) {
    lines.push(`- Session number: ${context.session.sequenceNumber}`);
  }
  lines.push(
    `- Preparation duration: ${Math.round(context.session.preparationDurationSeconds / 60)} min`,
  );
  lines.push(
    `- Negotiation duration: ${Math.round(context.session.durationSeconds / 60)} min`,
  );
  lines.push("");

  lines.push("## Case Context (Public)");
  lines.push(context.session.businessContext || "(not available)");
  lines.push("");
  lines.push("## Public Instructions");
  lines.push(context.session.publicInstructions || "(not available)");
  lines.push("");

  if (context.roles.length > 0) {
    lines.push("## Roles & Private Briefings (Facilitator Only)");
    for (const role of context.roles) {
      lines.push(`### Role: ${role.name}`);
      lines.push(`- Objectives: ${role.objectives}`);
      lines.push(`- Constraints: ${role.constraints}`);
      lines.push(`- Hidden info: ${role.hiddenInfo}`);
      lines.push(`- Fallback position: ${role.fallbackPosition}`);
    }
    lines.push("");
  }

  if (context.participants.length > 0) {
    lines.push("## Participants");
    for (const p of context.participants) {
      const roleLabel = p.roleName ? ` (Role: ${p.roleName})` : "";
      lines.push(`- ${p.displayName}${roleLabel} [${p.type}]`);
      if (p.notes?.trim()) {
        lines.push(`  Notes: ${p.notes.trim()}`);
      }
    }
    lines.push("");
  }

  if (context.transcript) {
    lines.push("## Transcript");
    if (
      context.transcript.hasSpeakerDiarization &&
      context.transcript.diarizedText?.trim()
    ) {
      lines.push("(Speaker-attributed transcript)");
      lines.push(context.transcript.diarizedText.trim());
    } else if (context.transcript.text?.trim()) {
      lines.push("(Plain transcript — speaker attribution not available)");
      lines.push(context.transcript.text.trim());
    } else {
      lines.push("(Transcript is empty)");
    }
    lines.push("");
    if (context.transcript.language) {
      lines.push(`Transcript language: ${context.transcript.language}`);
    }
  } else {
    lines.push("## Transcript");
    lines.push("(No transcript available)");
    lines.push("");
  }

  return lines.join("\n");
}
