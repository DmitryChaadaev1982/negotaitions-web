"use client";

import { useActionState, useMemo, useState } from "react";

import {
  createSession,
  type CreateSessionState,
} from "@/app/actions/sessions";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import {
  GradientButton,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import {
  alertErrorClassName,
  errorClassName,
  hintClassName,
  inputClassName,
  labelClassName,
} from "@/components/ui/form-styles";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import {
  DEFAULT_NEGOTIATION_DURATION_SECONDS,
  secondsToDisplayMinutes,
} from "@/lib/negotiation-duration";
import { useI18n } from "@/lib/i18n/useI18n";

const initialState: CreateSessionState = {};

type CaseOption = {
  id: string;
  title: string;
  caseLanguage: "RU" | "EN";
  defaultPreparationDurationSeconds: number;
  defaultDurationSeconds: number;
};

type UserOption = {
  id: string;
  name: string | null;
  email: string;
};

type NewSessionFormProps = {
  cases: CaseOption[];
  defaultCaseId?: string;
  currentUserId?: string;
  activeUsers?: UserOption[];
};

function userLabel(user: UserOption): string {
  return user.name ? `${user.name} (${user.email})` : user.email;
}

export function NewSessionForm({ cases, defaultCaseId, currentUserId, activeUsers = [] }: NewSessionFormProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    createSession,
    initialState,
  );
  const initialCaseId = defaultCaseId ?? cases[0]?.id ?? "";
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId);
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PRIVATE");
  const [selectedInvites, setSelectedInvites] = useState<string[]>([]);

  const toggleInvite = (userId: string) => {
    setSelectedInvites((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const invitableUsers = activeUsers.filter((u) => u.id !== currentUserId);

  const selectedCase = useMemo(
    () => cases.find((negotiationCase) => negotiationCase.id === selectedCaseId),
    [cases, selectedCaseId],
  );

  const [preparationDurationMinutes, setPreparationDurationMinutes] = useState(
    selectedCase
      ? secondsToDisplayMinutes(selectedCase.defaultPreparationDurationSeconds)
      : 5,
  );
  const [durationMinutes, setDurationMinutes] = useState(
    selectedCase
      ? secondsToDisplayMinutes(selectedCase.defaultDurationSeconds)
      : secondsToDisplayMinutes(DEFAULT_NEGOTIATION_DURATION_SECONDS),
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.errors?.form ? (
        <div className={alertErrorClassName}>
          {state.errors.form.map((message) => tv(message)).join(", ")}
        </div>
      ) : null}

      {/* Hidden fields for controlled state */}
      <input type="hidden" name="visibility" value={visibility} />
      {selectedInvites.map((userId) => (
        <input key={userId} type="hidden" name="invitedUserId" value={userId} />
      ))}

      <GlassCard>
        <GlassCardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("sessions.sessionDetails")}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {t("sessions.sessionDetailsSectionDescription")}
          </p>
        </GlassCardHeader>
        <GlassCardContent className="space-y-4">
          <Field
            label={t("common.title")}
            name="title"
            error={state.errors?.title?.[0]}
            required
          >
            <input
              id="title"
              name="title"
              type="text"
              required
              className={inputClassName(!!state.errors?.title)}
              placeholder={t("sessions.titlePlaceholder")}
            />
          </Field>

          <Field
            label={t("common.caseLabel")}
            name="caseId"
            error={state.errors?.caseId?.[0]}
            required
          >
            <select
              id="caseId"
              name="caseId"
              required
              value={selectedCaseId}
              onChange={(event) => {
                const caseId = event.target.value;
                setSelectedCaseId(caseId);
                const negotiationCase = cases.find(
                  (negotiationCaseOption) => negotiationCaseOption.id === caseId,
                );
                if (negotiationCase) {
                  setPreparationDurationMinutes(
                    secondsToDisplayMinutes(
                      negotiationCase.defaultPreparationDurationSeconds,
                    ),
                  );
                  setDurationMinutes(
                    secondsToDisplayMinutes(
                      negotiationCase.defaultDurationSeconds,
                    ),
                  );
                }
              }}
              className={inputClassName(!!state.errors?.caseId)}
            >
              <option value="" disabled>
                {t("common.selectCase")}
              </option>
              {cases.map((negotiationCase) => (
                <option key={negotiationCase.id} value={negotiationCase.id}>
                  {negotiationCase.title}
                </option>
              ))}
            </select>
            {selectedCase ? (
              <div className="mt-2">
                <CaseLanguageBadge caseLanguage={selectedCase.caseLanguage} />
              </div>
            ) : null}
          </Field>

          <Field
            label={t("common.preparationDurationMinutes")}
            name="preparationDurationMinutes"
            error={state.errors?.preparationDurationMinutes?.[0]}
            required
          >
            <input
              id="preparationDurationMinutes"
              name="preparationDurationMinutes"
              type="number"
              min={0}
              max={60}
              required
              value={preparationDurationMinutes}
              onChange={(event) =>
                setPreparationDurationMinutes(Number(event.target.value))
              }
              className={inputClassName(
                !!state.errors?.preparationDurationMinutes,
              )}
            />
            <p className={hintClassName}>
              {t("sessions.defaultPreparationFromCase", {
                minutes: selectedCase
                  ? secondsToDisplayMinutes(
                      selectedCase.defaultPreparationDurationSeconds,
                    )
                  : 5,
              })}
            </p>
          </Field>

          <Field
            label={t("common.negotiationDurationMinutes")}
            name="negotiationDurationMinutes"
            error={state.errors?.negotiationDurationMinutes?.[0]}
            required
          >
            <input
              id="negotiationDurationMinutes"
              name="negotiationDurationMinutes"
              type="number"
              min={1}
              max={180}
              required
              value={durationMinutes}
              onChange={(event) =>
                setDurationMinutes(Number(event.target.value))
              }
              className={inputClassName(
                !!state.errors?.negotiationDurationMinutes,
              )}
            />
            <p className={hintClassName}>
              {t("sessions.defaultFromCase", {
                minutes: selectedCase
                  ? secondsToDisplayMinutes(selectedCase.defaultDurationSeconds)
                  : secondsToDisplayMinutes(DEFAULT_NEGOTIATION_DURATION_SECONDS),
              })}
            </p>
          </Field>
        </GlassCardContent>
      </GlassCard>

      {/* Visibility + Invited users */}
      <GlassCard>
        <GlassCardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("visibility.visibilityLabel")}
          </h2>
        </GlassCardHeader>
        <GlassCardContent className="space-y-4">
          <div className="space-y-2">
            {(["PRIVATE", "PUBLIC"] as const).map((v) => (
              <label
                key={v}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  visibility === v
                    ? "border-cyan-500/40 bg-cyan-500/5"
                    : "border-slate-600/40 bg-slate-900/50"
                }`}
              >
                <input
                  type="radio"
                  name="_visibilityRadio"
                  value={v}
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    {v === "PUBLIC" ? t("visibility.public") : t("visibility.private")}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {v === "PUBLIC"
                      ? t("visibility.publicOption")
                      : t("visibility.privateOption")}
                  </p>
                </div>
              </label>
            ))}
          </div>

          {invitableUsers.length > 0 ? (
            <div>
              <p className={labelClassName}>{t("visibility.invitedUsers")}</p>
              <p className="mb-2 text-xs text-amber-400/80">
                {t("visibility.invitedUsersHint")}
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-600/40 bg-slate-900/50 p-2">
                {invitableUsers.map((user) => (
                  <label
                    key={user.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={selectedInvites.includes(user.id)}
                      onChange={() => toggleInvite(user.id)}
                    />
                    {userLabel(user)}
                  </label>
                ))}
              </div>
              {selectedInvites.length > 0 ? (
                <p className="mt-1 text-xs text-cyan-400">
                  {selectedInvites.length} invited
                </p>
              ) : null}
            </div>
          ) : null}
        </GlassCardContent>
      </GlassCard>

      <div className="flex items-center gap-3">
        <GradientButton type="submit" disabled={isPending || cases.length === 0}>
          {isPending ? t("common.creating") : t("sessions.createSession")}
        </GradientButton>
        <SecondaryButtonLink href="/sessions">
          {t("common.cancel")}
        </SecondaryButtonLink>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const { tv } = useI18n();

  return (
    <div>
      <label htmlFor={name} className={labelClassName}>
        {label}
        {required ? <span className="text-rose-400"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p className={errorClassName}>{tv(error)}</p>
      ) : null}
    </div>
  );
}
