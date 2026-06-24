"use client";

import { CaseLanguageBadge } from "@/components/case-language-badge";
import { StatusBadge } from "@/components/badge";
import { Card, CardContent, CardHeader } from "@/components/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import { ParticipantNotesPanel } from "@/components/participant-notes-panel";
import { RoleBriefingCard } from "@/components/role-briefing-card";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { AppShell } from "@/components/ui/app-shell";
import { BrandLogo } from "@/components/ui/brand-logo";
import {
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import { buildSessionRoomPath } from "@/lib/config";
import type { SessionDisplayStatus } from "@/lib/session-display-status";
import { isSessionActiveForRoom } from "@/lib/session-overview-shared";
import { useI18n } from "@/lib/i18n/useI18n";

type RoleBriefing = {
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
};

type JoinPageViewProps = {
  joinToken: string;
  session: {
    id: string;
    title: string;
    preparationDurationMinutes: number;
    negotiationDurationMinutes: number;
    displayStatus: SessionDisplayStatus;
    negotiationState: string;
    isDeleted?: boolean;
    closedByEvent?: boolean;
    closedBeforeNegotiation?: boolean;
    closedByEventAt?: string | null;
  };
  participant: {
    displayName: string;
    type: "PARTICIPANT" | "OBSERVER" | "FACILITATOR";
    notes: string;
  };
  negotiationCase: {
    description: string;
    publicInstructions: string;
    caseLanguage: "RU" | "EN";
  };
  caseRole: RoleBriefing | null;
  assignedParticipants: Array<{
    id: string;
    displayName: string;
    role: RoleBriefing;
  }>;
  showNotes: boolean;
  notesVariant: "preparation" | "observer" | "facilitator";
};

function SessionResultsPlaceholder() {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-slate-50">
          {t("join.resultsSection")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("recording.recording")}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {t("join.recordingNotAvailableYet")}
          </p>
        </div>
        <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("recording.transcript")}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {t("join.transcriptNotAvailableYet")}
          </p>
        </div>
        <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            AI
          </p>
          <p className="mt-1 text-sm text-slate-400">{t("join.aiAnalysisLater")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function JoinPageView({
  joinToken,
  session,
  participant,
  negotiationCase,
  caseRole,
  assignedParticipants,
  showNotes,
  notesVariant,
}: JoinPageViewProps) {
  const { t } = useI18n();

  const isParticipant = participant.type === "PARTICIPANT";
  const isObserver = participant.type === "OBSERVER";
  const isFacilitator = participant.type === "FACILITATOR";

  const roomActive = isSessionActiveForRoom({
    negotiationState: session.negotiationState,
    closedByEventAt: session.closedByEventAt ?? null,
    deletedAt: session.isDeleted ? new Date() : null,
  });
  const isFinishedSession = !roomActive && !session.isDeleted;

  const notesConfig = {
    preparation: {
      title: t("join.preparation"),
      description: t("join.preparationDescription"),
      placeholder: t("join.preparationPlaceholder"),
    },
    observer: {
      title: t("join.observerNotes"),
      description: t("join.observerNotesDescription"),
      placeholder: t("join.observerNotesPlaceholder"),
    },
    facilitator: {
      title: t("join.facilitatorNotes"),
      description: t("join.facilitatorNotesDescription"),
      placeholder: t("join.facilitatorNotesPlaceholder"),
    },
  }[notesVariant];

  const participantTypeLabel = t(
    `participantType.${participant.type}` as `participantType.${typeof participant.type}`,
  );

  const roomHref = buildSessionRoomPath(session.id, joinToken);

  return (
    <div className="min-h-full app-gradient-bg">
      <header className="glass-header sticky top-0 z-50">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <BrandLogo size="sm" href={undefined} />
            <div className="flex items-center gap-4">
              <RejoinNavLink />
              <LanguageSwitcher />
            </div>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-50">
            {t("join.sessionMaterials")}
          </h1>
          <p className="text-base text-slate-300">{session.title}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <span>{t("common.welcome", { name: participant.displayName })}</span>
            <span>·</span>
            <span className="rounded-full border border-slate-600/25 bg-slate-900/70 px-2 py-0.5 text-slate-300">
              {participantTypeLabel}
            </span>
            {isObserver ? (
              <>
                <span>·</span>
                <span>{t("join.joiningAsObserver")}</span>
              </>
            ) : null}
            <SessionStatusBadge status={session.displayStatus} />
            <span>·</span>
            <span>
              {t("common.preparationDurationValue", {
                minutes: session.preparationDurationMinutes,
              })}
            </span>
            <span>·</span>
            <span>
              {t("common.negotiationDurationValue", {
                minutes: session.negotiationDurationMinutes,
              })}
            </span>
          </div>
        </div>
      </header>

      <AppShell narrow className="space-y-6">
        {session.closedByEvent ? (
          <div className="space-y-2 rounded-lg border border-slate-600/30 bg-slate-900/60 px-4 py-3">
            <StatusBadge variant="default">{t("events.closedByEventCompletion")}</StatusBadge>
            <p className="text-sm text-slate-300">
              {session.closedBeforeNegotiation
                ? t("events.sessionClosedBeforeNegotiation")
                : t("events.sessionClosedByEventJoin")}
            </p>
          </div>
        ) : session.isDeleted ? (
          <div className="space-y-2">
            <StatusBadge variant="danger">{t("sessions.deletedBadge")}</StatusBadge>
            <p className="text-sm text-slate-400">
              {t("sessions.deletedSessionReadOnly")}
            </p>
          </div>
        ) : isFinishedSession ? (
          <div className="rounded-lg border border-slate-600/30 bg-slate-900/60 px-4 py-3">
            <p className="text-sm text-slate-300">{t("join.sessionFinishedMessage")}</p>
          </div>
        ) : (
          <SecondaryButtonLink href={roomHref} className="w-full py-3 text-center">
            {t("join.joinVideoRoom")}
          </SecondaryButtonLink>
        )}

        {isFinishedSession ? <SessionResultsPlaceholder /> : null}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-50">
                {t("join.publicContext")}
              </h2>
              <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-slate-50">
                {t("join.caseDescription")}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                {negotiationCase.description}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-50">
                {t("join.publicInstructions")}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                {negotiationCase.publicInstructions}
              </p>
            </div>
          </CardContent>
        </Card>

        {isParticipant && caseRole ? (
          <RoleBriefingCard
            title={t("join.yourRoleTitle", { name: caseRole.name })}
            subtitle={t("join.privateBriefingVisible")}
            warning={t("join.privateBriefingWarning")}
            role={caseRole}
          />
        ) : null}

        {isFacilitator ? (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-50">
                {t("join.participantRoleBriefings")}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {t("join.participantRoleBriefingsDescription")}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {assignedParticipants.length === 0 ? (
                <p className="text-sm text-slate-400">
                  {t("join.noParticipantRoles")}
                </p>
              ) : (
                assignedParticipants.map((sessionParticipant) => (
                  <RoleBriefingCard
                    key={sessionParticipant.id}
                    title={t("join.participantBriefingTitle", {
                      name: sessionParticipant.displayName,
                      role: sessionParticipant.role.name,
                    })}
                    subtitle={t("join.privateBriefingForParticipant")}
                    role={sessionParticipant.role}
                  />
                ))
              )}
            </CardContent>
          </Card>
        ) : null}

        {showNotes ? (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-50">
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

      </AppShell>
    </div>
  );
}
