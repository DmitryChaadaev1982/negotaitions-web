"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AddParticipantForm } from "@/components/add-participant-form";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { StatusBadge } from "@/components/badge";
import { Card, CardContent, CardHeader } from "@/components/card";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { PageHeader } from "@/components/page-header";
import { ParticipantsTable } from "@/components/participants-table";
import {
  ParticipantNotesModal,
  type ParticipantNotesModalParticipant,
} from "@/components/participant-notes-modal";
import { RoleBriefingCard } from "@/components/role-briefing-card";
import { SessionDisplayStatusBadge } from "@/components/session-display-status-badge";
import { SessionDurationEditor } from "@/components/session-duration-editor";
import {
  GradientButtonLink,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import type { SessionDisplayStatus } from "@/lib/session-display-status";
import type { ParticipantNoteEntry } from "@/lib/participant-notes-types";
import { useI18n } from "@/lib/i18n/useI18n";
import { useSessionNotesPoll } from "@/lib/use-session-notes-poll";

type SessionDetailViewProps = {
  session: {
    id: string;
    title: string;
    durationSeconds: number;
    negotiationState: "LOBBY" | "RUNNING" | "PAUSED" | "FINISHED";
    createdAt: string;
    displayStatus: SessionDisplayStatus;
    isDeleted: boolean;
    caseSnapshot: {
      sourceCaseId: string;
      title: string;
      caseLanguage: "RU" | "EN";
      sourceCaseDeleted: boolean;
      businessContext: string;
      publicInstructions: string;
      roles: Array<{
        id: string;
        name: string;
        privateInstructions: string;
        objectives: string;
        constraints: string;
        hiddenInfo: string;
        fallbackPosition: string;
      }>;
    };
    participants: Array<{
      id: string;
      displayName: string;
      type: string;
      caseRoleName: string | null;
      joinUrl: string;
      joinedAt: string | null;
      lastSeenAt: string | null;
      notesCount: number;
      notes: ParticipantNoteEntry[];
    }>;
    facilitatorParticipant: {
      joinToken: string;
    } | null;
    assignableRoles: Array<{ id: string; name: string }>;
    assignedRoleIds: string[];
    hasFacilitator: boolean;
  };
};

export function SessionDetailView({ session }: SessionDetailViewProps) {
  const { t, locale } = useI18n();
  const [notesModalParticipant, setNotesModalParticipant] =
    useState<ParticipantNotesModalParticipant | null>(null);

  const initialNotesSnapshots = useMemo(
    () =>
      session.participants.map((participant) => ({
        id: participant.id,
        notesCount: participant.notesCount,
        notes: participant.notes,
      })),
    [session.participants],
  );

  const notesByParticipantId = useSessionNotesPoll(
    session.id,
    initialNotesSnapshots,
  );

  const participantsWithLiveNotes = useMemo(
    () =>
      session.participants.map((participant) => {
        const liveNotes = notesByParticipantId.get(participant.id);

        return {
          ...participant,
          notesCount: liveNotes?.notesCount ?? participant.notesCount,
          notes: liveNotes?.notes ?? participant.notes,
        };
      }),
    [session.participants, notesByParticipantId],
  );

  const totalNotesCount = useMemo(
    () =>
      participantsWithLiveNotes.reduce(
        (total, participant) => total + participant.notesCount,
        0,
      ),
    [participantsWithLiveNotes],
  );

  const openNotesModal = (
    participant: SessionDetailViewProps["session"]["participants"][number],
  ) => {
    setNotesModalParticipant({
      id: participant.id,
      displayName: participant.displayName,
      type: participant.type,
      caseRoleName: participant.caseRoleName,
    });
  };

  const closeNotesModal = () => {
    setNotesModalParticipant(null);
  };

  const notesModalEntries = useMemo(() => {
    if (!notesModalParticipant) {
      return [];
    }

    return (
      notesByParticipantId.get(notesModalParticipant.id)?.notes ??
      participantsWithLiveNotes.find(
        (participant) => participant.id === notesModalParticipant.id,
      )?.notes ??
      []
    );
  }, [notesModalParticipant, notesByParticipantId, participantsWithLiveNotes]);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));

  const durationMinutes = Math.round(session.durationSeconds / 60);
  const isReadOnly = session.isDeleted;

  return (
    <div className="space-y-8">
      <PageHeader
        title={session.title}
        description={t("sessions.sessionDetailsDescription")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!isReadOnly ? (
              <DeleteSessionButton sessionId={session.id} variant="button" />
            ) : null}
            <SecondaryButtonLink href="/sessions">
              {t("sessions.backToSessions")}
            </SecondaryButtonLink>
          </div>
        }
      />

      {isReadOnly ? (
        <div className="space-y-3">
          <StatusBadge variant="danger">{t("sessions.deletedBadge")}</StatusBadge>
          <p className="text-sm text-slate-400">
            {t("sessions.deletedSessionReadOnly")}
          </p>
        </div>
      ) : null}

      <GlassCard elevated className="border-blue-500/15">
        <GlassCardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("sessions.sessionDetails")}
          </h2>
        </GlassCardHeader>
        <GlassCardContent>
          <div className="flex flex-wrap items-center gap-3">
            <SessionDisplayStatusBadge
              key={`${session.id}-${session.displayStatus}`}
              sessionId={session.id}
              initialStatus={session.displayStatus}
            />
            <span className="text-sm text-slate-400">
              {t("common.caseLabel")}:{" "}
              {session.caseSnapshot.sourceCaseDeleted ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-300">
                    {session.caseSnapshot.title}
                  </span>
                  <StatusBadge variant="warning">
                    {t("sessions.sourceCaseDeleted")}
                  </StatusBadge>
                </span>
              ) : (
                <Link
                  href={`/cases/${session.caseSnapshot.sourceCaseId}`}
                  className="font-medium text-cyan-400 hover:text-cyan-300"
                >
                  {session.caseSnapshot.title}
                </Link>
              )}
            </span>
            <CaseLanguageBadge caseLanguage={session.caseSnapshot.caseLanguage} />
            <span className="text-sm text-slate-400">
              {t("common.negotiationDurationValue", { minutes: durationMinutes })}
            </span>
            <span className="text-sm text-slate-400">
              {t("common.created")} {formatDate(session.createdAt)}
            </span>
          </div>
        </GlassCardContent>
      </GlassCard>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("sessions.negotiationSettings")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <SessionDurationEditor
            sessionId={session.id}
            durationSeconds={session.durationSeconds}
            negotiationState={session.negotiationState}
            readOnly={isReadOnly}
          />
          {!isReadOnly && session.facilitatorParticipant ? (
            <GradientButtonLink
              href={`/room/${session.id}?joinToken=${encodeURIComponent(session.facilitatorParticipant.joinToken)}`}
            >
              {t("sessions.joinVideoRoom")}
            </GradientButtonLink>
          ) : !isReadOnly ? (
            <p className="text-sm text-slate-400">
              {t("sessions.addFacilitatorToJoin")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {!isReadOnly ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("sessions.addParticipant")}
            </h2>
          </CardHeader>
          <CardContent>
            <AddParticipantForm
              sessionId={session.id}
              sessionRoles={session.assignableRoles}
              assignedRoleIds={session.assignedRoleIds}
              hasFacilitator={session.hasFacilitator}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("sessions.participants")}
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {session.participants.length === 0 ? (
            <div className="px-6 py-8 text-sm text-slate-400">
              {t("sessions.noParticipants")}
            </div>
          ) : (
            <ParticipantsTable
              sessionId={session.id}
              participants={participantsWithLiveNotes}
              readOnly={isReadOnly}
              onViewNotes={openNotesModal}
            />
          )}
        </CardContent>
      </Card>

      {session.participants.length > 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-50">
              {t("sessions.sessionNotes")}
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-400">
              {t("sessions.sessionNotesTotal", { count: totalNotesCount })}
            </p>
            <ul className="space-y-2">
              {participantsWithLiveNotes.map((participant) => {
                const typeLabel = t(
                  `participantType.${participant.type}` as `participantType.PARTICIPANT`,
                );

                return (
                  <li
                    key={participant.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-100">
                        {participant.displayName}
                      </p>
                      <p className="text-xs text-slate-400">
                        {typeLabel}
                        {participant.caseRoleName
                          ? ` · ${participant.caseRoleName}`
                          : ""}
                        {" · "}
                        {participant.notesCount === 0
                          ? t("sessions.noNotesYet")
                          : t("sessions.notesCountMany", {
                              count: participant.notesCount,
                            })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openNotesModal(participant)}
                      className="shrink-0 text-sm font-medium text-cyan-400 hover:text-cyan-300"
                    >
                      {t("sessions.viewNotes")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ParticipantNotesModal
        open={notesModalParticipant != null}
        participant={notesModalParticipant}
        notes={notesModalEntries}
        onClose={closeNotesModal}
      />

      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-50">
            {t("sessions.caseSnapshot")}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {t("sessions.caseSnapshotDescription")}
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold text-slate-50">
                {t("cases.businessContext")}
              </h3>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
                {session.caseSnapshot.businessContext}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold text-slate-50">
                {t("cases.publicInstructions")}
              </h3>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
                {session.caseSnapshot.publicInstructions}
              </p>
            </CardContent>
          </Card>
        </div>

        {session.caseSnapshot.roles.length > 0 ? (
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-slate-50">
              {t("cases.roles")}
            </h3>
            <div className="space-y-4">
              {session.caseSnapshot.roles.map((role) => (
                <RoleBriefingCard
                  key={role.id}
                  title={role.name}
                  role={role}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
