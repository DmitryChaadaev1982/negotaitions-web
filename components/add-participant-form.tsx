"use client";

import { useActionState, useState } from "react";

import {
  addAccountParticipant,
  type AddAccountParticipantState,
} from "@/app/actions/sessions";
import { PeoplePicker } from "@/components/people-picker";
import { GradientButton } from "@/components/ui/buttons";
import {
  alertErrorClassName,
  alertSuccessClassName,
  errorClassName,
  hintClassName,
  inputClassName,
  labelClassName,
} from "@/components/ui/form-styles";
import { useI18n } from "@/lib/i18n/useI18n";

const initialState: AddAccountParticipantState = {};

type ParticipantTypeOption = "PARTICIPANT" | "OBSERVER";

type SessionRoleOption = {
  id: string;
  name: string;
};

type AddParticipantFormProps = {
  sessionId: string;
  sessionRoles: SessionRoleOption[];
  assignedRoleIds: string[];
  hasFacilitator: boolean;
  existingParticipantUserIds?: string[];
};

export function AddParticipantForm({
  sessionId,
  sessionRoles,
  assignedRoleIds,
  existingParticipantUserIds = [],
}: AddParticipantFormProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    addAccountParticipant,
    initialState,
  );
  const [participantType, setParticipantType] =
    useState<ParticipantTypeOption>("PARTICIPANT");

  const isParticipant = participantType === "PARTICIPANT";
  const availableRoles = sessionRoles.filter(
    (role) => !assignedRoleIds.includes(role.id),
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="type" value={participantType} />

      {state.errors?.form ? (
        <div className={alertErrorClassName}>
          {state.errors.form.map((message) => tv(message)).join(", ")}
        </div>
      ) : null}

      {state.success ? (
        <div className={alertSuccessClassName}>
          {t("common.participantAdded")}
        </div>
      ) : null}

      <p className="text-sm text-slate-400">
        {t("sessions.addParticipantAccountHint")}
      </p>

      <div className="space-y-4">
        <div>
          <p className={labelClassName}>{t("sessions.selectParticipant")}</p>
          <PeoplePicker
            excludeUserIds={existingParticipantUserIds}
            userFieldName="invitedUserId"
            emailFieldName="invitedEmail"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t("common.type")}
            name="participantType"
            error={state.errors?.form?.[0]}
          >
            <select
              id="participantType"
              value={participantType}
              onChange={(event) =>
                setParticipantType(event.target.value as ParticipantTypeOption)
              }
              className={inputClassName(false)}
            >
              <option value="PARTICIPANT">{t("common.participant")}</option>
              <option value="OBSERVER">{t("common.observer")}</option>
            </select>
          </Field>

          <Field
            label={t("common.assignedRole")}
            name="sessionRoleId"
            error={state.errors?.sessionRoleId?.[0]}
            description={
              isParticipant
                ? t("sessions.assignedRoleRequired")
                : t("sessions.assignedRoleNotApplicable")
            }
          >
            {isParticipant ? (
              <select
                id="sessionRoleId"
                name="sessionRoleId"
                defaultValue=""
                className={inputClassName(!!state.errors?.sessionRoleId)}
              >
                {/* Phase 6.11B: allow adding participant without role — role assigned later via management panel */}
                <option value="">{t("sessions.assignRoleLater")}</option>
                {availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                id="sessionRoleId"
                disabled
                value=""
                className={`${inputClassName(false)} cursor-not-allowed opacity-60`}
              >
                <option value="">{t("common.notApplicable")}</option>
              </select>
            )}
          </Field>

          <div className="flex items-end">
            <GradientButton
              type="submit"
              disabled={isPending}
              className="w-full"
            >
              {isPending ? t("common.adding") : t("common.addParticipant")}
            </GradientButton>
          </div>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  required,
  description,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  description?: string;
  children: React.ReactNode;
}) {
  const { tv } = useI18n();

  return (
    <div>
      <label htmlFor={name} className={labelClassName}>
        {label}
        {required ? <span className="text-rose-400"> *</span> : null}
      </label>
      {description ? (
        <p className={hintClassName}>{description}</p>
      ) : null}
      {children}
      {error ? (
        <p className={errorClassName}>{tv(error)}</p>
      ) : null}
    </div>
  );
}
