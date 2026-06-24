"use client";

import { CaseLanguageBadge } from "@/components/case-language-badge";
import { StatusBadge } from "@/components/badge";
import { Card, CardContent, CardHeader } from "@/components/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import { ParticipantNotesPanel } from "@/components/participant-notes-panel";
import { RoleBriefingCard } from "@/components/role-briefing-card";
import { SessionMaterialsDashboard } from "@/components/session-materials-dashboard";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { AppShell } from "@/components/ui/app-shell";
import { BrandLogo } from "@/components/ui/brand-logo";
import { SecondaryButtonLink } from "@/components/ui/buttons";
import { buildSessionMaterialsPath, buildSessionRoomPath } from "@/lib/config";
import type { SessionDisplayStatus } from "@/lib/session-display-status";
import { isSessionActiveForRoom } from "@/lib/session-overview-shared";
import type {
  SessionMaterialsProcessingSnapshot,
  SessionMaterialsRecordingSnapshot,
  SessionMaterialsTranscriptSnapshot,
} from "@/lib/session-materials-processing";
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
    caseTitle: string;
    roomLabel: string | null;
    preparationDurationMinutes: number;
    negotiationDurationMinutes: number;
    displayStatus: SessionDisplayStatus;
    negotiationState: string;
    isDeleted?: boolean;
    closedByEvent?: boolean;
    closedBeforeNegotiation?: boolean;
    closedByEventAt?: string | null;
  };
  event: {
    title: string;
    lobbyUrl: string;
  } | null;
  eventSessions: Array<{
    id: string;
    roomLabel: string | null;
    title: string;
    caseTitle: string;
    roleName: string | null;
    status: string;
    createdAt: string;
    joinToken: string;
    isActive: boolean;
  }>;
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
  recording: SessionMaterialsRecordingSnapshot;
  transcript: SessionMaterialsTranscriptSnapshot;
  processing?: SessionMaterialsProcessingSnapshot;
};

export function JoinPageView({
  joinToken,
  session,
  participant,
  negotiationCase,
  event,
  eventSessions,
  caseRole,
  assignedParticipants,
  showNotes,
  notesVariant,
  recording,
  transcript,
  processing,
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
    <div className="min-h-full app-gradient-bg" data-testid="session-materials-page">
      <header className="glass-header sticky top-0 z-50" data-testid="session-materials-header">
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
          {event ? (
            <p className="text-sm text-cyan-300" data-testid="session-event-title">
              {event.title}
            </p>
          ) : null}
          {session.roomLabel ? (
            <p className="text-sm font-medium text-cyan-300" data-testid="session-room-label">
              {session.roomLabel}
            </p>
          ) : null}
          <p className="text-base text-slate-300" data-testid="session-case-title">
            {session.caseTitle}
          </p>
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
            <span data-testid="session-status">
              <SessionStatusBadge status={session.displayStatus} />
            </span>
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
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {event ? (
              <SecondaryButtonLink
                href={event.lobbyUrl}
                className="w-full text-center sm:w-auto"
                data-testid="back-to-event-lobby-link"
              >
                {t("events.returnToEventLobby")}
              </SecondaryButtonLink>
            ) : null}
            {!session.isDeleted && roomActive ? (
              <SecondaryButtonLink
                href={roomHref}
                className="w-full text-center sm:w-auto"
                data-testid="join-video-room-button"
              >
                {t("join.joinVideoRoom")}
              </SecondaryButtonLink>
            ) : null}
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
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-50" data-testid="public-context-section">
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
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                {negotiationCase.description}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-50">
                {t("join.publicInstructions")}
              </h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                {negotiationCase.publicInstructions}
              </p>
            </div>
            {isParticipant && caseRole ? (
              <div>
                <h3 className="text-sm font-medium text-slate-50">
                  {t("join.yourRole")}
                </h3>
                <p className="mt-2 text-sm text-slate-300">{caseRole.name}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {isParticipant && caseRole ? (
          <div data-testid="private-role-section">
            <RoleBriefingCard
              title={t("join.yourRoleTitle", { name: caseRole.name })}
              subtitle={t("join.privateBriefingVisible")}
              warning={t("join.privateBriefingWarning")}
              role={caseRole}
            />
          </div>
        ) : null}

        {isFacilitator ? (
          <Card data-testid="private-role-section">
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

        <SessionMaterialsDashboard
          sessionId={session.id}
          joinToken={joinToken}
          recording={recording}
          transcript={transcript}
          processing={processing}
        />

        {eventSessions.length > 0 ? (
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-50" data-testid="my-sessions-in-event-section">
                {isFacilitator
                  ? t("events.sessionsInThisEvent")
                  : t("events.mySessionsInThisEvent")}
              </h2>
            </CardHeader>
            <CardContent className="space-y-2">
              {eventSessions.map((item) => {
                const isCurrentSession = item.joinToken === joinToken;

                return (
                  <div
                    key={item.id}
                    className={`flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                      isCurrentSession
                        ? "border-cyan-500/40 bg-cyan-950/20"
                        : "border-slate-700/40 bg-slate-900/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-slate-100">
                        {item.roomLabel ?? item.title}
                      </p>
                      <p className="break-words text-xs text-slate-400">
                        {item.caseTitle}
                        {item.roleName ? ` · ${item.roleName}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.isActive ? (
                        <SecondaryButtonLink
                          href={buildSessionRoomPath(item.id, item.joinToken)}
                          data-testid="join-video-room-button"
                        >
                          {t("events.openRoom")}
                        </SecondaryButtonLink>
                      ) : null}
                      {isCurrentSession ? (
                        <span className="inline-flex items-center rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-200">
                          {t("join.sessionMaterials")}
                        </span>
                      ) : (
                        <SecondaryButtonLink
                          href={buildSessionMaterialsPath(item.joinToken)}
                          data-testid="open-session-materials-link"
                        >
                          {t("events.openMaterials")}
                        </SecondaryButtonLink>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {showNotes ? (
          <Card data-testid="notes-section">
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
