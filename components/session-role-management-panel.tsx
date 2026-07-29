"use client";

import { useActionState, useMemo, useState } from "react";

import {
  assignParticipantRole,
  type AssignParticipantRoleState,
  reassignFacilitator,
  type ReassignSessionFacilitatorState,
} from "@/app/actions/sessions";
import {
  alertErrorClassName,
  alertSuccessClassName,
  inputClassName,
} from "@/components/ui/form-styles";
import { GradientButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";
import { resolveConnectionStatus } from "@/lib/presence";
import {
  derivePanelRoleOptionAvailability,
  deriveRoleSlotSummary,
  deriveRoleAssignmentDraft,
  deriveRoleAssignmentSignature,
  hasRoleAssignmentDraftChanges,
  OBSERVER_DRAFT_VALUE,
  type DraftAssignmentValue,
  type SessionRoleParticipantState,
} from "@/lib/session-role-ui-state";

type SessionRoleOption = {
  id: string;
  name: string;
};

type ParticipantRoleEntry = {
  id: string;
  displayName: string;
  type: string;
  userId?: string | null;
  currentRoleId: string | null;
  currentRoleName: string | null;
  joinedAt: string | null;
  lastSeenAt: string | null;
};

type SessionRoleManagementPanelProps = {
  sessionId: string;
  participants: ParticipantRoleEntry[];
  availableRoles: SessionRoleOption[];
  /**
   * If set, defines visual density while preserving identical assignment semantics.
   * - full: standalone /sessions/[id] management
   * - compact: room sidebar facilitator panel
   */
  variant?: "full" | "compact";
  /**
   * Backward-compatible alias for compact mode.
   * Prefer `variant` for new call sites.
   */
  compact?: boolean;
};

const initialState: AssignParticipantRoleState = {};
const initialFacilitatorState: ReassignSessionFacilitatorState = {};

type JoinStatus = "NOT_JOINED" | "JOINED" | "INACTIVE" | "DISCONNECTED";

/**
 * Phase 6.11B: Facilitator/admin panel for assigning and reassigning roles
 * to already-joined participants.
 *
 * Available in:
 *   A. Standalone Session overview/detail (compact=false)
 *   B. Facilitator video room sidebar (compact=true)
 *
 * Participants cannot see or use this panel.
 * Does not leak private role instructions — only role names are shown here.
 */
export function SessionRoleManagementPanel({
  sessionId,
  participants,
  availableRoles,
  variant,
  compact = false,
}: SessionRoleManagementPanelProps) {
  const { t, tv } = useI18n();
  const resolvedVariant = variant ?? (compact ? "compact" : "full");
  const isCompact = resolvedVariant === "compact";

  // Facilitator rows are displayed separately and excluded from reassignment.
  const manageableParticipants = participants.filter(
    (p) => p.type !== "FACILITATOR",
  );
  const staticParticipants = participants.filter(
    (p) => p.type === "FACILITATOR",
  );

  const participantDraftSource = useMemo<SessionRoleParticipantState[]>(
    () =>
      manageableParticipants.map((participant) => ({
        id: participant.id,
        type: participant.type,
        currentRoleId: participant.currentRoleId,
      })),
    [manageableParticipants],
  );

  const propsDraft = useMemo(
    () => deriveRoleAssignmentDraft(participantDraftSource),
    [participantDraftSource],
  );
  const propsSignature = useMemo(
    () => deriveRoleAssignmentSignature(participantDraftSource),
    [participantDraftSource],
  );

  // Local draft — each participant's selected role before Apply.
  const [draft, setDraft] = useState<Record<string, DraftAssignmentValue>>(
    propsDraft,
  );
  const [baseDraft, setBaseDraft] =
    useState<Record<string, DraftAssignmentValue>>(propsDraft);
  const [baseSignature, setBaseSignature] =
    useState<string>(propsSignature);
  const [state, formAction, isPending] = useActionState(
    async (
      prevState: AssignParticipantRoleState,
      formData: FormData,
    ): Promise<AssignParticipantRoleState> => {
      const result = await assignParticipantRole(prevState, formData);

      if (result.success) {
        setDraft(propsDraft);
        setBaseDraft(propsDraft);
        setBaseSignature(propsSignature);
      }

      return result;
    },
    initialState,
  );
  const [facilitatorState, facilitatorFormAction, facilitatorPending] =
    useActionState(
      async (
        prevState: ReassignSessionFacilitatorState,
        formData: FormData,
      ): Promise<ReassignSessionFacilitatorState> => {
        const result = await reassignFacilitator(prevState, formData);
        return result;
      },
      initialFacilitatorState,
    );

  const facilitatorCandidates = useMemo(
    () => participants.filter((participant) => Boolean(participant.userId)),
    [participants],
  );
  const currentFacilitator = useMemo(
    () =>
      participants.find((participant) => participant.type === "FACILITATOR") ??
      null,
    [participants],
  );
  const [nextFacilitatorSelectionOverride, setNextFacilitatorSelectionOverride] =
    useState<string | null>(null);
  const nextFacilitatorParticipantId =
    nextFacilitatorSelectionOverride ?? currentFacilitator?.id ?? "";
  const [previousFacilitatorType, setPreviousFacilitatorType] = useState<
    "PARTICIPANT" | "OBSERVER"
  >("OBSERVER");
  const [previousFacilitatorSessionRoleId, setPreviousFacilitatorSessionRoleId] =
    useState<string>("");

  const hasUnsavedLocalChanges = useMemo(() => {
    const participantIds = new Set<string>([
      ...Object.keys(baseDraft),
      ...Object.keys(draft),
    ]);

    for (const participantId of participantIds) {
      const baseValue =
        baseDraft[participantId] === undefined ? null : baseDraft[participantId];
      const currentValue =
        draft[participantId] === undefined ? null : draft[participantId];

      if (baseValue !== currentValue) {
        return true;
      }
    }

    return false;
  }, [baseDraft, draft]);
  const propsChangedSinceBase = propsSignature !== baseSignature;
  const hasIncomingServerChanges = propsChangedSinceBase && hasUnsavedLocalChanges;
  const effectiveDraft =
    propsChangedSinceBase && !hasUnsavedLocalChanges ? propsDraft : draft;
  const slotSummary = useMemo(
    () =>
      deriveRoleSlotSummary({
        roles: availableRoles,
        participants: manageableParticipants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          type: participant.type,
          currentRoleId: participant.currentRoleId,
        })),
        draft: effectiveDraft,
      }),
    [availableRoles, effectiveDraft, manageableParticipants],
  );
  const hasUnsavedChanges = useMemo(
    () =>
      hasRoleAssignmentDraftChanges({
        participants: participantDraftSource,
        draft: effectiveDraft,
      }),
    [effectiveDraft, participantDraftSource],
  );

  // Build hidden form fields for all assignments in the draft.
  const formFields = useMemo(() => {
    return manageableParticipants.map((p) => ({
      participantId: p.id,
      roleId:
        effectiveDraft[p.id] === OBSERVER_DRAFT_VALUE
          ? null
          : (effectiveDraft[p.id] ?? null),
      participantType:
        effectiveDraft[p.id] === OBSERVER_DRAFT_VALUE
          ? "OBSERVER"
          : "PARTICIPANT",
    }));
  }, [manageableParticipants, effectiveDraft]);

  if (participants.length === 0) {
    return null;
  }

  const resolveJoinStatus = (participant: ParticipantRoleEntry): JoinStatus => {
    if (!participant.joinedAt && !participant.lastSeenAt) {
      return "NOT_JOINED";
    }

    const status = resolveConnectionStatus(
      participant.lastSeenAt ? new Date(participant.lastSeenAt) : null,
    );

    if (status === "ONLINE") {
      return "JOINED";
    }

    if (status === "RECENTLY_DISCONNECTED") {
      return "INACTIVE";
    }

    return "DISCONNECTED";
  };

  return (
    <div
      className={isCompact ? "space-y-3" : "space-y-4"}
      data-testid="session-role-management-panel"
    >
      {!isCompact ? (
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {t("sessions.participantRoles")}
          </p>
          <p className="text-sm text-slate-400">
            {t("sessions.roleManagementDescription")}
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          {t("sessions.compactRoleManagement")}
        </p>
      )}

      {state.errors?.form ? (
        <div className={alertErrorClassName}>
          {state.errors.form.map((message) => tv(message)).join(", ")}
        </div>
      ) : null}
      {facilitatorState.errors?.form ? (
        <div className={alertErrorClassName}>
          {facilitatorState.errors.form.map((message) => tv(message)).join(", ")}
        </div>
      ) : null}
      {state.success ? (
        <div className={alertSuccessClassName}>
          {t("sessions.roleAssignmentUpdated")}
        </div>
      ) : null}
      {facilitatorState.success ? (
        <div className={alertSuccessClassName}>
          {t("sessions.roleAssignmentUpdated")}
        </div>
      ) : null}
      {hasUnsavedChanges ? (
        <p className="text-xs text-amber-300">
          {t("sessions.roleDraftUnsaved")}
        </p>
      ) : null}
      {hasIncomingServerChanges ? (
        <p className="text-xs text-cyan-300">
          {t("sessions.roleAssignmentsUpdatedElsewhere")}
        </p>
      ) : null}

      {availableRoles.length > 0 ? (
        <div
          className={
            isCompact
              ? "space-y-1 rounded-lg border border-slate-700/40 bg-slate-900/30 px-3 py-2"
              : "space-y-2 rounded-lg border border-slate-700/40 bg-slate-900/30 px-4 py-3"
          }
          data-testid="role-slot-summary"
        >
          {slotSummary.slots.map((slot) => (
            <p
              key={slot.roleId}
              className={isCompact ? "text-xs text-slate-300" : "text-sm text-slate-300"}
            >
              <span className="font-medium text-slate-200">{slot.roleName}</span>
              {" — "}
              {slot.assignedParticipantName ?? t("sessions.roleUnassigned")}
            </p>
          ))}
        </div>
      ) : null}
      {slotSummary.allRolesAssigned ? (
        <div className={isCompact ? "space-y-0.5" : "space-y-1"}>
          <p className="text-xs font-medium text-amber-300">
            {t("sessions.allRolesAssigned")}
          </p>
          <p className="text-xs text-slate-400">
            {t("sessions.newParticipantsObserverOrUnassigned")}
          </p>
        </div>
      ) : null}

      {currentFacilitator && facilitatorCandidates.length > 0 ? (
        <form
          action={facilitatorFormAction}
          className={
            isCompact
              ? "space-y-2 rounded-lg border border-slate-700/40 bg-slate-900/30 p-3"
              : "space-y-3 rounded-lg border border-slate-700/40 bg-slate-900/30 p-4"
          }
        >
          <input type="hidden" name="sessionId" value={sessionId} />
          <input
            type="hidden"
            name="previousFacilitatorSessionRoleId"
            value={previousFacilitatorSessionRoleId}
          />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {t("events.assignFacilitator")}
          </p>
          <select
            name="nextFacilitatorParticipantId"
            value={nextFacilitatorParticipantId}
            onChange={(event) => {
              setNextFacilitatorSelectionOverride(event.target.value);
              setPreviousFacilitatorType("OBSERVER");
              setPreviousFacilitatorSessionRoleId("");
            }}
            className={inputClassName(false)}
            data-testid="reassign-facilitator-select"
          >
            {facilitatorCandidates.map((participant) => (
              <option key={participant.id} value={participant.id}>
                {participant.displayName}
              </option>
            ))}
          </select>

          {nextFacilitatorParticipantId &&
          nextFacilitatorParticipantId !== currentFacilitator.id ? (
            <>
              <select
                name="previousFacilitatorType"
                value={previousFacilitatorType}
                onChange={(event) => {
                  const nextType =
                    event.target.value === "PARTICIPANT"
                      ? "PARTICIPANT"
                      : "OBSERVER";
                  setPreviousFacilitatorType(nextType);
                  if (nextType === "OBSERVER") {
                    setPreviousFacilitatorSessionRoleId("");
                  }
                }}
                className={inputClassName(false)}
                data-testid="previous-facilitator-type-select"
              >
                <option value="OBSERVER">{t("participantType.OBSERVER")}</option>
                <option value="PARTICIPANT">{t("participantType.PARTICIPANT")}</option>
              </select>
              {previousFacilitatorType === "PARTICIPANT" ? (
                <select
                  value={previousFacilitatorSessionRoleId}
                  onChange={(event) =>
                    setPreviousFacilitatorSessionRoleId(event.target.value)
                  }
                  className={inputClassName(false)}
                  data-testid="previous-facilitator-role-select"
                >
                  <option value="">{t("sessions.roleUnassigned")}</option>
                  {derivePanelRoleOptionAvailability({
                    participantId: currentFacilitator.id,
                    participants: participantDraftSource,
                    draft: effectiveDraft,
                    roles: availableRoles,
                  }).map((roleOption) => (
                    <option
                      key={roleOption.id}
                      value={roleOption.id}
                      disabled={roleOption.disabled}
                    >
                      {roleOption.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </>
          ) : (
            <input
              type="hidden"
              name="previousFacilitatorType"
              value="OBSERVER"
            />
          )}

          <GradientButton
            type="submit"
            disabled={
              facilitatorPending ||
              !nextFacilitatorParticipantId ||
              nextFacilitatorParticipantId === currentFacilitator.id
            }
            className={isCompact ? "w-full" : undefined}
            data-testid="reassign-facilitator-button"
          >
            {facilitatorPending ? t("common.saving") : t("events.assignFacilitator")}
          </GradientButton>
        </form>
      ) : null}

      <form action={formAction} className={isCompact ? "space-y-2.5" : "space-y-3"}>
        <input type="hidden" name="sessionId" value={sessionId} />

        {/* Hidden fields for all assignments */}
        {formFields.map(({ participantId, roleId, participantType }) => (
          <span key={participantId}>
            <input
              type="hidden"
              name="sessionParticipantId"
              value={participantId}
            />
            <input
              type="hidden"
              name="sessionRoleId"
              value={roleId ?? ""}
            />
            <input
              type="hidden"
              name="sessionParticipantType"
              value={participantType}
            />
          </span>
        ))}

        {/* Participant and observer rows */}
        {manageableParticipants.map((p) => {
          const roleOptions = derivePanelRoleOptionAvailability({
            participantId: p.id,
            participants: participantDraftSource,
            draft: effectiveDraft,
            roles: availableRoles,
          });
          const joinStatus = resolveJoinStatus(p);
          const joinStatusClass =
            joinStatus === "JOINED"
              ? "text-emerald-400"
              : joinStatus === "INACTIVE"
                ? "text-amber-400"
                : joinStatus === "DISCONNECTED"
                ? "text-rose-400"
                : "text-slate-500";
          const joinStatusLabel =
            joinStatus === "JOINED"
              ? t("common.joined")
              : joinStatus === "INACTIVE"
                ? t("sessions.inactive")
                : joinStatus === "DISCONNECTED"
                ? t("sessions.disconnected")
                : t("sessions.notJoinedYet");

          return (
            <div
              key={p.id}
              className={`flex flex-wrap items-center gap-3 rounded-lg border border-slate-700/40 bg-slate-900/40 ${
                isCompact ? "px-3 py-2.5" : "px-4 py-3"
              }`}
              data-testid={`role-row-${p.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-100">
                  {p.displayName}
                </p>
                <p className={`text-xs ${joinStatusClass}`}>
                  {joinStatusLabel}
                  {effectiveDraft[p.id] === OBSERVER_DRAFT_VALUE ? (
                    <span className="ml-2 text-xs text-cyan-300">
                      {t("sessions.observer")}
                    </span>
                  ) : null}
                  {effectiveDraft[p.id] === null ? (
                    <span
                      className="ml-2 text-xs text-amber-400"
                      data-testid="unassigned-badge"
                    >
                      {t("sessions.roleUnassigned")}
                    </span>
                  ) : null}
                </p>
              </div>
              <select
                value={effectiveDraft[p.id] ?? ""}
                onChange={(e) => {
                  const nextValue = e.target.value || null;
                  const shouldAdoptLatestPropsBeforeEditing =
                    propsChangedSinceBase && !hasUnsavedLocalChanges;

                  if (shouldAdoptLatestPropsBeforeEditing) {
                    setBaseDraft(propsDraft);
                    setBaseSignature(propsSignature);
                  }

                  setDraft((prev) => ({
                    ...(shouldAdoptLatestPropsBeforeEditing ? propsDraft : prev),
                    [p.id]: nextValue,
                  }));
                }}
                className={`${
                  isCompact ? "w-full sm:w-44" : "w-44"
                } shrink-0 ${inputClassName(false)} text-sm`}
                aria-label={`${t("common.assignedRole")}: ${p.displayName}`}
                data-testid={`role-select-${p.id}`}
              >
                <option value="">{t("sessions.roleUnassigned")}</option>
                {roleOptions.map((roleOption) => (
                  <option
                    key={roleOption.id}
                    value={roleOption.id}
                    disabled={roleOption.disabled}
                  >
                    {roleOption.disabled && roleOption.disabledReason
                      ? `${roleOption.name} (${t(
                          roleOption.disabledReason === "assignedToAnotherParticipant"
                            ? "sessions.roleAssignedToAnotherParticipant"
                            : "sessions.roleAlreadyAssigned",
                        )})`
                      : roleOption.name}
                  </option>
                ))}
                <option value={OBSERVER_DRAFT_VALUE}>
                  {t("participantType.OBSERVER")}
                </option>
              </select>
            </div>
          );
        })}

        {/* Non-participant rows (facilitator, observer) — show status only */}
        {staticParticipants.length > 0 ? (
          <div className="space-y-2">
            {staticParticipants.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 rounded-lg border border-slate-700/20 bg-slate-900/20 ${
                  isCompact ? "px-3 py-2" : "px-4 py-2.5"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className={isCompact ? "text-xs text-slate-300" : "text-sm text-slate-300"}>
                    {p.displayName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {t("sessions.facilitator")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {manageableParticipants.length > 0 ? (
          <GradientButton
            type="submit"
            disabled={isPending}
            className={isCompact ? "w-full" : undefined}
            data-testid="apply-roles-button"
          >
            {isPending ? t("common.saving") : t("sessions.applyRoles")}
          </GradientButton>
        ) : (
          <p className="text-sm text-slate-500">
            {t("sessions.noParticipants")}
          </p>
        )}
      </form>
    </div>
  );
}
