"use client";

import {
  evaluatePasswordChecklist,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  projectPasswordServerChecks,
  type PasswordChecklistStatus,
} from "@/lib/auth/password-policy-constants";
import { useI18n } from "@/lib/i18n/useI18n";

const REQUIREMENT_IDS = [
  "minLength",
  "maxLength",
  "match",
  "common",
  "reused",
] as const;

type PasswordRequirementsProps = {
  password: string;
  confirmation: string;
  id?: string;
  submittedPassword?: string | null;
  serverSuccess?: boolean;
  serverError?: string | null;
};

function StatusMark({ status }: { status: PasswordChecklistStatus }) {
  const tone =
    status === "met"
      ? "text-emerald-400"
      : status === "unmet"
        ? "text-amber-200"
        : "text-slate-500";

  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`}
    >
      {status === "met" ? (
        <path
          d="M3.5 8.5 6.5 11.5 12.5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          {status === "unmet" ? (
            <path
              d="M5 8h6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ) : null}
        </>
      )}
    </svg>
  );
}

export function PasswordRequirements({
  password,
  confirmation,
  id = "password-requirements",
  submittedPassword = null,
  serverSuccess = false,
  serverError = null,
}: PasswordRequirementsProps) {
  const { t } = useI18n();
  const live = evaluatePasswordChecklist({ password, confirmation });
  const server = projectPasswordServerChecks({
    password,
    submittedPassword,
    success: serverSuccess,
    error: serverError,
  });
  const checklist = {
    minLength: live.minLength,
    maxLength: live.maxLength,
    match: live.match,
    common: server.common,
    reused: server.reused,
  };
  const labels = {
    minLength: t("auth.passwordRequirementMin", { min: PASSWORD_MIN_LENGTH }),
    maxLength: t("auth.passwordRequirementMax", { max: PASSWORD_MAX_LENGTH }),
    match: t("auth.passwordRequirementMatch"),
    common: t("auth.passwordRequirementCommon"),
    reused: t("auth.passwordRequirementReused"),
  };
  const statusText: Record<PasswordChecklistStatus, string> = {
    met: t("auth.passwordRequirementMet"),
    unmet: t("auth.passwordRequirementUnmet"),
    neutral: t("auth.passwordRequirementNeutral"),
  };

  return (
    <div className="space-y-2" data-testid="password-requirements-group">
      <ul
        id={id}
        aria-live="polite"
        aria-atomic="false"
        aria-label={t("auth.passwordRequirementsLabel")}
        data-testid="password-requirements"
        className="space-y-1.5"
      >
        {REQUIREMENT_IDS.map((requirementId) => {
          const status = checklist[requirementId];
          const tone =
            status === "met"
              ? "text-emerald-400"
              : status === "unmet"
                ? "text-amber-200"
                : "text-slate-500";
          return (
            <li
              key={requirementId}
              data-testid={`password-requirement-${requirementId}`}
              data-state={status}
              className={`flex items-start gap-2 text-sm ${tone}`}
            >
              <StatusMark status={status} />
              <span>
                {labels[requirementId]}
                <span className="sr-only"> {statusText[status]}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
