"use client";

import { useActionState, useMemo, useState } from "react";

import { createCase, updateCase, type CreateCaseState } from "@/app/actions/cases";
import { useCaseLanguageDefault } from "@/components/language-switcher";
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
import { useI18n } from "@/lib/i18n/useI18n";

const initialState: CreateCaseState = {};

type RoleField = {
  name: string;
  privateInstructions: string;
};

const emptyRole = (): RoleField => ({
  name: "",
  privateInstructions: "",
});

export type CaseFormInitialValues = {
  title: string;
  businessContext: string;
  publicInstructions: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  caseLanguage: "RU" | "EN";
  visibility: "PUBLIC" | "PRIVATE";
  defaultDurationMinutes: number;
  defaultPreparationDurationMinutes: number;
  roles: RoleField[];
};

type UserOption = {
  id: string;
  name: string | null;
  email: string;
};

type NewCaseFormProps = {
  caseId?: string;
  initialValues?: CaseFormInitialValues;
  currentUserId?: string;
  currentUserEmail?: string;
  activeUsers?: UserOption[];
  canAssignOwner?: boolean;
  currentOwnerUserId?: string;
};

function userLabel(user: UserOption): string {
  return user.name ? `${user.name} (${user.email})` : user.email;
}

export function NewCaseForm({
  caseId,
  initialValues,
  currentUserId,
  currentUserEmail,
  activeUsers = [],
  canAssignOwner = false,
  currentOwnerUserId,
}: NewCaseFormProps = {}) {
  const { t, tv } = useI18n();
  const isEdit = Boolean(caseId);
  const languageDefault = useCaseLanguageDefault();
  const defaultCaseLanguage = initialValues?.caseLanguage ?? languageDefault;
  const [state, formAction, isPending] = useActionState(
    isEdit ? updateCase : createCase,
    initialState,
  );
  const [roles, setRoles] = useState<RoleField[]>(
    initialValues?.roles ?? [emptyRole(), emptyRole()],
  );
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">(
    initialValues?.visibility ?? "PRIVATE",
  );

  const defaultOwnerUserId = currentOwnerUserId ?? currentUserId ?? "";
  const [ownerUserId, setOwnerUserId] = useState(defaultOwnerUserId);

  const selfOption = useMemo(
    () =>
      activeUsers.find((u) => u.id === currentUserId) ?? {
        id: currentUserId ?? "",
        name: null,
        email: currentUserEmail ?? "",
      },
    [activeUsers, currentUserId, currentUserEmail],
  );
  const ownerOptions = canAssignOwner ? activeUsers : [selfOption];

  const addRole = () => {
    if (roles.length < 4) {
      setRoles([...roles, emptyRole()]);
    }
  };

  const removeRole = (index: number) => {
    if (roles.length > 2) {
      setRoles(roles.filter((_, roleIndex) => roleIndex !== index));
    }
  };

  const updateRole = (
    index: number,
    field: keyof RoleField,
    value: string,
  ) => {
    setRoles(
      roles.map((role, roleIndex) =>
        roleIndex === index ? { ...role, [field]: value } : role,
      ),
    );
  };

  return (
    <form action={formAction} className="space-y-8">
      {isEdit ? <input type="hidden" name="caseId" value={caseId} /> : null}
      <input type="hidden" name="roleCount" value={roles.length} />
      <input type="hidden" name="ownerUserId" value={ownerUserId} />

      {/* Data confidentiality warning */}
      <div
        data-testid="case-data-warning"
        className="rounded-lg border border-amber-500/40 bg-amber-900/20 px-4 py-3 space-y-1"
      >
        <p className="text-sm font-medium text-amber-200">⚠️ {t("legal.caseDataWarning")}</p>
        <p className="text-xs text-amber-300/80">{t("legal.caseDataWarningExamples")}</p>
      </div>

      {state.errors?.form ? (
        <div className={alertErrorClassName}>
          {state.errors.form.map((message) => tv(message)).join(", ")}
        </div>
      ) : null}

      <CardSection title={t("cases.caseDetails")}>
        <div className="space-y-4">
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
              defaultValue={initialValues?.title}
              className={inputClassName(!!state.errors?.title)}
              placeholder={t("cases.titlePlaceholder")}
            />
          </Field>

          <Field
            label={t("cases.businessContext")}
            name="businessContext"
            error={state.errors?.businessContext?.[0]}
            required
          >
            <textarea
              id="businessContext"
              name="businessContext"
              required
              rows={4}
              defaultValue={initialValues?.businessContext}
              className={inputClassName(!!state.errors?.businessContext)}
              placeholder={t("cases.businessContextPlaceholder")}
            />
          </Field>

          <Field
            label={t("cases.publicInstructions")}
            name="publicInstructions"
            error={state.errors?.publicInstructions?.[0]}
            required
          >
            <textarea
              id="publicInstructions"
              name="publicInstructions"
              required
              rows={4}
              defaultValue={initialValues?.publicInstructions}
              className={inputClassName(!!state.errors?.publicInstructions)}
              placeholder={t("cases.publicInstructionsPlaceholder")}
            />
          </Field>

          <Field label={t("cases.caseLanguage")} name="caseLanguage">
            <select
              id="caseLanguage"
              name="caseLanguage"
              defaultValue={defaultCaseLanguage}
              className={inputClassName(false)}
            >
              <option value="EN">{t("cases.caseLanguageEn")}</option>
              <option value="RU">{t("cases.caseLanguageRu")}</option>
            </select>
          </Field>

          <Field
            label={t("cases.caseVisibilityLabel")}
            name="visibility"
            error={state.errors?.visibility?.[0]}
          >
            <div className="space-y-2">
              {(["PRIVATE", "PUBLIC"] as const).map((visibilityOption) => (
                <label
                  key={visibilityOption}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    visibility === visibilityOption
                      ? "border-cyan-500/40 bg-cyan-500/5"
                      : "border-slate-600/40 bg-slate-900/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={visibilityOption}
                    checked={visibility === visibilityOption}
                    onChange={() => setVisibility(visibilityOption)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {visibilityOption === "PUBLIC"
                        ? t("cases.publicCase")
                        : t("cases.privateCase")}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {visibilityOption === "PUBLIC"
                        ? t("cases.publicCaseHint")
                        : t("cases.privateCaseHint")}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </Field>

          {/* Owner field — placed near visibility per Phase 6.11A requirement */}
          <Field
            label={t("visibility.ownerLabel")}
            name="ownerUserIdDisplay"
          >
            {canAssignOwner ? (
              <>
                <select
                  id="ownerUserIdDisplay"
                  value={ownerUserId}
                  onChange={(e) => setOwnerUserId(e.target.value)}
                  className={inputClassName(false)}
                >
                  {ownerOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userLabel(u)}
                      {u.id === currentUserId ? " (you)" : ""}
                    </option>
                  ))}
                </select>
                <p className={hintClassName}>{t("visibility.ownerSelectHint")}</p>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-slate-300">
                  {selfOption.name
                    ? `${selfOption.name} (${selfOption.email})`
                    : selfOption.email}
                </p>
                <p className={hintClassName}>{t("visibility.ownerSelfOnlyHint")}</p>
              </>
            )}
            {state.errors?.form?.includes("ownerRequired") ? (
              <p className={errorClassName}>{t("visibility.ownerRequired")}</p>
            ) : null}
            {state.errors?.form?.includes("ownerMustBeActive") ? (
              <p className={errorClassName}>{t("visibility.ownerMustBeActive")}</p>
            ) : null}
          </Field>

          <Field
            label={t("cases.difficulty")}
            name="difficulty"
            error={state.errors?.difficulty?.[0]}
          >
            <select
              id="difficulty"
              name="difficulty"
              defaultValue={initialValues?.difficulty ?? "MEDIUM"}
              className={inputClassName(!!state.errors?.difficulty)}
            >
              <option value="EASY">{t("difficulty.EASY")}</option>
              <option value="MEDIUM">{t("difficulty.MEDIUM")}</option>
              <option value="HARD">{t("difficulty.HARD")}</option>
            </select>
          </Field>

          <Field
            label={t("cases.defaultPreparationDuration")}
            name="preparationDurationMinutes"
            error={state.errors?.preparationDurationMinutes?.[0]}
          >
            <input
              id="preparationDurationMinutes"
              name="preparationDurationMinutes"
              type="number"
              min={0}
              max={60}
              defaultValue={initialValues?.defaultPreparationDurationMinutes ?? 5}
              className={inputClassName(
                !!state.errors?.preparationDurationMinutes,
              )}
            />
            <p className={hintClassName}>
              {t("cases.defaultPreparationDurationHint")}
            </p>
          </Field>

          <Field
            label={t("cases.defaultNegotiationDuration")}
            name="negotiationDurationMinutes"
            error={state.errors?.negotiationDurationMinutes?.[0]}
          >
            <input
              id="negotiationDurationMinutes"
              name="negotiationDurationMinutes"
              type="number"
              min={1}
              max={180}
              defaultValue={initialValues?.defaultDurationMinutes ?? 15}
              className={inputClassName(
                !!state.errors?.negotiationDurationMinutes,
              )}
            />
            <p className={hintClassName}>
              {t("cases.defaultNegotiationDurationHint")}
            </p>
          </Field>
        </div>
      </CardSection>

      <CardSection
        title={t("cases.roles")}
        description={t("cases.rolesSectionDescription")}
      >
        {state.errors?.roles ? (
          <p className={`mb-4 ${errorClassName}`}>
            {state.errors.roles.map((message) => tv(message)).join(", ")}
          </p>
        ) : null}

        <div className="space-y-6">
          {roles.map((role, index) => (
            <div
              key={index}
              className="rounded-xl border border-violet-500/15 glass-panel-elevated p-4"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-50">
                  {t("common.roleNumber", { number: index + 1 })}
                </h3>
                {roles.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => removeRole(index)}
                    className="text-sm font-medium text-slate-400 hover:text-slate-50"
                  >
                    {t("common.remove")}
                  </button>
                ) : null}
              </div>

              <div className="space-y-4">
                <Field
                  label={t("cases.roleName")}
                  name={`roles.${index}.name`}
                  error={state.errors?.[`roles.${index}.name`]?.[0]}
                  required
                >
                  <input
                    id={`roles.${index}.name`}
                    name={`roles.${index}.name`}
                    type="text"
                    required
                    value={role.name}
                    onChange={(event) =>
                      updateRole(index, "name", event.target.value)
                    }
                    className={inputClassName(
                      !!state.errors?.[`roles.${index}.name`],
                    )}
                    placeholder={t("cases.roleNamePlaceholder")}
                  />
                </Field>

                <Field
                  label={t("cases.privateInstructions")}
                  name={`roles.${index}.privateInstructions`}
                  error={
                    state.errors?.[`roles.${index}.privateInstructions`]?.[0]
                  }
                  required
                >
                  <textarea
                    id={`roles.${index}.privateInstructions`}
                    name={`roles.${index}.privateInstructions`}
                    required
                    rows={4}
                    value={role.privateInstructions}
                    onChange={(event) =>
                      updateRole(
                        index,
                        "privateInstructions",
                        event.target.value,
                      )
                    }
                    className={inputClassName(
                      !!state.errors?.[`roles.${index}.privateInstructions`],
                    )}
                    placeholder={t("cases.privateInstructionsPlaceholder")}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>

        {roles.length < 4 ? (
          <button
            type="button"
            onClick={addRole}
            className="mt-4 text-sm font-medium text-blue-400 hover:text-blue-300"
          >
            {t("common.addRole")}
          </button>
        ) : null}
      </CardSection>

      <div className="flex items-center gap-3">
        <GradientButton type="submit" disabled={isPending}>
          {isPending
            ? isEdit
              ? t("cases.savingCase")
              : t("cases.creatingCase")
            : isEdit
              ? t("cases.saveCaseButton")
              : t("cases.createCaseButton")}
        </GradientButton>
        <SecondaryButtonLink
          href={isEdit ? `/cases/${caseId}` : "/cases"}
        >
          {t("common.cancel")}
        </SecondaryButtonLink>
      </div>
    </form>
  );
}

function CardSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <GlassCard>
      <GlassCardHeader>
        <h2 className="text-base font-semibold text-slate-50">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        ) : null}
      </GlassCardHeader>
      <GlassCardContent>{children}</GlassCardContent>
    </GlassCard>
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
