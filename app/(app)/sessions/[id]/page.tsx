import Link from "next/link";
import { notFound } from "next/navigation";

import { AddParticipantForm } from "@/components/add-participant-form";
import { Card, CardContent, CardHeader } from "@/components/card";
import { PageHeader } from "@/components/page-header";
import { ParticipantsTable } from "@/components/participants-table";
import { SessionDurationEditor } from "@/components/session-duration-editor";
import { SessionStatusActions } from "@/components/session-status-actions";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { getJoinUrl } from "@/lib/config";
import { isAssignableCaseRole } from "@/lib/case-roles";
import { formatDate } from "@/lib/format-date";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SessionDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SessionDetailPage({
  params,
}: SessionDetailPageProps) {
  const { id } = await params;
  const facilitator = await getDemoFacilitator();

  const session = await prisma.session.findFirst({
    where: {
      id,
      facilitatorId: facilitator.id,
    },
    include: {
      negotiationCase: {
        include: {
          roles: {
            orderBy: { sortOrder: "asc" },
          },
        },
      },
      participants: {
        orderBy: { createdAt: "asc" },
        include: {
          caseRole: true,
        },
      },
    },
  });

  if (!session) {
    notFound();
  }

  const facilitatorParticipant = session.participants.find(
    (participant) => participant.type === "FACILITATOR",
  );
  const observerParticipants = session.participants.filter(
    (participant) => participant.type === "OBSERVER",
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title={session.title}
        description="Facilitator view — manage participants, join links, and session status."
        action={
          <Link
            href="/sessions"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Back to sessions
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SessionStatusBadge status={session.status} />
        <span className="text-sm text-slate-500">
          Case:{" "}
          <Link
            href={`/cases/${session.negotiationCase.id}`}
            className="font-medium text-slate-700 hover:text-slate-900"
          >
            {session.negotiationCase.title}
          </Link>
        </span>
        <span className="text-sm text-slate-500">
          Negotiation duration: {secondsToDisplayMinutes(session.durationSeconds)}{" "}
          minutes
        </span>
        <span className="text-sm text-slate-500">
          Created {formatDate(session.createdAt)}
        </span>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            Negotiation settings
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <SessionDurationEditor
            sessionId={session.id}
            durationSeconds={session.durationSeconds}
            negotiationState={session.negotiationState}
          />
          {facilitatorParticipant ? (
            <Link
              href={`/room/${session.id}?joinToken=${encodeURIComponent(facilitatorParticipant.joinToken)}`}
              className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Join Video Room
            </Link>
          ) : (
            <p className="text-sm text-slate-600">
              Add a facilitator participant to join the video room.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            Session status
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <SessionStatusActions
            sessionId={session.id}
            status={session.status}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            Add participant
          </h2>
        </CardHeader>
        <CardContent>
          <AddParticipantForm
            sessionId={session.id}
            caseRoles={session.negotiationCase.roles
              .filter((role) => isAssignableCaseRole(role.name))
              .map((role) => ({
                id: role.id,
                name: role.name,
              }))}
            assignedRoleIds={session.participants
              .filter(
                (participant) =>
                  participant.type === "PARTICIPANT" && participant.caseRoleId,
              )
              .map((participant) => participant.caseRoleId!)}
            hasFacilitator={session.participants.some(
              (participant) => participant.type === "FACILITATOR",
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            Participants
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {session.participants.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-600">
              No participants yet. Add participants above to generate join
              links.
            </div>
          ) : (
            <ParticipantsTable
              sessionId={session.id}
              participants={session.participants.map((participant) => ({
                id: participant.id,
                displayName: participant.displayName,
                type: participant.type,
                caseRoleName: participant.caseRole?.name ?? null,
                joinUrl: getJoinUrl(participant.joinToken),
                joinedAt: participant.joinedAt?.toISOString() ?? null,
                lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
              }))}
            />
          )}
        </CardContent>
      </Card>

      {session.participants.some(
        (participant) => participant.type === "PARTICIPANT" && participant.caseRole,
      ) ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">
              Role briefings
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Private instructions for each assigned role. Visible only on this
              facilitator page.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {session.participants
              .filter(
                (participant) =>
                  participant.type === "PARTICIPANT" && participant.caseRole,
              )
              .map((participant) => (
                <div
                  key={participant.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    {participant.displayName} — {participant.caseRole?.name}
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {participant.caseRole?.privateInstructions}
                  </p>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            Facilitator notes
          </h2>
        </CardHeader>
        <CardContent>
          {!facilitatorParticipant?.notes.trim() ? (
            <p className="text-sm text-slate-600">No facilitator notes yet.</p>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-500">
                {facilitatorParticipant.displayName}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {facilitatorParticipant.notes}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            Observer notes
          </h2>
        </CardHeader>
        <CardContent>
          {observerParticipants.length === 0 ||
          observerParticipants.every((participant) => !participant.notes.trim()) ? (
            <p className="text-sm text-slate-600">No observer notes yet.</p>
          ) : (
            <div className="space-y-4">
              {observerParticipants
                .filter((participant) => participant.notes.trim())
                .map((participant) => (
                  <div
                    key={participant.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  >
                    <p className="text-xs font-medium text-slate-500">
                      {participant.displayName}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {participant.notes}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
