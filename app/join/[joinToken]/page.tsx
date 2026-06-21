import Link from "next/link";
import { notFound } from "next/navigation";

import { ParticipantType } from "@/app/generated/prisma/client";
import { Card, CardContent, CardHeader } from "@/components/card";
import { ParticipantNotesPanel } from "@/components/participant-notes-panel";
import { ParticipantPresenceHeartbeat } from "@/components/participant-presence-heartbeat";
import { RoleBriefingCard } from "@/components/role-briefing-card";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { getAppName } from "@/lib/config";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const roleBriefingSelect = {
  name: true,
  privateInstructions: true,
  objectives: true,
  constraints: true,
  hiddenInfo: true,
  fallbackPosition: true,
} as const;

type JoinPageProps = {
  params: Promise<{ joinToken: string }>;
};

export default async function JoinPage({ params }: JoinPageProps) {
  const { joinToken } = await params;
  const appName = getAppName();

  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    include: {
      session: {
        include: {
          negotiationCase: {
            select: {
              description: true,
              publicInstructions: true,
            },
          },
          participants: {
            where: { type: ParticipantType.PARTICIPANT },
            include: {
              caseRole: {
                select: roleBriefingSelect,
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!participant) {
    notFound();
  }

  const isParticipant = participant.type === ParticipantType.PARTICIPANT;
  const isObserver = participant.type === ParticipantType.OBSERVER;
  const isFacilitator = participant.type === ParticipantType.FACILITATOR;
  const showNotes = isParticipant || isObserver || isFacilitator;

  const caseRole =
    isParticipant && participant.caseRoleId
      ? await prisma.caseRole.findUnique({
          where: { id: participant.caseRoleId },
          select: roleBriefingSelect,
        })
      : null;

  const { session } = participant;
  const negotiationCase = session.negotiationCase;
  const assignedParticipants = session.participants.filter(
    (sessionParticipant) => sessionParticipant.caseRole,
  );

  const notesConfig = isParticipant
    ? {
        title: "Preparation",
        description:
          "Capture your negotiation plan, opening moves, and priorities before the session. Visible only to you.",
        placeholder: "Your strategy, target outcomes, walk-away points...",
      }
    : isObserver
      ? {
          title: "Observer notes",
          description:
            "Record your observations and notes for this session. You cannot see participant private briefings.",
          placeholder: "Record observations about the negotiation...",
        }
      : {
          title: "Facilitator notes",
          description:
            "Capture guidance, debrief points, and session observations.",
          placeholder: "Session guidance, debrief points, observations...",
        };

  return (
    <div className="min-h-full bg-slate-50">
      <ParticipantPresenceHeartbeat joinToken={joinToken} />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-4 sm:px-6">
          <p className="text-sm text-slate-500">{appName}</p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {session.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span>Welcome, {participant.displayName}</span>
            <span>·</span>
            <span>{participant.type}</span>
            <SessionStatusBadge status={session.status} />
            <span>·</span>
            <span>
              Negotiation duration:{" "}
              {secondsToDisplayMinutes(session.durationSeconds)} minutes
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <Link
          href={`/room/${session.id}?joinToken=${encodeURIComponent(joinToken)}`}
          className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Join Video Room
        </Link>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">
              Case description
            </h2>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {negotiationCase.description}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">
              Public instructions
            </h2>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {negotiationCase.publicInstructions}
            </p>
          </CardContent>
        </Card>

        {isParticipant && caseRole ? (
          <RoleBriefingCard
            title={`Your role: ${caseRole.name}`}
            subtitle="Private briefing — visible only to you."
            role={caseRole}
          />
        ) : null}

        {isFacilitator ? (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-900">
                Participant role briefings
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Full private briefings for each assigned participant role.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {assignedParticipants.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No participant roles assigned yet.
                </p>
              ) : (
                assignedParticipants.map((sessionParticipant) => (
                  <RoleBriefingCard
                    key={sessionParticipant.id}
                    title={`${sessionParticipant.displayName} — ${sessionParticipant.caseRole!.name}`}
                    subtitle="Private briefing for this participant."
                    role={sessionParticipant.caseRole!}
                  />
                ))
              )}
            </CardContent>
          </Card>
        ) : null}

        {showNotes ? (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-900">
                {notesConfig.title}
              </h2>
            </CardHeader>
            <CardContent>
              <ParticipantNotesPanel
                joinToken={joinToken}
                initialNotes={participant.notes}
                description={notesConfig.description}
                placeholder={notesConfig.placeholder}
              />
            </CardContent>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
