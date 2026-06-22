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
  defaultDurationSeconds: number;
};

type NewSessionFormProps = {
  cases: CaseOption[];
  defaultCaseId?: string;
};

export function NewSessionForm({ cases, defaultCaseId }: NewSessionFormProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState(
    createSession,
    initialState,
  );
  const initialCaseId = defaultCaseId ?? cases[0]?.id ?? "";
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId);

  const selectedCase = useMemo(
    () => cases.find((negotiationCase) => negotiationCase.id === selectedCaseId),
    [cases, selectedCaseId],
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
