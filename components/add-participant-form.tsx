"use client";

import { useActionState, useState } from "react";

import {
  addParticipant,
  type AddParticipantState,
} from "@/app/actions/sessions";

const initialState: AddParticipantState = {};

type ParticipantTypeOption = "PARTICIPANT" | "OBSERVER" | "FACILITATOR";

type CaseRole = {
  id: string;
  name: string;
};

type AddParticipantFormProps = {
  sessionId: string;
  caseRoles: CaseRole[];
  assignedRoleIds: string[];
  hasFacilitator: boolean;
};

export function AddParticipantForm({
  sessionId,
  caseRoles,
  assignedRoleIds,
  hasFacilitator,
}: AddParticipantFormProps) {
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
  const availableRoles = caseRoles.filter(
    (role) => !assignedRoleIds.includes(role.id),
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="sessionId" value={sessionId} />

      {state.errors?.form ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {state.errors.form.join(", ")}
        </div>
      ) : null}

      {state.success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Participant added.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Display name"
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
          label="Type"
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
            <option value="PARTICIPANT">Participant</option>
            <option value="OBSERVER">Observer</option>
            <option value="FACILITATOR" disabled={hasFacilitator}>
              Facilitator{hasFacilitator ? " (already added)" : ""}
            </option>
          </select>
        </Field>

        <Field
          label="Assigned role"
          name="caseRoleId"
          error={state.errors?.caseRoleId?.[0]}
          required={isParticipant}
          description={
            isParticipant
              ? "Required for participants. Each role can only be assigned once."
              : "Not applicable for observers or facilitators."
          }
        >
          {isParticipant ? (
            <select
              id="caseRoleId"
              name="caseRoleId"
              required
              defaultValue=""
              className={inputClassName(!!state.errors?.caseRoleId)}
            >
              <option value="" disabled>
                Select a role
              </option>
              {availableRoles.length === 0 ? (
                <option value="" disabled>
                  All roles are already assigned
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
              id="caseRoleId"
              disabled
              value=""
              className={`${inputClassName(false)} cursor-not-allowed bg-slate-100 text-slate-500`}
            >
              <option value="">Not applicable</option>
            </select>
          )}
        </Field>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={
              isPending || (isParticipant && availableRoles.length === 0)
            }
            className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Adding..." : "Add participant"}
          </button>
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
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-1.5 block text-sm font-medium text-slate-700"
      >
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </label>
      {description ? (
        <p className="mb-1.5 text-xs text-slate-500">{description}</p>
      ) : null}
      {children}
      {error ? <p className="mt-1.5 text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}

function inputClassName(hasError: boolean) {
  return `block w-full rounded-md border px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
    hasError
      ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
      : "border-slate-300 focus:border-slate-500 focus:ring-slate-500/20"
  }`;
}
