"use client";

import { useActionState, useMemo, useState } from "react";

import {
  assignParticipantRole,
  type AssignParticipantRoleState,
} from "@/app/actions/sessions";
import {
  alertErrorClassName,
  alertSuccessClassName,
  inputClassName,
} from "@/components/ui/form-styles";
import { GradientButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";
import { resolveConnectionStatus } from "@/lib/presence";

type SessionRoleOption = {
  id: string;
  name: string;
};
const OBSERVER_DRAFT_VALUE = "__observer__";
type DraftAssignmentValue = string | typeof OBSERVER_DRAFT_VALUE | null;

type ParticipantRoleEntry = {
  id: string;
  displayName: string;
  type: string;
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
   * If true, only renders a compact version suited for the video room sidebar.
   * Default: false (full page panel).
   */
  compact?: boolean;
};

const initialState: AssignParticipantRoleState = {};

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
  compact = false,
}: SessionRoleManagementPanelProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    assignParticipantRole,
    initialState,
  );

  // Local draft — each participant's selected role before Apply.
  const [draft, setDraft] = useState<Record<string, DraftAssignmentValue>>(() => {
    const initial: Record<string, DraftAssignmentValue> = {};
    for (const p of participants) {
      initial[p.id] =
        p.type === "OBSERVER" ? OBSERVER_DRAFT_VALUE : p.currentRoleId;
    }
    return initial;
  });

  // Facilitator is excluded from reassignment in this panel.
  const manageableParticipants = participants.filter(
    (p) => p.type !== "FACILITATOR",
  );
  const staticParticipants = participants.filter(
    (p) => p.type === "FACILITATOR",
  );

  // Build hidden form fields for all assignments in the draft.
  const formFields = useMemo(() => {
    return manageableParticipants.map((p) => ({
      participantId: p.id,
      roleId:
        draft[p.id] === OBSERVER_DRAFT_VALUE ? null : (draft[p.id] ?? null),
      participantType:
        draft[p.id] === OBSERVER_DRAFT_VALUE ? "OBSERVER" : "PARTICIPANT",
    }));
  }, [manageableParticipants, draft]);

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
      className={compact ? "space-y-3" : "space-y-4"}
      data-testid="session-role-management-panel"
    >
      {!compact ? (
        <div>
          <p className="text-sm text-slate-400">
            {t("sessions.roleManagementDescription")}
          </p>
        </div>
      ) : null}

      {state.errors?.form ? (
        <div className={alertErrorClassName}>
          {state.errors.form.map((message) => tv(message)).join(", ")}
        </div>
      ) : null}
      {state.success ? (
        <div className={alertSuccessClassName}>
          {t("sessions.roleAssignmentUpdated")}
        </div>
      ) : null}

      <form action={formAction} className="space-y-3">
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
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3"
              data-testid={`role-row-${p.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-100">
                  {p.displayName}
                </p>
                <p className={`text-xs ${joinStatusClass}`}>
                  {joinStatusLabel}
                  {draft[p.id] === null ? (
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
                value={draft[p.id] ?? ""}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    [p.id]: e.target.value || null,
                  }))
                }
                className={`w-40 shrink-0 ${inputClassName(false)} text-sm`}
                aria-label={`${t("common.assignedRole")}: ${p.displayName}`}
                data-testid={`role-select-${p.id}`}
              >
                <option value="">{t("sessions.roleUnassigned")}</option>
                {availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
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
        {!compact && staticParticipants.length > 0 ? (
          <div className="space-y-2">
            {staticParticipants.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border border-slate-700/20 bg-slate-900/20 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-300">{p.displayName}</p>
                  <p className="text-xs text-slate-500">
                    {t(`participantType.${p.type}` as `participantType.PARTICIPANT`)}
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
            className={compact ? "w-full" : undefined}
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
