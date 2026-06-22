"use client";

import "@livekit/components-styles";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, DifficultyBadge } from "@/components/badge";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { ConnectionStatusBadge } from "@/components/connection-status-badge";
import { EventLobbyPresence } from "@/components/event-lobby-presence";
import { EventLobbyVideoRoom } from "@/components/event-lobby-video-room";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import {
  GradientButton,
  GradientButtonLink,
  SecondaryButton,
} from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { BrandLogo } from "@/components/ui/brand-logo";
import {
  alertErrorClassName,
  inputClassName,
  labelClassName,
} from "@/components/ui/form-styles";
import { getJoinUrl } from "@/lib/config";
import type { EventAssignmentDraft } from "@/lib/event-assignment";
import type { EventStateResponse } from "@/lib/event-state";
import { saveRecoveryContext, touchRecoveryContext } from "@/lib/rejoin/recovery-storage";
import { useI18n } from "@/lib/i18n/useI18n";

type EventLobbyViewProps = {
  eventId: string;
  hostToken?: string;
  participantToken?: string;
};

type LiveKitTokenResponse = {
  token: string;
  serverUrl: string;
  roomName: string;
  displayName: string;
  isHost: boolean;
};

function deviceWarningLabel(
  warning: string | null,
  t: (key: "events.cameraUnavailable" | "events.microphoneUnavailable") => string,
) {
  if (warning === "cameraUnavailable") {
    return t("events.cameraUnavailable");
  }
  if (warning === "microphoneUnavailable") {
    return t("events.microphoneUnavailable");
  }
  return null;
}

