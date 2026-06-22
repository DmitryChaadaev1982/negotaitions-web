"use client";

import { useActionState, useState } from "react";

import {
  addParticipant,
  type AddParticipantState,
} from "@/app/actions/sessions";
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

const initialState: AddParticipantState = {};

type ParticipantTypeOption = "PARTICIPANT" | "OBSERVER" | "FACILITATOR";

type SessionRoleOption = {
  id: string;
  name: string;
};

type AddParticipantFormProps = {
  sessionId: string;
  sessionRoles: SessionRoleOption[];
  assignedRoleIds: string[];
  hasFacilitator: boolean;
};

export function AddParticipantForm({
  sessionId,
  sessionRoles,
  assignedRoleIds,
  hasFacilitator,
}: AddParticipantFormProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    addParticipant,
    initialState,
  );
  const [participantType, setParticipantType] =
    useState<ParticipantTypeOption>("PARTICIPANT");

  const effectiveType =
    hasFacilitator && participantType === "FACILITATOR"
      ? "PARTICIPANT"
      : participantType;
  const isParticipant = effectiveType === "PARTICIPANT";
  const availableRoles = sessionRoles.filter(
    (role) => !assignedRoleIds.includes(role.id),
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="sessionId" value={sessionId} />

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label={t("common.displayName")}
          name="displayName"
          error={state.errors?.displayName?.[0]}
          required
        >
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            className={inputClassName(!!state.errors?.displayName)}
            placeholder="e.g. Alex Chen"
          />
        </Field>

        <Field
          label={t("common.type")}
          name="type"
          error={state.errors?.type?.[0]}
          required
        >
          <select
            id="type"
            name="type"
            required
            value={effectiveType}
            onChange={(event) => {
              const nextType = event.target.value as ParticipantTypeOption;
              if (nextType === "FACILITATOR" && hasFacilitator) {
                return;
              }
              setParticipantType(nextType);
            }}
            className={inputClassName(!!state.errors?.type)}
          >
            <option value="PARTICIPANT">{t("common.participant")}</option>
            <option value="OBSERVER">{t("common.observer")}</option>
            <option value="FACILITATOR" disabled={hasFacilitator}>
              {t("common.facilitator")}
              {hasFacilitator ? t("common.facilitatorAlreadyAdded") : ""}
            </option>
          </select>
        </Field>

        <Field
          label={t("common.assignedRole")}
          name="sessionRoleId"
          error={state.errors?.sessionRoleId?.[0]}
          required={isParticipant}
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
              required
              defaultValue=""
              className={inputClassName(!!state.errors?.sessionRoleId)}
            >
              <option value="" disabled>
                {t("common.selectRole")}
              </option>
              {availableRoles.length === 0 ? (
                <option value="" disabled>
                  {t("common.allRolesAssigned")}
                </option>
              ) : (
                availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))
              )}
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
            disabled={
              isPending || (isParticipant && availableRoles.length === 0)
            }
            className="w-full"
          >
            {isPending ? t("common.adding") : t("common.addParticipant")}
          </GradientButton>
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