export function EventLobbyView({
  eventId,
  hostToken,
  participantToken,
}: EventLobbyViewProps) {
  const { t } = useI18n();
  const [state, setState] = useState<EventStateResponse | null>(null);
  const [liveKit, setLiveKit] = useState<LiveKitTokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [deviceWarning, setDeviceWarning] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const accessQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (hostToken) params.set("hostToken", hostToken);
    if (participantToken) params.set("participantToken", participantToken);
    return params.toString();
  }, [hostToken, participantToken]);

  const fetchState = useCallback(async () => {
    const response = await fetch(
      `/api/events/${eventId}/state?${accessQuery}`,
      { cache: "no-store" },
    );

    if (response.status === 410) {
      setError("eventUnavailable");
      return null;
    }

    if (!response.ok) {
      setError("invalidAccess");
      return null;
    }

    const data = (await response.json()) as EventStateResponse;
    setState(data);
    setError(null);
    return data;
  }, [accessQuery, eventId]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const [nextState, tokenResponse] = await Promise.all([
          fetch(`/api/events/${eventId}/state?${accessQuery}`, { cache: "no-store" }),
          fetch(`/api/events/${eventId}/livekit-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hostToken: hostToken || undefined,
              participantToken: participantToken || undefined,
            }),
          }),
        ]);

        if (!active) return;

        if (nextState.status === 410) {
          setError("eventUnavailable");
          return;
        }

        if (!nextState.ok) {
          setError("invalidAccess");
          return;
        }

        setState((await nextState.json()) as EventStateResponse);
        setError(null);

        if (tokenResponse.ok) {
          setLiveKit((await tokenResponse.json()) as LiveKitTokenResponse);
        } else {
          setError(
            tokenResponse.status === 410 ? "eventUnavailable" : "livekitTokenFailed",
          );
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [accessQuery, eventId, hostToken, participantToken]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchState();
      touchRecoveryContext();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [fetchState]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const displayName =
      state.currentParticipant?.displayName ?? liveKit?.displayName;

    saveRecoveryContext({
      type: "EVENT_LOBBY",
      eventId,
      hostToken,
      participantToken,
      displayName,
    });

    const assignment = state.currentParticipant
      ? state.participants.find((participant) => participant.id === state.currentParticipant?.id)
      : null;

    if (assignment?.joinToken) {
      saveRecoveryContext({
        type: "SESSION_JOIN",
        eventId,
        sessionId: assignment.assignedSessionId ?? undefined,
        hostToken,
        participantToken,
        joinToken: assignment.joinToken,
        displayName,
      });
    }
  }, [eventId, hostToken, liveKit?.displayName, participantToken, state]);

  const updateHost = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!hostToken) return;

      const response = await fetch(`/api/events/${eventId}/host`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken, ...payload }),
      });

      if (response.ok) {
        const data = (await response.json()) as EventStateResponse;
        setState(data);
      }
    },
    [eventId, hostToken],
  );

  const updatePreference = useCallback(
    async (preference: string) => {
      if (!participantToken) return;

      const response = await fetch(`/api/events/${eventId}/participant`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantToken, preference }),
      });

      if (response.ok) {
        const data = (await response.json()) as EventStateResponse;
        setState(data);
      }
    },
    [eventId, participantToken],
  );

  const createSession = useCallback(async () => {
    if (!hostToken || !state) return;

    setIsCreatingSession(true);

    try {
      const response = await fetch(`/api/events/${eventId}/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken }),
      });

      if (response.ok) {
        const data = await response.json();
        setState(data.state as EventStateResponse);
      }
    } finally {
      setIsCreatingSession(false);
    }
  }, [eventId, hostToken, state]);

  const copyJoinLink = useCallback(async () => {
    if (!state) return;
    const url = `${window.location.origin}/events/join/${state.event.publicJoinCode}`;
    await navigator.clipboard.writeText(url);
    setCopyMessage(t("events.linkCopied"));
    window.setTimeout(() => setCopyMessage(null), 2000);
  }, [state, t]);

  if (error === "eventUnavailable") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#020617] px-4 text-center">
        <BrandLogo size="lg" href={undefined} />
        <h1 className="text-xl font-bold text-slate-50">{t("events.eventUnavailableTitle")}</h1>
        <p className="max-w-md text-slate-400">{t("events.eventUnavailable")}</p>
        <GradientButtonLink href="/">{t("common.goToHome")}</GradientButtonLink>
      </div>
    );
  }

  if (isBootstrapping && !error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] px-4">
        <p className="text-sm text-slate-400">{t("common.loading")}…</p>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] px-4">
        <div className={alertErrorClassName}>
          {t("common.error")}: {error ?? t("common.loading")}
        </div>
      </div>
    );
  }

  const draft = state.assignmentDraft;
  const isHost = state.isHost;
  const currentAssignment = state.currentParticipant
    ? state.participants.find((p) => p.id === state.currentParticipant?.id)
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#020617]">
      {participantToken || hostToken ? (
        <EventLobbyPresence
          eventId={eventId}
          participantToken={participantToken}
          hostToken={hostToken}
        />
      ) : null}
      <header className="glass-header border-b border-slate-700/40 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <BrandLogo size="sm" href={isHost ? "/events" : undefined} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-cyan-400/80">
                {t("events.eventLobby")}
              </p>
              <h1 className="text-lg font-bold text-slate-50">{state.event.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isHost ? (
              <SecondaryButton type="button" onClick={() => void copyJoinLink()}>
                {t("events.copyEventJoinLink")}
              </SecondaryButton>
            ) : null}
            <LanguageSwitcher />
            <RejoinNavLink />
          </div>
        </div>
        {copyMessage ? (
          <p className="mx-auto mt-2 max-w-[1600px] text-sm text-emerald-400">{copyMessage}</p>
        ) : null}
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-4 lg:flex-row lg:overflow-hidden">
        <section className="glass-panel flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-600/25 lg:min-h-0">
          <div className="shrink-0 border-b border-slate-600/25 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-50">{t("events.commonLobby")}</h2>
            <p className="text-xs text-slate-400">
              {liveKit?.displayName ?? state.currentParticipant?.displayName ?? "Host"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{t("events.singleDeviceHint")}</p>
          </div>
          <div className="relative min-h-[360px] flex-1 bg-black/40">
            {deviceWarning ? (
              <p className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                {deviceWarningLabel(deviceWarning, t)}
              </p>
            ) : null}
            {liveKit ? (
              <EventLobbyVideoRoom
                token={liveKit.token}
                serverUrl={liveKit.serverUrl}
                onDeviceWarning={setDeviceWarning}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                {t("common.loading")}…
              </div>
            )}
          </div>
        </section>

        <aside className="glass-panel flex w-full flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-600/25 p-4 lg:w-[380px] lg:shrink-0 xl:w-[420px]">
          {state.currentParticipant ? (
            <GlassCard elevated>
              <GlassCardHeader>
                <h3 className="text-sm font-semibold text-slate-50">
                  {state.currentParticipant.displayName}
                  {isHost ? (
                    <span className="ml-2 text-xs font-normal text-cyan-400">
                      ({t("events.hostLabel")})
                    </span>
                  ) : null}
                </h3>
              </GlassCardHeader>
              <GlassCardContent className="space-y-3">
                <p className="text-xs font-medium text-slate-400">{t("events.yourPreference")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["UNDECIDED", t("events.undecided")],
                      ["PLAY", t("events.wantToPlay")],
                      ["OBSERVE", t("events.wantToObserve")],
                      ["FACILITATE", t("events.canFacilitate")],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void updatePreference(value)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                        state.currentParticipant?.preference === value
                          ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                          : "border-slate-600/40 bg-slate-900/50 text-slate-300 hover:border-slate-500/50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          <GlassCard elevated>
            <GlassCardHeader>
              <h3 className="text-sm font-semibold text-slate-50">
                {t("events.participantsInLobby")}
              </h3>
            </GlassCardHeader>
            <GlassCardContent className="space-y-2">
              {state.participants.length === 0 ? (
                <p className="text-sm text-slate-400">{t("events.noParticipantsYet")}</p>
              ) : (
                state.participants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-600/30 bg-slate-900/50 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-slate-100">
                      {participant.displayName}
                      {participant.isHost ? (
                        <span className="ml-1.5 text-xs font-normal text-cyan-400">
                          ({t("events.hostLabel")})
                        </span>
                      ) : null}
                    </span>
                    <div className="flex flex-col items-end gap-1">
                      <ConnectionStatusBadge
                        lastSeenAt={participant.lastSeenAt}
                        showLastSeen={isHost}
                      />
                      <Badge variant="default" className="text-[10px]">
                        {participant.preference === "PLAY"
                          ? t("events.wantToPlay")
                          : participant.preference === "OBSERVE"
                            ? t("events.wantToObserve")
                            : participant.preference === "FACILITATE"
                              ? t("events.canFacilitate")
                              : t("events.undecided")}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </GlassCardContent>
          </GlassCard>

          {state.selectedCase ? (
            <GlassCard elevated>
              <GlassCardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-50">
                    {t("events.selectedCase")}
                  </h3>
                  <CaseLanguageBadge caseLanguage={state.selectedCase.caseLanguage} />
                </div>
              </GlassCardHeader>
              <GlassCardContent className="space-y-3 text-sm">
                <p className="font-medium text-slate-100">{state.selectedCase.title}</p>
                <DifficultyBadge difficulty={state.selectedCase.difficulty} />
                <p className="text-xs text-slate-400">
                  {t("common.preparationDurationValue", {
                    minutes: state.selectedCase.defaultPreparationDurationMinutes,
                  })}
                </p>
                <p className="text-xs text-slate-400">
                  {t("common.negotiationDurationValue", {
                    minutes: state.selectedCase.defaultDurationMinutes,
                  })}
                </p>
                <div>
                  <p className="text-xs font-medium text-slate-400">{t("cases.roles")}</p>
                  <p className="mt-1 text-slate-300">
                    {state.selectedCase.roleNames.join(", ")}
                  </p>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-5 text-slate-400">
                  {state.selectedCase.businessContext}
                </p>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {isHost ? (
            <HostControlsPanel
              state={state}
              draft={draft}
              isCreatingSession={isCreatingSession}
              onUpdateHost={updateHost}
              onCreateSession={() => void createSession()}
            />
          ) : null}

          {currentAssignment?.joinToken ? (
            <GlassCard elevated className="border-emerald-500/30">
              <GlassCardContent className="space-y-3">
                <p className="text-sm text-emerald-200">{t("events.assignedToRoom")}</p>
                <p className="text-xs text-slate-400">
                  {currentAssignment.assignedType === "FACILITATOR"
                    ? t("participantType.FACILITATOR")
                    : currentAssignment.assignedType === "OBSERVER"
                      ? t("participantType.OBSERVER")
                      : t("participantType.PARTICIPANT")}
                  {currentAssignment.assignedRoleName
                    ? ` · ${currentAssignment.assignedRoleName}`
                    : ""}
                </p>
                <GradientButtonLink href={getJoinUrl(currentAssignment.joinToken)}>
                  {t("events.goToNegotiationRoom")}
                </GradientButtonLink>
              </GlassCardContent>
            </GlassCard>
          ) : state.createdSession && !currentAssignment?.joinToken ? (
            <GlassCard>
              <GlassCardContent>
                <p className="text-sm text-slate-400">{t("events.notAssignedYet")}</p>
              </GlassCardContent>
            </GlassCard>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function HostControlsPanel({
  state,
  draft,
  isCreatingSession,
  onUpdateHost,
  onCreateSession,
}: {
  state: EventStateResponse;
  draft: EventAssignmentDraft;
  isCreatingSession: boolean;
  onUpdateHost: (payload: Record<string, unknown>) => Promise<void>;
  onCreateSession: () => void;
}) {
  const { t } = useI18n();
  const selectedCase = state.selectedCase;

  const saveDraft = (next: Partial<EventAssignmentDraft>) => {
    const merged: EventAssignmentDraft = {
      ...draft,
      ...next,
    };
    void onUpdateHost({ assignmentDraft: merged });
  };

  return (
    <GlassCard elevated>
      <GlassCardHeader>
        <h3 className="text-sm font-semibold text-slate-50">{t("events.hostControls")}</h3>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
        <div>
          <label className={labelClassName}>{t("events.selectCase")}</label>
          <select
            className={inputClassName(false)}
            value={selectedCase?.id ?? ""}
            onChange={(event) => {
              const caseId = event.target.value || null;
              const selected = state.availableCases.find(
                (negotiationCase) => negotiationCase.id === caseId,
              );
              if (selected) {
                saveDraft({
                  preparationDurationMinutes:
                    selected.defaultPreparationDurationMinutes,
                  negotiationDurationMinutes: selected.defaultDurationMinutes,
                });
              }
              void onUpdateHost({ selectedCaseId: caseId });
            }}
          >
            <option value="">{t("common.selectCase")}</option>
            {state.availableCases.map((negotiationCase) => (
              <option key={negotiationCase.id} value={negotiationCase.id}>
                {negotiationCase.title}
              </option>
            ))}
          </select>
        </div>

        {selectedCase ? (
          <>
            <div>
              <label className={labelClassName}>
                {t("common.preparationTime")}
              </label>
              <input
                type="number"
                min={0}
                max={60}
                className={inputClassName(false)}
                value={draft.preparationDurationMinutes}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  if (!Number.isFinite(minutes)) return;
                  saveDraft({ preparationDurationMinutes: minutes });
                }}
              />
            </div>

            <div>
              <label className={labelClassName}>
                {t("common.negotiationTime")}
              </label>
              <input
                type="number"
                min={1}
                max={180}
                className={inputClassName(false)}
                value={draft.negotiationDurationMinutes}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  if (!Number.isFinite(minutes)) return;
                  saveDraft({ negotiationDurationMinutes: minutes });
                }}
              />
            </div>

            <div>
              <label className={labelClassName}>{t("events.assignFacilitator")}</label>
              <select
                className={inputClassName(false)}
                value={draft.facilitatorEventParticipantId ?? ""}
                onChange={(event) => {
                  saveDraft({
                    facilitatorEventParticipantId: event.target.value || null,
                  });
                }}
              >
                <option value="">{t("common.selectRole")}</option>
                {state.participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>
                    {participant.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <p className={labelClassName}>{t("events.assignRoles")}</p>
              {selectedCase.roles.map((role) => (
                <div key={role.id}>
                  <label className="mb-1 block text-xs text-slate-400">{role.name}</label>
                  <select
                    className={inputClassName(false)}
                    value={draft.roleAssignments[role.id] ?? ""}
                    onChange={(event) => {
                      saveDraft({
                        roleAssignments: {
                          ...draft.roleAssignments,
                          [role.id]: event.target.value,
                        },
                      });
                    }}
                  >
                    <option value="">{t("common.selectRole")}</option>
                    {state.participants.map((participant) => (
                      <option key={participant.id} value={participant.id}>
                        {participant.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div>
              <label className={labelClassName}>{t("events.assignObservers")}</label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-600/30 p-2">
                {state.participants.map((participant) => {
                  const isRolePlayer = Object.values(draft.roleAssignments).includes(
                    participant.id,
                  );
                  const isFacilitator =
                    draft.facilitatorEventParticipantId === participant.id;
                  const checked = draft.observerEventParticipantIds.includes(participant.id);

                  return (
                    <label
                      key={participant.id}
                      className={`flex items-center gap-2 text-sm ${
                        isRolePlayer || isFacilitator
                          ? "text-slate-500"
                          : "text-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isRolePlayer || isFacilitator}
                        checked={checked}
                        onChange={(event) => {
                          const ids = event.target.checked
                            ? [...draft.observerEventParticipantIds, participant.id]
                            : draft.observerEventParticipantIds.filter(
                                (id) => id !== participant.id,
                              );
                          saveDraft({ observerEventParticipantIds: ids });
                        }}
                      />
                      {participant.displayName}
                    </label>
                  );
                })}
              </div>
            </div>

            <GradientButton
              type="button"
              disabled={isCreatingSession || Boolean(state.createdSession)}
              onClick={onCreateSession}
            >
              {state.createdSession
                ? t("events.negotiationSessionCreated")
                : t("events.createNegotiationSession")}
            </GradientButton>

            {state.createdSession ? (
              <p className="text-xs text-slate-400">
                <Link
                  href={`/sessions/${state.createdSession.id}`}
                  className="text-cyan-400 hover:text-cyan-300"
                >
                  {state.createdSession.title}
                </Link>
              </p>
            ) : null}
          </>
        ) : null}
      </GlassCardContent>
    </GlassCard>
  );
}
